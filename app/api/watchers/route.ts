import { NextResponse } from "next/server";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { appBaseUrl } from "@/lib/voice-server";
import { decideProposal, getSettings, listProposals, runWatchersForUser, saveSettings } from "@/lib/watchers-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const origin = (req: Request) => { try { return appBaseUrl(req); } catch { return new URL(req.url).origin; } };

// The owner's side of the proactive engine: see / change the settings, see proposals, say yes or no, scan right now.
export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const uid = String(body.uid);
    const action = String(body.action || "get");
    if (action === "get") return NextResponse.json({ ok: true, settings: await getSettings(uid), proposals: await listProposals(uid, 30) });
    if (action === "set_settings") return NextResponse.json({ ok: true, settings: await saveSettings(uid, body.settings) });
    if (action === "decide") {
      const id = String(body.id || "");
      if (!/^p[0-9a-z]{7}$/.test(id)) throw new RequestError("A valid proposal id is required.", 400);
      return NextResponse.json(await decideProposal(uid, id, body.approve === true));
    }
    if (action === "scan") return NextResponse.json({ ok: true, ...(await runWatchersForUser(uid, origin(req), Date.now(), true)) });
    throw new RequestError("Unknown action.", 400);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Request failed." }, { status: requestStatus(err) });
  }
}
