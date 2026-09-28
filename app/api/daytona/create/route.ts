// SAVE AS: app/api/daytona/create/route.ts
import { NextResponse } from "next/server";
import { createSandbox } from "@/lib/daytona-server";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { apiKey } = await req.json();
    if (!apiKey) {
      return NextResponse.json({ error: "No Daytona API key on file." }, { status: 400 });
    }
    const sandboxId = await createSandbox(apiKey);
    return NextResponse.json({ sandboxId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create a computer.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}