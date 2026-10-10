import { NextResponse } from "next/server";
import { fetchModels, NO_LISTING } from "@/lib/model-catalog-server";
import { readBody, requestStatus } from "@/lib/request";
import { resolveValue } from "@/lib/vault";
import { authFromRequest } from "@/lib/job-token";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 30;

const PROVIDER_IDS = new Set<ProviderId>([
  "openai",
  "anthropic",
  "gemini",
  "grok",
  "openrouter",
  "mistral",
  "cohere",
  "perplexity",
  "groq",
  "deepseek",
  "apinex",
]);

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_IDS.has(value as ProviderId);
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 16 * 1024 });

    if (!isProviderId(body.provider)) {
      return NextResponse.json(
        { error: "Invalid provider." },
        { status: 400 }
      );
    }

    const provider = body.provider;

    /*
     * IMPORTANT:
     *
     * The browser now receives only:
     *
     *   vault:provider.openai#1234
     *
     * instead of the real API key.
     *
     * Never trust/use that placeholder directly against the provider API.
     *
     * We therefore resolve the saved secret on the server.
     */

    let apiKey = "";

    const suppliedKey =
      typeof body.apiKey === "string" ? body.apiKey.trim() : "";

    if (suppliedKey) {
      /*
       * Normal case after the vault migration:
       * suppliedKey is a vault placeholder.
       *
       * resolveValue() returns the real key only on the server.
       */
      apiKey = await resolveValue(
        String((await authFromRequest(req, undefined)).uid),
        suppliedKey
      );
    }

    /*
     * Backward compatibility:
     * If an old client sends a real key, continue to support it.
     *
     * New clients should never expose the real key to the browser.
     */
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing API key." },
        { status: 400 }
      );
    }

    const models = await fetchModels(provider, apiKey);

    if (models === NO_LISTING) {
      return NextResponse.json({
        models: null,
        source: "fallback",
      });
    }

    return NextResponse.json({
      models,
      source: "live",
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not list models.";

    return NextResponse.json(
      { error: message },
      { status: requestStatus(err) }
    );
  }
}