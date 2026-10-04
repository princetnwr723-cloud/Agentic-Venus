import { createHmac, timingSafeEqual } from "crypto";
import { verifyUser } from "@/lib/server-auth";

const secret = () => {
  const s = process.env.ROUTINE_RUNNER_SECRET;
  if (!s) throw new Error("ROUTINE_RUNNER_SECRET is not set on the server.");
  return s;
};
const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

/** A short-lived pass for ONE background job. The sandbox never sees the user's tokens: it calls the server with this. */
export function signJob(uid: string, chatId: string, jobId: string, ttlMs = 6 * 3600_000): string {
  const body = Buffer.from(JSON.stringify({ u: uid, c: chatId, j: jobId, e: Date.now() + ttlMs })).toString("base64url");
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
    if (!c.u || !c.c || c.e < Date.now()) return null;
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
