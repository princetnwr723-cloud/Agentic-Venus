import { NextResponse } from "next/server";
import { verifyJobToken } from "@/lib/job-token";
import { jobIdOf, runSliceServer, venusStore } from "@/lib/venus-run-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// One slice of one video. Only the server itself calls this, with a job token that is bound to this uid, chat AND video.
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const job = verifyJobToken(token);
  if (!job) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { pid?: unknown };
  const pid = String(body.pid ?? "");
  if (job.jobId !== jobIdOf(pid)) return NextResponse.json({ error: "This token is for another video." }, { status: 403 });
  const run = await venusStore().getRun(job.uid, pid);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  try {
    const r = await runSliceServer(job.uid, pid, { origin: run.origin || new URL(req.url).origin });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Slice failed." }, { status: 500 });
  }
}
