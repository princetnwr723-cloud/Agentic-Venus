import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { approveMission, kickMission, listMissions, startMission, stopMission } from "@/lib/mission";
import { defaultChatId } from "@/lib/voice-calls";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 32 * 1024 });
    const uid = String(b.uid);
    const action = String(b.action || "");
    if (action === "list") return NextResponse.json({ missions: await listMissions(uid) });
    if (action === "start") {
      const chatId = String(b.chatId || "") || (await defaultChatId(uid));
      if (!chatId) return NextResponse.json({ error: "Create a chat first." }, { status: 400 });
      const r = await startMission(uid, { chatId, goal: String(b.goal || ""), maxCalls: Number(b.maxCalls) || 0, allowWrites: b.allowWrites === true, notify: Array.isArray(b.notify) ? b.notify : undefined });
      return NextResponse.json({ ok: true, ...r });
    }
    const id = String(b.id || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return NextResponse.json({ error: "Bad mission id." }, { status: 400 });
    if (action === "stop") { await stopMission(uid, id); return NextResponse.json({ ok: true }); }
    if (action === "approve") { await approveMission(uid, id, true); return NextResponse.json({ ok: true }); }
    if (action === "decline") { await approveMission(uid, id, false); return NextResponse.json({ ok: true }); }
    if (action === "kick") { kickMission(uid, id); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Mission request failed." }, { status: requestStatus(e) });
  }
}