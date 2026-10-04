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

async function callOpenAICompatible(provider: ProviderId, apiKey: string, model: string, messages: ChatMsg[]) {
  const url = OPENAI_COMPATIBLE_URLS[provider];
  if (!url) throw new Error(`No endpoint configured for ${provider}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: messages.map((m) => ({ role: m.role, content: openAIStyleContent(m) })) }),
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

async function callAnthropic(apiKey: string, model: string, messages: ChatMsg[], maxTokens: number) {
  const system = messages.find((m) => m.role === "system")?.content;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: anthropicMessages(messages) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || "Anthropic request failed");
  return data?.content?.[0]?.text ?? "";
}

async function callGemini(apiKey: string, model: string, messages: ChatMsg[], maxTokens: number) {
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
        generationConfig: { maxOutputTokens: maxTokens },
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

export async function callProvider({
  provider, apiKey, model, messages, maxTokens = 8192,
}: {
  provider: ProviderId; apiKey: string; model: string; messages: ChatMsg[]; maxTokens?: number;
}): Promise<string> {
  switch (provider) {
    case "anthropic": return callAnthropic(apiKey, model, messages, maxTokens);
    case "gemini": return callGemini(apiKey, model, messages, maxTokens);
    case "cohere": return callCohere(apiKey, model, messages);
    default: return callOpenAICompatible(provider, apiKey, model, messages);
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
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: anthropicMessages(messages), stream: true }),
  });
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.error?.message || "Anthropic request failed");
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
