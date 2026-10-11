import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { runAfter } from "@/lib/channels";
import { advance, kickMission, type Mission } from "@/lib/mission";

export const runtime = "nodejs";
export const maxDuration = 60;

// Called by missions themselves (with uid+id) and every 5 minutes by GitHub Actions (no body) as a safety net.
export async function POST(req: Request) {
  const secret = process.env.ROUTINE_RUNNER_SECRET;
  if (!secret) return NextResponse.json({ error: "ROUTINE_RUNNER_SECRET is not set." }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as { uid?: string; id?: string };
  if (b.uid && b.id) {
    runAfter(advance(b.uid, b.id)); // answer at once, work continues in the background
    return NextResponse.json({ accepted: true }, { status: 202 });
  }

  try {
    const snap = await getAdminDb().collectionGroup("missions").where("status", "in", ["running", "waiting_call"]).get();
    let kicked = 0, stale = 0;
    for (const d of snap.docs) {
      const m = d.data() as Mission;
      const uid = d.ref.parent.parent?.id;
      if (!uid) continue;
      if (m.status === "running" && (m.lease ?? 0) < Date.now() && kicked < 10) { kickMission(uid, d.id); kicked++; }
      else if (m.status === "waiting_call" && Date.now() - m.updatedAt > 25 * 60_000) {
        // the call never reported back: tell the agent and continue
        await d.ref.update({
          status: "running", waitCall: null, lease: 0, updatedAt: Date.now(),
          messages: [...m.messages, { role: "user", content: "CALL RESULT: unknown (the call did not report back in time). Treat it as no answer and continue." }].slice(-60),
        });
        kickMission(uid, d.id);
        stale++;
      }
    }
    return NextResponse.json({ checked: snap.size, kicked, stale });
  } catch (e) {
    // Usually the missing collection-group index: the message contains a link that creates it.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Mission tick failed." }, { status: 500 });
  }
}