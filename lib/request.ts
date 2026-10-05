import { authFromRequest } from "@/lib/job-token";
import { resolveDeep } from "@/lib/vault";

/**
 * Drop-in replacement for `await req.json()` on every API route:
 *  1) the caller must be signed in (Firebase ID token) — or hold a job token on routes that allow it,
 *  2) body.uid is forced to the verified uid (the client cannot lie about it),
 *  3) "vault:..." placeholders in secret fields are swapped for the real secret, server-side only.
 */
export async function readBody(req: Request, opts: { allowJob?: boolean } = {}): Promise<any> {
  const raw = await req.json().catch(() => ({}));
  const auth = await authFromRequest(req, raw?.uid);
  if (auth.job && !opts.allowJob) throw new Error("Background-job tokens are not accepted on this endpoint.");
  const body = (raw && typeof raw === "object" ? await resolveDeep(auth.uid, raw) : {}) as Record<string, any>;
  body.uid = auth.uid;
  if (auth.job && auth.chatId) body.chatId = auth.chatId;
  return body;
}
