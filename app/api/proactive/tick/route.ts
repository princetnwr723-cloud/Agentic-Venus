import { NextResponse } from "next/server";
import { runProactive } from "@/lib/proactive";

export const runtime = "nodejs";
export const maxDuration = 60;

// Called every few minutes by the GitHub Actions workflow with the same secret as the other ticks.
export async function POST(req: Request) {
  const secret = process.env.ROUTINE_RUNNER_SECRET;
  if (!secret) return NextResponse.json({ error: "ROUTINE_RUNNER_SECRET is not set." }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const results = await runProactive();
    return NextResponse.json({ checked: results.length, results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Proactive tick failed." }, { status: 500 });
  }
}