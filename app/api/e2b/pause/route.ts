import { NextResponse } from "next/server";
import { pauseSandbox } from "@/lib/e2b-server";
import { readBody } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { apiKey, sandboxId } = await readBody(req);
    if (!apiKey || !sandboxId) {
      return NextResponse.json({ error: "Missing E2B API key or sandbox id." }, { status: 400 });
    }
    await pauseSandbox(apiKey, sandboxId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not pause the computer.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
