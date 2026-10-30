import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { searchMcp } from "@/lib/tools/connect";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 4 * 1024 });
    const q = String(body.q || "").trim().slice(0, 60);
    if (q.length < 2) return NextResponse.json({ results: [] });
    // Popular servers first (with small-typo matching), then the official MCP registry.
    return NextResponse.json({ results: await searchMcp(q) });
  } catch (e) {
    return NextResponse.json({ results: [], error: e instanceof Error ? e.message : "Search failed." }, { status: requestStatus(e) });
  }
}
