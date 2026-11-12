// Firestore persistence of agent runs (server only, Admin SDK). The browser may READ users/{uid}/runs/** (see firestore.rules)
// and never writes it. The Db is injected so this file runs against a fake in the tests.
//   users/{uid}/runs/{id}                run document (status, pending card, usage, lease ...)
//   users/{uid}/runs/{id}/chunks/{v_i}   the run state as JSON, cut in pieces (one document is limited to 1 MB)
//   users/{uid}/runs/{id}/events/{t_r}   what the owner sees live
//   users/{uid}/runs/{id}/live/now       the answer being typed right now (streaming)
//   users/{uid}/runs/{id}/steps/{n}      one row per model call: tokens, cost, ms, tools
//   agentQueue/{id}                      who has to be woken up (expired lease, takeover timer, pending card timeout)
//   users/{uid}/billing/latch            the budget latch
import type { AgentEvent, Latch, Pending, Reply, RunState, RunStatus, Usage } from "./types.ts";
import type { Takeover } from "./takeover.ts";
import type { StepRow } from "./loop.ts";

type Snap = { exists: boolean; id: string; data(): any };
type DocRef = { get(): Promise<Snap>; set(d: any, o?: { merge?: boolean }): Promise<unknown>; update(d: any): Promise<unknown>; delete(): Promise<unknown>; collection(n: string): ColRef };
type Query = { where(f: string, op: string, v: unknown): Query; orderBy(f: string, dir?: "asc" | "desc"): Query; limit(n: number): Query; get(): Promise<{ docs: Snap[] }> };
type ColRef = Query & { doc(id?: string): DocRef };
type Tx = { get(r: DocRef): Promise<Snap>; set(r: DocRef, d: any, o?: { merge?: boolean }): unknown; update(r: DocRef, d: any): unknown; delete(r: DocRef): unknown };
export type DbLike = { collection(n: string): ColRef; runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> };

export type KeyRef = { provider: string; model: string; keyRef: string };
export type RunDoc = {
  id: string; chatId: string; task: string; provider: string; model: string; keyRef: string; fallbacks: KeyRef[];
  /** vault entry made only for this run (deleted when it ends) */
  tempKey?: string;
  status: RunStatus; round: number; createdAt: number; updatedAt: number; endedAt?: number;
  lease: { owner: string; until: number } | null;
  stopRequested?: boolean;
  pending: Pending | null; reply: Reply | null; takeover?: Takeover | null;
  usage: Usage; costMicros: number; calls: number; compactions: number; tainted: boolean;
  stateVer: number; stateChunks: number;
  result?: string; error?: { code: string; message: string } | null;
  maxRounds: number; slices: number; origin?: string; routineId?: string;
  /** how many extra cost allowances the owner granted with "Continue" after the per-run cost cap stopped the run */
  costExtra?: number;
};

export const CHUNK_CHARS = 180_000;
const PRIVATE_DONE: RunStatus[] = ["done", "error", "stopped", "budget"];
export const isFinished = (s: RunStatus) => PRIVATE_DONE.includes(s);

export function createStore(db: DbLike) {
  const runs = (uid: string) => db.collection("users").doc(uid).collection("runs");
  const run = (uid: string, id: string) => runs(uid).doc(id);
  const queue = () => db.collection("agentQueue");
  const latchDoc = (uid: string) => db.collection("users").doc(uid).collection("billing").doc("latch");

  const createRun = async (uid: string, d: RunDoc) => { await run(uid, d.id).set(d); return d; };
  const getRun = async (uid: string, id: string): Promise<RunDoc | null> => { const s = await run(uid, id).get(); return s.exists ? (s.data() as RunDoc) : null; };
  const patchRun = async (uid: string, id: string, patch: Partial<RunDoc> & Record<string, unknown>) => { await run(uid, id).update({ ...patch, updatedAt: Date.now() }); };

  /** The run state, in pieces, under a new version; the pointer moves last, the old pieces are removed after. */
  async function saveState(uid: string, id: string, s: RunState): Promise<void> {
    const json = JSON.stringify(s);
    const cur = await getRun(uid, id);
    const ver = (cur?.stateVer ?? 0) + 1;
    const n = Math.max(1, Math.ceil(json.length / CHUNK_CHARS));
    const col = run(uid, id).collection("chunks");
    for (let i = 0; i < n; i++) await col.doc(`${ver}_${i}`).set({ d: json.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) });
    await patchRun(uid, id, {
      stateVer: ver, stateChunks: n, round: s.round, usage: s.usage, costMicros: s.costMicros, calls: s.calls, compactions: s.compactions, tainted: s.tainted, pending: s.pending,
    });
    if (cur && cur.stateChunks) for (let i = 0; i < cur.stateChunks; i++) await col.doc(`${cur.stateVer}_${i}`).delete().catch(() => {});
  }

  async function loadState(uid: string, id: string): Promise<RunState | null> {
    const r = await getRun(uid, id);
    if (!r || !r.stateChunks) return null;
    const col = run(uid, id).collection("chunks");
    let json = "";
    for (let i = 0; i < r.stateChunks; i++) {
      const s = await col.doc(`${r.stateVer}_${i}`).get();
      if (!s.exists) throw new Error("The saved run state is incomplete.");
      json += (s.data() as { d: string }).d;
    }
    return JSON.parse(json) as RunState;
  }

  const addEvent = async (uid: string, id: string, e: AgentEvent, now = Date.now()) => {
    const key = `${String(now).padStart(13, "0")}_${Math.random().toString(36).slice(2, 6)}`;
    await run(uid, id).collection("events").doc(key).set({ t: now, kind: e.kind, text: e.text.slice(0, 1500), ...(e.data ? { data: JSON.parse(JSON.stringify(e.data)) } : {}) });
  };
  /** The answer while it is being written. One small document, replaced about once a second; deleted when the model call ends. */
  const setLive = async (uid: string, id: string, text: string, round: number) => { await run(uid, id).collection("live").doc("now").set({ text, round, at: Date.now() }); };
  const clearLive = async (uid: string, id: string) => { await run(uid, id).collection("live").doc("now").delete().catch(() => {}); };
  const addStep = async (uid: string, id: string, row: StepRow) => { await run(uid, id).collection("steps").doc(String(row.round).padStart(4, "0") + "_" + Math.random().toString(36).slice(2, 5)).set({ ...row, at: Date.now() }); };

  const setQueue = async (uid: string, id: string, kind: "run" | "takeover" | "expire", wakeAt: number) => { await queue().doc(id).set({ uid, kind, wakeAt }); };
  const clearQueue = async (id: string) => { await queue().doc(id).delete().catch(() => {}); };
  const dueQueue = async (now: number, limit = 20): Promise<Array<{ id: string; uid: string; kind: string; wakeAt: number }>> => {
    const s = await queue().where("wakeAt", "<", now).limit(limit).get();
    return s.docs.map((d) => ({ id: d.id, ...(d.data() as { uid: string; kind: string; wakeAt: number }) }));
  };

  /** Only ONE worker runs a slice at a time. Returns the run when the lease is yours, otherwise null. */
  async function claimLease(uid: string, id: string, owner: string, ttlMs: number, now = Date.now()): Promise<RunDoc | null> {
    const ref = run(uid, id);
    const got = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return null;
      const r = s.data() as RunDoc;
      if (isFinished(r.status)) return null;
      if (r.status === "paused" && !r.reply) return null;
      if (r.lease && r.lease.until > now && r.lease.owner !== owner) return null;
      const next: RunDoc = { ...r, status: "running", lease: { owner, until: now + ttlMs }, updatedAt: now, slices: (r.slices ?? 0) + 1 };
      tx.update(ref, { status: "running", lease: next.lease, updatedAt: now, slices: next.slices });
      return next;
    });
    if (got) await setQueue(uid, id, "run", now + ttlMs);
    return got;
  }

  /** The slice is over: free the lease, set the final status and tell the scheduler when to look again (or never). */
  async function release(uid: string, id: string, patch: Partial<RunDoc> & Record<string, unknown>, wake: { kind: "run" | "takeover" | "expire"; at: number } | null) {
    await patchRun(uid, id, { ...patch, lease: null });
    if (wake) await setQueue(uid, id, wake.kind, wake.at); else await clearQueue(id);
  }

  const listRuns = async (uid: string, limit = 50): Promise<RunDoc[]> => (await runs(uid).orderBy("createdAt", "desc").limit(limit).get()).docs.map((d) => d.data() as RunDoc);

  const readLatch = async (uid: string): Promise<Latch | null> => { const s = await latchDoc(uid).get(); return s.exists ? (s.data() as Latch) : null; };
  const armLatch = async (uid: string, l: Latch) => { await latchDoc(uid).set(l); };
  const clearLatch = async (uid: string) => { await latchDoc(uid).delete().catch(() => {}); };

  return { createRun, getRun, patchRun, saveState, loadState, addEvent, addStep, setLive, clearLive, setQueue, clearQueue, dueQueue, claimLease, release, listRuns, readLatch, armLatch, clearLatch };
}
export type Store = ReturnType<typeof createStore>;
