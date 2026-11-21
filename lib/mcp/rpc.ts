// The MCP protocol (JSON-RPC 2.0 over Streamable HTTP, JSON replies). Pure: tools come in through `deps`.
import { PROTOCOL_VERSIONS } from "./oauth-core.ts";

export type McpTool = { name: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> };
export type ToolOutcome = { text: string; isError: boolean; image?: { mediaType: string; data: string } };
export type RpcDeps = {
  info: { name: string; version: string; instructions?: string };
  listTools: () => Promise<McpTool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>;
};
type Id = string | number | null;
export type RpcResponse = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string } };

const MAX_TEXT = 200_000;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
const fail = (id: Id, code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

/** One message. Returns null for notifications (nothing to answer). */
export async function handleRpc(msg: unknown, deps: RpcDeps): Promise<RpcResponse | null> {
  if (!isObj(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return fail(isObj(msg) && (typeof msg.id === "string" || typeof msg.id === "number") ? msg.id : null, -32600, "Invalid Request");
  }
  const method = msg.method;
  if (msg.id === undefined || method.startsWith("notifications/")) return null;
  const id = msg.id as Id;
  const params = isObj(msg.params) ? msg.params : {};

  try {
    if (method === "initialize") {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: deps.info.name, version: deps.info.version },
        ...(deps.info.instructions ? { instructions: deps.info.instructions } : {}),
      });
    }
    if (method === "ping") return ok(id, {});
    if (method === "tools/list") return ok(id, { tools: await deps.listTools() });
    if (method === "tools/call") {
      const name = params.name;
      if (typeof name !== "string" || !name || name.length > 128) return fail(id, -32602, "Missing tool name.");
      if (params.arguments !== undefined && !isObj(params.arguments)) return fail(id, -32602, "arguments must be an object.");
      const out = await deps.callTool(name, (params.arguments as Record<string, unknown>) ?? {});
      const text = out.text.length > MAX_TEXT ? out.text.slice(0, MAX_TEXT) + "\n…(cut)" : out.text;
      const content: Array<Record<string, unknown>> = [{ type: "text", text }];
      if (out.image && /^image\/(png|jpeg|webp)$/.test(out.image.mediaType) && out.image.data.length < 4_000_000) {
        content.push({ type: "image", data: out.image.data, mimeType: out.image.mediaType });
      }
      return ok(id, { content, isError: out.isError });
    }
    return fail(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    return fail(id, -32603, e instanceof Error ? e.message.slice(0, 300) : "Internal error");
  }
}

/** A body can be one message or (older clients) an array of them. Returns what to send back, or null for 202. */
export async function handleBody(body: unknown, deps: RpcDeps): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (!body.length || body.length > 20) return fail(null, -32600, "Invalid Request");
    const out = (await Promise.all(body.map((m) => handleRpc(m, deps)))).filter((r): r is RpcResponse => r !== null);
    return out.length ? out : null;
  }
  return handleRpc(body, deps);
}