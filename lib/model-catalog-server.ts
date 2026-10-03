// Server-only. Each provider exposes its own "list models" endpoint in a
// different shape — this normalizes all of them to {id, label?}[]. Used by
// app/api/models/route.ts so the model picker shows what a key can
// *actually* call, not just our static suggestions in lib/providers.ts.

import type { ProviderId } from "./providers";

export type ModelInfo = { id: string; label?: string };

// Providers with no public models-listing endpoint fall back to the
// curated defaults in lib/providers.ts instead of erroring.
export const NO_LISTING = Symbol("no-listing");

async function getJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || `Request failed (${res.status})`);
  }
  return data;
}

const OPENAI_COMPATIBLE_MODELS_URL: Partial<Record<ProviderId, string>> = {
  openai: "https://api.openai.com/v1/models",
  grok: "https://api.x.ai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
  mistral: "https://api.mistral.ai/v1/models",
  groq: "https://api.groq.com/openai/v1/models",
  deepseek: "https://api.deepseek.com/models",
  apinex: "https://apinex.bond/v1/models",
};

export async function fetchModels(
  provider: ProviderId,
  apiKey: string
): Promise<ModelInfo[] | typeof NO_LISTING> {
  switch (provider) {
    case "anthropic": {
      const data = await getJson("https://api.anthropic.com/v1/models?limit=1000", {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      });
      return (data.data || []).map((m: { id: string; display_name?: string }) => ({
        id: m.id,
        label: m.display_name,
      }));
    }

    case "gemini": {
      const data = await getJson(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`,
        {}
      );
      type GeminiModel = {
        name: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      };
      return (data.models || [])
        .filter((m: GeminiModel) =>
          (m.supportedGenerationMethods || []).includes("generateContent")
        )
        .map((m: GeminiModel) => ({
          id: m.name.replace(/^models\//, ""),
          label: m.displayName,
        }));
    }

    case "cohere": {
      const data = await getJson("https://api.cohere.com/v1/models?page_size=200", {
        Authorization: `Bearer ${apiKey}`,
      });
      type CohereModel = { name: string; endpoints?: string[] };
      return (data.models || [])
        .filter((m: CohereModel) => !m.endpoints || m.endpoints.includes("chat"))
        .map((m: CohereModel) => ({ id: m.name }));
    }

    case "perplexity":
      // No public models-listing endpoint as of this writing.
      return NO_LISTING;

    default: {
      const url = OPENAI_COMPATIBLE_MODELS_URL[provider];
      if (!url) return NO_LISTING;
      const data = await getJson(url, { Authorization: `Bearer ${apiKey}` });
      return (data.data || []).map((m: { id: string }) => ({ id: m.id }));
    }
  }
}