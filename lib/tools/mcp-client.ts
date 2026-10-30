import { assertPublicUrl, safeFetch } from "./net";

export type McpTool = {
  name: string; description?: string;
  inputSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

/** The server answered 401: it wants a sign-in (OAuth). `resourceMetadata` is the URL it points to, if any. */
export class McpAuthError extends Error {
  constructor(message: string, public resourceMetadata?: string) { super(message); this.name = "McpAuthError"; }
}

/** Any other HTTP answer that is not OK. 404 on a reused session means "that session is gone" (MCP spec). */
export class McpHttpError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "McpHttpError"; }
}

function authHeaders(auth?: string): Record<string, string> {
  const a = (auth ?? "").trim();
  if (!a) return {};
  if (/^bearer\s/i.test(a)) return { Authorization: a };
  const m = /^([A-Za-z0-9-]+):\s*(.+)$/.exec(a); // "X-Api-Key: abc" style
  if (m) return { [m[1]]: m[2] };
  return { Authorization: `Bearer ${a}` };
}

// Every hop goes through safeFetch: the host is resolved and checked, redirects can't lead into a private network.
async function post(url: string, headers: Record<string, string>, body: unknown, session?: string, ms = 25_000) {
  const res = await safeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers, ...(session ? { "Mcp-Session-Id": session } : {}) },
    body: JSON.stringify(body),
  }, ms);
  const text = await res.text();
  if (res.status === 401) {
    const rm = /resource_metadata="([^"]+)"/i.exec(res.headers.get("www-authenticate") ?? "")?.[1];
    throw new McpAuthError("MCP server answered 401: sign-in required.", rm);
  }
  if (!res.ok && res.status !== 202) throw new McpHttpError(`MCP server answered ${res.status}: ${text.slice(0, 200)}`, res.status);
  return { sid: res.headers.get("mcp-session-id") ?? session ?? undefined, ct: res.headers.get("content-type") ?? "", text };
}

export function parseRpc(ct: string, text: string, id: number): any {
  if (!text.trim()) return null;
  if (ct.includes("text/event-stream")) {
    for (const block of text.split(/\n\n+/)) {
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue;
      try { const j = JSON.parse(data); if (j.id === id) return j; } catch { /* keep scanning */ }
    }
    return null;
  }
  try {
    const j = JSON.parse(text);
    return Array.isArray(j) ? j.find((x) => x.id === id) ?? null : j;
  } catch { return null; }
}

type Call = (method: string, params?: unknown, ms?: number) => Promise<any>;

async function open(url: string, auth: string | undefined, ms: number): Promise<{ call: Call; sid?: string }> {
  assertPublicUrl(url);
  const headers = authHeaders(auth);
  const init = await post(url, headers, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "agenticvenus", version: "1.0" } },
  }, undefined, ms);
  const r = parseRpc(init.ct, init.text, 1);
  if (!r || r.error) throw new Error(`MCP initialize failed: ${r?.error?.message ?? "no answer (this must be a Streamable-HTTP MCP URL)"}`);
  await post(url, headers, { jsonrpc: "2.0", method: "notifications/initialized" }, init.sid, ms).catch((e) => { if (e instanceof McpAuthError) throw e; });
  let n = 1;
  const call: Call = async (method, params, callMs) => {
    const id = ++n;
    const x = await post(url, headers, { jsonrpc: "2.0", id, method, params }, init.sid, callMs ?? ms);
    const j = parseRpc(x.ct, x.text, id);
    if (!j) throw new Error("MCP server gave no answer.");
    if (j.error) throw new Error(j.error.message ?? "MCP error");
    return j.result;
  };
  return { call, sid: init.sid };
}

/**
 * A server that hands out a session id (stateful) is opened ONCE and reused for a few minutes: that turns
 * "initialize + initialized + call" (3 round trips) into 1. Servers without a session id are opened every time,
 * exactly as before. A call is only repeated when the server says the session is gone (404): nothing ran then.
 */
const sessions = new Map<string, { call: Call; t: number }>();
const SESSION_TTL = 4 * 60_000;

async function withSession<T>(url: string, auth: string | undefined, ms: number, fn: (call: Call) => Promise<T>): Promise<T> {
  const key = `${url}|${auth ?? ""}`;
  const hit = sessions.get(key);
  if (hit && Date.now() - hit.t < SESSION_TTL) {
    try { const r = await fn(hit.call); hit.t = Date.now(); return r; }
    catch (e) {
      sessions.delete(key);
      if (!(e instanceof McpHttpError && e.status === 404)) throw e; // anything else is a real answer
    }
  } else if (hit) sessions.delete(key);
  const { call, sid } = await open(url, auth, ms);
  if (sid) {
    sessions.set(key, { call, t: Date.now() });
    if (sessions.size > 40) { const oldest = [...sessions.entries()].sort((a, b) => a[1].t - b[1].t)[0]; if (oldest) sessions.delete(oldest[0]); }
  }
  try { return await fn(call); } catch (e) { sessions.delete(key); throw e; }
}

const cache = new Map<string, { t: number; tools: McpTool[] }>();
const FRESH = 3 * 60_000;      // a tool list this young is used without asking the server
const STALE_OK = 60 * 60_000;  // if the server is down, a list this young is still better than no tools

export async function mcpList(url: string, auth?: string, ms = 20_000): Promise<McpTool[]> {
  const key = url + "|" + (auth ?? "");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < FRESH) return hit.tools;
  try {
    const tools = await withSession(url, auth, ms, async (call) => {
      const out: McpTool[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 100; i++) {
        const r = await call("tools/list", cursor ? { cursor } : {});
        out.push(...((r?.tools ?? []) as McpTool[]));
        cursor = r?.nextCursor;
        if (!cursor) break;
      }
      return out;
    });
    cache.set(key, { t: Date.now(), tools });
    return tools;
  } catch (e) {
    if (hit && Date.now() - hit.t < STALE_OK && !(e instanceof McpAuthError)) return hit.tools;
    throw e;
  }
}

export async function mcpCall(url: string, auth: string | undefined, name: string, args: Record<string, unknown>, ms = 50_000): Promise<{ isError: boolean; text: string }> {
  const r = await withSession(url, auth, 20_000, (call) => call("tools/call", { name, arguments: args }, ms));
  const parts = ((r?.content ?? []) as Array<{ type: string; text?: string }>).map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`));
  return { isError: Boolean(r?.isError), text: parts.join("\n") || JSON.stringify(r?.structuredContent ?? r ?? {}) };
}

export function paramSummary(t: McpTool): string {
  const props = t.inputSchema?.properties ?? {};
  const req = new Set(t.inputSchema?.required ?? []);
  return Object.entries(props).map(([k, v]) => `${k}${req.has(k) ? "" : "?"}:${v.type ?? "any"}`).join(", ");
}
