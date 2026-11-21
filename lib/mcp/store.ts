// Firestore side of the MCP login: registered apps, one-time codes, access and refresh tokens.
// Only SHA-256 hashes of codes and tokens are stored. These collections are NOT in firestore.rules, so only the server
// (Admin SDK) can touch them. Add a Firestore TTL policy on the "expireAt" field of mcpCodes and mcpTokens to auto-clean.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { ACCESS_TTL_S, CODE_TTL_MS, REFRESH_TTL_S, isValidRedirectUri, pkceMatches, randomToken, sha256 } from "./oauth-core.ts";

export class McpOAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "McpOAuthError";
    this.code = code;
    this.status = status;
  }
}

export type Grant = { uid: string; clientId: string; scope: string };
export type TokenSet = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

const clients = (db: Firestore) => db.collection("mcpClients");
const codes = (db: Firestore) => db.collection("mcpCodes");
const tokens = (db: Firestore) => db.collection("mcpTokens");

export async function registerClient(db: Firestore, input: { name?: unknown; redirectUris?: unknown }) {
  const uris = Array.isArray(input.redirectUris) ? input.redirectUris : [];
  if (!uris.length || uris.length > 5 || !uris.every(isValidRedirectUri)) {
    throw new McpOAuthError("invalid_redirect_uri", "redirect_uris must be 1-5 https URLs (http only for localhost).");
  }
  const name = (typeof input.name === "string" ? input.name : "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80) || "MCP app";
  const clientId = randomToken("mcpc_");
  const createdAt = Date.now();
  await clients(db).doc(clientId).set({ name, redirectUris: uris, createdAt });
  return { clientId, name, redirectUris: uris as string[], createdAt };
}

export async function getClient(db: Firestore, clientId: unknown) {
  if (typeof clientId !== "string" || !/^mcpc_[A-Za-z0-9_-]{43}$/.test(clientId)) return null;
  const d = (await clients(db).doc(clientId).get()).data() as { name?: string; redirectUris?: string[] } | undefined;
  if (!d || !Array.isArray(d.redirectUris)) return null;
  return { clientId, name: String(d.name || "MCP app"), redirectUris: d.redirectUris };
}

/** The redirect address must match one registered address EXACTLY (no prefix or wildcard matching). */
export async function checkClientRedirect(db: Firestore, clientId: unknown, redirectUri: unknown) {
  const c = await getClient(db, clientId);
  if (!c || typeof redirectUri !== "string" || !c.redirectUris.includes(redirectUri)) return null;
  return c;
}

export async function createCode(db: Firestore, p: { clientId: string; uid: string; redirectUri: string; challenge: string; scope: string }) {
  const code = randomToken("mc_");
  const exp = Date.now() + CODE_TTL_MS;
  await codes(db).doc(sha256(code)).set({ ...p, exp, expireAt: new Date(exp) });
  return code;
}

/** One use only: the code is deleted the moment it is looked at, right or wrong. */
export async function redeemCode(db: Firestore, p: { code: string; clientId: string; redirectUri: string; verifier: string }): Promise<Grant | null> {
  const ref = codes(db).doc(sha256(p.code));
  return db.runTransaction(async (tx: Transaction) => {
    const d = (await tx.get(ref)).data() as { clientId?: string; uid?: string; redirectUri?: string; challenge?: string; scope?: string; exp?: number } | undefined;
    if (!d) return null;
    tx.delete(ref);
    if (!d.uid || !d.scope || Number(d.exp ?? 0) < Date.now() || d.clientId !== p.clientId || d.redirectUri !== p.redirectUri || !pkceMatches(p.verifier, d.challenge)) return null;
    return { uid: d.uid, clientId: d.clientId, scope: d.scope };
  });
}

export async function issueTokens(db: Firestore, g: Grant, since = Date.now()): Promise<TokenSet> {
  const now = Date.now();
  const access = randomToken("mca_");
  const refresh = randomToken("mcr_");
  const aExp = now + ACCESS_TTL_S * 1000, rExp = now + REFRESH_TTL_S * 1000;
  await tokens(db).doc(sha256(access)).set({ t: "a", ...g, exp: aExp, expireAt: new Date(aExp) });
  await tokens(db).doc(sha256(refresh)).set({ t: "r", ...g, since, exp: rExp, expireAt: new Date(rExp) });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: g.scope };
}

/** A refresh token works once and is swapped for a new pair (rotation). */
export async function refreshTokens(db: Firestore, p: { refreshToken: string; clientId: string }): Promise<TokenSet> {
  if (!/^mcr_[A-Za-z0-9_-]{43}$/.test(p.refreshToken)) throw new McpOAuthError("invalid_grant", "Refresh token is invalid.");
  const ref = tokens(db).doc(sha256(p.refreshToken));
  const d = await db.runTransaction(async (tx: Transaction) => {
    const x = (await tx.get(ref)).data() as { t?: string; uid?: string; clientId?: string; scope?: string; exp?: number; since?: number } | undefined;
    if (!x || x.t !== "r") return null;
    tx.delete(ref);
    if (!x.uid || !x.scope || Number(x.exp ?? 0) < Date.now() || x.clientId !== p.clientId) return null;
    return x as Required<Pick<typeof x, "uid" | "clientId" | "scope">> & { since?: number };
  });
  if (!d) throw new McpOAuthError("invalid_grant", "Refresh token is invalid or expired.");
  return issueTokens(db, { uid: d.uid, clientId: d.clientId, scope: d.scope }, d.since);
}

export async function verifyAccess(db: Firestore, token: string): Promise<Grant | null> {
  if (!/^mca_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const d = (await tokens(db).doc(sha256(token)).get()).data() as { t?: string; uid?: string; clientId?: string; scope?: string; exp?: number } | undefined;
  if (!d || d.t !== "a" || !d.uid || !d.clientId || !d.scope || Number(d.exp ?? 0) < Date.now()) return null;
  return { uid: d.uid, clientId: d.clientId, scope: d.scope };
}

export async function listConnections(db: Firestore, uid: string) {
  const snap = await tokens(db).where("uid", "==", uid).where("t", "==", "r").get();
  const byClient = new Map<string, { since: number; write: boolean }>();
  for (const s of snap.docs) {
    const d = s.data() as { clientId?: string; since?: number; scope?: string };
    if (!d.clientId) continue;
    const prev = byClient.get(d.clientId);
    const since = Number(d.since ?? 0);
    byClient.set(d.clientId, { since: prev ? Math.min(prev.since, since) : since, write: (prev?.write ?? false) || String(d.scope ?? "").includes("tools:write") });
  }
  const out: { clientId: string; name: string; since: number; write: boolean }[] = [];
  for (const [clientId, v] of Array.from(byClient)) out.push({ clientId, name: (await getClient(db, clientId))?.name ?? "MCP app", ...v });
  return out.sort((a, b) => b.since - a.since);
}

/** "Disconnect": every access and refresh token of this app for this user stops working. */
export async function revokeClient(db: Firestore, uid: string, clientId: string) {
  const snap = await tokens(db).where("uid", "==", uid).where("clientId", "==", clientId).get();
  for (const s of snap.docs) await tokens(db).doc(s.id).delete();
  return snap.docs.length;
}
