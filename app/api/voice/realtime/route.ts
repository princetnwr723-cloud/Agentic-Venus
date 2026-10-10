import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { getExistingOpenAIKey } from "@/lib/voice-utils";
import { voiceSafeError } from "@/lib/voice-server";

export const runtime = "nodejs";
export const maxDuration = 20;
export async function POST(req: Request) {
  try {
    const auth = await authFromRequest(req);
    if (auth.job) return NextResponse.json({ error: "Background jobs cannot create voice sessions." }, { status: 403 });
    const key = await getExistingOpenAIKey(auth.uid);
    if (!key) return NextResponse.json({ error: "Save an OpenAI API key in Voice & Calling or API keys settings first." }, { status: 400 });
    const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "OpenAI-Safety-Identifier": createHash("sha256").update(auth.uid).digest("hex") },
      body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 600 }, session: { type: "realtime", model: "gpt-realtime", audio: { output: { voice: "marin" } } } }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return NextResponse.json({ error: data?.error?.message || `OpenAI Realtime session failed (HTTP ${upstream.status}).` }, { status: upstream.status === 401 ? 400 : 502 });
    const value = data?.value || data?.client_secret?.value;
    if (typeof value !== "string") return NextResponse.json({ error: "OpenAI returned no short-lived client secret." }, { status: 502 });
    return NextResponse.json({ value, expires_at: data?.expires_at ?? data?.client_secret?.expires_at, session: data?.session ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ error: voiceSafeError(e) }, { status: 500 }); }
}