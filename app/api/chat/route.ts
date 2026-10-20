import { NextResponse } from "next/server";
import { callWithFallback, type ChatMsg, type Fallback } from "@/lib/ai-providers-server";
import { readBody, requestStatus } from "@/lib/request";
import { addTokens, assertTokens, estTokens } from "@/lib/billing-server";
import { appendNote, mailGuardNote } from "@/lib/mail-guard";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const { provider, apiKey, model, messages, systemPrompt }: {
      provider: ProviderId; apiKey: string; model: string; messages: ChatMsg[]; systemPrompt?: string;
    } = body;

    if (!apiKey) return NextResponse.json({ error: "No API key on file for this provider yet." }, { status: 400 });
    if (!provider || !model) return NextResponse.json({ error: "Missing provider or model." }, { status: 400 });

    // plan limit: blocks with HTTP 402 and a clear message when the window's tokens are used up
    await assertTokens(String(body.uid));

    const fallbacks: Fallback[] = (Array.isArray(body.fallbacks) ? body.fallbacks : [])
      .filter((f: Fallback) => f && typeof f.provider === "string" && typeof f.apiKey === "string" && typeof f.model === "string")
      .slice(0, 2);

    const full: ChatMsg[] = systemPrompt ? [{ role: "system", content: systemPrompt }, ...messages] : messages;
    const { reply: raw, used } = await callWithFallback({ provider, apiKey, model, messages: full }, fallbacks);

    const inChars = full.reduce((n, m) => n + String(m.content ?? "").length, 0);
    await addTokens(String(body.uid), estTokens(inChars + raw.length));

    // honesty guard: never let the agent claim "email sent" without a real receipt
    const reply = appendNote(raw, mailGuardNote(full, raw));

    return NextResponse.json({ reply, used });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: requestStatus(err) });
  }
}