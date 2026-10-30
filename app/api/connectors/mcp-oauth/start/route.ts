import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { appBaseUrl } from "@/lib/voice-server";
import { safeId } from "@/lib/tools/catalog";
import { beginMcpOAuth } from "@/lib/tools/connect";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 8 * 1024 });
    const chatId = String(b.chatId || "");
    const name = safeId(String(b.name || ""));
    const url = String(b.url || "").trim();
    if (!/^[A-Za-z0-9_-]{4,160}$/.test(chatId)) return NextResponse.json({ ok: false, error: "Valid chatId is required." }, { status: 400 });
    if (!name || name === "x") return NextResponse.json({ ok: false, error: "A name is required." }, { status: 400 });
    const authUrl = await beginMcpOAuth({
      uid: String(b.uid), chatId, name, url,
      resourceMetadata: typeof b.resourceMetadata === "string" ? b.resourceMetadata : undefined,
      baseUrl: appBaseUrl(req),
    });
    return NextResponse.json({ ok: true, url: authUrl });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Sign-in could not start." }, { status: requestStatus(e) });
  }
}
