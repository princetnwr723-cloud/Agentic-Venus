// Small server helper so API routes can ask "is this owner's budget latched?" without loading the whole worker.
import { getAdminDb } from "@/lib/firebase-admin";
import { createStore, type DbLike } from "./store.ts";
import { describeLatch, latchActive } from "./budget.ts";

/** null = free to run. Otherwise the text that explains why the run is skipped and until when. */
export async function latchReason(uid: string, now = Date.now()): Promise<{ until: number; text: string } | null> {
  const l = await createStore(getAdminDb() as unknown as DbLike).readLatch(uid);
  return latchActive(l, now) ? { until: l.until, text: describeLatch(l, now) } : null;
}
