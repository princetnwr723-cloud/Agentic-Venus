import { callWithFallback, type ChatMsg, type Fallback } from "@/lib/ai-providers-server";
import { webRead, webSearch } from "@/lib/web-tools-server";
import type { ProviderId } from "@/lib/providers";

const MAX_STEPS = 6;

const SYSTEM = `You are a background agent that runs on a schedule while the user is away. You can research the web.
Reply with ONE JSON object only (no prose, no fences):
{"action":"web_search","query":"..."}   search the web
{"action":"web_read","url":"https://..."}   read a page as text
{"action":"final","text":"the finished result for the user, markdown, with source links"}
Rules: at most ${MAX_STEPS} tool calls. Never invent facts. You cannot log in, send, post or buy: if the task needs that, put it under "Needs you" in the final text.`;

function parse(s: string): { action?: string; query?: string; url?: string; text?: string } | null {
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

export async function runWebAgent(a: {
  provider: ProviderId; apiKey: string; model: string; fallbacks?: Fallback[];
  instructions: string; memory?: string; deadline: number;
}): Promise<{ text: string; steps: string[] }> {
  const msgs: ChatMsg[] = [
    { role: "system", content: SYSTEM + (a.memory ? `\n\nWhat you know about the user:\n${a.memory}` : "") },
    { role: "user", content: `Scheduled task:\n${a.instructions}` },
  ];
  const steps: string[] = [];
  let invalid = 0;

  for (let i = 0; i < MAX_STEPS; i++) {
    const last = i === MAX_STEPS - 1 || Date.now() > a.deadline;
    if (last) msgs.push({ role: "user", content: 'Time is up. Reply NOW with {"action":"final","text":"..."} using what you have.' });
    const { reply } = await callWithFallback({ provider: a.provider, apiKey: a.apiKey, model: a.model, messages: msgs }, a.fallbacks);
    msgs.push({ role: "assistant", content: reply });
    const j = parse(reply);

    if (!j?.action) {
      if (last || invalid++ >= 1) return { text: reply.slice(0, 3000), steps };
      msgs.push({ role: "user", content: "Reply with valid JSON only." });
      continue;
    }
    if (j.action === "final") return { text: String(j.text ?? "Done.").slice(0, 6000), steps };
    if (last) return { text: reply.slice(0, 3000), steps };

    let out: string;
    try {
      if (j.action === "web_search") { steps.push(`search: ${String(j.query).slice(0, 60)}`); out = await webSearch(String(j.query ?? "")); }
      else if (j.action === "web_read") { steps.push(`read: ${String(j.url).slice(0, 70)}`); out = await webRead(String(j.url ?? ""), 3500); }
      else out = "ERROR: unknown action";
    } catch (e) {
      out = "ERROR: " + (e instanceof Error ? e.message : "failed");
    }
    msgs.push({ role: "user", content: `RESULT:\n${out.slice(0, 4500)}` });
  }
  return { text: "No result.", steps };
}