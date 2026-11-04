import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { verifyUser } from "@/lib/server-auth";
import { pendingPayments } from "@/lib/pay-channel";

export const runtime = "nodejs";
export const maxDuration = 15;

/** What the Android runner shows: which computer tasks are running right now and how many payments wait for you. */
export async function GET(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const snap = await getAdminDb().collection("users").doc(uid).collection("pcJobs").where("running", "==", true).limit(10).get();
    const jobs = snap.docs
      .map((d) => d.data() as { task?: string; startedAt?: number; job?: unknown })
      .filter((j) => Boolean(j.job) && Date.now() - Number(j.startedAt ?? 0) < 8 * 3600_000)
      .map((j) => ({ task: String(j.task ?? "Task").slice(0, 80), startedAt: Number(j.startedAt ?? 0) }));
    const needsYou = (await pendingPayments(uid).catch(() => [])).length;
    return NextResponse.json({ jobs, needsYou }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Status failed.";
    return NextResponse.json({ error: m }, { status: /session|sign in|token|auth/i.test(m) ? 401 : 500 });
  }
}