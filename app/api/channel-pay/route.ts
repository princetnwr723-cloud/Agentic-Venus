import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { channelPayStatus, clearChannelPay, setChannelPay } from "@/lib/pay-channel";

export const runtime = "nodejs";
export const maxDuration = 30;

const fail = (m: string, st = 400) => NextResponse.json({ error: m }, { status: st });

// Settings for approving card payments from chat apps. Only YOU (signed in) can change them; a running task never can.
export async function POST(req: Request) {
  try {
    const raw = (await req.json().catch(() => ({}))) as { uid?: string; action?: string; pin?: string; maxPerPayment?: number };
    const auth = await authFromRequest(req, raw.uid);
    if (auth.job) return fail("Not allowed.", 403);
    const action = String(raw.action || "status");
    if (action === "set") await setChannelPay(auth.uid, String(raw.pin ?? ""), Number(raw.maxPerPayment) || 0);
    else if (action === "clear") await clearChannelPay(auth.uid);
    else if (action !== "status") return fail("Unknown action.");
    return NextResponse.json(await channelPayStatus(auth.uid));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Request failed.", 400);
  }
}