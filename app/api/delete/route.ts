import { NextResponse } from "next/server";
import { deleteSandbox } from "@/lib/daytona-server";

export async function POST(req: Request) {
  try {
    const { apiKey, sandboxId } = await req.json();
    if (!apiKey || !sandboxId) {
      return NextResponse.json({ error: "Missing API key or sandbox id." }, { status: 400 });
    }
    await deleteSandbox(apiKey, sandboxId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not delete the computer.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}