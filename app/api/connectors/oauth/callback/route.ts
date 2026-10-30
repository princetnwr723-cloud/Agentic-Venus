import { createHmac, timingSafeEqual } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { vaultPut } from "@/lib/vault";
import { getOAuthProvider } from "@/lib/tools/oauth-catalog";
import { identifyAccount } from "@/lib/tools/oauth-identify";
import { extendToken, pkceVerifier, tokenRequest } from "@/lib/tools/oauth-token";
import { syncConnectorAnnouncements } from "@/lib/connector-announce";
import { oauthResultPage } from "@/lib/oauth-result";

export const runtime = "nodejs";
export const maxDuration = 60;
function secret() { const v = process.env.ROUTINE_RUNNER_SECRET; if (!v || v.length < 32) throw new Error("OAuth callback is not configured securely."); return v; }
function fail(req: Request, message: string) {
  return oauthResultPage(req, false, message);
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    if (u.searchParams.has("error")) return fail(req, `Provider denied authorization: ${u.searchParams.get("error_description") || u.searchParams.get("error")}`);
    if (!code || !state || state.length > 4096) return fail(req, "OAuth callback is missing code or state.");
    const parts = state.split(".");
    if (parts.length !== 2) return fail(req, "Invalid OAuth state.");
    const [payload, sig] = parts;
    const expected = createHmac("sha256", secret()).update(payload).digest();
    const actual = Buffer.from(sig, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return fail(req, "OAuth state signature is invalid.");
    const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { uid: string; chatId: string; provider: string; h?: string; exp: number; nonce: string };
    if (!d.uid || !d.chatId || !d.nonce || !Number.isFinite(d.exp) || d.exp < Date.now()) return fail(req, "OAuth state expired. Start connection again.");
    const provider = getOAuthProvider(d.provider);
    if (!provider) return fail(req, "Unknown OAuth provider.");

    const db = getAdminDb();
    try { await db.collection("oauthNonces").doc(d.nonce).create({ uid: d.uid, chatId: d.chatId, provider: d.provider, createdAt: Date.now(), expiresAt: d.exp }); }
    catch { return fail(req, "OAuth state was already used or could not be verified."); }

    const clientId = process.env[provider.clientIdEnv], clientSecret = process.env[provider.clientSecretEnv];
    if (!clientId || !clientSecret) return fail(req, `Server setup missing ${provider.clientIdEnv} or ${provider.clientSecretEnv}.`);
    const redirectUri = process.env.OAUTH_REDIRECT_URI || new URL("/api/connectors/oauth/callback", req.url).toString();
    const basicAuth = ["notion_oauth", "figma"].includes(provider.id); // these two want a JSON body with Basic auth
    let response: Response;
    if (basicAuth) {
      response = await fetch(provider.tokenUrl, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
        body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
        signal: AbortSignal.timeout(15000),
      });
    } else {
      // Every other provider: form body. Social providers add their own style (Basic header, client_key, PKCE).
      const q = tokenRequest(provider, {
        grant_type: "authorization_code", code, redirect_uri: redirectUri,
        ...(provider.pkce ? { code_verifier: pkceVerifier(d.nonce) } : {}),
      });
      response = await fetch(provider.tokenUrl, { method: "POST", headers: q.headers, body: q.body, signal: AbortSignal.timeout(15000) });
    }
    const t = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!response.ok || !t.access_token) return fail(req, `Token exchange failed for ${provider.label}. Check the app credentials, redirect URI and provider-specific OAuth requirements.`);

    // Facebook and Threads give a short login (about an hour). Swap it for the long one (about 60 days).
    if (provider.exchange) {
      try {
        const x = await extendToken(provider, t.access_token);
        t.access_token = x.access;
        t.expires_in = x.exp ? Math.max(60, Math.round((x.exp - Date.now()) / 1000)) : t.expires_in;
      } catch { return fail(req, `${provider.label} login could not be made long-lasting. Check the app id and secret, then try again.`); }
    }

    // Which account did the person really sign in with? A different one than asked for is never saved.
    const account = await identifyAccount(provider.id, t.access_token);
    if (d.h && account && account.toLowerCase() !== d.h.toLowerCase() && (provider.id === "google" || provider.id === "microsoft" || provider.identity === "email")) {
      return fail(req, `You signed in as ${account}, but you asked for ${d.h}. Nothing was saved. Try again and pick the right account.`);
    }

    const chatRef = db.collection("users").doc(d.uid).collection("chats").doc(d.chatId);
    const chat = await chatRef.get();
    if (!chat.exists) return fail(req, "Target chat no longer exists.");

    const stored = JSON.stringify({ access: t.access_token, refresh: t.refresh_token, exp: t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : undefined });
    const placeholder = await vaultPut(d.uid, `conn.${d.chatId.toLowerCase()}.oauth:${provider.id}`, stored);
    await chatRef.update({
      [`connectors.oauth:${provider.id}`]: placeholder,
      [`connectorStatus.${provider.id}`]: { status: "connected", connectedAt: Date.now(), scopes: provider.scopes, refreshable: Boolean(t.refresh_token) || Boolean(provider.exchange), account },
    });
    await syncConnectorAnnouncements(d.uid, d.chatId, { added: [`oauth:${provider.id}`] }).catch(() => {}); // posts "Agent updated" in the chat

    return oauthResultPage(req, true, `${provider.label} connected.`, { provider: provider.id, chatId: d.chatId });
  } catch (e) { return fail(req, e instanceof Error ? e.message : "OAuth callback failed."); }
}
