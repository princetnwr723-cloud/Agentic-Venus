import { NextResponse } from "next/server";
import { createSandbox, loadSdk } from "@/lib/e2b-server";
import { readBody } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Open /api/e2b/create in a browser tab to check that the E2B SDK loads.
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
    const { apiKey } = await readBody(req);
    if (!apiKey) {
      return NextResponse.json({ error: "No E2B API key on file." }, { status: 400 });
    }
    const { sandboxId, persistence } = await createSandbox(apiKey);
    return NextResponse.json({ sandboxId, persistence });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create a computer.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
