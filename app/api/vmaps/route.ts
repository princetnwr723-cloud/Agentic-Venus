// The /vmaps screen calls this. It runs the same vmaps.* tools the agent uses, for a signed-in user only.
import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { VMAPS_TOOLS } from "@/lib/tools/vmaps";
import { cleanArgs } from "@/lib/vmaps/ui";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = new Set(["vmaps.geocode", "vmaps.nearby", "vmaps.route", "vmaps.leads", "vmaps.reverse"]);

// Every search can call free public map servers, so one user cannot flood them from this screen.
const recent = new Map<string, number[]>();
function tooMany(uid: string): boolean {
  const now = Date.now();
  if (recent.size > 2000) recent.clear();
  const list = (recent.get(uid) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(uid, list);
  return list.length > 20;
}

export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 8 * 1024 });
    const uid = String(b.uid);
    const tool = ALLOWED.has(String(b.tool)) ? VMAPS_TOOLS.find((t) => t.name === String(b.tool)) : undefined;
    if (!tool) return NextResponse.json({ error: "Unknown map action." }, { status: 400 });
    if (tooMany(uid)) return NextResponse.json({ error: "Too many map searches. Wait a minute and try again." }, { status: 429 });
    try {
      const text = await tool.run(cleanArgs(b.args), []);
      return NextResponse.json({ text });
    } catch (e) {
      // a normal "could not find that place" style answer, not a server crash
      return NextResponse.json({ error: e instanceof Error ? e.message : "Map search failed." }, { status: 422 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Map request failed." }, { status: requestStatus(e) });
  }
}
