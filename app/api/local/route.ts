import { NextResponse } from "next/server";
import { verifyUser } from "@/lib/server-auth";
import { claimJobs, completeJob, registerDevice, touchDevice } from "@/lib/local-relay";
import { isDeviceId, makeLocalKey } from "@/lib/local-relay-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The desktop app talks to the server here, always with the signed-in user's token (Authorization: Bearer ...).
//   register: this PC gets a private device id and a key the website uses as its "computer key"
//   poll:     "do you have work for me?" (waits up to ~20 s, so it is cheap and fast)
//   result:   the answer to one job
// Nothing about plans or limits is ever sent to the app. The server decides; the app only does what it is told.
export async function POST(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(b.action ?? "");

    if (action === "register") {
      const deviceId = await registerDevice(uid, String(b.name ?? ""), String(b.platform ?? ""), b.deviceId);
      return NextResponse.json({ deviceId, key: makeLocalKey(deviceId) });
    }

    if (!isDeviceId(b.deviceId)) return NextResponse.json({ error: "Bad device id." }, { status: 400 });
    const deviceId = b.deviceId;

    if (action === "poll") {
      await touchDevice(uid, deviceId);
      const until = Date.now() + 20_000;
      for (;;) {
        const jobs = await claimJobs(uid, deviceId);
        if (jobs.length || Date.now() > until) return NextResponse.json({ jobs });
        await new Promise((r) => setTimeout(r, 1_200));
      }
    }

    if (action === "result") {
      await completeJob(uid, deviceId, String(b.jobId ?? ""), b.result);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Request failed.";
    return NextResponse.json({ error: m }, { status: /session|sign in|token|auth/i.test(m) ? 401 : /belong|Bad /.test(m) ? 403 : 500 });
  }
}