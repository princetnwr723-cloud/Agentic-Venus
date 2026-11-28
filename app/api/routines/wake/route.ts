import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { getAdminDb } from "@/lib/firebase-admin";
import { runAfter } from "@/lib/channels";
import { claimRoutine, kickRoutine, runClaimed } from "@/lib/routines-server";
import type { Routine } from "@/lib/routines-core";

export const runtime = "nodejs";
export const maxDuration = 60;

// Called by the open website (every ~30 seconds, signed-in user only). It starts THIS user's routines that are due right now,
// so they run on time even when the GitHub / cron-job.org scheduler is late. Safe to call often: claimRoutine() holds a lease,
// so a routine that the scheduler already started is never started twice.
export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 1024 });
    const uid = String(b.uid);
    const now = Date.now();
    // one range filter only (no composite index needed); "enabled" and the lease are checked here
    const snap = await getAdminDb().collection("users").doc(uid).collection("routines").where("nextRunAt", "<=", now).limit(20).get();
    const due = snap.docs.filter((d) => { const r = d.data() as Routine; return r.enabled === true && (r.leaseUntil ?? 0) <= now; });
    let started = 0;
    for (const d of due.slice(0, 10)) {
      if (await kickRoutine(uid, d.id)) { started++; continue; }
      const c = await claimRoutine(uid, d.id, { trigger: "schedule" });
      if (c.ok) { started++; runAfter(runClaimed(c)); }
    }
    return NextResponse.json({ ok: true, due: due.length, started });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Routine wake failed." }, { status: requestStatus(e) });
  }
}