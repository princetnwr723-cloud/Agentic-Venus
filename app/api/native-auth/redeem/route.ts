import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 15;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Step 2: the app trades the one-time code + its secret verifier for a Firebase custom token. A code stolen by another app is useless without the verifier. */
export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { code?: unknown; verifier?: unknown };
    const code = typeof b.code === "string" ? b.code : "";
    const verifier = typeof b.verifier === "string" ? b.verifier : "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) {
      return NextResponse.json({ error: "Login code is invalid." }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("nativeAuth").doc(sha(code));
    const uid = await db.runTransaction(async (tx) => {
      const d = (await tx.get(ref)).data() as { uid?: string; challenge?: string; exp?: number } | undefined;
      if (!d?.uid || !d.challenge || Number(d.exp ?? 0) < Date.now()) return null;
      if (createHash("sha256").update(verifier).digest("base64url") !== d.challenge) return null;
      tx.delete(ref); // single use
      return d.uid;
    });
    if (!uid) return NextResponse.json({ error: "Login code is invalid or expired. Try again." }, { status: 400 });

    const token = await getAdminAuth().createCustomToken(uid);
    return NextResponse.json({ token });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Login failed." }, { status: 500 });
  }
}