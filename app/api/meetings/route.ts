import { NextResponse } from "next/server";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { appBaseUrl } from "@/lib/voice-server";
import {
  getAutoSettings, getMeeting, joinMeeting, leaveMeeting, listMeetings, liveMeetings, meetingsConfigured, saveAutoSettings, skipUpcoming, upcomingMeetings,
} from "@/lib/meetings-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const chatOf = (body: Record<string, unknown>) => (typeof body.chatId === "string" && body.chatId ? body.chatId : undefined);
const siteOf = (req: Request) => { try { return appBaseUrl(req); } catch { return ""; } };

// The owner's side of the meeting bot: send it into a call, follow it live, list meetings, read the notes, calendar auto-join.
export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const uid = String(body.uid);
    switch (String(body.action || "list")) {
      case "status": return NextResponse.json({ ok: true, configured: meetingsConfigured() });
      case "join": {
        const m = await joinMeeting(uid, { url: String(body.url ?? ""), chatId: chatOf(body), title: String(body.title ?? ""), site: siteOf(req) });
        return NextResponse.json({ ok: true, meeting: { ...m, url: "" } });
      }
      case "list": return NextResponse.json({ ok: true, meetings: await listMeetings(uid) });
      case "live": return NextResponse.json({ ok: true, live: await liveMeetings(uid, siteOf(req), chatOf(body)) });
      case "get": {
        const m = await getMeeting(uid, String(body.botId ?? ""));
        if (!m) throw new RequestError("Meeting not found.", 404);
        return NextResponse.json({ ok: true, meeting: m });
      }
      case "leave": {
        await leaveMeeting(uid, String(body.botId ?? ""));
        return NextResponse.json({ ok: true });
      }
      case "upcoming": return NextResponse.json({ ok: true, ...(await upcomingMeetings(uid, chatOf(body))) });
      case "auto_get": return NextResponse.json({ ok: true, settings: await getAutoSettings(uid) });
      case "auto_set": {
        const patch: Record<string, unknown> = {};
        if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
        if (Array.isArray(body.skipWords)) patch.skipWords = body.skipWords;
        return NextResponse.json({ ok: true, settings: await saveAutoSettings(uid, patch, chatOf(body)) });
      }
      case "skip": {
        await skipUpcoming(uid, String(body.eventId ?? ""), Number(body.startMs), body.skip !== false);
        return NextResponse.json({ ok: true });
      }
      default: throw new RequestError("Unknown action.", 400);
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Request failed." }, { status: requestStatus(err) });
  }
}
