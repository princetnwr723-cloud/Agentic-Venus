import { NextResponse } from "next/server";
import { verifyJobToken } from "@/lib/job-token";
import { enterHops } from "@/lib/hops";
import { runSlice, store } from "@/lib/agent/worker";

export const runtime = "nodejs";
export const maxDuration = 60;

// One slice of one run. Only the server itself calls this, with a job token that is bound to this uid, chat AND run id.
export async function POST(req: Request) {
  enterHops(req); // how deep in a chain of calls to this site we are (Vercel refuses the 6th)
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const job = verifyJobToken(token);
  if (!job) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { runId?: unknown };
  const runId = String(body.runId ?? "");
  if (runId !== job.jobId) return NextResponse.json({ error: "This token is for another run." }, { status: 403 });
  const run = await store().getRun(job.uid, runId);
  if (!run || run.chatId !== job.chatId) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  try {
    const r = await runSlice(job.uid, runId, { origin: run.origin || new URL(req.url).origin });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Slice failed." }, { status: 500 });
  }
}
