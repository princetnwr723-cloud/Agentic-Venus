import { NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/voice-server";
import { runAfter } from "@/lib/channels";
import { verifyMeetingWebhook } from "@/lib/meetings-core";
import { handleMeetingEvent, meetingsApiKey, webhookSecret, type MeetingEvent } from "@/lib/meetings-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// The notetaker service (Meeting BaaS v2) calls this from the bot's own callback when the bot finishes or fails.
// The callback is given to the service automatically when the bot is sent, so there is nothing to set up in a dashboard.
// Without our secret token (in the URL or in the x-mb-secret header) nothing happens: anybody could otherwise make the agent post "meeting notes".
export async function POST(req: Request) {
  const raw = await req.text();
  let token = "";
  try { token = new URL(req.url).searchParams.get("t") || ""; } catch { token = ""; }
  const ok = verifyMeetingWebhook({
    secret: webhookSecret(), apiKey: meetingsApiKey(), token: token || (req.headers.get("x-mb-secret") || "").trim(),
    headerKey: req.headers.get("x-meeting-baas-api-key") || "",
  });
  if (!ok) return new NextResponse("Forbidden", { status: 403 });
  let ev: MeetingEvent = {};
  try { ev = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  let site = "";
  try { site = appBaseUrl(req); } catch { site = new URL(req.url).origin; }
  // answer fast (the service retries slow endpoints); the notes are written in the background of this request
  runAfter(handleMeetingEvent(ev, site).catch((e) => console.error("meeting webhook failed", e)));
  return NextResponse.json({ ok: true });
}
