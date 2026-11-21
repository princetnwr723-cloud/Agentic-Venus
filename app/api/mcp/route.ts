import { getAdminDb } from "@/lib/firebase-admin";
import { baseUrlOf, bearerOf, jsonResponse, preflight, wwwAuthenticate, CORS } from "@/lib/mcp/oauth-core.ts";
import { handleBody, type RpcDeps } from "@/lib/mcp/rpc.ts";
import { verifyAccess } from "@/lib/mcp/store.ts";
import { MCP_INSTRUCTIONS, listMcpTools, runMcpTool } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY = 1_000_000;

/** The AgenticVenus MCP server (Streamable HTTP, JSON replies). Add https://YOUR-SITE/api/mcp as a custom connector in Claude. */
export async function POST(req: Request) {
  const base = baseUrlOf(req);
  try {
    const grant = await verifyAccess(getAdminDb(), bearerOf(req));
    if (!grant) return jsonResponse({ error: "unauthorized" }, 401, { "WWW-Authenticate": wwwAuthenticate(base) });

    if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large." } }, 413);
    const text = await req.text();
    if (text.length > MAX_BODY) return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large." } }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }

    const site = { baseUrl: base, origin: base };
    const deps: RpcDeps = {
      info: { name: "agenticvenus", version: "0.3.0", instructions: MCP_INSTRUCTIONS },
      listTools: () => listMcpTools(grant.uid, site),
      callTool: (name, args) => runMcpTool(grant.uid, grant.scope, name, args, site),
    };
    const out = await handleBody(body, deps);
    if (out === null) return new Response(null, { status: 202, headers: CORS });
    return jsonResponse(out);
  } catch (e) {
    return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32603, message: e instanceof Error ? e.message.slice(0, 200) : "Server error" } }, 500);
  }
}

// This server has no streaming channel and no sessions, so GET and DELETE are not offered (the spec allows 405).
const notAllowed = () => new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS } });
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = preflight;
