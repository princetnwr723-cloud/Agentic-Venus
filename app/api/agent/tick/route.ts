import { NextResponse } from "next/server";
import { cronDenied } from "@/lib/cron-auth";
import { kick, store } from "@/lib/agent/worker";
import { appBaseUrl } from "@/lib/voice-server";
import { latchActive } from "@/lib/agent/budget";
import { beat, endedBecause, handBack, nextCheck, takeoverSeconds, END_TEXT } from "@/lib/agent/takeover";
import type { Reply } from "@/lib/agent/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Called every few minutes by the scheduler (same secret as the routines). It wakes up everything that is waiting on a clock:
//   - a slice that died (lease expired)            -> the run continues from its last save
//   - a run held by a budget latch                 -> continues when the limit has reset
//   - a takeover with no heartbeat / past 15 min   -> the screen is handed back to the agent
//   - a card nobody answered for 24 hours          -> the agent is told, and wraps up
export async function POST(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  const S = store();
  const now = Date.now();
  let site = "";
  try { site = appBaseUrl(req); } catch { site = new URL(req.url).origin; }
  const out = { checked: 0, resumed: 0, waiting: 0, handedBack: 0, timedOut: 0, cleared: 0 };
  try {
    for (const q of await S.dueQueue(now, 25)) {
      out.checked++;
      const run = await S.getRun(q.uid, q.id);
      if (!run || ["done", "error", "stopped"].includes(run.status)) { await S.clearQueue(q.id); out.cleared++; continue; }
      const go = () => kick(q.uid, q.id, run.chatId, run.origin || site);
      const answer = async (reply: Reply, extra: Record<string, unknown> = {}) => {
        await S.patchRun(q.uid, q.id, { reply, ...extra });
        await S.setQueue(q.uid, q.id, "run", now + 90_000);
        go();
      };

      if (run.status === "queued" || run.status === "running") { await S.setQueue(q.uid, q.id, "run", now + 90_000); go(); out.resumed++; continue; }

      if (run.status === "budget") {
        const l = await S.readLatch(q.uid);
        if (latchActive(l, now)) { await S.setQueue(q.uid, q.id, "run", l.until); out.waiting++; continue; }
        await S.patchRun(q.uid, q.id, { status: "queued", error: null });
        await S.setQueue(q.uid, q.id, "run", now + 90_000);
        go(); out.resumed++; continue;
      }

      if (run.status === "paused" && run.pending) {
        const t = run.takeover;
        if (t?.status === "active") {
          const why = endedBecause(t, now);
          if (why) {
            const ended = handBack(t, now, why);
            await answer({ action: "takeover_done", seconds: takeoverSeconds(ended), note: `The screen was handed back because ${END_TEXT[why]}.`, reason: run.pending.summary.slice(0, 80) }, { takeover: ended });
            out.handedBack++;
          } else { await S.setQueue(q.uid, q.id, "takeover", nextCheck(beat(t, t.lastBeat ?? now))); out.waiting++; }
          continue;
        }
        if (run.pending.expiresAt <= now) { await answer({ action: "timeout" }); out.timedOut++; continue; }
        await S.setQueue(q.uid, q.id, "expire", run.pending.expiresAt);
        out.waiting++;
        continue;
      }
      await S.clearQueue(q.id);
      out.cleared++;
    }
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return NextResponse.json({ ok: false, ...out, error: err instanceof Error ? err.message : "Agent tick failed." }, { status: 500 });
  }
}
