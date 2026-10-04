import type { ProviderId } from "@/lib/providers";

export type ChatMsg = {
  role: "system" | "user" | "assistant";
  content: string;
  image?: { mediaType: string; data: string };
};

export const OPENAI_COMPATIBLE_URLS: Partial<Record<ProviderId, string>> = {
  openai: "https://api.openai.com/v1/chat/completions",
  grok: "https://api.x.ai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  perplexity: "https://api.perplexity.ai/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  apinex: "https://apinex.bond/v1/chat/completions",
};

export function openAIStyleContent(
  m: ChatMsg
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (!m.image) return m.content;
  return [
    { type: "text", text: m.content },
    { type: "image_url", image_url: { url: `data:${m.image.mediaType};base64,${m.image.data}` } },
  ];
}

// ---------------------------------------------------------------------------
// One-shot call (no streaming) for every provider.
// Error messages include the HTTP status so callWithFallback can detect 429 / 5xx.
// ---------------------------------------------------------------------------
async function postJson(provider: ProviderId, url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data?.error?.message ?? data?.error ?? data?.message ?? "request failed";
    const msg = typeof raw === "string" ? raw : JSON.stringify(raw);
    throw new Error(`${provider} ${res.status}: ${msg.slice(0, 300)}`);
  }
  return data;
}

export async function callProvider(a: {
  provider: ProviderId;
  apiKey: string;
  model: string;
  messages: ChatMsg[];
  maxTokens?: number;
}): Promise<string> {
  const { provider, apiKey, model, messages } = a;

  if (provider === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || undefined;
    const rest = messages
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
    const d = await postJson(
      provider,
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      { model, max_tokens: a.maxTokens ?? 8192, system, messages: rest }
    );
    return (d.content ?? []).map((b: { text?: string }) => b.text ?? "").join("");
  }

  if (provider === "gemini") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: m.image
          ? [{ inline_data: { mime_type: m.image.mediaType, data: m.image.data } }, { text: m.content }]
          : [{ text: m.content }],
      }));
    const d = await postJson(
      provider,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": apiKey },
      {
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: { maxOutputTokens: a.maxTokens ?? 8192 },
      }
    );
    const parts: Array<{ text?: string }> = d?.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.text ?? "").join("");
  }

  const oaMessages = messages.map((m) => ({ role: m.role, content: openAIStyleContent(m) }));

  if (provider === "cohere") {
    const d = await postJson(
      provider,
      "https://api.cohere.com/v2/chat",
      { Authorization: `Bearer ${apiKey}` },
      { model, messages: oaMessages, ...(a.maxTokens ? { max_tokens: a.maxTokens } : {}) }
    );
    const parts = d?.message?.content;
    return Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? "").join("") : "";
  }

  const url = OPENAI_COMPATIBLE_URLS[provider];
  if (!url) throw new Error(`No endpoint configured for ${provider}`);
  const tokenField = a.maxTokens
    ? provider === "openai"
      ? { max_completion_tokens: a.maxTokens }
      : { max_tokens: a.maxTokens }
    : {};
  const d = await postJson(provider, url, { Authorization: `Bearer ${apiKey}` }, { model, messages: oaMessages, ...tokenField });
  const content = d?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

// ---------------------------------------------------------------------------
// Fallback chain: if a provider is rate-limited / overloaded / down, try the next one.
// Bad keys and bad requests are NOT retried (they would hide a real problem).
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
// Streaming (plain text deltas). Anthropic + every OpenAI-compatible provider stream
// for real; Gemini/Cohere arrive as one chunk (still works, just not token-by-token).
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
  const rest = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role,
    content: m.image
      ? [{ type: "image", source: { type: "base64", media_type: m.image.mediaType, data: m.image.data } }, { type: "text", text: m.content }]
      : m.content,
  }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: rest, stream: true }),
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