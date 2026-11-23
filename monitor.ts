// Error monitoring. No packages: it speaks the Sentry HTTP "envelope" format directly and can also post a short alert to a webhook
// (Slack / Discord / Telegram bridge / anything that accepts JSON). Everything is optional and every call is best-effort:
// captureError NEVER throws and never slows a request more than a short timeout.
//
//   SENTRY_DSN          https://<key>@<host>/<project>   (also accepted: NEXT_PUBLIC_SENTRY_DSN)
//   ALERT_WEBHOOK_URL   a URL that accepts POST {"text": "..."} (Slack-style; Discord accepts {"content"} too, both are sent)
//   ALERT_MIN_GAP_MIN   minutes between two alerts for the SAME error (default 10)
//
// Secrets are cut out of messages before anything leaves the server (keys, bearer tokens, long hex/base64 strings, card numbers).

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export type Ctx = { where?: string; uid?: string; runId?: string; chatId?: string; level?: "error" | "warning" | "fatal"; extra?: Record<string, unknown> };

const PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk|rk|pk|xox[abprs]|ghp|gho|github_pat|AIza|AKIA|ya29)[-_A-Za-z0-9]{12,}/g, "[key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [token]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[jwt]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[number]"],
  [/\b[A-Fa-f0-9]{32,}\b/g, "[hex]"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}/g, "[blob]"],
  [/([?&](?:key|token|secret|password|code|api_key|access_token)=)[^&\s]+/gi, "$1[x]"],
];

/** Removes anything that looks like a secret. Used on every message and stack before it leaves the server. */
export function redact(text: string): string {
  let t = String(text ?? "");
  for (const [re, to] of PATTERNS) t = t.replace(re, to);
  return t.slice(0, 4000);
}

export function parseDsn(dsn: string | undefined): { url: string; key: string; project: string; host: string } | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+/, "").split("/").pop() || "";
    if (!u.username || !project || !/^https?:$/.test(u.protocol)) return null;
    return { url: `${u.protocol}//${u.host}/api/${project}/envelope/`, key: u.username, project, host: u.host };
  } catch { return null; }
}

/** Same error -> same fingerprint (numbers and ids are removed so "run r123 failed" and "run r456 failed" group together). */
export function fingerprint(err: unknown, where = ""): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const msg = redact(e.message).replace(/\b[a-z]*\d[\w-]*\b/gi, "#").slice(0, 120);
  return `${where}|${e.name}|${msg}`;
}

export function buildEnvelope(err: unknown, ctx: Ctx, dsn: { key: string; project: string }, now = Date.now(), env: Env = {}): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const eventId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const event = {
    event_id: eventId,
    timestamp: now / 1000,
    platform: "node",
    level: ctx.level ?? "error",
    environment: env.VERCEL_ENV || env.NODE_ENV || "production",
    release: env.VERCEL_GIT_COMMIT_SHA || undefined,
    server_name: "agenticvenus",
    message: redact(e.message),
    exception: { values: [{ type: e.name, value: redact(e.message), stacktrace: undefined }] },
    extra: { stack: redact(e.stack ?? ""), where: ctx.where, runId: ctx.runId, chatId: ctx.chatId, ...(ctx.extra ?? {}) },
    // a short, one-way id of the user so errors can be grouped; never the raw id or any e-mail
    user: ctx.uid ? { id: "u_" + simpleHash(ctx.uid) } : undefined,
    tags: { where: ctx.where || "unknown" },
  };
  const header = JSON.stringify({ event_id: eventId, sent_at: new Date(now).toISOString(), dsn: `https://${dsn.key}@x/${dsn.project}` });
  const item = JSON.stringify({ type: "event" });
  return `${header}\n${item}\n${JSON.stringify(event)}`;
}

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const lastAlert = new Map<string, number>();
export function shouldAlert(fp: string, now: number, gapMs: number): boolean {
  const last = lastAlert.get(fp);
  if (last !== undefined && now - last < gapMs) return false;
  if (lastAlert.size > 500) lastAlert.clear();
  lastAlert.set(fp, now);
  return true;
}
export const _resetAlerts = () => lastAlert.clear();

export function alertText(err: unknown, ctx: Ctx): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const bits = [`AgenticVenus ${ctx.level === "warning" ? "warning" : "error"}${ctx.where ? " in " + ctx.where : ""}`, redact(e.message).slice(0, 300)];
  if (ctx.runId) bits.push(`run ${ctx.runId}`);
  return bits.join(" - ");
}

/**
 * Report an error. Logs one JSON line (Vercel keeps it), sends it to Sentry when SENTRY_DSN is set and posts a short alert when
 * ALERT_WEBHOOK_URL is set (at most once per ALERT_MIN_GAP_MIN minutes for the same error). Never throws.
 */
export async function captureError(err: unknown, ctx: Ctx = {}, opts: { env?: Env; fetchImpl?: FetchLike; now?: number } = {}): Promise<void> {
  try {
    const env = opts.env ?? ((typeof process !== "undefined" ? process.env : {}) as Env);
    const now = opts.now ?? Date.now();
    const f: FetchLike | undefined = opts.fetchImpl ?? (typeof fetch === "function" ? (fetch as unknown as FetchLike) : undefined);
    const e = err instanceof Error ? err : new Error(String(err));
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ at: new Date(now).toISOString(), level: ctx.level ?? "error", where: ctx.where, runId: ctx.runId, name: e.name, message: redact(e.message) }));
    if (!f) return;
    const jobs: Array<Promise<unknown>> = [];
    const dsn = parseDsn(env.SENTRY_DSN || env.NEXT_PUBLIC_SENTRY_DSN);
    if (dsn) {
      jobs.push(f(dsn.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=agenticvenus/1.0, sentry_key=${dsn.key}` },
        body: buildEnvelope(e, ctx, dsn, now, env),
        signal: AbortSignal.timeout(3000),
      }).catch(() => undefined));
    }
    const hook = env.ALERT_WEBHOOK_URL;
    if (hook && /^https:\/\//.test(hook) && ctx.level !== "warning") {
      const gap = Math.max(1, Number(env.ALERT_MIN_GAP_MIN) || 10) * 60_000;
      if (shouldAlert(fingerprint(e, ctx.where), now, gap)) {
        const text = alertText(e, ctx);
        jobs.push(f(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(3000) }).catch(() => undefined));
      }
    }
    await Promise.all(jobs);
  } catch { /* monitoring must never break the thing it watches */ }
}
