import { createHash, createHmac } from "crypto";
import { http } from "./net";
import type { OAuthProvider } from "./oauth-catalog";
import type { ToolCtx } from "./types";

// OAuth tokens are stored as {access, refresh, exp}. Old plain-string tokens still work.
export type OTok = { access: string; refresh?: string; exp?: number };

export const parseTok = (v: string): OTok => {
  try { const j = JSON.parse(v); if (j && typeof j.access === "string") return j as OTok; } catch { /* plain token */ }
  return { access: v };
};

/** Reddit (and others) reject requests without a clear User-Agent. */
export const OAUTH_UA = "AgenticVenus/1.0 (OAuth connector)";

function stateSecret(): string {
  const v = process.env.ROUTINE_RUNNER_SECRET;
  if (!v || v.length < 32) throw new Error("ROUTINE_RUNNER_SECRET must be set to at least 32 characters.");
  return v;
}

/**
 * PKCE verifier. It is NOT stored anywhere and NOT put in the URL: it is derived from the one-time nonce with the
 * server secret, so the start route and the callback route compute the same value while nobody else can.
 */
export const pkceVerifier = (nonce: string): string => createHmac("sha256", stateSecret()).update("pkce:" + nonce).digest("base64url");
export const pkceChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

/** Headers + form body for a token request (code exchange or refresh) in the style each provider wants. */
export function tokenRequest(p: OAuthProvider, params: Record<string, string>): { headers: Record<string, string>; body: string } {
  const id = process.env[p.clientIdEnv], secret = process.env[p.clientSecretEnv];
  if (!id || !secret) throw new Error(`Server setup missing ${p.clientIdEnv} or ${p.clientSecretEnv}.`);
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": OAUTH_UA };
  const body = new URLSearchParams(params);
  if (p.tokenAuth === "basic") headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  else { body.set(p.clientIdParam ?? "client_id", id); body.set("client_secret", secret); }
  return { headers, body: body.toString() };
}

/** Facebook / Threads: swap a short-lived login for a long-lived one (about 60 days), or renew a long-lived one. */
export async function extendToken(p: OAuthProvider, access: string, renew = false): Promise<{ access: string; exp?: number }> {
  const id = process.env[p.clientIdEnv], secret = process.env[p.clientSecretEnv];
  if (!id || !secret) throw new Error(`Server setup missing ${p.clientIdEnv} or ${p.clientSecretEnv}.`);
  let url: string;
  if (p.exchange === "meta") {
    // The same call both creates and renews a long-lived Facebook user token.
    url = `${p.tokenUrl}?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: access })}`;
  } else if (p.exchange === "threads") {
    url = renew
      ? `https://graph.threads.net/refresh_access_token?${new URLSearchParams({ grant_type: "th_refresh_token", access_token: access })}`
      : `https://graph.threads.net/access_token?${new URLSearchParams({ grant_type: "th_exchange_token", client_secret: secret, access_token: access })}`;
  } else throw new Error("This provider has no token exchange.");
  const r = await http(url, { headers: { Accept: "application/json", "User-Agent": OAUTH_UA } }, 15_000);
  if (r.status >= 400 || !r.json?.access_token) throw new Error("token exchange failed");
  return { access: String(r.json.access_token), exp: r.json.expires_in ? Date.now() + Number(r.json.expires_in) * 1000 : undefined };
}

export async function refreshTok(p: OAuthProvider, t: OTok): Promise<OTok> {
  if (p.exchange) {
    const x = await extendToken(p, t.access, true);
    return { access: x.access, exp: x.exp ?? t.exp };
  }
  const id = process.env[p.clientIdEnv], secret = process.env[p.clientSecretEnv];
  if (!id || !secret || !t.refresh) throw new Error("no refresh token");
  const q = tokenRequest(p, { grant_type: "refresh_token", refresh_token: t.refresh });
  const r = await http(p.tokenUrl, { method: "POST", headers: q.headers, body: q.body }, 15_000);
  if (r.status >= 400 || !r.json?.access_token) throw new Error("refresh failed");
  return { access: String(r.json.access_token), refresh: r.json.refresh_token ? String(r.json.refresh_token) : t.refresh, exp: r.json.expires_in ? Date.now() + Number(r.json.expires_in) * 1000 : t.exp };
}

/** A valid access token for a provider; renews it (and saves the new one) when it is about to expire. */
export async function oauthAccess(p: OAuthProvider, raw: string, ctx?: ToolCtx): Promise<string> {
  let tok = parseTok(raw);
  // Facebook / Threads logins have no refresh token: they are renewed from the access token itself, a week before they end.
  const lead = p.exchange ? 7 * 24 * 3600_000 : 60_000;
  if ((tok.refresh || p.exchange) && tok.exp && tok.exp < Date.now() + lead) {
    try {
      tok = await refreshTok(p, tok);
      if (ctx) await ctx.save(`oauth:${p.id}`, JSON.stringify(tok));
    } catch {
      if (p.exchange && (tok.exp ?? 0) > Date.now()) return tok.access; // still valid today; renewal is tried again on the next call
      throw new Error(`${p.label} login expired. Open Connectors and press Reconnect for ${p.label}.`);
    }
  }
  return tok.access;
}