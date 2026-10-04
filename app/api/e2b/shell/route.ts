import { NextResponse } from "next/server";
import { shellStart } from "@/lib/e2b-server";
import { verifyUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { uid, e2bKey, sandboxId, command } = await req.json();
    await verifyUser(req, uid);
    if (!e2bKey || !sandboxId || !String(command ?? "").trim()) return NextResponse.json({ error: "Missing computer or command." }, { status: 400 });
    const r = await shellStart(String(e2bKey), String(sandboxId), String(command));
    return NextResponse.json({ done: r.done, exitCode: r.exitCode, output: r.output });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Shell failed." }, { status: 500 });
  }
}
