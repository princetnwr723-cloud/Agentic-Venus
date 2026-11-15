// Server-only. Who is the OWNER of this deployment (the person who runs it).
// The owner is never stopped by a plan: no token window, no computer-time limit, no daily video / website limit,
// no per-task cost cap, no task-count cap, and a "plan" latch can never hold the owner's tasks.
//
// How it is decided (set it ONCE in Vercel -> Settings -> Environment Variables, then redeploy):
//   OWNER_EMAILS=you@gmail.com            the Firebase account with this email counts as owner, but ONLY when Firebase says the email is verified
//   OWNER_UIDS=uid1,uid2                  or: the exact Firebase user ids (Firebase console -> Authentication -> Users -> "User UID")
// The older testing switch still works too: VENUS_UNLIMITED_TEST_MODE=true + VENUS_UNLIMITED_TEST_UIDS=uid1,uid2
//
// Nothing here trusts the browser: callers pass the uid that came out of the verified Firebase ID token.
import { getAdminAuth } from "@/lib/firebase-admin";

const list = (v: string | undefined) => String(v ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

function ownerUids(): Set<string> {
  const ids = [...list(process.env.OWNER_UIDS), ...list(process.env.VENUS_OWNER_UIDS)];
  if (process.env.VENUS_UNLIMITED_TEST_MODE === "true") ids.push(...list(process.env.VENUS_UNLIMITED_TEST_UIDS));
  return new Set(ids);
}
const ownerEmails = (): Set<string> => new Set([...list(process.env.OWNER_EMAILS), ...list(process.env.VENUS_OWNER_EMAILS)].map((e) => e.toLowerCase()));

// a yes/no per user is remembered for 10 minutes, so a busy run does not ask Firebase Auth on every model call
const TTL_MS = 10 * 60_000;
const known = new Map<string, { v: boolean; at: number }>();

/** true = this user is the owner of the deployment (unlimited). Never throws. */
export async function isOwner(uid: string): Promise<boolean> {
  const id = String(uid ?? "");
  if (!id) return false;
  if (ownerUids().has(id)) return true;
  const emails = ownerEmails();
  if (!emails.size) return false;

  const hit = known.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  try {
    const u = await getAdminAuth().getUser(id);
    const v = Boolean(u.email && u.emailVerified && emails.has(u.email.trim().toLowerCase()));
    if (known.size > 500) known.clear();
    known.set(id, { v, at: Date.now() });
    return v;
  } catch {
    return false; // Firebase Auth could not be reached: not cached, the next call asks again
  }
}