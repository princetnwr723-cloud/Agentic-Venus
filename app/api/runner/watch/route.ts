// Real-time follower for computer tasks started from chat apps. It runs ~45 seconds: starts queued tasks, forwards
// questions and payment approvals to your chat apps, and sends the result when a job ends. If work is still open it calls
// itself again, so a task is followed for hours without the website. The 5-minute tick only restarts it if the chain breaks.
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveValue } from "@/lib/vault";
import { cronDenied } from "@/lib/cron-auth";
import { processPcJob } from "@/lib/pc-tick";
import { activeQueueCount, advancePcQueue, kickWatcher, releaseWatchLease, takeWatchLease } from "@/lib/pc-start-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SLICE_MS = 45_000;
const MAX_ROUNDS = 400; // about 5 hours

export async function POST(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as { uid?: string; round?: number };
  const uid = String(b.uid ?? "");
  if (!uid) return NextResponse.json({ error: "uid is required." }, { status: 400 });
  if (!(await takeWatchLease(uid))) return NextResponse.json({ skipped: "another watcher is already running for this user" });

  const t0 = Date.now();
  let active = false;
  try {
    const userRef = getAdminDb().collection("users").doc(uid);
    let key: string | undefined;
    const e2bFor = async () => {
      if (key === undefined) {
        const raw = ((await userRef.get()).data() as { e2bKey?: string } | undefined)?.e2bKey;
        key = raw ? await resolveValue(uid, raw) : "";
      }
      return key || undefined;
    };
    while (Date.now() - t0 < SLICE_MS) {
      await advancePcQueue(uid);
      const running = await userRef.collection("pcJobs").where("running", "==", true).get();
      for (const d of running.docs) await processPcJob(d, e2bFor);
      const still = await userRef.collection("pcJobs").where("running", "==", true).limit(1).get();
      active = !still.empty || (await activeQueueCount(uid)) > 0;
      if (!active) break;
      await sleep(4_000);
    }
  } finally {
    await releaseWatchLease(uid);
  }
  const round = Number(b.round) || 0;
  if (active && round < MAX_ROUNDS) kickWatcher(uid, round + 1);
  return NextResponse.json({ active, round });
}