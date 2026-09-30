import { NextResponse } from "next/server";
import { createSandbox, loadSdk } from "@/lib/e2b-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Open /api/e2b/create in a browser tab: it tells you whether the E2B SDK
// loads on the server, and if not, the exact reason.
export async function GET() {
  try {
    await loadSdk();
    return NextResponse.json({ ok: true, sdk: "loaded", node: process.version });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message, node: process.version }, { status: 500 });
  }
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}