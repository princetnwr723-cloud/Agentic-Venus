import { NextResponse } from "next/server";
import { deleteSandbox } from "@/lib/e2b-server";
import { readBody, requestStatus } from "@/lib/request";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { apiKey, sandboxId } = await readBody(req);
    if (!apiKey || !sandboxId) {
      return NextResponse.json({ error: "Missing E2B API key or sandbox id." }, { status: 400 });
    }
    await deleteSandbox(apiKey, sandboxId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not delete the computer.";
    return NextResponse.json({ error: message }, { status: requestStatus(err) });
  }
}
