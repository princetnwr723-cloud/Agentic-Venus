import { NextResponse } from "next/server";
import { performAction, takeScreenshot } from "@/lib/e2b-server";
import { readBody, requestStatus } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 60;

// The live picture of a computer that runs on the user's own phone or PC. The website asks for a screenshot every second or so
// and sends taps / typing back. Only plain input is allowed here (no shell), so "take control" cannot run commands.
const INPUT = new Set(["click", "double_click", "right_click", "type", "key", "scroll"]);

export async function POST(req: Request) {
  try {
    const b = await readBody(req);
    const apiKey = String(b.apiKey ?? "");
    const sandboxId = String(b.sandboxId ?? "");
    if (!apiKey || !sandboxId) return NextResponse.json({ error: "Missing computer." }, { status: 400 });

    if (b.action === "input") {
      const type = String(b.type ?? "");
      if (!INPUT.has(type)) return NextResponse.json({ error: "Unknown input." }, { status: 400 });
      const done = await performAction(apiKey, sandboxId, {
        type,
        x: Number(b.x) || 0,
        y: Number(b.y) || 0,
        text: typeof b.text === "string" ? b.text.slice(0, 2000) : undefined,
        keys: typeof b.keys === "string" ? b.keys.slice(0, 60) : undefined,
        direction: b.direction === "up" ? "up" : "down",
        amount: Number(b.amount) || 3,
      });
      return NextResponse.json({ ok: true, done });
    }

    const shot = await takeScreenshot(apiKey, sandboxId);
    return NextResponse.json(shot);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read the screen." }, { status: requestStatus(err) });
  }
}
