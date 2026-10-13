import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { callProvider } from "@/lib/ai-providers-server";
import { loadAgent } from "@/lib/voice-calls";
import { addMemoryServer, readMem } from "@/lib/learning";

export const runtime = "nodejs";
export const maxDuration = 30;

// Cheap pre-filter: only messages where the owner talks about themselves / their work are worth a model call.
const CUE = /\b(i|i'm|im|my|me|we|our|mera|meri|mere|mujhe|main|mai|hum|hamara|hamari|hamare|humara|apna|apni)\b|\d/i;
const lastRun = new Map<string, number>();

export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 32 * 1024 });
    const uid = String(b.uid);
    const chatId = String(b.chatId || "");
    const text = String(b.user || "").trim().slice(0, 1500);
    if (!/^[A-Za-z0-9_-]{4,160}$/.test(chatId)) return NextResponse.json({ saved: 0 });
    if (text.length < 12 || text.startsWith("/") || !CUE.test(text)) return NextResponse.json({ saved: 0 });
    const key = uid + chatId;
    if (Date.now() - (lastRun.get(key) ?? 0) < 15_000) return NextResponse.json({ saved: 0 });
    lastRun.set(key, Date.now());

    const agent = await loadAgent(uid, chatId);
    const known = (await readMem(uid, chatId)).filter((m) => m.kind !== "lesson").slice(-60).map((m) => `- ${m.text}`).join("\n");
    const raw = await callProvider({
      provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 500,
      messages: [{ role: "user", content:
`You quietly learn about ONE person (the owner) from their chat messages so their AI teammate can serve them better over time.
From the message below, extract lasting facts about the OWNER that will still be useful in months: name, role, company, what the business sells, customers, goals, tools they use, city/language/timezone, working hours, writing style, how they like results delivered, recurring tasks, key people (first name + relationship only).
Do NOT extract: one-off task details, passwords/keys/card/ID numbers, anything about health, religion, politics, finances or other sensitive topics, or anything already known.
Reply with JSON only: {"facts":[{"text":"short sentence, e.g. Owner runs a dental clinic in Delhi","kind":"profile|preference|fact","weight":1-3}]} (max 4, empty list if nothing).

ALREADY KNOWN:
${known || "(nothing yet)"}

OWNER'S MESSAGE:
${text}` }],
    });
    const a = raw.indexOf("{"), z = raw.lastIndexOf("}");
    const j = a >= 0 && z > a ? (JSON.parse(raw.slice(a, z + 1)) as { facts?: Array<{ text?: string; kind?: string; weight?: number }> }) : null;
    let saved = 0;
    for (const f of (j?.facts ?? []).slice(0, 4)) {
      const kind = f.kind === "preference" ? "preference" : f.kind === "fact" ? "fact" : "profile";
      if (await addMemoryServer(uid, chatId, String(f.text ?? ""), { auto: true, kind, weight: Number(f.weight) || 2 })) saved++;
    }
    return NextResponse.json({ saved });
  } catch (e) {
    return NextResponse.json({ saved: 0, error: e instanceof Error ? e.message : "Learning failed." }, { status: requestStatus(e) });
  }
}