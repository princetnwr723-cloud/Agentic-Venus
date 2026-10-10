import { FREE_TOOLS, PLUGIN_TOOLS, type Def } from "./plugins";
import { GITHUB_EXTRA } from "./github-extra";
import { IDENTITY_TOOLS } from "./identity";
import { VERIFY_TOOLS } from "./verify";
import { VOICE_TOOLS } from "./voice";
import { mcpCall, mcpList, paramSummary, type McpTool } from "./mcp-client";
import { assertPublicUrl, cut, http } from "./net";
import { safeId, unpack } from "./catalog";
import { OAUTH_PROVIDERS, type OAuthProvider } from "./oauth-catalog";
import { INJECTION_PATTERNS, wrapUntrusted } from "@/lib/shield";
import type { Risk, ToolCtx, ToolResult, ToolSpec } from "./types";

type Conn = Record<string, string>;
const ALL: Record<string, Def[]> = {
  ...PLUGIN_TOOLS,
  github: [...(PLUGIN_TOOLS.github ?? []), ...GITHUB_EXTRA],
  identity: IDENTITY_TOOLS,
};
const ALL_FREE: Def[] = [...FREE_TOOLS, ...VERIFY_TOOLS, ...VOICE_TOOLS];
const READISH = /^(get|list|search|find|read|fetch|query|describe|lookup|view|check|count|show)/i;

const json = <T,>(v?: string): T | null => { try { return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const isAuto = (c: Conn, id: string) => c["auto:" + id] === "1";

type McpEntry = { id: string; url: string; auth?: string };
type ApiEntry = { id: string; baseUrl: string; header?: string; value?: string; description?: string };
const mcpEntries = (c: Conn): McpEntry[] =>
  Object.entries(c).filter(([k]) => k.startsWith("mcp:")).map(([k, v]) => ({ id: k.slice(4), ...(json<{ url: string; auth?: string }>(v) ?? { url: "" }) })).filter((e) => e.url);
const apiEntries = (c: Conn): ApiEntry[] =>
  Object.entries(c).filter(([k]) => k.startsWith("api:")).map(([k, v]) => ({ id: k.slice(4), ...(json<Omit<ApiEntry, "id">>(v) ?? { baseUrl: "" }) })).filter((e) => e.baseUrl);

function mcpRisk(t: McpTool): Risk {
  if (t.annotations?.readOnlyHint === true) return "read";
  if (t.annotations?.readOnlyHint === false || t.annotations?.destructiveHint === true) return "write";
  return READISH.test(t.name) ? "read" : "write";
}

// MCP tool descriptions go straight into the prompt, so they are untrusted too.
const safeDesc = (d?: string) => {
  const t = (d ?? "").slice(0, 200);
  return INJECTION_PATTERNS.some(([, re]) => re.test(t)) ? "(description hidden: it contained instruction-like text)" : t;
};

const toSpec = (d: Def, source: string): ToolSpec => ({ name: d.name, description: d.description, params: d.params, risk: d.risk, source });

export async function buildCatalog(c: Conn): Promise<{ specs: ToolSpec[]; errors: string[] }> {
  const specs: ToolSpec[] = ALL_FREE.map((d) => toSpec(d, "free"));
  const errors: string[] = [];
  for (const [id, defs] of Object.entries(ALL)) if (c[id]) specs.push(...defs.map((d) => toSpec(d, id)));

  const mcp = mcpEntries(c);
  const results = await Promise.allSettled(mcp.map((e) => mcpList(e.url, e.auth)));
  results.forEach((r, i) => {
    const e = mcp[i];
    if (r.status === "rejected") { errors.push(`mcp:${e.id} — ${r.reason instanceof Error ? r.reason.message : "failed"}`); return; }
    for (const t of r.value) {
      specs.push({ name: `mcp_${safeId(e.id)}.${t.name}`, description: safeDesc(t.description), params: paramSummary(t), risk: mcpRisk(t), source: `mcp:${e.id}` });
    }
  });
  for (const p of OAUTH_PROVIDERS) {
    if (c[`oauth:${p.id}`]) specs.push({ name: `oauth_${safeId(p.id)}.request`, source: `oauth:${p.id}`, risk: "read", description: `${p.label} API request limited to ${p.apiHost}. GET is read-only; other methods require approval.`, params: "method:GET|POST|PUT|PATCH|DELETE, path:string, body?:object" });
  }
  for (const e of apiEntries(c)) {
    specs.push({
      name: `api_${safeId(e.id)}.request`, source: `api:${e.id}`, risk: "read",
      description: `${safeDesc(e.description) || "REST API"} (GET is free; POST/PUT/PATCH/DELETE need approval). Base ${e.baseUrl}`,
      params: "method:GET|POST|PUT|PATCH|DELETE, path:string (starts with /), body?:object",
    });
  }
  return { specs, errors };
}

/**
 * Everything that came from outside goes through the shield.
 * Exception: verify.* results are computed by OUR code (they contain no page text), so they stay plain and parseable.
 */
function good(text: string, source: string, risk: Risk, ok = true): ToolResult {
  if (source.startsWith("verify.")) return { ok, text: cut(text, 20000), flagged: [], risk };
  const w = wrapUntrusted(cut(text), source);
  return { ok, text: w.text, flagged: w.flagged, risk };
}

const ask = (name: string, args: Record<string, unknown>, risk: Risk): ToolResult => ({
  ok: false, text: "Waiting for the user's approval.",
  needsApproval: { summary: `${name}\n${JSON.stringify(args).slice(0, 400)}`, risk },
});

// ---- OAuth tokens: stored as {access, refresh, exp}. Old plain-string tokens still work. ----
type OTok = { access: string; refresh?: string; exp?: number };
const parseTok = (v: string): OTok => {
  try { const j = JSON.parse(v); if (j && typeof j.access === "string") return j as OTok; } catch { /* plain token */ }
  return { access: v };
};
async function refreshTok(p: OAuthProvider, t: OTok): Promise<OTok> {
  const id = process.env[p.clientIdEnv], secret = process.env[p.clientSecretEnv];
  if (!id || !secret || !t.refresh) throw new Error("no refresh token");
  const r = await http(p.tokenUrl, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: id, client_secret: secret }).toString(),
  }, 15_000);
  if (r.status >= 400 || !r.json?.access_token) throw new Error("refresh failed");
  return { access: String(r.json.access_token), refresh: r.json.refresh_token ? String(r.json.refresh_token) : t.refresh, exp: r.json.expires_in ? Date.now() + Number(r.json.expires_in) * 1000 : t.exp };
}

/**
 * The ONLY place tools run. A write action stops here until a human approved it.
 * approved=true is set by the UI after a click, never by the model.
 * force=true means "this run saw injection-like content": auto-approve is ignored.
 */
export async function callTool(
  c: Conn, name: string, rawArgs: unknown, approved: boolean,
  opts: { force?: boolean; ctx?: ToolCtx } = {}
): Promise<ToolResult> {
  const args = (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {}) as Record<string, unknown>;
  const dot = name.indexOf(".");
  if (dot < 1) return { ok: false, text: `Unknown tool "${name}".` };
  const src = name.slice(0, dot), tool = name.slice(dot + 1);
  const mustAsk = (risk: Risk, auto: boolean) => risk === "write" && !approved && (opts.force === true || !auto);

  const free = ALL_FREE.find((t) => t.name === name);
  if (free) {
    if (mustAsk(free.risk, false)) return ask(name, args, "write"); // e.g. voice.call: every phone call is approved by the user
    try { return good(await free.run(args, [], opts.ctx), name, free.risk); }
    catch (e) { return { ok: false, text: e instanceof Error ? e.message : "Tool failed." }; }
  }

  const defs = ALL[src];
  if (defs) {
    const def = defs.find((d) => d.name === name);
    if (!def) return { ok: false, text: `Unknown tool "${name}".` };
    if (!c[src]) return { ok: false, text: `${src} is not connected for this chat (Connectors button).` };
    if (mustAsk(def.risk, isAuto(c, src))) return ask(name, args, "write");
    try { return good(await def.run(args, unpack(c[src]), opts.ctx), name, def.risk); }
    catch (e) { return { ok: false, text: e instanceof Error ? e.message : "Tool failed.", risk: def.risk }; }
  }

  if (src.startsWith("mcp_")) {
    const e = mcpEntries(c).find((x) => "mcp_" + safeId(x.id) === src);
    if (!e) return { ok: false, text: "That MCP connector is not connected for this chat." };
    try {
      const t = (await mcpList(e.url, e.auth)).find((x) => x.name === tool);
      if (!t) return { ok: false, text: `The MCP server has no tool "${tool}".` };
      const risk = mcpRisk(t);
      if (mustAsk(risk, isAuto(c, "mcp:" + e.id))) return ask(name, args, risk);
      const r = await mcpCall(e.url, e.auth, tool, args);
      return good(r.text, name, risk, !r.isError);
    } catch (err) { return { ok: false, text: err instanceof Error ? err.message : "MCP call failed." }; }
  }

  if (src.startsWith("oauth_")) {
    const providerId = src.slice("oauth_".length);
    const p = OAUTH_PROVIDERS.find((x) => safeId(x.id) === providerId);
    const raw = p ? c[`oauth:${p.id}`] : undefined;
    if (!p || !raw) return { ok: false, text: "That OAuth connector is not connected for this chat." };
    try {
      const method = String(args.method ?? "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return { ok: false, text: "Unsupported HTTP method." };
      const path = String(args.path ?? "");
      if (!path.startsWith("/") || path.startsWith("//") || path.length > 1500) return { ok: false, text: 'path must be a relative API path starting with "/".' };
      const risk: Risk = method === "GET" ? "read" : "write";
      if (mustAsk(risk, isAuto(c, `oauth:${p.id}`))) return ask(name, args, risk);

      let tok = parseTok(raw);
      if (tok.refresh && tok.exp && tok.exp < Date.now() + 60_000) {
        try {
          tok = await refreshTok(p, tok);
          if (opts.ctx) await opts.ctx.save(`oauth:${p.id}`, JSON.stringify(tok)); // keep the new token for next time
        } catch { return { ok: false, text: `${p.label} login expired. Open Connectors and press Reconnect for ${p.label}.` }; }
      }
      const url = new URL(path, p.apiBase.endsWith("/") ? p.apiBase : p.apiBase + "/");
      if (url.protocol !== "https:" || url.hostname !== p.apiHost) return { ok: false, text: "Request blocked: URL is outside the provider's verified API host." };
      const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${tok.access}` };
      if (p.id === "github_oauth") { headers["X-GitHub-Api-Version"] = "2022-11-28"; headers["User-Agent"] = "AgenticVenus"; }
      if (p.id === "notion_oauth") headers["Notion-Version"] = "2022-06-28";
      if (p.id === "twitch") headers["Client-Id"] = process.env.TWITCH_CLIENT_ID || "";
      if (args.body !== undefined) headers["Content-Type"] = "application/json";
      const r = await http(url.toString(), { method, headers, ...(args.body !== undefined && method !== "GET" ? { body: JSON.stringify(args.body) } : {}) }, 20_000);
      const expired = r.status === 401 ? `\n[${p.label} login is no longer valid: tell the user to press Reconnect for ${p.label} in Connectors.]` : "";
      return good(`HTTP ${r.status}\n${r.text}${expired}`, name, risk, r.status < 400);
    } catch (err) { return { ok: false, text: err instanceof Error ? err.message : "OAuth API request failed." }; }
  }

  if (src.startsWith("api_")) {
    const e = apiEntries(c).find((x) => "api_" + safeId(x.id) === src);
    if (!e) return { ok: false, text: "That API connector is not connected for this chat." };
    try {
      const method = String(args.method ?? "GET").toUpperCase();
      if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return { ok: false, text: "Unsupported method." };
      const path = String(args.path ?? "");
      if (!path.startsWith("/")) return { ok: false, text: 'path must start with "/".' };
      const risk: Risk = method === "GET" || method === "HEAD" ? "read" : "write";
      if (mustAsk(risk, isAuto(c, "api:" + e.id))) return ask(`${name} ${method} ${path}`, args, risk);
      const url = assertPublicUrl(e.baseUrl.replace(/\/+$/, "") + path).toString();
      const r = await http(url, {
        method,
        headers: { Accept: "application/json", ...(args.body ? { "Content-Type": "application/json" } : {}), ...(e.header && e.value ? { [e.header]: e.value } : {}) },
        ...(args.body && method !== "GET" && method !== "HEAD" ? { body: JSON.stringify(args.body) } : {}),
      }, 25_000);
      return good(`HTTP ${r.status}\n${r.text}`, name, risk, r.status < 400);
    } catch (err) { return { ok: false, text: err instanceof Error ? err.message : "API call failed." }; }
  }
  return { ok: false, text: `Unknown tool "${name}".` };
}