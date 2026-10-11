import { NextResponse } from "next/server";
import { createHash, createHmac, randomBytes } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { readBody, requestStatus } from "@/lib/request";
import { vaultPut } from "@/lib/vault";
import { appBaseUrl } from "@/lib/voice-server";
import { safeId } from "@/lib/tools/catalog";
import { assertPublicUrl } from "@/lib/tools/net";
import { buildAuthUrl, discover, pkce, registerClient } from "@/lib/tools/mcp-oauth";

export const runtime = "nodejs";
export const maxDuration = 30;

function secret() {
  const v = process.env.ROUTINE_RUNNER_SECRET;
  if (!v || v.length < 32) throw new Error("ROUTINE_RUNNER_SECRET must be set to at least 32 characters.");
  return v;
}

export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 8 * 1024 });
    const uid = String(b.uid);
    const chatId = String(b.chatId || "");
    const name = safeId(String(b.name || ""));
    const url = String(b.url || "").trim();
    if (!/^[A-Za-z0-9_-]{4,160}$/.test(chatId)) return NextResponse.json({ ok: false, error: "Valid chatId is required." }, { status: 400 });
    if (!name || name === "x") return NextResponse.json({ ok: false, error: "A name is required." }, { status: 400 });
    assertPublicUrl(url);

    const redirectUri = `${appBaseUrl(req)}/api/connectors/mcp-oauth/callback`;
    const { as, resource, scopes } = await discover(url, typeof b.resourceMetadata === "string" ? b.resourceMetadata : undefined);

    // One registered client per (server, redirect) is reused for every sign-in.
    const db = getAdminDb();
    const key = createHash("sha256").update(`${as.issuer}|${redirectUri}`).digest("hex").slice(0, 20);
    const cref = db.collection("users").doc(uid).collection("mcpClients").doc(key);
    const cdoc = (await cref.get()).data() as { clientId?: string; secretPh?: string } | undefined;
    let clientId = cdoc?.clientId || "";
    let secretPh = cdoc?.secretPh || "";
    if (!clientId) {
      const reg = await registerClient(as, redirectUri);
      clientId = reg.clientId;
      secretPh = reg.clientSecret ? await vaultPut(uid, `mcpclient.${key}`, reg.clientSecret) : "";
      await cref.set({ clientId, secretPh, issuer: as.issuer, at: Date.now() });
    }

    const { verifier, challenge } = pkce();
    const nonce = randomBytes(18).toString("hex");
    await db.collection("users").doc(uid).collection("mcpOauth").doc(nonce).set({
      chatId, name, url, verifier, tokenEndpoint: as.token_endpoint, clientId, secretPh, resource, expiresAt: Date.now() + 10 * 60_000,
    });
    const payload = Buffer.from(JSON.stringify({ u: uid, n: nonce })).toString("base64url");
    const state = `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
    return NextResponse.json({ ok: true, url: buildAuthUrl({ as, clientId, redirectUri, state, challenge, resource, scopes }) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Sign-in could not start." }, { status: requestStatus(e) });
  }
}