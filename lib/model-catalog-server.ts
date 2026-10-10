// Server-only.
//
// Fetches the models that are actually available to the user's API key
// and normalizes every provider to:
//
//   { id: string; label?: string }
//
// IMPORTANT:
// The browser must NEVER receive the real API key.
// This module is only called from the server.

import type { ProviderId } from "./providers";

export type ModelInfo = {
  id: string;
  label?: string;
};

export const NO_LISTING = Symbol("no-listing");

const REQUEST_TIMEOUT = 15_000;
const MAX_MODELS = 2_000;

async function getJson(
  url: string,
  headers: Record<string, string> = {}
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...headers,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message =
        data?.error?.message ||
        data?.error?.type ||
        data?.message ||
        `Request failed (${res.status})`;

      throw new Error(message);
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Model provider request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function uniqueModels(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  const result: ModelInfo[] = [];

  for (const model of models) {
    const id = String(model.id || "").trim();

    if (!id || seen.has(id)) continue;

    seen.add(id);

    result.push({
      id,
      ...(model.label ? { label: model.label } : {}),
    });

    if (result.length >= MAX_MODELS) break;
  }

  return result;
}

/*
 * OpenAI-compatible model endpoints.
 *
 * These providers expose an OpenAI-style /models endpoint.
 */
const OPENAI_COMPATIBLE_MODELS_URL: Partial<
  Record<ProviderId, string>
> = {
  openai: "https://api.openai.com/v1/models",
  grok: "https://api.x.ai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
  mistral: "https://api.mistral.ai/v1/models",
  groq: "https://api.groq.com/openai/v1/models",
  deepseek: "https://api.deepseek.com/models",
  apinex: "https://apinex.bond/v1/models",
};

/*
 * OpenAI-compatible APIs sometimes return different metadata.
 * We only require id and optionally use a human-readable name.
 */
function normalizeOpenAIModels(
  data: unknown
): ModelInfo[] {
  const rows = Array.isArray(
    (data as { data?: unknown[] })?.data
  )
    ? ((data as { data: unknown[] }).data)
    : [];

  return uniqueModels(
    rows
      .map((item) => {
        if (!item || typeof item !== "object") return null;

        const m = item as {
          id?: unknown;
          name?: unknown;
        };

        if (typeof m.id !== "string" || !m.id.trim()) {
          return null;
        }

        return {
          id: m.id.trim(),
          label:
            typeof m.name === "string" && m.name.trim()
              ? m.name.trim()
              : undefined,
        };
      })
      .filter(Boolean) as ModelInfo[]
  );
}

/*
 * Anthropic
 *
 * Anthropic's model API is paginated.
 * We continue through all pages instead of only requesting
 * the first 1000 models.
 */
async function fetchAnthropicModels(
  apiKey: string
): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];

  let afterId: string | undefined;

  for (let page = 0; page < 20; page++) {
    const url = new URL(
      "https://api.anthropic.com/v1/models"
    );

    url.searchParams.set("limit", "100");

    if (afterId) {
      url.searchParams.set("after_id", afterId);
    }

    const data = await getJson(url.toString(), {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    });

    const rows = Array.isArray(data?.data)
      ? data.data
      : [];

    for (const item of rows) {
      if (
        item &&
        typeof item.id === "string" &&
        item.id.trim()
      ) {
        models.push({
          id: item.id.trim(),
          label:
            typeof item.display_name === "string"
              ? item.display_name
              : undefined,
        });
      }
    }

    if (!data?.has_more || !data?.last_id) break;

    afterId = String(data.last_id);

    if (models.length >= MAX_MODELS) break;
  }

  return uniqueModels(models);
}

/*
 * Gemini
 *
 * Gemini's models.list endpoint is also paginated.
 */
async function fetchGeminiModels(
  apiKey: string
): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];

  let pageToken: string | undefined;

  for (let page = 0; page < 20; page++) {
    const url = new URL(
      "https://generativelanguage.googleapis.com/v1beta/models"
    );

    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "1000");

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const data = await getJson(url.toString());

    type GeminiModel = {
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    };

    const rows: GeminiModel[] = Array.isArray(data?.models)
      ? data.models
      : [];

    for (const model of rows) {
      if (
        typeof model.name !== "string" ||
        !model.name.trim()
      ) {
        continue;
      }

      /*
       * We only show models capable of generating content.
       * Embedding-only and unrelated models should not appear
       * in the normal chat model picker.
       */
      if (
        Array.isArray(model.supportedGenerationMethods) &&
        !model.supportedGenerationMethods.includes(
          "generateContent"
        )
      ) {
        continue;
      }

      models.push({
        id: model.name.replace(/^models\//, "").trim(),
        label:
          typeof model.displayName === "string"
            ? model.displayName
            : undefined,
      });
    }

    pageToken =
      typeof data?.nextPageToken === "string"
        ? data.nextPageToken
        : undefined;

    if (!pageToken) break;

    if (models.length >= MAX_MODELS) break;
  }

  return uniqueModels(models);
}

/*
 * Cohere
 */
async function fetchCohereModels(
  apiKey: string
): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];

  let pageToken: string | undefined;

  for (let page = 0; page < 20; page++) {
    const url = new URL(
      "https://api.cohere.com/v1/models"
    );

    url.searchParams.set("page_size", "100");

    if (pageToken) {
      url.searchParams.set("page_token", pageToken);
    }

    const data = await getJson(url.toString(), {
      Authorization: `Bearer ${apiKey}`,
    });

    type CohereModel = {
      name?: string;
      endpoints?: string[];
    };

    const rows: CohereModel[] = Array.isArray(data?.models)
      ? data.models
      : [];

    for (const model of rows) {
      if (
        typeof model.name !== "string" ||
        !model.name.trim()
      ) {
        continue;
      }

      /*
       * Prefer models that can actually be used for chat.
       * Some Cohere accounts can expose models for other
       * purposes as well.
       */
      if (
        Array.isArray(model.endpoints) &&
        model.endpoints.length > 0 &&
        !model.endpoints.includes("chat")
      ) {
        continue;
      }

      models.push({
        id: model.name.trim(),
      });
    }

    pageToken =
      typeof data?.next_page_token === "string"
        ? data.next_page_token
        : undefined;

    if (!pageToken) break;

    if (models.length >= MAX_MODELS) break;
  }

  return uniqueModels(models);
}

/*
 * Main provider dispatcher.
 */
export async function fetchModels(
  provider: ProviderId,
  apiKey: string
): Promise<ModelInfo[] | typeof NO_LISTING> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Missing API key.");
  }

  switch (provider) {
    case "anthropic":
      return fetchAnthropicModels(apiKey);

    case "gemini":
      return fetchGeminiModels(apiKey);

    case "cohere":
      return fetchCohereModels(apiKey);

    case "perplexity":
      /*
       * Perplexity currently has no reliable public model
       * discovery endpoint for this application.
       *
       * Keep using the curated provider list.
       */
      return NO_LISTING;

    default: {
      const url =
        OPENAI_COMPATIBLE_MODELS_URL[provider];

      if (!url) {
        return NO_LISTING;
      }

      const data = await getJson(url, {
        Authorization: `Bearer ${apiKey}`,
      });

      return normalizeOpenAIModels(data);
    }
  }
}