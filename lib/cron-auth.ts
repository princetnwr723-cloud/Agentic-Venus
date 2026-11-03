import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/** The secret shared by the scheduler (GitHub Actions / cron-job.org) and the server. Trimmed: a pasted secret often has a stray space or newline. */
export const cronSecret = () => (process.env.ROUTINE_RUNNER_SECRET ?? "").trim();

export function cronAuthorized(req: Request): boolean {
  const secret = cronSecret();
  if (!secret) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** null = allowed. Otherwise the response to return. */
export function cronDenied(req: Request): NextResponse | null {
  if (!cronSecret()) {
    return NextResponse.json({ error: "ROUTINE_RUNNER_SECRET is not set on the server (Vercel -> Settings -> Environment Variables). Set it, then redeploy." }, { status: 500 });
  }
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized — the secret sent doesn't match ROUTINE_RUNNER_SECRET on the server." }, { status: 401 });
  }
  return null;
}