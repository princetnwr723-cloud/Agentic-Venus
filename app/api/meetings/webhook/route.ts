import { NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/voice-server";
import { runAfter } from "@/lib/channels";
import { verifySvix } from "@/lib/meetings-core";
import { handleRecallEvent } from "@/lib/meetings-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Recall.ai calls this when the bot joins, leaves, fails or the transcript is ready.
// Set it as the endpoint in the Recall dashboard (Webhooks) and copy its signing secret into RECALL_WEBHOOK_SECRET.
// Without a valid signature nothing happens: anybody could otherwise make the agent post "meeting notes".
export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifySvix({
    secret: process.env.RECALL_WEBHOOK_SECRET || "", body: raw,
    id: req.headers.get("webhook-id") || req.headers.get("svix-id") || "",
    timestamp: req.headers.get("webhook-timestamp") || req.headers.get("svix-timestamp") || "",
    signature: req.headers.get("webhook-signature") || req.headers.get("svix-signature") || "",
  });
  if (!ok) return new NextResponse("Forbidden", { status: 403 });
  let ev: Parameters<typeof handleRecallEvent>[0] = {};
  try { ev = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  let site = "";
  try { site = appBaseUrl(req); } catch { site = new URL(req.url).origin; }
  // answer fast (Recall retries slow endpoints); the notes are written in the background of this request
  runAfter(handleRecallEvent(ev, site).catch((e) => console.error("recall webhook failed", e)));
  return NextResponse.json({ ok: true });
}
