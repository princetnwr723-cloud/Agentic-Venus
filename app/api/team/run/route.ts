import { NextResponse } from "next/server";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { verifyJobToken } from "@/lib/job-token";
import { appBaseUrl } from "@/lib/voice-server";
import { runAfter } from "@/lib/channels";
import { launchTeamRun, stopTeamRun } from "@/lib/team-server";
import { advanceGroupTurn, postGroupMessage, postGroupMsg, stopGroupTurn } from "@/lib/group-server";
import { savePins } from "@/lib/group-memory";
import { oneLine } from "@/lib/group-core";

export const runtime = "nodejs";
export const maxDuration = 60;

const origin = (req: Request) => { try { return appBaseUrl(req); } catch { return new URL(req.url).origin; } };

// Team runs and the group chat. The dashboard hands work to the server; the browser may close right after this call returns.
//   start / stop          the planned team goal (Chief splits it into steps)
//   group_post            a message in the group chat (mentions, @everyone or the router decide who answers)
//   group_advance         move a turn forward (the open panel, the scheduler and the turn itself call this; a job token may call ONLY this)
//   group_stop            stop a running turn
//   group_pin             pin a fact for the whole group (/pin)
//   group_goal            start a planned team goal from the group chat (/goal)
export async function POST(req: Request) {
  try {
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const job = verifyJobToken(bearer);
    const body = await readBody(req, { allowJob: "grp" });
    const uid = String(body.uid);
    const action = String(body.action || "start");
    const chatId = String(body.chatId || "").slice(0, 200);

    if (job && action !== "group_advance") throw new RequestError("This token can only move a group turn forward.", 403);

    if (action === "start") {
      const goal = String(body.goal || "").trim();
      if (!chatId || !goal) throw new RequestError("chatId and goal are required.", 400);
      return NextResponse.json({ ok: true, runId: await launchTeamRun(uid, { chatId, goal, origin: origin(req) }) });
    }
    if (action === "stop") return NextResponse.json({ ok: await stopTeamRun(uid, String(body.runId || "")) });

    if (action === "group_post") {
      const text = String(body.text || "").trim();
      if (!chatId || !text) throw new RequestError("chatId and text are required.", 400);
      const site = origin(req);
      const turnId = await postGroupMessage(uid, { chatId, text, origin: site });
      runAfter(advanceGroupTurn(`${uid}_${turnId}`, site)); // the first answers are written after this response is sent
      return NextResponse.json({ ok: true, turnId });
    }
    if (action === "group_advance") {
      const turnId = String(body.turnId || "").slice(0, 40);
      if (!turnId) throw new RequestError("turnId is required.", 400);
      if (job && job.jobId !== "grp" + turnId) throw new RequestError("This token belongs to another turn.", 403);
      runAfter(advanceGroupTurn(`${uid}_${turnId}`, origin(req)));
      return NextResponse.json({ ok: true });
    }
    if (action === "group_stop") return NextResponse.json({ ok: await stopGroupTurn(uid, String(body.turnId || "").slice(0, 40)) });
    if (action === "group_pin") {
      const text = oneLine(String(body.text || ""), 200);
      if (!chatId || text.length < 4) throw new RequestError("Write what to pin (at least 4 characters).", 400);
      await savePins(uid, chatId, [text]);
      await postGroupMsg(uid, chatId, { from: "system", text: `📌 Pinned for the whole group: ${text}`, kind: "note" });
      return NextResponse.json({ ok: true });
    }
    if (action === "group_goal") {
      const goal = String(body.goal || "").trim();
      if (!chatId || !goal) throw new RequestError("chatId and goal are required.", 400);
      const runId = await launchTeamRun(uid, { chatId, goal, origin: origin(req) });
      await postGroupMsg(uid, chatId, { from: "system", text: `📋 Team goal started: ${oneLine(goal, 200)}. The step-by-step plan is in this chat's Progress panel; the report comes back in the chat.`, kind: "note" });
      return NextResponse.json({ ok: true, runId });
    }
    throw new RequestError("Unknown action.", 400);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Team request failed." }, { status: requestStatus(err) });
  }
}