// SAVE AS: app/api/e2b/create/route.ts
import { NextResponse } from "next/server";
import { createSandbox } from "@/lib/e2b-server";

export const maxDuration = 60;

// Diagnostic only — visit /api/e2b/create directly in a browser tab. If you
// see {"ok":true,"version":"diag-1"} the new file is genuinely live on the
// server. If you see anything else (404, a crash page, old text), the
// deploy itself hasn't taken effect and that's the real thing to fix first.
export async function GET() {
  return NextResponse.json({ ok: true, version: "diag-1" });
}

export async function POST(req: Request) {
  try {
    const { apiKey } = await req.json();
    if (!apiKey) {
      return NextResponse.json({ error: "No E2B API key on file." }, { status: 400 });
    }
    const sandboxId = await createSandbox(apiKey);
    return NextResponse.json({ sandboxId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create a computer.";
    return NextResponse.json({ error: `[diag-1] ${message}` }, { status: 500 });
  }
}