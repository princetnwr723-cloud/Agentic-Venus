import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { installFromInput } from "@/lib/skill-install";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 200 * 1024 });
    const chatId = String(b.chatId || "");
    if (!/^[A-Za-z0-9_-]{4,160}$/.test(chatId)) return NextResponse.json({ error: "Valid chatId is required." }, { status: 400 });
    const r = await installFromInput(String(b.uid), chatId, String(b.input || "").slice(0, 120_000));
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Skill install failed." }, { status: requestStatus(e) });
  }
}