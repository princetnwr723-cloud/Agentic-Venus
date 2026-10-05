import { getAdminDb } from "@/lib/firebase-admin";

/** Append-only trail of security-relevant actions (tool writes, vault changes). Readable by the owner, writable only by the server. */
export async function audit(uid: string, e: { kind: string; chatId?: string; text: string }) {
  try {
    await getAdminDb().collection("users").doc(uid).collection("audit").add({ at: Date.now(), kind: e.kind, chatId: e.chatId ?? null, text: e.text.slice(0, 400) });
  } catch { /* never block the action because the log failed */ }
}
