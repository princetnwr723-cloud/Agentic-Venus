import { NextResponse } from "next/server";
import { backupComputerState } from "@/lib/e2b-server";
import { readBody } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const apiKey = String(body.apiKey || "");
    const sandboxId = String(body.sandboxId || "");
    const uid = String(body.uid || "");
    const chatId = String(body.chatId || "");
    if (!apiKey || !sandboxId || !uid || !chatId) {
      return NextResponse.json({ error: "apiKey, sandboxId, uid and chatId are required." }, { status: 400 });
    }
    const path = await backupComputerState(apiKey, sandboxId, uid, chatId);
    return NextResponse.json({ ok: true, path, savedAt: Date.now() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Computer backup failed." }, { status: 500 });
  }
}
