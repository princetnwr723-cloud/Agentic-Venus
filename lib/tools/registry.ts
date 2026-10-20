import { FREE_TOOLS, PLUGIN_TOOLS, type Def } from "./plugins";
import { GITHUB_EXTRA } from "./github-extra";
import { GITHUB_PUT } from "./github-put";
import { IDENTITY_TOOLS } from "./identity";
import { VERIFY_TOOLS } from "./verify";
import { VOICE_TOOLS } from "./voice";
import { CHANNEL_TOOLS, NOTIFY_TOOLS } from "./channels";
import { MISSION_TOOLS } from "./mission";
import { LEARNING_TOOLS } from "./learning";
import { REPO_TOOLS } from "./repo";
import { VISUAL_TOOLS } from "./visual";
import { MAIL_TOOLS } from "./mail";
import { PLAN_TOOLS } from "./plan";
import { GMAIL_TOOLS } from "./gmail";
import { SOCIAL_TOOLS, providerOfPlatform, socialTargets } from "./social";
import { mcpCall, mcpList, paramSummary, type McpTool } from "./mcp-client";
import { refreshMcpToken, type McpOAuth } from "./mcp-oauth";
import { oauthAccess } from "./oauth-token";
import { assertPublicUrl, cut, http } from "./net";
import { safeId, unpack } from "./catalog";
import { OAUTH_PROVIDERS, SOCIAL_PROVIDERS, type OAuthProvider } from "./oauth-catalog";
import { INJECTION_PATTERNS, wrapUntrusted } from "@/lib/shield";
import type { Risk, ToolCtx, ToolResult, ToolSpec } from "./types";

type Conn = Record<string, string>;
const ALL: Record<string, Def[]> = {
  ...PLUGIN_TOOLS,
  github: [...(PLUGIN_TOOLS.github ?? []), ...GITHUB_EXTRA, ...GITHUB_PUT],
  identity: IDENTITY_TOOLS,
  ...CHANNEL_TOOLS,
};
const ALL_FREE: Def[] = [...FREE_TOOLS, ...VERIFY_TOOLS, ...VOICE_TOOLS, ...NOTIFY_TOOLS, ...MISSION_TOOLS, ...LEARNING_TOOLS, ...REPO_TOOLS, ...VISUAL_TOOLS, ...MAIL_TOOLS, ...PLAN_TOOLS];
const READISH = /^(get|list|search|find|read|fetch|query|describe|lookup|view|check|count|show)/i;

const json = <T,>(v?: string): T | null => { try { return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const isAuto = (c: Conn, id: string) => c["auto:" + id] === "1";

type McpEntry = { id: string; url: string; auth?: string; oauth?: McpOAuth };
type ApiEntry = { id: string; baseUrl: string; header?: string; value?: string; description?: string };
const mcpEntries = (c: Conn): McpEntry[] =>
  Object.entries(c).filter(([k]) => k.startsWith("mcp:")).map(([k, v]) => ({ id: k.slice(4), ...(json<{ url: string; auth?: string; oauth?: McpOAuth }>(v) ?? { url: "" }) })).filter((e) => e.url);
const apiEntries = (c: Conn): ApiEntry[] =>
  Object.entries(c).filter(([k]) => k.startsWith("api:")).map(([k, v]) => ({ id: k.slice(4), ...(json<Omit<ApiEntry, "id">>(v) ?? { baseUrl: "" }) })).filter((e) => e.baseUrl);

/** The Authorization value for an MCP server. OAuth logins are renewed here when they are about to expire. */
async function mcpBearer(e: McpEntry, ctx?: ToolCtx): Promise<string | undefined> {
  if (!e.oauth) return e.auth;
  let o = e.oauth;
  if (o.refresh && o.exp && o.exp < Date.now() + 60_000) {
    try {
      o = await refreshMcpToken(o);
      e.oauth = o;
      if (ctx) await ctx.save(`mcp:${e.id}`, JSON.stringify({ url: e.url, oauth: o }));
    } catch { /* the old token is used; the call will report that a reconnect is needed */ }
  }
  return `Bearer ${o.access}`;
}

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

export async function buildCatalog(c: Conn, ctx?: ToolCtx): Promise<{ specs: ToolSpec[]; errors: string[] }> {
  const specs: ToolSpec[] = ALL_FREE.map((d) => toSpec(d, "free"));
  const errors: string[] = [];
  for (const [id, defs] of Object.entries(ALL)) if (c[id]) specs.push(...defs.map((d) => toSpec(d, id)));
  if (c["oauth:google"]) specs.push(...GMAIL_TOOLS.map((d) => toSpec(d, "oauth:google")));
  // Social media tools appear as soon as ANY social platform is connected.
  if (SOCIAL_PROVIDERS.some((p) => c[`oauth:${p.id}`])) specs.push(...SOCIAL_TOOLS.map((d) => toSpec(d, "social")));

  const mcp = mcpEntries(c);
  const results = await Promise.allSettled(mcp.map(async (e) => mcpList(e.url, await mcpBearer(e, ctx))));
  results.forEach((r, i) => {
    const e = mcp[i];
    if (r.status === "rejected") {
      const msg = r.reason instanceof Error ? r.reason.message : "failed";
      errors.push(`mcp:${e.id} — ${/401|sign-in/i.test(msg) ? "login expired: press Reconnect in Connectors" : msg}`);
      return;
    }
    for (const t of r.value) {
      specs.push({ name: `mcp_${safeId(e.id)}.${t.name}`, description: safeDesc(t.description), params: paramSummary(t), risk: mcpRisk(t), source: `mcp:${e.id}` });
    }
  });
  for (const p of OAUTH_PROVIDERS) {
    if (c[`oauth:${p.id}`]) specs.push({ name: `oauth_${safeId(p.id)}.request`, source: `oauth:${p.id}`, risk: "read", description: `${p.label} API request (hosts: ${p.hosts.join(", ")}). GET is read-only; other methods require approval.`, params: "method:GET|POST|PUT|PATCH|DELETE, path:string (starts with / or a full https URL on an allowed host), body?:object" });
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

const brief = (it: unknown): string => {
  if (!it || typeof it !== "object") return String(it).slice(0, 80);
  const o = it as Record<string, unknown>;
  const who = String(o.to ?? o.email ?? o.path ?? o.name ?? "").slice(0, 60);
  const what = String(o.subject ?? o.title ?? o.text ?? o.body ?? "").replace(/\s+/g, " ").slice(0, 70);
  return [who, what].filter(Boolean).join(" — ");
};

/** What the owner sees in the approval question. Batches list every recipient / file, not just the first 400 characters. */
function summarize(name: string, args: Record<string, unknown>): string {
  if (name.startsWith("social.")) {
    const where = Array.isArray(args.platforms) ? args.platforms.join(", ") : String(args.platforms ?? args.platform ?? "");
    const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
    const text = clip(args.caption ?? args.text ?? args.description ?? args.body, 300);
    return [
      `${name} → ${where || "?"}`,
      args.title ? `Title: ${clip(args.title, 100)}` : "",
      name === "social.post_video" ? `Video: ${args.video_id ? clip(args.video_id, 40) : "the newest finished Venus Pro video"}` : "",
      text ? `Text: ${text}` : "",
      args.link ? `Link: ${clip(args.link, 200)}` : "",
      args.image_url ? `Picture: ${clip(args.image_url, 200)}` : "",
      args.subreddit ? `Subreddit: r/${clip(args.subreddit, 40)}` : "",
      name === "social.finish" ? "Completes a post that was still processing." : `Visibility: ${args.visibility ? clip(args.visibility, 20) : "public"}`,
    ].filter(Boolean).join("\n");
  }
  if (Array.isArray(args.items)) {
    const tpl = [args.subject ? `Subject: ${String(args.subject).slice(0, 100)}` : "", args.body ? `Text: ${String(args.body).replace(/\s+/g, " ").slice(0, 160)}` : ""].filter(Boolean).join("\n");
    return `${name} — ${args.items.length} item(s)${tpl ? "\n" + tpl : ""}\n` + args.items.slice(0, 12).map((it, i) => `${i + 1}. ${brief(it)}`).join("\n") + (args.items.length > 12 ? `\n… +${args.items.length - 12} more` : "");
  }
  if (Array.isArray(args.files) || Array.isArray(args.delete_paths)) {
    const files = Array.isArray(args.files) ? args.files.slice(0, 10).map((f) => String((f as { path?: unknown })?.path ?? "")).join(", ") : "";
    const dels = Array.isArray(args.delete_paths) ? args.delete_paths.slice(0, 10).join(", ") : "";
    return `${name} on ${String(args.repo ?? "")}${args.branch ? ` (branch ${String(args.branch)})` : ""}${args.new_branch ? ` (new branch ${String(args.new_branch)})` : ""}${files ? `\nFiles: ${files}` : ""}${dels ? `\nDelete: ${dels}` : ""}`;
  }
  if (typeof args.to === "string") return `${name}\nTo: ${args.to}\nSubject: ${String(args.subject ?? "")}\n${String(args.body ?? args.text ?? "").slice(0, 200)}`;
  if (typeof args.path === "string" && typeof args.content === "string") return `${name}\nFile: ${args.path}${args.delete === true ? " (delete)" : ""}\n${String(args.content).slice(0, 200)}`;
  return `${name}\n${JSON.stringify(args).slice(0, 400)}`;
}

const ask = (name: string, args: Record<string, unknown>, risk: Risk): ToolResult => ({
  ok: false, text: "Waiting for the user's approval.",
  needsApproval: { summary: summarize(name, args), risk },
});

/**
 * The ONLY place tools run. A write action stops here until a human approved it.
 * approved=true is set by the UI/chat after a click or a YES, never by the model.
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
    // mail.* honours the "don't ask before write actions" switch of any connected sender
    const autoMail = name.startsWith("mail.") && (isAuto(c, "oauth:google") || isAuto(c, "oauth:microsoft") || isAuto(c, "smtp") || isAuto(c, "email"));
    if (mustAsk(free.risk, autoMail)) return ask(name, args, "write"); // voice.call, mission.start, repo.push ...: approved by a human
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

  // Gmail tools use the Google OAuth connection (MIME is built on the server: the model never writes base64).
  if (src === "gmail") {
    const def = GMAIL_TOOLS.find((d) => d.name === name);
    if (!def) return { ok: false, text: `Unknown tool "${name}".` };
    const raw = c["oauth:google"];
    if (!raw) return { ok: false, text: "Google is not connected for this chat (Connectors → Google). To SEND email without Google use mail.send." };
    if (mustAsk(def.risk, isAuto(c, "oauth:google"))) return ask(name, args, "write");
    try {
      const p = OAUTH_PROVIDERS.find((x) => x.id === "google") as OAuthProvider;
      const access = await oauthAccess(p, raw, opts.ctx);
      return good(await def.run(args, [access], opts.ctx), name, def.risk);
    } catch (e) { return { ok: false, text: e instanceof Error ? e.message : "Gmail failed.", risk: def.risk }; }
  }

  // Social media tools use the OAuth logins of the connected platforms (YouTube, X, LinkedIn, Meta, Threads, TikTok, Pinterest, Reddit).
  if (src === "social") {
    const def = SOCIAL_TOOLS.find((d) => d.name === name);
    if (!def) return { ok: false, text: `Unknown tool "${name}".` };
    const connected = SOCIAL_PROVIDERS.filter((p) => c[`oauth:${p.id}`]);
    if (!connected.length) return { ok: false, text: "No social media account is connected for this chat. Tell the owner: open Connectors (plug icon), pick the platform and press Connect." };
    const wanted = socialTargets(args).map(providerOfPlatform);
    const auto = wanted.length > 0 && wanted.every((id) => isAuto(c, `oauth:${id}`));
    if (mustAsk(def.risk, auto)) return ask(name, args, "write");
    try {
      const tokens: Record<string, string> = {}, errors: Record<string, string> = {};
      await Promise.all(connected.map(async (p) => {
        try { tokens[p.id] = await oauthAccess(p, c[`oauth:${p.id}`], opts.ctx); }
        catch (e) { errors[p.id] = e instanceof Error ? e.message : `${p.label} login failed. Press Reconnect in Connectors.`; }
      }));
      return good(await def.run(args, [JSON.stringify({ tokens, errors })], opts.ctx), name, def.risk);
    } catch (e) { return { ok: false, text: e instanceof Error ? e.message : "Social media tool failed.", risk: def.risk }; }
  }

  if (src.startsWith("mcp_")) {
    const e = mcpEntries(c).find((x) => "mcp_" + safeId(x.id) === src);
    if (!e) return { ok: false, text: "That MCP connector is not connected for this chat." };
    try {
      const auth = await mcpBearer(e, opts.ctx);
      const t = (await mcpList(e.url, auth)).find((x) => x.name === tool);
      if (!t) return { ok: false, text: `The MCP server has no tool "${tool}".` };
      const risk = mcpRisk(t);
      if (mustAsk(risk, isAuto(c, "mcp:" + e.id))) return ask(name, args, risk);
      const r = await mcpCall(e.url, auth, tool, args);
      return good(r.text, name, risk, !r.isError);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "MCP call failed.";
      return { ok: false, text: /401|sign-in/i.test(msg) ? `The login for "${e.id}" expired. Tell the user: open Connectors → Custom and Reconnect "${e.id}".` : msg };
    }
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
      const full = /^https:\/\//i.test(path);
      if ((!full && (!path.startsWith("/") || path.startsWith("//"))) || path.length > 1500) return { ok: false, text: 'path must start with "/" or be a full https URL on the provider\'s API host.' };
      const risk: Risk = method === "GET" ? "read" : "write";
      if (mustAsk(risk, isAuto(c, `oauth:${p.id}`))) return ask(name, args, risk);

      const access = await oauthAccess(p, raw, opts.ctx);
      // Join by hand: new URL("/me", ".../v1.0/") would drop the "/v1.0" part.
      const url = new URL(full ? path : p.apiBase.replace(/\/+$/, "") + path);
      if (url.protocol !== "https:" || !p.hosts.includes(url.hostname)) return { ok: false, text: "Request blocked: URL is outside the provider's verified API hosts." };
      const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${access}` };
      if (p.id === "github_oauth") { headers["X-GitHub-Api-Version"] = "2022-11-28"; headers["User-Agent"] = "AgenticVenus"; }
      if (p.id === "notion_oauth") headers["Notion-Version"] = "2022-06-28";
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