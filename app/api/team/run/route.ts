import { NextResponse } from "next/server";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { appBaseUrl } from "@/lib/voice-server";
import { launchTeamRun, stopTeamRun } from "@/lib/team-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const origin = (req: Request) => { try { return appBaseUrl(req); } catch { return new URL(req.url).origin; } };

// The dashboard hands a team goal to the server. The browser may close right after this call returns.
export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const uid = String(body.uid);
    const action = String(body.action || "start");
    if (action === "start") {
      const chatId = String(body.chatId || "").slice(0, 200), goal = String(body.goal || "").trim();
      if (!chatId || !goal) throw new RequestError("chatId and goal are required.", 400);
      return NextResponse.json({ ok: true, runId: await launchTeamRun(uid, { chatId, goal, origin: origin(req) }) });
    }
    if (action === "stop") return NextResponse.json({ ok: await stopTeamRun(uid, String(body.runId || "")) });
    throw new RequestError("Unknown action.", 400);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Team request failed." }, { status: requestStatus(err) });
  }
}
