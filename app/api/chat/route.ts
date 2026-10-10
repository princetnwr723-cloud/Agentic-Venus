import { NextResponse } from "next/server";
import { callWithFallback, type ChatMsg, type Fallback } from "@/lib/ai-providers-server";
import { readBody, requestStatus } from "@/lib/request";
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

    const fallbacks: Fallback[] = (Array.isArray(body.fallbacks) ? body.fallbacks : [])
      .filter((f: Fallback) => f && typeof f.provider === "string" && typeof f.apiKey === "string" && typeof f.model === "string")
      .slice(0, 2);

    const full: ChatMsg[] = systemPrompt ? [{ role: "system", content: systemPrompt }, ...messages] : messages;
    const { reply, used } = await callWithFallback({ provider, apiKey, model, messages: full }, fallbacks);
    return NextResponse.json({ reply, used });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: requestStatus(err) });
  }
}