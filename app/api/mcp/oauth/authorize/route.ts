import { getAdminDb } from "@/lib/firebase-admin";
import { verifyUser } from "@/lib/server-auth";
import { baseUrlOf, isChallenge, jsonResponse, preflight, resourceUrl, scopeFor } from "@/lib/mcp/oauth-core.ts";
import { checkClientRedirect, createCode } from "@/lib/mcp/store.ts";

export const runtime = "nodejs";
export const maxDuration = 15;

type Body = {
  action?: string; client_id?: string; redirect_uri?: string; state?: string; code_challenge?: string;
  code_challenge_method?: string; resource?: string; write?: boolean;
};

const withParams = (uri: string, p: Record<string, string>) => {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(p)) if (v) u.searchParams.set(k, v);
  return u.toString();
};

/**
 * Called by the /mcp-authorize page (never a redirect target itself).
 * info    -> app name + where it will return to (no login needed)
 * approve -> needs the signed-in person's Firebase token; returns the address to send the browser back to, with the code
 * deny    -> returns the address with error=access_denied
 * The redirect address is checked against the registered one BEFORE anything is returned, so this can never be an open redirect.
 */
export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as Body;
    const db = getAdminDb();
    const client = await checkClientRedirect(db, b.client_id, b.redirect_uri);
    if (!client || !b.redirect_uri) return jsonResponse({ error: "This sign-in link is not valid. Start again from Claude." }, 400);
    const state = typeof b.state === "string" ? b.state.slice(0, 500) : "";

    if (b.action === "info") return jsonResponse({ clientName: client.name, redirectHost: new URL(b.redirect_uri).host });
    if (b.action === "deny") return jsonResponse({ redirect: withParams(b.redirect_uri, { error: "access_denied", state }) });
    if (b.action !== "approve") return jsonResponse({ error: "Unknown action." }, 400);

    if (!isChallenge(b.code_challenge) || b.code_challenge_method !== "S256") return jsonResponse({ error: "This app did not send a valid PKCE challenge (S256)." }, 400);
    if (b.resource && b.resource !== resourceUrl(baseUrlOf(req))) return jsonResponse({ error: "This app asked for a different server." }, 400);

    const { uid } = await verifyUser(req);
    const code = await createCode(db, { clientId: client.clientId, uid, redirectUri: b.redirect_uri, challenge: b.code_challenge, scope: scopeFor(b.write === true) });
    return jsonResponse({ redirect: withParams(b.redirect_uri, { code, state }) });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Sign-in failed.";
    return jsonResponse({ error: m }, /session|sign in|token|auth/i.test(m) ? 401 : 500);
  }
}
export const OPTIONS = preflight;
