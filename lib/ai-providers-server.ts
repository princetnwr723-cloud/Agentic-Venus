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