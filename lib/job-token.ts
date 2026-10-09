import { createHmac, timingSafeEqual } from "crypto";
import { verifyUser } from "@/lib/server-auth";

const secret = () => {
  const s = process.env.ROUTINE_RUNNER_SECRET;
  if (!s) throw new Error("ROUTINE_RUNNER_SECRET is not set on the server.");
  return s;
};
const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

/** A short-lived pass for ONE background job. The sandbox never sees the user's tokens: it calls the server with this. */
const MAX_JOB_TTL_MS = 6 * 60 * 60_000;
const validIdentity = (value: string) => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\r\n]/.test(value);

export function signJob(uid: string, chatId: string, jobId: string, ttlMs = MAX_JOB_TTL_MS): string {
  if (!validIdentity(uid) || !validIdentity(chatId) || !/^[a-z0-9]{4,24}$/.test(jobId)) {
    throw new Error("Cannot issue a job token for an invalid identity or job id.");
  }
  const boundedTtl = Math.min(MAX_JOB_TTL_MS, Math.max(1_000, Number.isFinite(ttlMs) ? ttlMs : MAX_JOB_TTL_MS));
  const body = Buffer.from(JSON.stringify({ u: uid, c: chatId, j: jobId, e: Date.now() + boundedTtl })).toString("base64url");
  return `job:${body}.${sign(body)}`;
}

export function verifyJobToken(token: string): { uid: string; chatId: string; jobId: string } | null {
  if (!token.startsWith("job:")) return null;
  const [body, sig] = token.slice(4).split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!validIdentity(c.u) || !validIdentity(c.c) || !/^[a-z0-9]{4,24}$/.test(String(c.j ?? ""))) return null;
    if (!Number.isFinite(c.e) || c.e <= Date.now() || c.e > Date.now() + MAX_JOB_TTL_MS + 5_000) return null;
    return { uid: String(c.u), chatId: String(c.c), jobId: String(c.j) };
  } catch { return null; }
}

export async function authFromRequest(req: Request, fallbackUid?: unknown): Promise<{ uid: string; chatId?: string; job: boolean }> {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (bearer.startsWith("job:")) {
    const c = verifyJobToken(bearer);
    if (!c) throw new Error("Job token is invalid or expired.");
    return { uid: c.uid, chatId: c.chatId, job: true };
  }
  const { uid } = await verifyUser(req, fallbackUid);
  return { uid, job: false };
}
