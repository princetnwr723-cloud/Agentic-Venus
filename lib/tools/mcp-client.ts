import { assertPublicUrl } from "./net";

export type McpTool = {
  name: string; description?: string;
  inputSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

function authHeaders(auth?: string): Record<string, string> {
  const a = (auth ?? "").trim();
  if (!a) return {};
  const m = /^([A-Za-z0-9-]+):\s*(.+)$/.exec(a); // "X-Api-Key: abc" style
  if (m) return { [m[1]]: m[2] };
  return { Authorization: /^bearer\s/i.test(a) ? a : `Bearer ${a}` };
}

async function post(url: string, headers: Record<string, string>, body: unknown, session?: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers, ...(session ? { "Mcp-Session-Id": session } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  if (!res.ok && res.status !== 202) throw new Error(`MCP server answered ${res.status}: ${text.slice(0, 200)}`);
  return { sid: res.headers.get("mcp-session-id") ?? session ?? undefined, ct: res.headers.get("content-type") ?? "", text };
}

function parseRpc(ct: string, text: string, id: number): any {
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

async function open(url: string, auth?: string) {
  assertPublicUrl(url);
  const headers = authHeaders(auth);
  const init = await post(url, headers, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "agenticvenus", version: "1.0" } },
  });
  const r = parseRpc(init.ct, init.text, 1);
  if (!r || r.error) throw new Error(`MCP initialize failed: ${r?.error?.message ?? "no answer (this must be a Streamable-HTTP MCP URL)"}`);
  await post(url, headers, { jsonrpc: "2.0", method: "notifications/initialized" }, init.sid).catch(() => {});
  let n = 1;
  return async (method: string, params?: unknown) => {
    const id = ++n;
    const x = await post(url, headers, { jsonrpc: "2.0", id, method, params }, init.sid);
    const j = parseRpc(x.ct, x.text, id);
    if (!j) throw new Error("MCP server gave no answer.");
    if (j.error) throw new Error(j.error.message ?? "MCP error");
    return j.result;
  };
}

const cache = new Map<string, { t: number; tools: McpTool[] }>();

export async function mcpList(url: string, auth?: string): Promise<McpTool[]> {
  const key = url + "|" + (auth ?? "");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 60_000) return hit.tools;
  const call = await open(url, auth);
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 5; i++) {
    const r = await call("tools/list", cursor ? { cursor } : {});
    tools.push(...((r?.tools ?? []) as McpTool[]));
    cursor = r?.nextCursor;
    if (!cursor) break;
  }
  cache.set(key, { t: Date.now(), tools });
  return tools;
}

export async function mcpCall(url: string, auth: string | undefined, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const call = await open(url, auth);
  const r = await call("tools/call", { name, arguments: args });
  const parts = ((r?.content ?? []) as Array<{ type: string; text?: string }>).map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`));
  return { isError: Boolean(r?.isError), text: parts.join("\n") || JSON.stringify(r?.structuredContent ?? r ?? {}) };
}

export function paramSummary(t: McpTool): string {
  const props = t.inputSchema?.properties ?? {};
  const req = new Set(t.inputSchema?.required ?? []);
  return Object.entries(props).map(([k, v]) => `${k}${req.has(k) ? "" : "?"}:${v.type ?? "any"}`).join(", ");
}