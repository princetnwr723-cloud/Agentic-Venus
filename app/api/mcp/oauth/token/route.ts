import { getAdminDb } from "@/lib/firebase-admin";
import { jsonResponse, preflight } from "@/lib/mcp/oauth-core.ts";
import { McpOAuthError, getClient, issueTokens, redeemCode, refreshTokens } from "@/lib/mcp/store.ts";

export const runtime = "nodejs";
export const maxDuration = 15;

async function params(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") || "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(j)) if (typeof v === "string") out[k] = v;
  } else {
    const form = new URLSearchParams(await req.text().catch(() => ""));
    form.forEach((v, k) => { out[k] = v; });
  }
  return out;
}

/** OAuth token endpoint: authorization_code (+PKCE) and refresh_token. Public clients only (no client secret). */
export async function POST(req: Request) {
  try {
    const p = await params(req);
    const db = getAdminDb();
    if (!(await getClient(db, p.client_id))) throw new McpOAuthError("invalid_client", "Unknown app.", 401);

    if (p.grant_type === "authorization_code") {
      const grant = await redeemCode(db, { code: p.code ?? "", clientId: p.client_id, redirectUri: p.redirect_uri ?? "", verifier: p.code_verifier ?? "" });
      if (!grant) throw new McpOAuthError("invalid_grant", "The code is invalid, expired or already used.");
      return jsonResponse(await issueTokens(db, grant));
    }
    if (p.grant_type === "refresh_token") return jsonResponse(await refreshTokens(db, { refreshToken: p.refresh_token ?? "", clientId: p.client_id }));
    throw new McpOAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  } catch (e) {
    if (e instanceof McpOAuthError) return jsonResponse({ error: e.code, error_description: e.message }, e.status);
    return jsonResponse({ error: "server_error" }, 500);
  }
}
export const OPTIONS = preflight;
