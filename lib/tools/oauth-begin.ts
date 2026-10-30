import { createHmac, randomBytes } from "crypto";
import { getOAuthProvider } from "./oauth-catalog";
import { pkceChallenge, pkceVerifier } from "./oauth-token";

function secret() {
  const v = process.env.ROUTINE_RUNNER_SECRET;
  if (!v || v.length < 32) throw new Error("ROUTINE_RUNNER_SECRET must be set to at least 32 characters.");
  return v;
}
const sign = (v: string) => createHmac("sha256", secret()).update(v).digest("base64url");

/** True when the site owner has put this provider's app credentials into Vercel (so "Connect" can work). */
export function oauthConfigured(providerId: string): boolean {
  const p = getOAuthProvider(providerId);
  return Boolean(p && process.env[p.clientIdEnv]);
}

/**
 * The provider's sign-in address for one of the built-in OAuth apps (Google, Slack, GitHub ...).
 * Shared by the Connectors window (/api/connectors/oauth/start) and by the agent (connect.service in the chat),
 * so both always build exactly the same, signed link.
 */
export function buildOAuthUrl(o: { uid: string; chatId: string; providerId: string; redirectUri: string; hint?: string }): string {
  const provider = getOAuthProvider(o.providerId);
  if (!provider) throw new Error("Unsupported OAuth provider.");
  const clientId = process.env[provider.clientIdEnv];
  if (!clientId) throw new Error(`Server setup required: ${provider.clientIdEnv} is missing in Vercel.`);
  const hint = (o.hint ?? "").trim().toLowerCase().slice(0, 120);
  // The account hint is only meaningful (and only checked) for providers that sign in with an e-mail address.
  const useHint = hint && (provider.id === "google" || provider.id === "microsoft" || provider.identity === "email") ? hint : "";
  // The expected account travels inside the signed state, so it cannot be changed on the way.
  const nonce = randomBytes(18).toString("hex");
  const payload = Buffer.from(JSON.stringify({ uid: o.uid, chatId: o.chatId, provider: provider.id, h: useHint || undefined, exp: Date.now() + 10 * 60_000, nonce })).toString("base64url");
  const state = `${payload}.${sign(payload)}`;
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set(provider.clientIdParam ?? "client_id", clientId);
  url.searchParams.set("redirect_uri", o.redirectUri);
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
  return url.toString();
}
