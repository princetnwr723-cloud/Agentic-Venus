import { NextResponse } from "next/server";
import { verifyUser } from "@/lib/server-auth";
import { claimJobs, completeJob, ensureComputerSlot, registerDevice, touchDevice } from "@/lib/local-relay";
import { isDeviceId, isOnline, makeLocalKey } from "@/lib/local-relay-core";
import { listLocalDevices, readPref, setPref } from "@/lib/computer-pref";
import { normPref } from "@/lib/computer-pref-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The desktop app and the phone app talk to the server here, always with the signed-in user's token (Authorization: Bearer ...).
//   register: this PC / phone gets a private device id and a key the website uses as its "computer key"
//   poll:     "do you have work for me?" (waits up to ~20 s, so it is cheap and fast)
//   result:   the answer to one job
// The website (a normal browser tab) uses two more actions:
//   devices:  which of my computers exist and which are online, and which one the account prefers
//   prefer:   "auto" (own computer when online, else cloud), "local" (own computer only) or "cloud" (E2B only)
// Nothing about plans or limits is ever sent to the apps. The server decides; the apps only do what they are told.
export async function POST(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(b.action ?? "");

    if (action === "register") {
      const deviceId = await registerDevice(uid, String(b.name ?? ""), String(b.platform ?? ""), b.deviceId);
      return NextResponse.json({ deviceId, key: makeLocalKey(deviceId) });
    }

    if (action === "devices") {
      const [list, p] = await Promise.all([listLocalDevices(uid), readPref(uid)]);
      const now = Date.now();
      return NextResponse.json({
        pref: p.pref, preferred: p.deviceId,
        devices: list.map((d) => ({ id: d.id, name: d.name, platform: d.platform, lastSeen: d.lastSeen, online: isOnline(d.lastSeen, now), key: makeLocalKey(d.id) })),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "prefer") {
      const device = b.deviceId == null || b.deviceId === "" ? null : String(b.deviceId);
      await setPref(uid, normPref(b.source), device);
      return NextResponse.json({ ok: true });
    }

    if (!isDeviceId(b.deviceId)) return NextResponse.json({ error: "Bad device id." }, { status: 400 });
    const deviceId = b.deviceId;

    if (action === "poll") {
      await touchDevice(uid, deviceId);
      void ensureComputerSlot(uid, deviceId); // once per server instance: makes sure the account has a computer slot for server-side jobs
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