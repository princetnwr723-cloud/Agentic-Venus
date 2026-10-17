import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { billingSummary } from "@/lib/billing-server";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 2 * 1024 });
    return NextResponse.json(await billingSummary(String(b.uid)), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load the plan." }, { status: requestStatus(e) });
  }
}
