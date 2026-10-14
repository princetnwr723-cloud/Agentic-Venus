import { http } from "./net";
import type { OAuthProvider } from "./oauth-catalog";
import type { ToolCtx } from "./types";

// OAuth tokens are stored as {access, refresh, exp}. Old plain-string tokens still work.
export type OTok = { access: string; refresh?: string; exp?: number };

export const parseTok = (v: string): OTok => {
  try { const j = JSON.parse(v); if (j && typeof j.access === "string") return j as OTok; } catch { /* plain token */ }
  return { access: v };
};

export async function refreshTok(p: OAuthProvider, t: OTok): Promise<OTok> {
  const id = process.env[p.clientIdEnv], secret = process.env[p.clientSecretEnv];
  if (!id || !secret || !t.refresh) throw new Error("no refresh token");
  const r = await http(p.tokenUrl, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: id, client_secret: secret }).toString(),
  }, 15_000);
  if (r.status >= 400 || !r.json?.access_token) throw new Error("refresh failed");
  return { access: String(r.json.access_token), refresh: r.json.refresh_token ? String(r.json.refresh_token) : t.refresh, exp: r.json.expires_in ? Date.now() + Number(r.json.expires_in) * 1000 : t.exp };
}

/** A valid access token for a provider; renews it (and saves the new one) when it is about to expire. */
export async function oauthAccess(p: OAuthProvider, raw: string, ctx?: ToolCtx): Promise<string> {
  let tok = parseTok(raw);
  if (tok.refresh && tok.exp && tok.exp < Date.now() + 60_000) {
    try {
      tok = await refreshTok(p, tok);
      if (ctx) await ctx.save(`oauth:${p.id}`, JSON.stringify(tok));
    } catch { throw new Error(`${p.label} login expired. Open Connectors and press Reconnect for ${p.label}.`); }
  }
  return tok.access;
}