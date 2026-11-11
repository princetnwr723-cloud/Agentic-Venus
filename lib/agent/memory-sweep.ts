// Applies memory decay to a chat's memories (server only). Called after a run ends, at most once a day per chat.
//   recalled memories get accessCount + lastAccessedAt (use keeps them alive)
//   dormant ones stay in the document but are not shown to the model
//   archived ones move to brain/archive (capped), so nothing is lost for good
import { getAdminDb } from "@/lib/firebase-admin";
import { sweep, touch, type DecayMem } from "./decay.ts";

const SWEEP_EVERY_MS = 24 * 3600_000;
const ARCHIVE_CAP = 300;
const ref = (uid: string, chatId: string, name: string) => getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId).collection("brain").doc(name);

type Doc = { items?: Array<DecayMem & Record<string, unknown>>; lastSweepAt?: number };

/** Mark memories as used. Only ids that exist are touched. */
export async function touchMemories(uid: string, chatId: string, ids: string[], now = Date.now()): Promise<void> {
  if (!ids.length) return;
  const r = ref(uid, chatId, "memories");
  await getAdminDb().runTransaction(async (tx) => {
    const s = await tx.get(r);
    const d = s.data() as Doc | undefined;
    if (!d?.items?.length) return;
    tx.set(r, { items: touch(d.items, new Set(ids), now) }, { merge: true });
  });
}

/** Returns how many memories moved to the archive (0 when it ran less than a day ago). */
export async function sweepMemories(uid: string, chatId: string, now = Date.now()): Promise<number> {
  const r = ref(uid, chatId, "memories");
  const a = ref(uid, chatId, "archive");
  const moved = await getAdminDb().runTransaction(async (tx) => {
    const [s, as] = await Promise.all([tx.get(r), tx.get(a)]);
    const d = s.data() as Doc | undefined;
    if (!d?.items?.length || now - (d.lastSweepAt ?? 0) < SWEEP_EVERY_MS) return 0;
    const { active, dormant, archived } = sweep(d.items, now);
    const old = ((as.data() as Doc | undefined)?.items ?? []);
    tx.set(r, { items: [...active, ...dormant], lastSweepAt: now }, { merge: true });
    if (archived.length) tx.set(a, { items: [...old, ...archived.map((m) => ({ ...m, archivedAt: now }))].slice(-ARCHIVE_CAP) });
    return archived.length;
  });
  return moved;
}
