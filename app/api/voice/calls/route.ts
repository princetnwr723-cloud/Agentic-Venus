import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import { voiceSafeError } from "@/lib/voice-server";
import { VoiceError, placeOutboundCall } from "@/lib/voice-calls";
import { readBody, requestStatus } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 30;
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(req: Request) {
  try {
    const auth = await authFromRequest(req);
    if (auth.job) return fail("Background jobs cannot view call history.", 403);
    const col = getAdminDb().collection("users").doc(auth.uid).collection("voiceCalls");
    const snap = await col.orderBy("createdAt", "desc").limit(50).get();
    const calls = snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, direction: x.direction, to: x.to ?? "", from: x.from ?? "", status: x.status ?? "unknown", createdAt: x.createdAt ?? 0, durationSeconds: x.durationSeconds ?? 0, goal: x.goal ?? "", summary: x.summary ?? "" };
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todaySnap = await col.where("createdAt", ">=", today.getTime()).get();
    return NextResponse.json({ calls, todayCount: todaySnap.size });
  } catch (e) { return fail(voiceSafeError(e), requestStatus(e, 401)); }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 16 * 1024 });
    const call = await placeOutboundCall(body.uid as string, {
      to: String(body.to || ""), goal: String(body.goal || ""), context: String(body.context || ""),
      chatId: typeof body.chatId === "string" && body.chatId ? body.chatId : undefined, approved: body.approved === true, req,
    });
    return NextResponse.json({ ok: true, call }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(voiceSafeError(e), e instanceof VoiceError ? e.status : requestStatus(e));
  }
}