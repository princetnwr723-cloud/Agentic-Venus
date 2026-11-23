// Rate limiting. PURE: no imports, no network, no database, so it runs in the Edge middleware, in API routes and in node --test.
//
// Two layers use it:
//   1) middleware.ts   - per IP, for every /api/* request (stops floods and bot-farming before any code runs)
//   2) lib/request.ts  - per signed-in user and route family (readBody calls it right after the login check)
//
// How it counts: a "sliding window counter". Two neighbouring fixed windows are blended, so a burst at the end of one window
// and the start of the next can not slip through at double speed, and it needs only two numbers per key.
//
// Honest limit: on a serverless host (Vercel) every warm instance has its own memory. This stops floods and loops that hit one
// instance, which is what abuse looks like in practice, but it is not a global exact counter. Things that cost real money
// (computer time, tokens, videos, websites) are ALSO limited per user in the billing database (lib/billing-server.ts).

export type Rule = { name: string; limit: number; windowMs: number };
export type Hit = { ok: boolean; remaining: number; retryAfterMs: number; limit: number };

type Slot = { ws: number; count: number; prev: number };

export class MemoryLimiter {
  private map = new Map<string, Slot>();
  private readonly maxKeys: number;
  // (no TypeScript parameter properties: the tests run these files with Node's type stripping)
  constructor(maxKeys = 5000) { this.maxKeys = maxKeys; }

  /** Counts one request for `key` under `rule`. `now` is injectable for tests. */
  hit(key: string, rule: Rule, now = Date.now()): Hit {
    const w = Math.max(1, rule.windowMs);
    const ws = Math.floor(now / w) * w;
    let e = this.map.get(key);
    if (!e) e = { ws, count: 0, prev: 0 };
    if (e.ws !== ws) {
      e.prev = ws - e.ws === w ? e.count : 0;
      e.count = 0;
      e.ws = ws;
    }
    const weight = 1 - (now - ws) / w;
    const used = e.prev * weight + e.count;
    // keep the map small: touched keys move to the end, the oldest go first
    this.map.delete(key);
    this.map.set(key, e);
    if (this.map.size > this.maxKeys) this.evict(now, w);
    if (used + 1 > rule.limit) {
      // when would one more request fit? Worst case: at the end of this window.
      const retry = Math.max(250, ws + w - now);
      return { ok: false, remaining: 0, retryAfterMs: retry, limit: rule.limit };
    }
    e.count++;
    return { ok: true, remaining: Math.max(0, Math.floor(rule.limit - (used + 1))), retryAfterMs: 0, limit: rule.limit };
  }

  private evict(now: number, w: number) {
    let drop = Math.ceil(this.maxKeys * 0.1);
    for (const [k, v] of this.map) {
      if (drop <= 0) break;
      if (now - v.ws > 2 * w) { this.map.delete(k); drop--; }
    }
    // still too big: the oldest keys go, whatever their age
    for (const k of this.map.keys()) {
      if (this.map.size <= this.maxKeys) break;
      this.map.delete(k);
    }
  }

  get size() { return this.map.size; }
  clear() { this.map.clear(); }
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Per signed-in user. A route family not listed here gets the default. Numbers are per user, per family.
 * Hot polling routes (agent status, dashboard, runner steps) stay on the generous default on purpose.
 */
export const USER_RULES: Array<{ test: RegExp; rule: Rule }> = [
  // creates a paid cloud computer: a handful per hour is plenty for a human
  { test: /^\/api\/e2b\/create/, rule: { name: "pc-create", limit: 6, windowMs: HOUR } },
  { test: /^\/api\/e2b\/(shell|screen)/, rule: { name: "pc-io", limit: 300, windowMs: MIN } },
  // each search can fire outbound probes to other servers
  { test: /^\/api\/connectors\/mcp-search/, rule: { name: "mcp-search", limit: 40, windowMs: MIN } },
  { test: /^\/api\/connectors\/catalog/, rule: { name: "mcp-catalog", limit: 120, windowMs: MIN } },
  { test: /^\/api\/connectors\/(mcp-oauth|oauth)\/start/, rule: { name: "oauth-start", limit: 20, windowMs: MIN } },
  { test: /^\/api\/connectors\/test/, rule: { name: "connector-test", limit: 40, windowMs: MIN } },
  // secrets and money
  { test: /^\/api\/(vault|vpassword|creds)/, rule: { name: "secrets", limit: 120, windowMs: MIN } },
  { test: /^\/api\/billing\//, rule: { name: "billing", limit: 30, windowMs: MIN } },
  { test: /^\/api\/native-auth\//, rule: { name: "native-auth", limit: 20, windowMs: MIN } },
  { test: /^\/api\/account/, rule: { name: "account", limit: 10, windowMs: HOUR } },
  // things that make the server fetch other sites
  { test: /^\/api\/skills\/(fetch|install)/, rule: { name: "skills-fetch", limit: 30, windowMs: MIN } },
  // publishing a site: a few per minute is plenty (Venus Pro / team routes are NOT limited here: they make many small calls on purpose)
  { test: /^\/api\/deploy(\/?$)/, rule: { name: "deploy", limit: 10, windowMs: MIN } },
  { test: /^\/api\/(chat|chat\/stream)(\/?$)/, rule: { name: "chat", limit: 240, windowMs: MIN } },
];
export const DEFAULT_USER_RULE: Rule = { name: "api", limit: 900, windowMs: MIN };

export function userRuleFor(pathname: string): Rule {
  for (const r of USER_RULES) if (r.test.test(pathname)) return r.rule;
  return DEFAULT_USER_RULE;
}

/**
 * Per IP (Edge middleware). Webhooks are NOT limited here: Telegram, Slack, Twilio, Gumroad and the meeting bot come from a few
 * shared addresses and prove who they are with their own signatures.
 */
export const IP_EXEMPT = /^\/api\/(channels\/|billing\/gumroad|meetings\/webhook|voice\/(twiml|status)|routines\/hook|runner\/tick|agent\/tick|watchers\/tick|missions\/tick|proactive\/tick)/;
export const IP_RULES: Array<{ test: RegExp; rule: Rule }> = [
  { test: /^\/api\/(native-auth|mcp\/oauth|connectors\/(oauth|mcp-oauth)\/(callback|go))/, rule: { name: "ip-auth", limit: 60, windowMs: MIN } },
  { test: /^\/api\/(billing|vault|vpassword|creds|account)/, rule: { name: "ip-sensitive", limit: 120, windowMs: MIN } },
];
export const DEFAULT_IP_RULE: Rule = { name: "ip-api", limit: 1500, windowMs: MIN };

export function ipRuleFor(pathname: string): Rule | null {
  if (IP_EXEMPT.test(pathname)) return null;
  for (const r of IP_RULES) if (r.test.test(pathname)) return r.rule;
  return DEFAULT_IP_RULE;
}

/** The client address as far as the host tells us. Never trusted for security decisions, only for counting. */
export function clientIp(h: { get(name: string): string | null }): string {
  const xff = (h.get("x-forwarded-for") || "").split(",")[0].trim();
  const ip = xff || (h.get("x-real-ip") || "").trim() || (h.get("cf-connecting-ip") || "").trim();
  return ip.slice(0, 64) || "unknown";
}

export const retryAfterSeconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** Switch for emergencies and local development: RATE_LIMIT=off. */
export const rateLimitOn = (env: Record<string, string | undefined> = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>) =>
  !/^(off|0|false|no)$/i.test(String(env.RATE_LIMIT ?? ""));

/** One limiter per process, shared by the middleware file and readBody when they run in the same isolate. */
const g = globalThis as unknown as { __venusLimiter?: MemoryLimiter };
export const sharedLimiter = (): MemoryLimiter => (g.__venusLimiter ??= new MemoryLimiter());
