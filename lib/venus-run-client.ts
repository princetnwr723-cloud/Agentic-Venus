// Browser side of the background Venus Pro runs: start one, stop one, watch the ones of a chat.
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { VenusProject } from "@/lib/venus";

export type VenusRunView = {
  id: string; chatId: string; title: string; status: "queued" | "running" | "done" | "error" | "stopped"; stage: string;
  label: string; value: number | null; error: string | null; createdAt: number; updatedAt: number;
};
export const isVenusActive = (r: Pick<VenusRunView, "status">) => r.status === "queued" || r.status === "running";

type Reply = { ok?: boolean; error?: string; runId?: string };

/** `status` 0 = the server could not be reached at all (the caller may fall back to running in the browser). */
export async function startVenusServer(uid: string, chatId: string, project: VenusProject): Promise<{ ok: true; runId: string } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch("/api/venus/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid, action: "start", chatId, project }) });
    const d = (await res.json().catch(() => ({}))) as Reply;
    if (res.ok && d.ok && d.runId) return { ok: true, runId: d.runId };
    return { ok: false, status: res.status, error: d.error || "The video could not be started." };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "The server could not be reached." };
  }
}
export async function stopVenusServer(uid: string, runId: string): Promise<void> {
  await fetch("/api/venus/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid, action: "stop", runId }) }).catch(() => {});
}
/** Equality filter only, so no composite index is needed. */
export function watchVenusRuns(uid: string, chatId: string, on: (r: VenusRunView[]) => void): () => void {
  const q = query(collection(db, "users", uid, "venusRuns"), where("chatId", "==", chatId), limit(8));
  return onSnapshot(q, (s) => on(s.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as VenusRunView).sort((a, b) => b.createdAt - a.createdAt)), () => on([]));
}
