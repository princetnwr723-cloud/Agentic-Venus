import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveValue } from "@/lib/vault";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 30;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// The agent types the saved login into the page it is working on (on the visible screen). The AI model never sees it.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await authFromRequest(req, body.uid);
    if (!auth.job) return NextResponse.json({ error: "Only the running task can use saved logins." }, { status: 403 });
    const n = norm(String(body.site || ""));
    if (n.length < 2) return NextResponse.json({ error: "No site given." }, { status: 400 });
    const snap = await getAdminDb().collection("users").doc(auth.uid).get();
    const all = ((snap.data() as { pcCredentials?: Record<string, { email: string; password: string }> } | undefined)?.pcCredentials ?? {});
    for (const [k, v] of Object.entries(all)) {
      if (k === n || (k.length >= 3 && n.includes(k)) || (n.length >= 3 && k.includes(n))) {
        await audit(auth.uid, { kind: "login_used", chatId: auth.chatId, text: k });
        return NextResponse.json({ email: await resolveValue(auth.uid, v.email), password: await resolveValue(auth.uid, v.password) });
      }
    }
    return NextResponse.json({ error: "No saved login for that site." }, { status: 404 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}