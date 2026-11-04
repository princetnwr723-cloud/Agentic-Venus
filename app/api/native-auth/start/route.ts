import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { verifyUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 15;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Step 1 of the app's Google login (PKCE). The Chrome login page calls this with the signed-in user's token and the app's challenge. */
export async function POST(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const b = (await req.json().catch(() => ({}))) as { challenge?: unknown };
    const challenge = typeof b.challenge === "string" ? b.challenge : "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return NextResponse.json({ error: "Bad challenge." }, { status: 400 });

    const code = randomBytes(32).toString("base64url"); // 43 characters
    const exp = Date.now() + 120_000;
    await getAdminDb().collection("nativeAuth").doc(sha(code)).set({ uid, challenge, exp, expireAt: new Date(exp) });
    return NextResponse.json({ code });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Login failed.";
    return NextResponse.json({ error: m }, { status: /session|sign in|token|auth/i.test(m) ? 401 : 500 });
  }
}