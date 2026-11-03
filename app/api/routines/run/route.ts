import { NextResponse } from "next/server";
import { runAfter } from "@/lib/channels";
import { claimRoutine, runClaimed, tickRoutines, type Trigger } from "@/lib/routines-server";
import { cronDenied } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const TRIGGERS: Trigger[] = ["schedule", "manual", "hook", "chain"];

// Two ways in, both protected by ROUTINE_RUNNER_SECRET:
//  1) no body  -> the scheduler tick (GitHub Actions / your own runner): finds due routines and starts each one in its own call
//  2) {uid,id} -> run ONE routine (what the tick, a chain and the webhook use)
export async function POST(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;

  const b = (await req.json().catch(() => ({}))) as { uid?: string; id?: string; trigger?: string; payload?: string; depth?: number };
  try {
    if (b.uid && b.id) {
      const trigger = TRIGGERS.includes(b.trigger as Trigger) ? (b.trigger as Trigger) : "schedule";
      const c = await claimRoutine(String(b.uid), String(b.id), { trigger, payload: typeof b.payload === "string" ? b.payload.slice(0, 4000) : undefined, depth: Number(b.depth) || 0 });
      if (!c.ok) return NextResponse.json({ ok: false, reason: c.reason });
      runAfter(runClaimed(c)); // answer at once, the work continues in the background
      return NextResponse.json({ ok: true, runId: c.runId, mode: c.mode }, { status: 202 });
    }
    const r = await tickRoutines();
    return NextResponse.json(r);
  } catch (err) {
    // Most common causes: missing Firebase Admin env vars, or Firestore needing a composite index
    // (the message then contains a "create index" link — open it, wait a minute, and it works).
    return NextResponse.json({ error: err instanceof Error ? err.message : "Routine runner failed." }, { status: 500 });
  }
}