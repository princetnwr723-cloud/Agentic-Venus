import { createHash, randomBytes } from "crypto";
import { safeFetch } from "./net";

export type AsMeta = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
};
export type McpOAuth = {
  access: string;
  refresh?: string;
  exp?: number;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  resource: string;
};

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await safeFetch(url, { headers: { Accept: "application/json" } }, 10_000);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Finds out how to sign in to an MCP server (MCP authorization spec):
 * protected-resource metadata -> authorization-server metadata -> endpoints.
 */
export async function discover(mcpUrl: string, resourceMetadataUrl?: string): Promise<{ as: AsMeta; resource: string; scopes?: string[] }> {
  const u = new URL(mcpUrl);
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
  const prmCandidates = [resourceMetadataUrl, `${u.origin}/.well-known/oauth-protected-resource${path}`, `${u.origin}/.well-known/oauth-protected-resource`].filter(Boolean) as string[];
  let prm: any = null;
  for (const c of prmCandidates) { prm = await getJson(c); if (prm) break; }

  const issuer: string = (Array.isArray(prm?.authorization_servers) && prm.authorization_servers[0]) || u.origin;
  const iu = new URL(issuer);
  const ipath = iu.pathname === "/" ? "" : iu.pathname.replace(/\/+$/, "");
  const asCandidates = [
    `${iu.origin}/.well-known/oauth-authorization-server${ipath}`,
    `${iu.origin}/.well-known/openid-configuration${ipath}`,
    `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
    `${iu.origin}/.well-known/oauth-authorization-server`,
  ];
  let meta: any = null;
  for (const c of asCandidates) {
    const j = await getJson(c);
    if (j?.authorization_endpoint && j?.token_endpoint) { meta = j; break; }
  }
  // Servers without metadata use these default paths (MCP 2025-03-26).
  const as: AsMeta = meta
    ? { issuer, authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint, registration_endpoint: meta.registration_endpoint, scopes_supported: meta.scopes_supported }
    : { issuer, authorization_endpoint: `${u.origin}/authorize`, token_endpoint: `${u.origin}/token`, registration_endpoint: `${u.origin}/register` };
  const scopes: string[] | undefined = Array.isArray(prm?.scopes_supported) && prm.scopes_supported.length ? prm.scopes_supported : undefined;
  return { as, resource: typeof prm?.resource === "string" ? prm.resource : mcpUrl, scopes };
}

/** Dynamic client registration (RFC 7591): the server gives us a client_id, no developer app needed. */
export async function registerClient(as: AsMeta, redirectUri: string): Promise<{ clientId: string; clientSecret?: string }> {
  if (!as.registration_endpoint) throw new Error("This server does not allow automatic sign-in setup. Use a token / API key for it instead.");
  const r = await safeFetch(as.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "AgenticVenus", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], token_endpoint_auth_method: "none",
    }),
  }, 15_000);
  const j = (await r.json().catch(() => ({}))) as { client_id?: string; client_secret?: string; error_description?: string; error?: string };
  if (!r.ok || !j.client_id) throw new Error(`Sign-in setup was refused by the server: ${j.error_description || j.error || "HTTP " + r.status}`);
  return { clientId: j.client_id, clientSecret: j.client_secret };
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function buildAuthUrl(o: { as: AsMeta; clientId: string; redirectUri: string; state: string; challenge: string; resource: string; scopes?: string[] }): string {
  const u = new URL(o.as.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("state", o.state);
  u.searchParams.set("code_challenge", o.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", o.resource);
  if (o.scopes?.length) u.searchParams.set("scope", o.scopes.join(" "));
  return u.toString();
}

async function tokenRequest(endpoint: string, params: Record<string, string>, clientId: string, clientSecret?: string) {
  const body = new URLSearchParams(params);
  body.set("client_id", clientId);
  if (clientSecret) body.set("client_secret", clientSecret);
  const r = await safeFetch(endpoint, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body }, 15_000);
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`Token request failed: ${j.error_description || j.error || "HTTP " + r.status}`);
  return j;
}

export async function exchangeCode(o: { tokenEndpoint: string; clientId: string; clientSecret?: string; code: string; redirectUri: string; verifier: string; resource: string }): Promise<McpOAuth> {
  const j = await tokenRequest(o.tokenEndpoint, { grant_type: "authorization_code", code: o.code, redirect_uri: o.redirectUri, code_verifier: o.verifier, resource: o.resource }, o.clientId, o.clientSecret);
  return { access: j.access_token as string, refresh: j.refresh_token, exp: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : undefined, tokenEndpoint: o.tokenEndpoint, clientId: o.clientId, clientSecret: o.clientSecret, resource: o.resource };
}

export async function refreshMcpToken(o: McpOAuth): Promise<McpOAuth> {
  if (!o.refresh) throw new Error("No refresh token.");
  const j = await tokenRequest(o.tokenEndpoint, { grant_type: "refresh_token", refresh_token: o.refresh, resource: o.resource }, o.clientId, o.clientSecret);
  return { ...o, access: j.access_token as string, refresh: j.refresh_token || o.refresh, exp: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : o.exp };
}