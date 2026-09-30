// SAVE AS: app/api/e2b/delete/route.ts
import { NextResponse } from "next/server";
import { deleteSandbox } from "@/lib/e2b-server";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { apiKey, sandboxId } = await req.json();
    if (!apiKey || !sandboxId) {
      return NextResponse.json(
        { error: "Missing E2B API key or sandbox id." },
        { status: 400 }
      );
    }
    await deleteSandbox(apiKey, sandboxId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not delete the computer.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}