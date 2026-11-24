import { NextResponse } from "next/server";
import { runAfter } from "@/lib/channels";
import { verifyUser } from "@/lib/server-auth";
import { latchReason } from "@/lib/agent/latch-server";
import { claimRoutine, getRoutineServer, routineRef, runClaimed } from "@/lib/routines-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (e: unknown) => {
  const m = e instanceof Error ? e.message : "Request failed.";
  return NextResponse.json({ error: m }, { status: /session|sign in|token|auth/i.test(m) ? 401 : 500 });
};

/**
 * The phone's alarm went off: run this routine now.
 * It uses the SAME claim as the server scheduler (a transaction + lease), so the phone and the server can never run one occurrence twice:
 * whoever claims first runs it, the other one gets "already running" and does nothing.
 */
export async function POST(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const b = (await req.json().catch(() => ({}))) as { id?: unknown };
    const id = String(b.id ?? "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!id) return NextResponse.json({ error: "Routine id missing." }, { status: 400 });

    const r = await getRoutineServer(uid, id);
    if (!r) return NextResponse.json({ ok: false, status: "gone" });
    if (!r.enabled) return NextResponse.json({ ok: false, status: "paused" });

    const now = Date.now();
    if (r.nextRunAt > now) {
      // the alarm can fire a moment before the stored time: wait for it (up to 20 s), otherwise this is simply not due yet
      if (r.nextRunAt - now > 20_000) return NextResponse.json({ ok: false, status: "not_due", nextRunAt: r.nextRunAt });
      await sleep(r.nextRunAt - now + 150);
    }

    const held = await latchReason(uid);
    if (held) return NextResponse.json({ ok: false, status: "held", reason: held.text, until: held.until });

    const c = await claimRoutine(uid, id, { trigger: "schedule" });
    if (!c.ok) return NextResponse.json({ ok: false, status: "skipped", reason: c.reason }); // "already running" = the server got there first: fine
    runAfter(runClaimed(c)); // answer at once, the work continues in the background
    return NextResponse.json({ ok: true, status: "started", runId: c.runId, mode: c.mode }, { status: 202 });
  } catch (e) { return fail(e); }
}

/** How a started run is going (the phone can show it while it keeps its screen alive). */
export async function GET(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const u = new URL(req.url);
    const id = (u.searchParams.get("id") || "").replace(/[^A-Za-z0-9_-]/g, "");
    const runId = (u.searchParams.get("runId") || "").replace(/[^A-Za-z0-9_.-]/g, "");
    if (!id || !runId) return NextResponse.json({ error: "id and runId are required." }, { status: 400 });
    const s = await routineRef(uid, id).collection("runs").doc(runId).get();
    const d = (s.data() ?? {}) as { status?: string; result?: string; finishedAt?: number };
    return NextResponse.json({ status: d.status ?? "unknown", result: String(d.result ?? "").slice(0, 300), finishedAt: d.finishedAt ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}
