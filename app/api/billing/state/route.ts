import { NextResponse } from "next/server";
import { requestStatus } from "@/lib/request";
import { authFromRequest } from "@/lib/job-token";
import { billingSummary, logEvent, syncFromGumroad } from "@/lib/billing-server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    // Resolve the actual signed-in user from the
    // verified Firebase ID token.
    const { uid } = await authFromRequest(req);

    // { "sync": true } = "I paid, please look at Gumroad now". It rescues payments whose ping was missed.
    const body = (await req.json().catch(() => ({}))) as { sync?: unknown };
    let syncNote = "";
    if (body && body.sync === true) {
      try {
        syncNote = (await syncFromGumroad(uid)).note;
      } catch (e) {
        syncNote = e instanceof Error ? e.message.slice(0, 200) : "Could not check Gumroad.";
        await logEvent("sync_error", { uid, message: syncNote });
      }
    }

    const summary = await billingSummary(uid);

    return NextResponse.json(syncNote ? { ...summary, syncNote } : summary, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not load the plan.",
      },
      {
        status: requestStatus(e),
      }
    );
  }
}