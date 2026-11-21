// Pure helpers for the MCP connector (OAuth 2.1 + PKCE). No network, no database: fully unit-tested.
// Relative imports with ".ts" on purpose, so the same file runs in Next.js and in `node --test`.
import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const MCP_PATH = "/api/mcp";
/** Newest first. An unknown version asked by a client gets the second entry (the widest supported one). */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SCOPE_READ = "tools:read";
export const SCOPE_WRITE = "tools:write";
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
export const CODE_TTL_MS = 5 * 60_000;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (prefix: string) => prefix + randomBytes(32).toString("base64url"); // prefix + 43 chars

export const isChallenge = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
export const isVerifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(v);

/** PKCE, method S256 only (plain is not accepted). */
export function pkceMatches(verifier: unknown, challenge: unknown): boolean {
  if (!isVerifier(verifier) || !isChallenge(challenge)) return false;
  const a = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** https anywhere, or http only on this computer (for local tools). No fragments, no user:password. */
export function isValidRedirectUri(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 500) return false;
  let u: URL;
  try { u = new URL(v); } catch { return false; }
  if (u.username || u.password || u.hash) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

export const scopeFor = (write: boolean) => (write ? `${SCOPE_READ} ${SCOPE_WRITE}` : SCOPE_READ);
export const canWrite = (scope: unknown) => typeof scope === "string" && scope.split(/\s+/).includes(SCOPE_WRITE);

/** The public https address of this site. NEXT_PUBLIC_APP_URL wins; otherwise the proxy headers. */
export function baseUrlOf(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) { try { return new URL(env).origin; } catch { /* fall through */ } }
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export const resourceUrl = (base: string) => base + MCP_PATH;

export const protectedResourceMetadata = (base: string) => ({
  resource: resourceUrl(base),
  authorization_servers: [base],
  scopes_supported: [SCOPE_READ, SCOPE_WRITE],
  bearer_methods_supported: ["header"],
  resource_name: "AgenticVenus",
});

export const authServerMetadata = (base: string) => ({
  issuer: base,
  authorization_endpoint: `${base}/mcp-authorize`,
  token_endpoint: `${base}/api/mcp/oauth/token`,
  registration_endpoint: `${base}/api/mcp/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: [SCOPE_READ, SCOPE_WRITE],
});

/** The 401 header that tells an MCP client where to start the login. */
export const wwwAuthenticate = (base: string) => `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource${MCP_PATH}"`;

export const bearerOf = (req: Request) => (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra },
  });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS });
