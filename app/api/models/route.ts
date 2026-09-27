import { NextResponse } from "next/server";
import { fetchModels, NO_LISTING } from "@/lib/model-catalog-server";
import type { ProviderId } from "@/lib/providers";

export async function POST(req: Request) {
  try {
    const { provider, apiKey }: { provider: ProviderId; apiKey: string } = await req.json();
    if (!apiKey) {
      return NextResponse.json({ error: "Missing API key." }, { status: 400 });
    }
    const models = await fetchModels(provider, apiKey);
    if (models === NO_LISTING) {
      // Signal the client to use its own curated defaults instead.
      return NextResponse.json({ models: null });
    }
    return NextResponse.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not list models.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}