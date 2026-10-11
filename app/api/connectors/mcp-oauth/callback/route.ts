import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveValue, vaultPut } from "@/lib/vault";
import { appBaseUrl } from "@/lib/voice-server";
import { exchangeCode } from "@/lib/tools/mcp-oauth";

export const runtime = "nodejs";
export const maxDuration = 30;

function secret() {
  const v = process.env.ROUTINE_RUNNER_SECRET;
  if (!v || v.length < 32) throw new Error("OAuth callback is not configured securely.");
  return v;
}
function back(req: Request, ok: boolean, message: string, extra: Record<string, string> = {}) {
  const u = new URL("/dashboard", appBaseUrl(req));
  u.searchParams.set("connector_oauth", ok ? "success" : "error");
  u.searchParams.set("message", message.slice(0, 180));
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return NextResponse.redirect(u, 303);
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state") || "";
    if (u.searchParams.has("error")) return back(req, false, `Sign-in was refused: ${u.searchParams.get("error_description") || u.searchParams.get("error")}`);
    if (!code || !state || state.length > 2048) return back(req, false, "Sign-in callback is missing code or state.");

    const [payload, sig, extra] = state.split(".");
    if (!payload || !sig || extra) return back(req, false, "Invalid sign-in state.");
    const expected = createHmac("sha256", secret()).update(payload).digest();
    const actual = Buffer.from(sig, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return back(req, false, "Sign-in state signature is invalid.");
    const { u: uid, n: nonce } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u: string; n: string };

    const db = getAdminDb();
    const sref = db.collection("users").doc(uid).collection("mcpOauth").doc(nonce);
    const s = (await sref.get()).data() as { chatId: string; name: string; url: string; verifier: string; tokenEndpoint: string; clientId: string; secretPh?: string; resource: string; expiresAt: number } | undefined;
    await sref.delete().catch(() => {}); // single use
    if (!s || s.expiresAt < Date.now()) return back(req, false, "Sign-in expired. Please try connecting again.");

    const redirectUri = `${appBaseUrl(req)}/api/connectors/mcp-oauth/callback`;
    const clientSecret = s.secretPh ? await resolveValue(uid, s.secretPh) : undefined;
    const oauth = await exchangeCode({ tokenEndpoint: s.tokenEndpoint, clientId: s.clientId, clientSecret, code, redirectUri, verifier: s.verifier, resource: s.resource });

    const chatRef = db.collection("users").doc(uid).collection("chats").doc(s.chatId);
    if (!(await chatRef.get()).exists) return back(req, false, "The chat for this connector no longer exists.");
    const kind = `mcp:${s.name}`;
    const placeholder = await vaultPut(uid, `conn.${s.chatId.toLowerCase()}.${kind}`, JSON.stringify({ url: s.url, oauth }));
    await chatRef.update({ [`connectors.${kind}`]: placeholder });
    return back(req, true, `${s.name} connected.`, { provider: s.name, chatId: s.chatId });
  } catch (e) {
    return back(req, false, e instanceof Error ? e.message : "Sign-in failed.");
  }
}