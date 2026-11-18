import { NextResponse } from "next/server";
import { cronDenied } from "@/lib/cron-auth";
import { kick, store } from "@/lib/agent/worker";
import { appBaseUrl } from "@/lib/voice-server";
import { planTick } from "@/lib/agent/actions";
import { tickVenus } from "@/lib/venus-run-server";
import { tickBusiness } from "@/lib/business-server";
import { tickWatchers } from "@/lib/watchers-server";
import { tickTeamRuns } from "@/lib/team-server";
import type { Reply } from "@/lib/agent/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Called every few minutes by the scheduler (same secret as the routines). It wakes up everything that is waiting on a clock:
//   - a slice that died (lease expired)            -> the run continues from its last save
//   - a run held by a budget latch                 -> continues when the limit has reset
//   - a takeover with no heartbeat / past 15 min   -> the screen is handed back to the agent
//   - a card nobody answered for 24 hours          -> the agent is told, and wraps up
//   - a Business Hub team job                       -> the next steps start, finished ones are collected
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

      const plan = planTick(run, run.status === "budget" ? await S.readLatch(q.uid) : null, now);
      switch (plan.do) {
        case "clear": await S.clearQueue(q.id); out.cleared++; break;
        case "resume": await S.setQueue(q.uid, q.id, "run", now + 90_000); go(); out.resumed++; break;
        case "wait": await S.setQueue(q.uid, q.id, plan.kind, plan.at); out.waiting++; break;
        case "requeue":
          await S.patchRun(q.uid, q.id, { status: "queued", error: null, resumeAt: null });
          await S.setQueue(q.uid, q.id, "run", now + 90_000);
          go(); out.resumed++; break;
        case "answer":
          await answer(plan.reply, plan.takeover ? { takeover: plan.takeover } : {});
          out[plan.counted]++; break;
      }
    }
    // Venus Pro videos that run on the server: wake the ones whose slice died, announce finished ones that were not announced
    const venus = await tickVenus(site, now).catch(() => ({ checked: 0, resumed: 0, posted: 0 }));
    // Business Hub teams working in the background: start the next steps, collect finished ones, post the report
    const business = await tickBusiness(site, now).catch(() => ({ checked: 0 }));
    // Proactive watchers (mail / calendar / GitHub / routines -> proposals) and dashboard team runs that work in the background
    const watchers = await tickWatchers(site, now).catch(() => ({ checked: 0, sent: 0 }));
    const teams = await tickTeamRuns(site, now).catch(() => ({ checked: 0 }));
    return NextResponse.json({ ok: true, ...out, venus, business, watchers, teams });
  } catch (err) {
    return NextResponse.json({ ok: false, ...out, error: err instanceof Error ? err.message : "Agent tick failed." }, { status: 500 });
  }
}
