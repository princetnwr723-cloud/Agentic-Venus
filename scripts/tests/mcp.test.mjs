// The AgenticVenus MCP connector: PKCE, redirect checks, the Firestore login store (in-memory), the JSON-RPC protocol and tool names.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { fakeDb } from "./helpers/fake-db.mjs";
import {
  pkceMatches, isValidRedirectUri, scopeFor, canWrite, authServerMetadata, protectedResourceMetadata, wwwAuthenticate, sha256, PROTOCOL_VERSIONS,
} from "../../lib/mcp/oauth-core.ts";
import {
  registerClient, checkClientRedirect, createCode, redeemCode, issueTokens, refreshTokens, verifyAccess, listConnections, revokeClient, McpOAuthError,
} from "../../lib/mcp/store.ts";
import { handleRpc, handleBody } from "../../lib/mcp/rpc.ts";
import { toNative, fromNative, listable, isBlocked } from "../../lib/mcp/names.ts";

const verifier = () => randomBytes(32).toString("base64url");
const challengeOf = (v) => createHash("sha256").update(v).digest("base64url");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

test("PKCE: only the matching S256 verifier passes", () => {
  const v = verifier();
  assert.equal(pkceMatches(v, challengeOf(v)), true);
  assert.equal(pkceMatches(verifier(), challengeOf(v)), false);
  assert.equal(pkceMatches("short", challengeOf(v)), false);
  assert.equal(pkceMatches(v, v), false); // "plain" is refused
});

test("redirect addresses: https, or http on this computer only", () => {
  for (const ok of [REDIRECT, "http://localhost:6274/cb", "http://127.0.0.1/cb"]) assert.equal(isValidRedirectUri(ok), true, ok);
  for (const bad of ["http://evil.com/cb", "javascript:alert(1)", "https://a.com/cb#x", "https://u:p@a.com/cb", "", "ftp://a.com", "https://a.com/" + "x".repeat(600), 5])
    assert.equal(isValidRedirectUri(bad), false, String(bad));
});

test("scopes and metadata", () => {
  assert.equal(canWrite(scopeFor(false)), false);
  assert.equal(canWrite(scopeFor(true)), true);
  const m = authServerMetadata("https://x.app");
  assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
  assert.equal(m.registration_endpoint, "https://x.app/api/mcp/oauth/register");
  assert.equal(protectedResourceMetadata("https://x.app").resource, "https://x.app/api/mcp");
  assert.match(wwwAuthenticate("https://x.app"), /resource_metadata="https:\/\/x\.app\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
});

test("full login: register -> code -> tokens -> verify -> refresh (rotation) -> revoke", async () => {
  const { db } = fakeDb();
  const c = await registerClient(db, { name: "Claude", redirectUris: [REDIRECT] });
  assert.ok(await checkClientRedirect(db, c.clientId, REDIRECT));
  assert.equal(await checkClientRedirect(db, c.clientId, REDIRECT + "/x"), null); // exact match only
  assert.equal(await checkClientRedirect(db, c.clientId, "https://evil.com"), null);

  const v = verifier();
  const code = await createCode(db, { clientId: c.clientId, uid: "u1", redirectUri: REDIRECT, challenge: challengeOf(v), scope: scopeFor(true) });
  const grant = await redeemCode(db, { code, clientId: c.clientId, redirectUri: REDIRECT, verifier: v });
  assert.deepEqual(grant, { uid: "u1", clientId: c.clientId, scope: scopeFor(true) });
  assert.equal(await redeemCode(db, { code, clientId: c.clientId, redirectUri: REDIRECT, verifier: v }), null); // single use

  const t = await issueTokens(db, grant);
  const who = await verifyAccess(db, t.access_token);
  assert.equal(who.uid, "u1");
  assert.equal(await verifyAccess(db, t.refresh_token), null); // a refresh token is not an access token
  assert.equal(await verifyAccess(db, "mca_" + "A".repeat(43)), null);

  const t2 = await refreshTokens(db, { refreshToken: t.refresh_token, clientId: c.clientId });
  assert.notEqual(t2.access_token, t.access_token);
  await assert.rejects(refreshTokens(db, { refreshToken: t.refresh_token, clientId: c.clientId }), McpOAuthError); // old one is dead

  const list = await listConnections(db, "u1");
  assert.equal(list.length, 1);
  assert.equal(list[0].write, true);
  assert.equal(await revokeClient(db, "u1", c.clientId) >= 2, true);
  assert.equal(await verifyAccess(db, t2.access_token), null);
  assert.equal((await listConnections(db, "u1")).length, 0);
});

test("a wrong verifier, wrong app or wrong redirect burns the code", async () => {
  const { db } = fakeDb();
  const c = await registerClient(db, { name: "A", redirectUris: [REDIRECT] });
  const v = verifier();
  for (const bad of [{ verifier: verifier() }, { redirectUri: "https://evil.com" }, { clientId: "mcpc_" + "B".repeat(43) }]) {
    const code = await createCode(db, { clientId: c.clientId, uid: "u1", redirectUri: REDIRECT, challenge: challengeOf(v), scope: scopeFor(false) });
    assert.equal(await redeemCode(db, { code, clientId: c.clientId, redirectUri: REDIRECT, verifier: v, ...bad }), null);
    assert.equal(await redeemCode(db, { code, clientId: c.clientId, redirectUri: REDIRECT, verifier: v }), null); // already burned
  }
});

test("a refresh token cannot be used by another app", async () => {
  const { db } = fakeDb();
  const a = await registerClient(db, { name: "A", redirectUris: [REDIRECT] });
  const t = await issueTokens(db, { uid: "u1", clientId: a.clientId, scope: scopeFor(false) });
  await assert.rejects(refreshTokens(db, { refreshToken: t.refresh_token, clientId: "mcpc_" + "C".repeat(43) }), McpOAuthError);
});

test("one person's disconnect does not touch another person's tokens", async () => {
  const { db } = fakeDb();
  const c = await registerClient(db, { name: "Claude", redirectUris: [REDIRECT] });
  const t1 = await issueTokens(db, { uid: "u1", clientId: c.clientId, scope: scopeFor(false) });
  const t2 = await issueTokens(db, { uid: "u2", clientId: c.clientId, scope: scopeFor(false) });
  await revokeClient(db, "u1", c.clientId);
  assert.equal(await verifyAccess(db, t1.access_token), null);
  assert.equal((await verifyAccess(db, t2.access_token)).uid, "u2");
});

test("registration rejects bad redirect addresses and cleans the name", async () => {
  const { db } = fakeDb();
  await assert.rejects(registerClient(db, { redirectUris: ["http://evil.com/cb"] }), McpOAuthError);
  await assert.rejects(registerClient(db, { redirectUris: [] }), McpOAuthError);
  const c = await registerClient(db, { name: "<b>Hi</b>\n" + "x".repeat(200), redirectUris: [REDIRECT] });
  assert.equal(c.name.includes("<"), false);
  assert.ok(c.name.length <= 80);
});

// ---------------- protocol ----------------
const deps = {
  info: { name: "agenticvenus", version: "1", instructions: "hi" },
  listTools: async () => [{ name: "web__search", description: "d", inputSchema: { type: "object", properties: {} } }],
  callTool: async (name, args) => (name === "boom" ? Promise.reject(new Error("x".repeat(500))) : { text: `ran ${name} ${JSON.stringify(args)}`, isError: false }),
};

test("initialize: echoes a known version, falls back for an unknown one", async () => {
  const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSIONS[2] } }, deps);
  assert.equal(r.result.protocolVersion, PROTOCOL_VERSIONS[2]);
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  const u = await handleRpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, deps);
  assert.equal(u.result.protocolVersion, PROTOCOL_VERSIONS[1]);
});

test("notifications get no answer; unknown methods and bad input get errors", async () => {
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, deps), null);
  assert.equal((await handleRpc({ jsonrpc: "2.0", id: 3, method: "nope" }, deps)).error.code, -32601);
  assert.equal((await handleRpc({ id: 4 }, deps)).error.code, -32600);
  assert.equal((await handleRpc("x", deps)).error.code, -32600);
  assert.deepEqual((await handleRpc({ jsonrpc: "2.0", id: 5, method: "ping" }, deps)).result, {});
});

test("tools/list and tools/call", async () => {
  const l = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, deps);
  assert.equal(l.result.tools[0].name, "web__search");
  const c = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "web__search", arguments: { query: "hi" } } }, deps);
  assert.equal(c.result.isError, false);
  assert.match(c.result.content[0].text, /ran web__search/);
  assert.equal((await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { arguments: {} } }, deps)).error.code, -32602);
  assert.equal((await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "a", arguments: [] } }, deps)).error.code, -32602);
  const e = await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "boom" } }, deps);
  assert.equal(e.error.code, -32603);
  assert.ok(e.error.message.length <= 300);
});

test("batches answer every request and skip notifications", async () => {
  const out = await handleBody([
    { jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "ping" },
  ], deps);
  assert.equal(out.length, 2);
  assert.equal(await handleBody([{ jsonrpc: "2.0", method: "notifications/initialized" }], deps), null);
  assert.equal((await handleBody([], deps)).error.code, -32600);
});

test("tool names survive the round trip and unsafe ones are not listed", () => {
  assert.equal(toNative("web.search"), "web__search");
  assert.equal(fromNative("web__search"), "web.search");
  assert.equal(listable("web.search"), true);
  assert.equal(listable("mcp_github.search_repos"), true);
  assert.equal(listable("a".repeat(70) + ".x"), false);
  assert.equal(listable("odd name.x"), false);
  assert.equal(listable("a__b.c"), false); // would come back as a.b__c
  assert.equal(isBlocked("connect.service"), true);
  assert.equal(isBlocked("web.search"), false);
  assert.equal(isBlocked("mission.start", "mission., voice."), true);
});

test("sha256 is stable", () => assert.equal(sha256("a"), "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"));
