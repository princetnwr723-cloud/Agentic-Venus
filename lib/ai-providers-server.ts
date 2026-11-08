// Server-only. Normalizes every provider to one callProvider() function,
// plus fallback chains and streaming.
import type { ProviderId } from "./providers";

export type ChatImage = { mediaType: string; data: string };
export type ChatMsg = { role: "system" | "user" | "assistant"; content: string; image?: ChatImage };

const OPENAI_COMPATIBLE_URLS: Partial<Record<ProviderId, string>> = {
  openai: "https://api.openai.com/v1/chat/completions",
  grok: "https://api.x.ai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  perplexity: "https://api.perplexity.ai/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  apinex: "https://apinex.bond/v1/chat/completions",
};

function openAIStyleContent(m: ChatMsg) {
  if (!m.image) return m.content;
  return [
    { type: "text", text: m.content },
    { type: "image_url", image_url: { url: `data:${m.image.mediaType};base64,${m.image.data}` } },
  ];
}

async function callOpenAICompatible(provider: ProviderId, apiKey: string, model: string, messages: ChatMsg[], power = false) {
  const url = OPENAI_COMPATIBLE_URLS[provider];
  if (!url) throw new Error(`No endpoint configured for ${provider}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: messages.map((m) => ({ role: m.role, content: openAIStyleContent(m) })), ...(power && provider === "openai" && /^(o\d|gpt-5)/i.test(model) ? { reasoning_effort: "medium" } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || data?.error || `${provider} request failed`);
  return data?.choices?.[0]?.message?.content ?? "";
}

function anthropicMessages(messages: ChatMsg[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: m.image
        ? [
            { type: "image", source: { type: "base64", media_type: m.image.mediaType, data: m.image.data } },
            { type: "text", text: m.content },
          ]
        : m.content,
    }));
}

/**
 * A long system prompt (agent persona + memory + skills) is re-sent on every turn. Marking it cacheable makes the
 * repeated part much cheaper and faster on Anthropic. Short prompts are left as plain text (nothing to gain).
 */
function anthropicSystem(system: string | undefined) {
  if (!system) return undefined;
  return system.length >= 3000 ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system;
}

/** Tokens a model may spend THINKING before it answers (planning calls only; the answer keeps its own room). */
const THINK_BUDGET = 3000;

async function callAnthropic(apiKey: string, model: string, messages: ChatMsg[], maxTokens: number, power = false) {
  const system = messages.find((m) => m.role === "system")?.content;
  const send = (sys: unknown) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: power ? maxTokens + THINK_BUDGET : maxTokens, system: sys, messages: anthropicMessages(messages), ...(power ? { thinking: { type: "enabled", budget_tokens: THINK_BUDGET } } : {}) }),
  });
  let res = await send(anthropicSystem(system));
  let data = await res.json().catch(() => ({}));
  if (!res.ok && /cache_control/i.test(data?.error?.message ?? "")) { res = await send(system); data = await res.json().catch(() => ({})); }
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${data?.error?.message || "request failed"}`);
  const text = (Array.isArray(data?.content) ? data.content : []).map((b: { type?: string; text?: string }) => (b?.type === "text" ? b.text ?? "" : "")).join("");
  return text;
}

async function callGemini(apiKey: string, model: string, messages: ChatMsg[], maxTokens: number, power = false) {
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: m.image
        ? [{ inline_data: { mime_type: m.image.mediaType, data: m.image.data } }, { text: m.content }]
        : [{ text: m.content }],
    }));
  const system = messages.find((m) => m.role === "system")?.content;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const call = async (inline: boolean) => {
    const cs = inline && system ? contents.map((c, i) => (i === 0 ? { ...c, parts: [{ text: system + "\n\n" }, ...c.parts] } : c)) : contents;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: cs,
        generationConfig: power ? { maxOutputTokens: maxTokens + THINK_BUDGET, thinkingConfig: { thinkingBudget: THINK_BUDGET } } : { maxOutputTokens: maxTokens },
        ...(system && !inline ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      }),
    });
    return { res, data: await res.json().catch(() => ({})) };
  };
  let r = await call(false);
  if (!r.res.ok && /developer instruction|system instruction/i.test(r.data?.error?.message ?? "")) r = await call(true);
  if (!r.res.ok) throw new Error(r.data?.error?.message || "Gemini request failed");
  return (r.data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
}

async function callCohere(apiKey: string, model: string, messages: ChatMsg[]) {
  const res = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: messages.map((m) => ({ role: m.role, content: openAIStyleContent(m) })) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || "Cohere request failed");
  const parts = data?.message?.content;
  return Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? "").join("") : "";
}

/** Short outages (rate limit, overloaded, 5xx, network blips) are retried with a growing pause before giving up. */
const TRANSIENT = /(\b429\b|rate.?limit|overloaded|timeout|timed out|fetch failed|ECONN|socket|\b50[0234]\b|unavailable|capacity)/i;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callProvider({
  provider, apiKey, model, messages, maxTokens = 8192, power = false,
}: {
  provider: ProviderId; apiKey: string; model: string; messages: ChatMsg[]; maxTokens?: number;
  /** Let the model think before it answers (extended thinking / reasoning). Models that do not support it answer normally. */
  power?: boolean;
}): Promise<string> {
  const run = (pw: boolean) => {
    switch (provider) {
      case "anthropic": return callAnthropic(apiKey, model, messages, maxTokens, pw);
      case "gemini": return callGemini(apiKey, model, messages, maxTokens, pw);
      case "cohere": return callCohere(apiKey, model, messages);
      default: return callOpenAICompatible(provider, apiKey, model, messages, pw);
    }
  };
  const once = async () => {
    if (power) {
      try { return await run(true); }
      catch (e) {
        // a busy / rate-limited provider is retried by the loop below; anything else usually means "this model cannot think": answer normally
        if (TRANSIENT.test(e instanceof Error ? e.message : String(e))) throw e;
      }
    }
    return run(false);
  };
  for (let attempt = 0; ; attempt++) {
    try { return await once(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt >= 2 || !TRANSIENT.test(msg)) throw e;
      await wait(1200 * (attempt + 1));
    }
  }
}

// ---------------------------------------------------------------------------
// Fallback chain: rate-limited / overloaded / down -> try the next provider.
// Bad keys and bad requests are NOT retried (that would hide a real problem).
// ---------------------------------------------------------------------------
export type Fallback = { provider: ProviderId; apiKey: string; model: string };
const RETRYABLE = /(\b429\b|rate.?limit|overloaded|timeout|timed out|fetch failed|ECONN|socket|\b5\d\d\b|unavailable|capacity)/i;

export async function callWithFallback(
  primary: { provider: ProviderId; apiKey: string; model: string; messages: ChatMsg[]; maxTokens?: number },
  fallbacks: Fallback[] = []
): Promise<{ reply: string; used: string }> {
  const chain: Fallback[] = [{ provider: primary.provider, apiKey: primary.apiKey, model: primary.model }, ...fallbacks];
  let lastErr: unknown;
  for (const c of chain) {
    try {
      const reply = await callProvider({ ...c, messages: primary.messages, maxTokens: primary.maxTokens });
      return { reply, used: `${c.provider}:${c.model}` };
    } catch (e) {
      lastErr = e;
      if (!RETRYABLE.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All providers failed.");
}

// ---------------------------------------------------------------------------
// Streaming (plain text deltas). Anthropic + every OpenAI-compatible provider
// stream for real; Gemini/Cohere arrive as one chunk.
// ---------------------------------------------------------------------------
async function readSSE(res: Response, onData: (j: any) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try { onData(JSON.parse(d)); } catch { /* partial json */ }
    }
  }
}

async function streamAnthropic(apiKey: string, model: string, messages: ChatMsg[], maxTokens: number, push: (s: string) => void) {
  const system = messages.find((m) => m.role === "system")?.content;
  const send = (sys: unknown) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: sys, messages: anthropicMessages(messages), stream: true }),
  });
  let res = await send(anthropicSystem(system));
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}));
    if (/cache_control/i.test(d?.error?.message ?? "")) res = await send(system);
    else throw new Error(`Anthropic ${res.status}: ${d?.error?.message || "request failed"}`);
  }
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}));
    throw new Error(`Anthropic ${res.status}: ${d?.error?.message || "request failed"}`);
  }
  await readSSE(res, (j) => { if (j.type === "content_block_delta" && j.delta?.type === "text_delta") push(j.delta.text); });
}

async function streamOpenAI(provider: ProviderId, apiKey: string, model: string, messages: ChatMsg[], push: (s: string) => void) {
  const url = OPENAI_COMPATIBLE_URLS[provider];
  if (!url) throw new Error(`No endpoint configured for ${provider}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, stream: true, messages: messages.map((m) => ({ role: m.role, content: openAIStyleContent(m) })) }),
  });
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.error?.message || d?.error || `${provider} request failed`);
  }
  await readSSE(res, (j) => { const t = j?.choices?.[0]?.delta?.content; if (typeof t === "string" && t) push(t); });
}

export const STREAM_ERROR_MARK = "[[ERROR]]";

export function streamProvider(a: { provider: ProviderId; apiKey: string; model: string; messages: ChatMsg[]; maxTokens?: number }): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const push = (s: string) => controller.enqueue(enc.encode(s));
      try {
        if (a.provider === "anthropic") await streamAnthropic(a.apiKey, a.model, a.messages, a.maxTokens ?? 8192, push);
        else if (a.provider === "gemini" || a.provider === "cohere") push(await callProvider(a));
        else await streamOpenAI(a.provider, a.apiKey, a.model, a.messages, push);
      } catch (e) {
        push(`${STREAM_ERROR_MARK}${e instanceof Error ? e.message : "Stream failed."}`);
      }
      controller.close();
    },
  });
}