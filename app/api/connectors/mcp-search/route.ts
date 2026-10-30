import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { searchMcpPlus } from "@/lib/tools/connect";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 4 * 1024 });
    const q = String(body.q || "").trim().slice(0, 60);
    if (q.length < 2) return NextResponse.json({ results: [] });
    // Popular servers first (small typos are fine), then the official MCP registry.
    // A tool no list knows is looked for at the addresses services usually use, and only real MCP servers are kept.
    return NextResponse.json({ results: await searchMcpPlus(q) });
  } catch (e) {
    return NextResponse.json({ results: [], error: e instanceof Error ? e.message : "Search failed." }, { status: requestStatus(e) });
  }
}
