// SAVE AS: lib/ai-providers-server.ts
// Server-only. Called from API routes — never imported into a client
// component, so the API key passed in here never reaches the browser
// bundle. Each provider has a slightly different request/response shape;
// this file normalizes all of them to a single callProvider() function.
// A message may carry one image (used by the computer-use agent to send a
// screenshot); it needs a vision-capable model on the provider's side.

import type { ProviderId } from "./providers";

export type ChatImage = { mediaType: string; data: string };
export type ChatMsg = {
  role: "system" | "user" | "assistant";
  content: string;
  image?: ChatImage;
};

const OPENAI_COMPATIBLE_URLS: Partial<Record<ProviderId, string>> = {
  openai: "https://api.openai.com/v1/chat/completions",
  grok: "https://api.x.ai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  perplexity: "https://api.perplexity.ai/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
};

// OpenAI-style content: plain string, or [text, image_url] when an image is attached.
function openAIStyleContent(m: ChatMsg) {
  if (!m.image) return m.content;
  return [
    { type: "text", text: m.content },
    {
      type: "image_url",
      image_url: { url: `data:${m.image.mediaType};base64,${m.image.data}` },
    },
  ];
}

async function callOpenAICompatible(
  provider: ProviderId,
  apiKey: string,
  model: string,
  messages: ChatMsg[]
) {
  const url = OPENAI_COMPATIBLE_URLS[provider];
  if (!url) throw new Error(`No endpoint configured for ${provider}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: openAIStyleContent(m) })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.error || `${provider} request failed`);
  }
  return data?.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(apiKey: string, model: string, messages: ChatMsg[]) {
  const system = messages.find((m) => m.role === "system")?.content;
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: m.image
        ? [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: m.image.mediaType,
                data: m.image.data,
              },
            },
            { type: "text", text: m.content },
          ]
        : m.content,
    }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: 1024, system, messages: rest }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || "Anthropic request failed");
  }
  return data?.content?.[0]?.text ?? "";
}

async function callGemini(apiKey: string, model: string, messages: ChatMsg[]) {
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: m.image
        ? [
            { inline_data: { mime_type: m.image.mediaType, data: m.image.data } },
            { text: m.content },
          ]
        : [{ text: m.content }],
    }));
  const system = messages.find((m) => m.role === "system")?.content;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || "Gemini request failed");
  }
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callCohere(apiKey: string, model: string, messages: ChatMsg[]) {
  const res = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: openAIStyleContent(m) })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || "Cohere request failed");
  }
  const parts = data?.message?.content;
  if (Array.isArray(parts)) {
    return parts.map((p: { text?: string }) => p.text ?? "").join("");
  }
  return "";
}

export async function callProvider({
  provider,
  apiKey,
  model,
  messages,
}: {
  provider: ProviderId;
  apiKey: string;
  model: string;
  messages: ChatMsg[];
}): Promise<string> {
  switch (provider) {
    case "anthropic":
      return callAnthropic(apiKey, model, messages);
    case "gemini":
      return callGemini(apiKey, model, messages);
    case "cohere":
      return callCohere(apiKey, model, messages);
    default:
      return callOpenAICompatible(provider, apiKey, model, messages);
  }
}