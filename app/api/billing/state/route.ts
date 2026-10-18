
import { NextResponse } from "next/server";
import { requestStatus } from "@/lib/request";
import { authFromRequest } from "@/lib/job-token";
import { billingSummary } from "@/lib/billing-server";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: Request) {
  try {
    // Resolve the actual signed-in user from the
    // verified Firebase ID token.
    const { uid } = await authFromRequest(req);

    const summary = await billingSummary(uid);

    return NextResponse.json(summary, {
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
