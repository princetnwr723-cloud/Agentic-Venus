// Small server helper so API routes can ask "is this owner's budget latched?" without loading the whole worker.
import { getAdminDb } from "@/lib/firebase-admin";
import { isOwner } from "@/lib/owner";
import { createStore, type DbLike } from "./store.ts";
import { describeLatch, latchActive } from "./budget.ts";

/**
 * null = free to run. Otherwise the text that explains why the run is skipped and until when.
 * The OWNER of the deployment is never held by a PLAN or COST latch (a leftover one is deleted on the spot).
 * A provider latch (your own AI key says "quota used up") is real and stays: no code can lift a limit the provider sets.
 */
export async function latchReason(uid: string, now = Date.now()): Promise<{ until: number; text: string } | null> {
  const store = createStore(getAdminDb() as unknown as DbLike);
  const l = await store.readLatch(uid);
  if (!latchActive(l, now)) return null;
  if (l.kind !== "provider" && (await isOwner(uid))) { await store.clearLatch(uid).catch(() => {}); return null; }
  return { until: l.until, text: describeLatch(l, now) };
}
