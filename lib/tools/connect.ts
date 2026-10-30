import { createHash, createHmac, randomBytes } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { vaultDelete, vaultPut } from "@/lib/vault";
import { appBaseUrl } from "@/lib/voice-server";
import { assertPublicUrl, http } from "./net";
import { McpAuthError, mcpList, type McpTool } from "./mcp-client";
import { buildAuthUrl, discover, pkce, registerClient } from "./mcp-oauth";
import { OAUTH_PROVIDERS, type OAuthProvider } from "./oauth-catalog";
import { buildOAuthUrl, oauthConfigured } from "./oauth-begin";
import { safeId } from "./catalog";
import { apiPayload, findPreset, type ApiPayload } from "./api-presets";
import { brandDomain } from "./brand";
import { vaultNameFor } from "./connectors";
import type { Def } from "./plugins";
import type { ToolCtx, ToolResult } from "./types";

/* ------------------------------------------------------------------ small helpers */

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
const fail = (text: string): ToolResult => ({ ok: false, text });
const ask = (summary: string): ToolResult => ({ ok: false, text: "Waiting for the user's approval.", needsApproval: { summary, risk: "write" } });

function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };

/* ------------------------------------------------------------------ MCP directory */

export type McpHit = { name: string; title: string; description: string; url: string; auth: "oauth" | "token" | "none"; source: "popular" | "registry" };

// Well-known remote MCP servers. URLs can change: if one fails, search the registry or paste the URL under "Custom".
export const POPULAR_MCP: Array<Omit<McpHit, "source">> = [
  { name: "notion", title: "Notion", description: "Search, read and create pages and databases.", url: "https://mcp.notion.com/mcp", auth: "oauth" },
  { name: "linear", title: "Linear", description: "Issues, projects, cycles.", url: "https://mcp.linear.app/mcp", auth: "oauth" },
  { name: "sentry", title: "Sentry", description: "Errors and performance issues.", url: "https://mcp.sentry.dev/mcp", auth: "oauth" },
  { name: "vercel", title: "Vercel", description: "Projects, deployments, logs.", url: "https://mcp.vercel.com", auth: "oauth" },
  { name: "supabase", title: "Supabase", description: "Databases, tables, SQL.", url: "https://mcp.supabase.com/mcp", auth: "oauth" },
  { name: "neon", title: "Neon", description: "Postgres databases and branches.", url: "https://mcp.neon.tech/mcp", auth: "oauth" },
  { name: "intercom", title: "Intercom", description: "Conversations and contacts.", url: "https://mcp.intercom.com/mcp", auth: "oauth" },
  { name: "paypal", title: "PayPal", description: "Invoices, orders, payments.", url: "https://mcp.paypal.com/mcp", auth: "oauth" },
  { name: "canva", title: "Canva", description: "Designs and brand assets.", url: "https://mcp.canva.com/mcp", auth: "oauth" },
  { name: "figma", title: "Figma", description: "Design files, components and variables.", url: "https://mcp.figma.com/mcp", auth: "oauth" },
  { name: "stripe", title: "Stripe", description: "Customers, payments, invoices. Use a restricted API key.", url: "https://mcp.stripe.com", auth: "token" },
  { name: "github", title: "GitHub", description: "Repos, issues, pull requests. Use a personal access token.", url: "https://api.githubcopilot.com/mcp/", auth: "token" },
  { name: "huggingface", title: "Hugging Face", description: "Models, datasets, spaces. Token optional.", url: "https://huggingface.co/mcp", auth: "token" },
  { name: "context7", title: "Context7", description: "Up-to-date docs for any library. No key needed.", url: "https://mcp.context7.com/mcp", auth: "none" },
  { name: "deepwiki", title: "DeepWiki", description: "Ask questions about any GitHub repository. No key needed.", url: "https://mcp.deepwiki.com/mcp", auth: "none" },
  { name: "cloudflare-docs", title: "Cloudflare Docs", description: "Search Cloudflare documentation. No key needed.", url: "https://docs.mcp.cloudflare.com/mcp", auth: "none" },
];

/** Servers we know by name: a tool that server says is read-only is believed. For every other server the tool name must agree. */
export const isTrustedMcp = (url: string) => { const h = hostOf(url); return Boolean(h) && POPULAR_MCP.some((p) => hostOf(p.url) === h); };

function mcpScore(q: string, h: { name: string; title: string; description: string }): number {
  const n = norm(h.name), t = norm(h.title);
  if (q === n || q === t) return 0;
  if (n.startsWith(q) || t.startsWith(q)) return 1;
  if (n.includes(q) || t.includes(q)) return 2;
  const tol = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0; // small typos: "can a", "cnava", "notin"
  if (tol && (lev(q, n) <= tol || lev(q, t) <= tol)) return 3;
  if (q.length >= 3 && norm(h.description).includes(q)) return 4;
  return -1;
}

type Remote = { type?: string; url?: string; headers?: Array<{ is_required?: boolean; isRequired?: boolean }> };
type RegServer = { name?: string; title?: string; description?: string; remotes?: Remote[] };

/** Best matches first: the popular list, then the official MCP registry (only remote / Streamable-HTTP servers can be used from here). */
export async function searchMcp(raw: string): Promise<McpHit[]> {
  const cleaned = raw.replace(/\b(mcp|server|tool|tools|connector|connect|api|app|integration|plugin)\b/gi, " ");
  const q = norm(cleaned) || norm(raw);
  if (q.length < 2) return [];
  const scored: Array<{ h: McpHit; sc: number }> = [];
  for (const p of POPULAR_MCP) { const sc = mcpScore(q, p); if (sc >= 0) scored.push({ h: { ...p, source: "popular" }, sc }); }
  try {
    const r = await fetch(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=40`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    if (r.ok) {
      const j = (await r.json()) as { servers?: Array<{ server?: RegServer } & RegServer> };
      for (const entry of j.servers ?? []) {
        const sv: RegServer = entry.server ?? entry;
        const remote = (sv.remotes ?? []).find((x) => x.type === "streamable-http" && x.url && !x.url.includes("{"));
        if (!remote?.url || !sv.name) continue;
        if (scored.some((x) => x.h.url === remote.url)) continue;
        const needsHeader = (remote.headers ?? []).some((hd) => hd.is_required || hd.isRequired);
        const hit: McpHit = {
          name: String(sv.name).split("/").pop() || sv.name, title: sv.title || sv.name,
          description: String(sv.description ?? "").slice(0, 160), url: remote.url, auth: needsHeader ? "token" : "none", source: "registry",
        };
        const sc = mcpScore(q, hit);
        scored.push({ h: hit, sc: sc >= 0 ? 5 + sc : 10 });
      }
    }
  } catch { /* registry offline: the popular matches still work */ }
  return scored.sort((a, b) => a.sc - b.sc).map((x) => x.h).slice(0, 25);
}

/* ------------------------------------------------------------------ built-in OAuth apps (checked FIRST) */

const OAUTH_ALIASES: Record<string, string[]> = {
  google: ["google", "gmail", "googledrive", "gdrive", "drive", "googlesheets", "sheets", "googlecalendar", "gcal", "calendar", "workspace", "googleworkspace"],
  microsoft: ["microsoft", "outlook", "office", "office365", "m365", "microsoft365", "onedrive", "teams", "microsoftteams"],
  slack: ["slack"],
  github_oauth: ["github"],
  notion_oauth: ["notion"],
  linear: ["linear"],
  dropbox: ["dropbox"],
  hubspot: ["hubspot"],
  asana: ["asana"],
  zoom: ["zoom"],
  figma: ["figma"],
  webflow: ["webflow"],
  youtube: ["youtube", "yt"],
  x: ["x", "twitter", "xtwitter"],
  linkedin: ["linkedin"],
  meta: ["meta", "facebook", "instagram", "fb", "ig", "facebookpage"],
  threads: ["threads"],
  tiktok: ["tiktok"],
  pinterest: ["pinterest"],
  reddit: ["reddit"],
};

export function matchOAuth(name: string): OAuthProvider | undefined {
  const n = norm(name.replace(/\b(oauth|mcp|connector|connect|app|integration)\b/gi, " ")) || norm(name);
  if (!n) return undefined;
  return OAUTH_PROVIDERS.find((p) => (OAUTH_ALIASES[p.id] ?? []).includes(n) || norm(p.id) === n || norm(p.label) === n);
}

const LOGO_OVERRIDE: Record<string, string> = { google: "google.com", microsoft: "microsoft.com", youtube: "youtube.com", meta: "facebook.com", github_oauth: "github.com", notion_oauth: "notion.com", x: "x.com" };
const providerDomain = (p: OAuthProvider) => LOGO_OVERRIDE[p.id] ?? brandDomain(hostOf(p.authorizeUrl));

/* ------------------------------------------------------------------ MCP probing and sign-in */

export type McpProbe = { state: "ready"; tools: McpTool[] } | { state: "oauth"; resourceMetadata?: string } | { state: "error"; error: string };

export async function probeMcp(url: string, auth?: string): Promise<McpProbe> {
  try { return { state: "ready", tools: await mcpList(url, auth, 12_000) }; }
  catch (e) {
    if (e instanceof McpAuthError) return { state: "oauth", resourceMetadata: e.resourceMetadata };
    return { state: "error", error: e instanceof Error ? e.message : "The server did not answer." };
  }
}

function secret() {
  const v = process.env.ROUTINE_RUNNER_SECRET;
  if (!v || v.length < 32) throw new Error("ROUTINE_RUNNER_SECRET must be set to at least 32 characters.");
  return v;
}

/** The sign-in page of an MCP server (no developer app needed: the server registers us automatically). Shared by the Connectors window and the chat. */
export async function beginMcpOAuth(o: { uid: string; chatId: string; name: string; url: string; resourceMetadata?: string; baseUrl: string }): Promise<string> {
  assertPublicUrl(o.url);
  const redirectUri = `${o.baseUrl}/api/connectors/mcp-oauth/callback`;
  const { as, resource, scopes } = await discover(o.url, o.resourceMetadata);

  // One registered client per (server, redirect) is reused for every sign-in.
  const db = getAdminDb();
  const key = createHash("sha256").update(`${as.issuer}|${redirectUri}`).digest("hex").slice(0, 20);
  const cref = db.collection("users").doc(o.uid).collection("mcpClients").doc(key);
  const cdoc = (await cref.get()).data() as { clientId?: string; secretPh?: string } | undefined;
  let clientId = cdoc?.clientId || "";
  let secretPh = cdoc?.secretPh || "";
  if (!clientId) {
    const reg = await registerClient(as, redirectUri);
    clientId = reg.clientId;
    secretPh = reg.clientSecret ? await vaultPut(o.uid, `mcpclient.${key}`, reg.clientSecret) : "";
    await cref.set({ clientId, secretPh, issuer: as.issuer, at: Date.now() });
  }

  const { verifier, challenge } = pkce();
  const nonce = randomBytes(18).toString("hex");
  await db.collection("users").doc(o.uid).collection("mcpOauth").doc(nonce).set({
    chatId: o.chatId, name: o.name, url: o.url, verifier, tokenEndpoint: as.token_endpoint, clientId, secretPh, resource, expiresAt: Date.now() + 10 * 60_000,
  });
  const payload = Buffer.from(JSON.stringify({ u: o.uid, n: nonce })).toString("base64url");
  const state = `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
  return buildAuthUrl({ as, clientId, redirectUri, state, challenge, resource, scopes });
}

/* ------------------------------------------------------------------ the Connect card in the chat */

/**
 * The card never carries the provider's address. It carries a one-time id; /api/connectors/mcp-oauth/go looks
 * the real address up on the server. So a card that the model (or a web page) makes up can not send the owner anywhere.
 */
async function makeLink(uid: string, authUrl: string, key: string): Promise<string> {
  const n = randomBytes(18).toString("hex");
  await getAdminDb().collection("users").doc(uid).collection("connectLinks").doc(n).set({ authUrl, key, expiresAt: Date.now() + 10 * 60_000 });
  return n;
}

export type ConnectCardJson = { v: 1; via: "oauth" | "mcp"; key: string; name: string; domain: string; u: string; n: string; chatId: string };

async function postCard(uid: string, chatId: string, card: ConnectCardJson): Promise<boolean> {
  try {
    await getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId).update({
      messages: FieldValue.arrayUnion({ role: "assistant", content: "```connect\n" + JSON.stringify(card) + "\n```", at: Date.now() }),
    });
    return true;
  } catch { return false; }
}

async function showCard(ctx: ToolCtx, authUrl: string, card: Omit<ConnectCardJson, "v" | "u" | "n" | "chatId">): Promise<boolean> {
  const n = await makeLink(ctx.uid, authUrl, card.key);
  return postCard(ctx.uid, ctx.chatId, { v: 1, ...card, u: ctx.uid, n, chatId: ctx.chatId });
}

/** Keeps the "Agent updated" announcer quiet about something the agent itself just connected or removed (it already said so). */
async function syncAnnounced(uid: string, chatId: string) {
  try {
    const ref = getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId);
    const d = ((await ref.get()).data() ?? {}) as { connectors?: Record<string, string>; announced?: string[] };
    if (!Array.isArray(d.announced)) return;
    const now = Object.keys(d.connectors ?? {}).filter((k) => !k.startsWith("auto:"));
    await ref.update({ announced: now });
  } catch { /* the announcer will simply post its own message */ }
}

/* ------------------------------------------------------------------ API keys */

export async function testApi(p: ApiPayload, testPath?: string): Promise<{ ok: boolean; status: number; note: string }> {
  const url = assertPublicUrl(p.baseUrl.replace(/\/+$/, "") + (testPath ?? "")).toString();
  const r = await http(url, {
    headers: { Accept: "application/json", "User-Agent": "AgenticVenus", ...(p.headers ?? {}), ...(p.header && p.value ? { [p.header]: p.value } : {}) },
  }, 12_000);
  if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, note: `The service answered HTTP ${r.status}: it does not accept this key (or the key lacks permission).` };
  if (testPath) return r.status < 400 ? { ok: true, status: r.status, note: "key accepted" } : { ok: false, status: r.status, note: `The check answered HTTP ${r.status}.` };
  return r.status < 500 ? { ok: true, status: r.status, note: `reachable (HTTP ${r.status})` } : { ok: false, status: r.status, note: `The server answered HTTP ${r.status}.` };
}

async function connectApi(args: Record<string, unknown>, ctx: ToolCtx | undefined, approved: boolean): Promise<ToolResult> {
  if (!ctx) return fail("Connecting is not available in this context.");
  const name = s(args.name ?? args.service, 80);
  const key = s(args.key ?? args.api_key ?? args.token ?? args.value, 800);
  if (!name || !key) return fail('connect.api needs {"name":"stripe","key":"..."}. Ask the owner for the missing part.');
  const preset = findPreset(name);
  let payload: ApiPayload;
  try { payload = apiPayload({ name, key, preset, baseUrl: s(args.base_url ?? args.baseUrl ?? args.url, 300), header: s(args.header, 60), description: s(args.description, 200) }); }
  catch (e) { return fail((e instanceof Error ? e.message : "Bad API settings.") + (preset ? "" : ` Ask the owner for ${name}'s API address (base URL) and call connect.api again with base_url.`)); }
  const id = safeId(preset?.id ?? name);
  if (!approved) return ask(`Connect API "${id}"\nAddress: ${payload.baseUrl}\nKey: ••••${key.slice(-4)} (saved encrypted)\nReading (GET) is free afterwards; POST / PUT / PATCH / DELETE still ask you each time.`);
  await ctx.save(`api:${id}`, JSON.stringify(payload));
  await syncAnnounced(ctx.uid, ctx.chatId);
  let check = "";
  try { const t = await testApi(payload, preset?.testPath); check = t.ok ? `Check: ${t.note}.` : `WARNING: ${t.note} Tell the owner to double-check the key; it is saved anyway.`; }
  catch (e) { check = `Check skipped: ${e instanceof Error ? e.message : "could not reach the service"}.`; }
  return {
    ok: true, risk: "write",
    text: `Connected API "${id}" (${payload.baseUrl}). ${check} Its tool is api_${safeId(id)}.request (method, path, body?). The key is saved encrypted; tell the owner they may delete the chat message that contains it. Now continue with their task.`,
  };
}

/* ------------------------------------------------------------------ connect.service */

async function connectService(args: Record<string, unknown>, c: Record<string, string>, ctx: ToolCtx | undefined, approved: boolean): Promise<ToolResult> {
  if (!ctx) return fail("Connecting is not available in this context.");
  const rawName = s(args.name ?? args.service ?? args.app ?? args.tool, 80);
  let url = s(args.url ?? args.mcp_url, 500);
  const token = s(args.token ?? args.auth, 600);
  if (s(args.key ?? args.api_key, 800)) return connectApi(args, ctx, approved); // an API key was given: that is the direct way
  if (!rawName && !url) return fail('Tell me which service to connect, for example {"name":"canva"}. If the owner gave an MCP URL, pass it as url.');

  let base: string;
  try { base = ctx.baseUrl || appBaseUrl(); } catch (e) { return fail(e instanceof Error ? e.message : "The site address is not set (NEXT_PUBLIC_APP_URL)."); }

  /* Step 1: built-in OAuth apps (only when the owner did not hand us an MCP URL or token). */
  let oauthNote = "";
  if (!url && !token) {
    const p = matchOAuth(rawName);
    if (p) {
      const key = `oauth:${p.id}`;
      if (c[key]) return { ok: true, text: `${p.label} is already connected for this chat. Its tools are in your tool list; use them. If it stopped working, tell the owner to press Reconnect for ${p.label} in Connectors.` };
      if (oauthConfigured(p.id)) {
        try {
          const redirectUri = process.env.OAUTH_REDIRECT_URI || `${ctx.origin || base}/api/connectors/oauth/callback`;
          const authUrl = buildOAuthUrl({ uid: ctx.uid, chatId: ctx.chatId, providerId: p.id, redirectUri });
          const shown = await showCard(ctx, authUrl, { via: "oauth", key, name: p.label, domain: providerDomain(p) });
          return {
            ok: true, risk: "read",
            text: shown
              ? `SIGN-IN CARD SHOWN: ${p.label} (built-in OAuth). The owner now sees a card with the ${p.label} logo and a Connect button in the chat. Say ONE short line: press Connect, finish the login in the new tab, and the tools appear on their own. Do not paste any link, do not repeat the card, do not call connect.service again for it.`
              : `Could not post the card. Tell the owner: open Connectors (plug icon) → ${p.label} → Connect.`,
          };
        } catch (e) { oauthNote = `(Built-in ${p.label} OAuth failed: ${e instanceof Error ? e.message : "error"}. Trying MCP.) `; }
      } else oauthNote = `(${p.label} has built-in OAuth but the site owner has not set ${p.clientIdEnv} in Vercel. Trying MCP.) `;
    }
  }

  /* Step 2: an MCP server (found by name, or the URL the owner gave). */
  let title = rawName;
  let idName = rawName;
  let picked: McpHit | undefined;
  if (!url) {
    const hits = await searchMcp(rawName);
    const q = norm(rawName.replace(/\b(mcp|server|tool|connector|connect|api|app|integration)\b/gi, " ")) || norm(rawName);
    picked = hits.find((h) => norm(h.name) === q || norm(h.title) === q) ?? (hits[0]?.source === "popular" ? hits[0] : undefined) ?? (hits.length === 1 ? hits[0] : undefined);
    if (!picked) {
      if (!hits.length) return fail(`${oauthNote}No built-in OAuth app and no remote MCP server found for "${rawName}". Ask the owner for an API key (then call connect.api with name and key) or for the service's MCP URL (then call connect.service with url).`);
      return fail(`${oauthNote}Several MCP servers match "${rawName}". Ask the owner which one, then call connect.service again with its url:\n` + hits.slice(0, 6).map((h) => `- ${h.title} (${h.name}) ${h.url} [${h.auth}]`).join("\n"));
    }
    url = picked.url; title = picked.title; idName = picked.name;
  } else {
    if (!title) title = hostOf(url);
    if (!idName) idName = brandDomain(hostOf(url)).split(".")[0] || "mcp";
  }
  try { assertPublicUrl(url); } catch (e) { return fail(e instanceof Error ? e.message : "That URL is not allowed."); }

  const id = safeId(idName);
  const key = `mcp:${id}`;
  if (c[key] && !token) return { ok: true, text: `"${id}" is already connected for this chat. Its tools are in your tool list; use them. If it stopped working, tell the owner to press Reconnect in Connectors → Custom.` };

  const probe = await probeMcp(url, token || undefined);
  if (probe.state === "error") return fail(`${oauthNote}Could not reach ${title} at ${url}: ${probe.error} Check the URL (it must be a remote Streamable-HTTP MCP address), or ask the owner for an API key.`);

  if (probe.state === "oauth") {
    if (token) return fail(`${title} rejected the token that was given. Ask the owner for a correct token, or connect it without a token to sign in.`);
    try {
      const authUrl = await beginMcpOAuth({ uid: ctx.uid, chatId: ctx.chatId, name: id, url, resourceMetadata: probe.resourceMetadata, baseUrl: base });
      const shown = await showCard(ctx, authUrl, { via: "mcp", key, name: title, domain: brandDomain(hostOf(url)) });
      return {
        ok: true, risk: "read",
        text: shown
          ? `${oauthNote}SIGN-IN CARD SHOWN: ${title} (MCP at ${hostOf(url)}). The owner now sees a card with the ${title} logo and a Connect button in the chat. Say ONE short line: press Connect, sign in on the ${title} page that opens, and the ${title} tools appear on their own. Do not paste any link, do not repeat the card, do not call connect.service again for it.`
          : `${oauthNote}Could not post the card. Tell the owner: open Connectors → Custom, type "${title}" and press Sign in.`,
      };
    } catch (e) { return fail(`${oauthNote}${title} needs a sign-in but it could not start: ${e instanceof Error ? e.message : "error"}. Ask the owner for an API key or token instead.`); }
  }

  // The server works without a sign-in (no auth, or the token the owner gave). Saving that is a change: ask first.
  if (!approved) return ask(`Connect MCP server "${id}"\n${title} · ${url}\n${probe.tools.length} tool${probe.tools.length === 1 ? "" : "s"} found${token ? "\nA token you gave is saved encrypted." : ""}`);
  await ctx.save(key, JSON.stringify({ url, auth: token || undefined }));
  await syncAnnounced(ctx.uid, ctx.chatId);
  const names = probe.tools.slice(0, 20).map((t) => `mcp_${id}.${t.name.replace(/[^A-Za-z0-9_.-]/g, "_")}`);
  return {
    ok: true, risk: "write",
    text: `${oauthNote}Connected ${title} (${probe.tools.length} tools). Example tool names: ${names.join(", ")}${probe.tools.length > 20 ? ", ..." : ""}. They are callable now. Continue with the owner's task.`,
  };
}

/* ------------------------------------------------------------------ list / find / remove */

async function findText(args: Record<string, unknown>): Promise<ToolResult> {
  const q = s(args.query ?? args.name, 80);
  if (!q) return fail('connect.find needs {"query":"canva"}.');
  const out: string[] = [];
  const p = matchOAuth(q);
  if (p) out.push(`Built-in OAuth: ${p.label} (${oauthConfigured(p.id) ? "ready to connect" : `not set up: ${p.clientIdEnv} missing in Vercel`})`);
  const f = findPreset(q);
  if (f) out.push(`Known API: ${f.label}, only the API key is needed (connect.api).`);
  const hits = await searchMcp(q);
  for (const h of hits.slice(0, 8)) out.push(`MCP: ${h.title} (${h.name}) ${h.url} [${h.auth === "oauth" ? "sign-in" : h.auth === "token" ? "token" : "no key"}]`);
  return out.length ? { ok: true, text: out.join("\n") } : fail(`Nothing found for "${q}". Ask the owner for an API key or an MCP URL.`);
}

function listText(c: Record<string, string>): ToolResult {
  const keys = Object.keys(c).filter((k) => !k.startsWith("auto:"));
  if (!keys.length) return { ok: true, text: "Nothing is connected for this chat yet (only the built-in tools)." };
  return { ok: true, text: "Connected for this chat:\n" + keys.map((k) => `- ${k}${c["auto:" + k] === "1" ? " (writes allowed without asking)" : ""}`).join("\n") };
}

async function removeConnector(args: Record<string, unknown>, c: Record<string, string>, ctx: ToolCtx | undefined, approved: boolean): Promise<ToolResult> {
  if (!ctx) return fail("Disconnecting is not available in this context.");
  const name = s(args.name ?? args.service, 80);
  const n = norm(name);
  if (!n) return fail('connect.remove needs {"name":"canva"}.');
  const keys = Object.keys(c).filter((k) => !k.startsWith("auto:") && (norm(k) === n || norm(k.slice(k.indexOf(":") + 1)) === n || norm(k.replace(/^(mcp|api|oauth):/, "")) === n));
  if (!keys.length) return fail(`"${name}" is not connected. Connected: ${Object.keys(c).filter((k) => !k.startsWith("auto:")).join(", ") || "nothing"}.`);
  if (!approved) return ask(`Disconnect: ${keys.join(", ")}\nThe saved login is deleted from this chat. (Sign-ins are not revoked at the provider.)`);
  const ref = getAdminDb().collection("users").doc(ctx.uid).collection("chats").doc(ctx.chatId);
  for (const k of keys) {
    await ref.update({ [`connectors.${k}`]: FieldValue.delete(), [`connectors.auto:${k}`]: FieldValue.delete() });
    await vaultDelete(ctx.uid, vaultNameFor(ctx.chatId, k)).catch(() => undefined);
  }
  await syncAnnounced(ctx.uid, ctx.chatId);
  return { ok: true, risk: "write", text: `Disconnected: ${keys.join(", ")}.` };
}

/* ------------------------------------------------------------------ the agent's tools */

const never: Def["run"] = async () => { throw new Error("connect.* tools run through runConnect()."); };

export const CONNECT_TOOLS: Def[] = [
  {
    name: "connect.service", risk: "write",
    params: 'name:string (e.g. "canva"), url?:string (MCP address, only if the owner gave one), token?:string, key?:string (API key the owner pasted), base_url?:string',
    description: 'CONNECT A SERVICE FROM THE CHAT. Use this whenever the owner says connect / add / hook up / link a tool, app, service or MCP ("connect canva", "notion add karo", "stripe connect kr do"), or pastes an MCP URL or an API key. It checks the built-in OAuth apps first, then finds the MCP server by name, then shows the owner a card with the service logo and a Connect button (they sign in themselves; you never see a password). Never send the owner to the Connectors window and never open the computer to look for an MCP: call this tool.',
    run: never,
  },
  {
    name: "connect.api", risk: "write",
    params: "name:string (e.g. stripe), key:string, base_url?:string (only when the service is not a well-known one), header?:string",
    description: "Connect a REST API directly with an API key the owner typed in the chat. For well-known services (OpenAI, Stripe, GitHub, Notion, Resend ...) the name and the key are enough. The key is saved encrypted. Asks the owner for approval.",
    run: never,
  },
  {
    name: "connect.find", risk: "read",
    params: "query:string",
    description: "Look up how a service can be connected: built-in OAuth, a known API key service, or MCP servers. Use it when connect.service answered that several MCP servers match.",
    run: never,
  },
  { name: "connect.list", risk: "read", params: "", description: "List what is connected for this chat.", run: never },
  {
    name: "connect.remove", risk: "write",
    params: "name:string",
    description: "Disconnect a connector from this chat (MCP, API key or OAuth). Asks the owner for approval.",
    run: never,
  },
];

/** The ONLY place the connect.* tools run (called from callTool). */
export async function runConnect(name: string, args: Record<string, unknown>, c: Record<string, string>, ctx: ToolCtx | undefined, approved: boolean): Promise<ToolResult> {
  switch (name) {
    case "connect.service": return connectService(args, c, ctx, approved);
    case "connect.api": return connectApi(args, ctx, approved);
    case "connect.find": return findText(args);
    case "connect.list": return listText(c);
    case "connect.remove": return removeConnector(args, c, ctx, approved);
    default: return fail(`Unknown tool "${name}".`);
  }
}
