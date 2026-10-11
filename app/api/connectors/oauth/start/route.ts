import { NextResponse } from "next/server";
import { randomBytes, createHmac } from "crypto";
import { readBody, requestStatus } from "@/lib/request";
import { getOAuthProvider } from "@/lib/tools/oauth-catalog";

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
    // The expected account travels inside the signed state, so it cannot be changed on the way.
    const payload = Buffer.from(JSON.stringify({ uid: b.uid, chatId, provider: provider.id, h: hint || undefined, exp: Date.now() + 10 * 60_000, nonce: randomBytes(18).toString("hex") })).toString("base64url");
    const state = `${payload}.${sign(payload)}`;
    const url = new URL(provider.authorizeUrl);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    if (provider.scopes.length) url.searchParams.set("scope", provider.scopes.join(" "));
    // select_account: ALWAYS show the account chooser, so a different Google account that is already logged in
    // in this browser is never picked silently. consent + offline: needed to get a refresh token.
    if (provider.id === "google") {
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "select_account consent");
      url.searchParams.set("include_granted_scopes", "true");
      if (hint) url.searchParams.set("login_hint", hint);
    }
    if (provider.id === "microsoft") { url.searchParams.set("prompt", "select_account"); if (hint) url.searchParams.set("login_hint", hint); }
    if (provider.id === "atlassian") { url.searchParams.set("audience", "api.atlassian.com"); url.searchParams.set("prompt", "consent"); }
    return NextResponse.json({ ok: true, url: url.toString() });
  } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "OAuth start failed." }, { status: requestStatus(e) }); }
}