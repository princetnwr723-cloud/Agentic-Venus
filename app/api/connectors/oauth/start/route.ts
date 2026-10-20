import { NextResponse } from "next/server";
import { randomBytes, createHmac } from "crypto";
import { readBody, requestStatus } from "@/lib/request";
import { getOAuthProvider } from "@/lib/tools/oauth-catalog";
import { pkceChallenge, pkceVerifier } from "@/lib/tools/oauth-token";

export const runtime = "nodejs";
function secret() { const v = process.env.ROUTINE_RUNNER_SECRET; if (!v || v.length < 32) throw new Error("ROUTINE_RUNNER_SECRET must be set to at least 32 characters."); return v; }
function sign(v: string) { return createHmac("sha256", secret()).update(v).digest("base64url"); }

export async function POST(req: Request) {
  try {
    const b = await readBody(req);
    const provider = getOAuthProvider(String(b.provider || ""));
    const chatId = String(b.chatId || "");
    if (!provider) return NextResponse.json({ ok: false, error: "Unsupported OAuth provider." }, { status: 400 });
    if (!/^[A-Za-z0-9_-]{4,160}$/.test(chatId)) return NextResponse.json({ ok: false, error: "Valid chatId is required." }, { status: 400 });
    const hint = String(b.hint || "").trim().toLowerCase().slice(0, 120);
    if (hint && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hint)) return NextResponse.json({ ok: false, error: "Enter a valid email address, or leave the account field empty." }, { status: 400 });
    const clientId = process.env[provider.clientIdEnv];
    if (!clientId) return NextResponse.json({ ok: false, error: `Server setup required: ${provider.clientIdEnv} is missing in Vercel.` }, { status: 503 });
    const redirectUri = process.env.OAUTH_REDIRECT_URI || new URL("/api/connectors/oauth/callback", req.url).toString();
    // The account hint is only meaningful (and only checked) for providers that sign in with an e-mail address.
    const useHint = hint && (provider.id === "google" || provider.id === "microsoft" || provider.identity === "email") ? hint : "";
    // The expected account travels inside the signed state, so it cannot be changed on the way.
    const nonce = randomBytes(18).toString("hex");
    const payload = Buffer.from(JSON.stringify({ uid: b.uid, chatId, provider: provider.id, h: useHint || undefined, exp: Date.now() + 10 * 60_000, nonce })).toString("base64url");
    const state = `${payload}.${sign(payload)}`;
    const url = new URL(provider.authorizeUrl);
    url.searchParams.set(provider.clientIdParam ?? "client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    if (provider.scopes.length) url.searchParams.set("scope", provider.scopes.join(provider.scopeSep ?? " "));
    // select_account: ALWAYS show the account chooser, so a different Google account that is already logged in
    // in this browser is never picked silently. consent + offline: needed to get a refresh token.
    if (provider.id === "google") {
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "select_account consent");
      url.searchParams.set("include_granted_scopes", "true");
      if (useHint) url.searchParams.set("login_hint", useHint);
    }
    if (provider.id === "microsoft") { url.searchParams.set("prompt", "select_account"); if (useHint) url.searchParams.set("login_hint", useHint); }
    if (provider.id === "atlassian") { url.searchParams.set("audience", "api.atlassian.com"); url.searchParams.set("prompt", "consent"); }
    // Social providers: fixed extra parameters (YouTube offline access, Reddit permanent login) and PKCE (X).
    for (const [k, v] of Object.entries(provider.authorizeExtra ?? {})) url.searchParams.set(k, v);
    if (provider.identity === "email" && useHint) url.searchParams.set("login_hint", useHint);
    if (provider.pkce) {
      url.searchParams.set("code_challenge", pkceChallenge(pkceVerifier(nonce)));
      url.searchParams.set("code_challenge_method", "S256");
    }
    return NextResponse.json({ ok: true, url: url.toString() });
  } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "OAuth start failed." }, { status: requestStatus(e) }); }
}
