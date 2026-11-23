import { NextResponse } from "next/server";
import { cronDenied } from "@/lib/cron-auth";
import { syncCatalog } from "@/lib/mcp/catalog-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Scheduler entry (same secret as the other ticks: ROUTINE_RUNNER_SECRET). Call it once a day to keep the connector list fresh.
export async function POST(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  return NextResponse.json(await syncCatalog());
}
