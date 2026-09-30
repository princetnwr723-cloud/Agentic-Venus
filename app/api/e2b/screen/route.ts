// SAVE AS: app/api/e2b/screen/route.ts
import { NextResponse } from "next/server";
import { getScreenUrl } from "@/lib/e2b-server";

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
    const url = await getScreenUrl(apiKey, sandboxId);
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not open the computer's screen.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}