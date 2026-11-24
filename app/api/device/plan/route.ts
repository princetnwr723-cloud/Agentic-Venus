import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { verifyUser } from "@/lib/server-auth";
import { buildPlan } from "@/lib/device-plan";

export const runtime = "nodejs";
export const maxDuration = 20;

/** The phone asks: "when should I wake up?". It also tells the server it is alive (the Reliability screen shows this). */
export async function GET(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const url = new URL(req.url);
    const now = Date.now();
    const items = await buildPlan(uid, now);
    await getAdminDb().collection("users").doc(uid).collection("phone").doc("state").set(
      {
        planAt: now, name: (url.searchParams.get("n") || "").slice(0, 60), appVersion: (url.searchParams.get("v") || "").slice(0, 20), armed: items.length,
        // what the last alarm did (the phone reports it in the same call, so one short request is enough inside a broadcast)
        ...(Number(url.searchParams.get("lf")) ? { lastFireAt: Number(url.searchParams.get("lf")), lastStatus: (url.searchParams.get("ls") || "").slice(0, 60), lateMs: Number(url.searchParams.get("ll")) || 0 } : {}),
      },
      { merge: true },
    ).catch(() => undefined);
    return NextResponse.json({ now, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Plan failed.";
    return NextResponse.json({ error: m }, { status: /session|sign in|token|auth/i.test(m) ? 401 : 500 });
  }
}

/** Phone -> server: "I woke up at the right time, here is what happened" (shown on the Reliability screen). */
export async function POST(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const b = (await req.json().catch(() => ({}))) as { lastFireAt?: number; lastStatus?: string; lateMs?: number };
    await getAdminDb().collection("users").doc(uid).collection("phone").doc("state").set(
      { lastFireAt: Number(b.lastFireAt) || Date.now(), lastStatus: String(b.lastStatus ?? "").slice(0, 60), lateMs: Number(b.lateMs) || 0 },
      { merge: true },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Report failed.";
    return NextResponse.json({ error: m }, { status: /session|sign in|token|auth/i.test(m) ? 401 : 500 });
  }
}
