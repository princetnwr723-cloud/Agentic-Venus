import { NextResponse } from "next/server";
import { cronDenied } from "@/lib/cron-auth";
import { appBaseUrl } from "@/lib/voice-server";
import { tickWatchers } from "@/lib/watchers-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Scheduler entry (same secret as the routines). /api/agent/tick calls the same function, so one scheduler is enough.
export async function POST(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  let site = "";
  try { site = appBaseUrl(req); } catch { site = new URL(req.url).origin; }
  try { return NextResponse.json({ ok: true, ...(await tickWatchers(site)) }); }
  catch (err) { return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Watcher tick failed." }, { status: 500 }); }
}
