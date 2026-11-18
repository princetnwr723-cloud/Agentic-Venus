import { NextResponse } from "next/server";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { appBaseUrl } from "@/lib/voice-server";
import { getMeeting, joinMeeting, listMeetings, meetingsConfigured } from "@/lib/meetings-server";

export const runtime = "nodejs";
export const maxDuration = 30;

// The owner's side of the meeting bot: send it into a call, list meetings, read the notes.
export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const uid = String(body.uid);
    switch (String(body.action || "list")) {
      case "status": return NextResponse.json({ ok: true, configured: meetingsConfigured() });
      case "join": {
        let site = "";
        try { site = appBaseUrl(req); } catch { site = ""; }
        const m = await joinMeeting(uid, { url: String(body.url ?? ""), chatId: body.chatId ? String(body.chatId) : undefined, title: String(body.title ?? ""), site });
        return NextResponse.json({ ok: true, meeting: { ...m, url: "" } });
      }
      case "list": return NextResponse.json({ ok: true, meetings: await listMeetings(uid) });
      case "get": {
        const m = await getMeeting(uid, String(body.botId ?? ""));
        if (!m) throw new RequestError("Meeting not found.", 404);
        return NextResponse.json({ ok: true, meeting: m });
      }
      default: throw new RequestError("Unknown action.", 400);
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Request failed." }, { status: requestStatus(err) });
  }
}
