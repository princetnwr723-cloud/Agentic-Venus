import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import { voiceSafeError } from "@/lib/voice-server";
import { VoiceError, endLiveCall, placeOutboundCall, sendOwnerNote } from "@/lib/voice-calls";
import { readBody, requestStatus } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 30;
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
type Line = { who: "agent" | "person" | "you"; text: string; at: number };

export async function GET(req: Request) {
  try {
    const auth = await authFromRequest(req);
    if (auth.job) return fail("Background jobs cannot view call history.", 403);
    const col = getAdminDb().collection("users").doc(auth.uid).collection("voiceCalls");

    // one call, live: what is being said right now (the Voice page polls this while a call is running)
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const snap = await col.doc(id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80)).get();
      if (!snap.exists) return fail("Call nahi mili.", 404);
      const x = snap.data() ?? {};
      const lines: Line[] = [
        ...((x.transcript ?? []) as Array<{ role: string; text: string; at: number }>).map((t) => ({ who: (t.role === "assistant" ? "agent" : "person") as Line["who"], text: String(t.text), at: Number(t.at) })),
        ...((x.ownerNotes ?? []) as Array<{ text: string; at: number }>).map((n) => ({ who: "you" as const, text: String(n.text), at: Number(n.at) })),
      ].sort((a, b) => a.at - b.at).slice(-80);
      return NextResponse.json({ call: { id: snap.id, status: x.status ?? "unknown", lines, lastError: x.lastError ?? "", lastVoice: x.lastVoice ?? "", durationSeconds: x.durationSeconds ?? 0 } }, { headers: { "Cache-Control": "no-store" } });
    }

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
    const uid = body.uid as string;
    const callId = String(body.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);

    // you talk to the agent while it is on the call
    if (body.action === "say") {
      const r = await sendOwnerNote(uid, callId, String(body.text || ""), req);
      return NextResponse.json({ ok: true, live: r.live }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "end") {
      await endLiveCall(uid, callId);
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    const call = await placeOutboundCall(uid, {
      to: String(body.to || ""), goal: String(body.goal || ""), context: String(body.context || ""),
      chatId: typeof body.chatId === "string" && body.chatId ? body.chatId : undefined, approved: body.approved === true, req,
    });
    return NextResponse.json({ ok: true, call }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(voiceSafeError(e), e instanceof VoiceError ? e.status : requestStatus(e));
  }
}