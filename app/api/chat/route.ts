import { NextResponse } from "next/server";
import { callProvider, type ChatMsg } from "@/lib/ai-providers-server";
import type { ProviderId } from "@/lib/providers";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      provider,
      apiKey,
      model,
      messages,
      systemPrompt,
    }: {
      provider: ProviderId;
      apiKey: string;
      model: string;
      messages: ChatMsg[];
      systemPrompt?: string;
    } = body;

    if (!apiKey) {
      return NextResponse.json(
        { error: "No API key on file for this provider yet." },
        { status: 400 }
      );
    }
    if (!provider || !model) {
      return NextResponse.json(
        { error: "Missing provider or model." },
        { status: 400 }
      );
    }

    const fullMessages: ChatMsg[] = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;

    const reply = await callProvider({ provider, apiKey, model, messages: fullMessages });
    return NextResponse.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}