import { getAdminDb } from "@/lib/firebase-admin";
import { jsonResponse, preflight } from "@/lib/mcp/oauth-core.ts";
import { McpOAuthError, registerClient } from "@/lib/mcp/store.ts";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Dynamic client registration (RFC 7591): Claude registers itself here the first time. Public client, PKCE only. */
export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => null)) as { client_name?: unknown; redirect_uris?: unknown } | null;
    if (!b || typeof b !== "object") return jsonResponse({ error: "invalid_client_metadata", error_description: "Body must be JSON." }, 400);
    const c = await registerClient(getAdminDb(), { name: b.client_name, redirectUris: b.redirect_uris });
    return jsonResponse({
      client_id: c.clientId, client_name: c.name, redirect_uris: c.redirectUris,
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none", client_id_issued_at: Math.floor(c.createdAt / 1000),
    }, 201);
  } catch (e) {
    if (e instanceof McpOAuthError) return jsonResponse({ error: e.code, error_description: e.message }, e.status);
    return jsonResponse({ error: "server_error" }, 500);
  }
}
export const OPTIONS = preflight;
