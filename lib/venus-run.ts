// Server-side Venus Pro runs, free of Next / Firebase / the network (the real wiring is lib/venus-run-server.ts).
// A video is made by the SAME pipeline as in the browser (lib/venus-pipeline.ts), cut into time slices of about a minute:
//   claim the lease -> replay the saved answers (journal) -> go on from the saved stage -> save -> yield -> next slice
// The browser tab, the phone, the laptop can be gone: nothing here needs them.
import type { DbLike } from "./agent/store.ts";
import { callKey, createJournal, type Journal, type JournalEntry, type JournalStore } from "./venus-journal.ts";
import type { PipelineEnv, PipelineHooks } from "./venus-pipeline.ts";
import type { VenusProject } from "./venus.ts";

export const STAGE_ORDER = ["studio", "ingest", "script", "design", "assets", "voice", "preview", "review", "final", "done"] as const;
const stageIdx = (s: string) => Math.max(0, STAGE_ORDER.indexOf(s as (typeof STAGE_ORDER)[number]));

export type VenusRunStatus = "queued" | "running" | "done" | "error" | "stopped";
export type VenusRunDoc = {
  id: string; chatId: string; title: string; status: VenusRunStatus; stage: string;
  createdAt: number; updatedAt: number; endedAt?: number;
  lease: { owner: string; until: number } | null;
  slices: number; origin: string;
  label?: string; value?: number | null; error?: string | null;
  stopRequested?: boolean; finalPath?: string; postedAt?: number;
  /** who asked: the chat, the server agent or a routine (a routine / agent run reports in its own words) */
  source?: "chat" | "agent" | "routine";
  /** no chat message when it ends (the caller reports it itself) */
  quiet?: boolean;
};

export const isEnded = (s: VenusRunStatus) => s === "done" || s === "error" || s === "stopped";
export const MAX_SLICES = 400;

// ---------------------------------------------------------------- storage
export function createVenusStore(db: DbLike) {
  const runs = (uid: string) => db.collection("users").doc(uid).collection("venusRuns");
  const run = (uid: string, id: string) => runs(uid).doc(id);
  const queue = () => db.collection("venusQueue");

  const getRun = async (uid: string, id: string): Promise<VenusRunDoc | null> => { const s = await run(uid, id).get(); return s.exists ? (s.data() as VenusRunDoc) : null; };
  const createRun = async (uid: string, d: VenusRunDoc) => { await run(uid, d.id).set(d); };
  const patchRun = async (uid: string, id: string, patch: Record<string, unknown>) => { await run(uid, id).update({ ...patch, updatedAt: Date.now() }); };
  const setQueue = async (uid: string, id: string, wakeAt: number) => { await queue().doc(id).set({ uid, wakeAt }); };
  const clearQueue = async (id: string) => { await queue().doc(id).delete().catch(() => {}); };
  const dueQueue = async (now: number, limit = 20): Promise<Array<{ id: string; uid: string; wakeAt: number }>> => {
    const s = await queue().where("wakeAt", "<", now).limit(limit).get();
    return s.docs.map((d) => ({ id: d.id, ...(d.data() as { uid: string; wakeAt: number }) }));
  };
  const listRuns = async (uid: string, limit = 30): Promise<VenusRunDoc[]> => (await runs(uid).orderBy("createdAt", "desc").limit(limit).get()).docs.map((d) => d.data() as VenusRunDoc);

  /** Only ONE worker runs a slice at a time. */
  async function claimLease(uid: string, id: string, owner: string, ttlMs: number, now: number): Promise<VenusRunDoc | null> {
    const ref = run(uid, id);
    const got = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return null;
      const r = s.data() as VenusRunDoc;
      if (isEnded(r.status)) return null;
      if (r.lease && r.lease.until > now && r.lease.owner !== owner) return null;
      const next: VenusRunDoc = { ...r, status: "running", lease: { owner, until: now + ttlMs }, updatedAt: now, slices: (r.slices ?? 0) + 1 };
      tx.update(ref, { status: "running", lease: next.lease, updatedAt: now, slices: next.slices });
      return next;
    });
    if (got) await setQueue(uid, id, now + ttlMs);
    return got;
  }
  async function release(uid: string, id: string, patch: Record<string, unknown>, wakeAt: number | null) {
    await patchRun(uid, id, { ...patch, lease: null });
    if (wakeAt) await setQueue(uid, id, wakeAt); else await clearQueue(id);
  }

  /** The journal of one run: users/{uid}/venusRuns/{id}/journal/{hash}_{n} */
  const journalStore = (uid: string, id: string): JournalStore => {
    const col = () => run(uid, id).collection("journal");
    const docId = (e: { k: string; n: number }) => `${e.k.replace(/[^A-Za-z0-9]/g, "_").slice(-60)}_${e.k.length}_${e.n}`;
    return {
      load: async () => (await col().get()).docs.map((d) => d.data() as JournalEntry),
      put: async (e) => { await col().doc(docId(e)).set(e); },
      clear: async () => { for (const d of (await col().get()).docs) await col().doc(d.id).delete().catch(() => {}); },
    };
  };
  const addLog = async (uid: string, id: string, text: string, now = Date.now()) => {
    await run(uid, id).collection("log").doc(`${String(now).padStart(13, "0")}_${Math.random().toString(36).slice(2, 6)}`).set({ t: now, text: text.slice(0, 400) });
  };
  return { getRun, createRun, patchRun, setQueue, clearQueue, dueQueue, listRuns, claimLease, release, journalStore, addLog };
}
export type VenusStore = ReturnType<typeof createVenusStore>;

// ---------------------------------------------------------------- the journaled transport
/** Calls that cost time or money and give the same answer again: they are written to the journal. Everything else (status, progress, files) is asked live. */
export function isJournaled(path: string, body: Record<string, unknown>): boolean {
  if (path === "/api/venus/ai") return true;
  if (path === "/api/venus/template") return body.action === "save";
  if (path === "/api/venus/studio") return ["prepare", "assets", "tts", "pullasset", "compose", "music", "render", "concat", "upload", "ingest-start", "ingest-read"].includes(String(body.action));
  return false;
}

export type Ctl = { t0: number; yielded: boolean; stopped: boolean; /** heavy calls made live (not replayed) in this slice */ heavy: number };
export type Raw = (path: string, body: Record<string, unknown>, timeoutMs: number) => Promise<{ ok: boolean; status: number; data: any }>;
export type Timing = {
  /** the function is killed after this (Vercel maxDuration, minus a safety margin) */
  hardMs: number;
  /** the FIRST heavy call of a slice may start this late (slice set-up takes a few seconds, a slice must always make progress) */
  firstHeavyMs: number;
  /** every further heavy call only in the first moments, so that it has the whole minute for itself */
  heavyStartMs: number;
  /** after this the slice only finishes what it is doing: no new calls, the pipeline yields */
  yieldAfterMs: number;
};
export const DEFAULT_TIMING: Timing = { hardMs: 56_000, firstHeavyMs: 12_000, heavyStartMs: 7_000, yieldAfterMs: 30_000 };

const STOPPED = () => new Error("Stopped.");

export function makeApi(o: { journal: Journal; ctl: Ctl; raw: Raw; now: () => number; timing?: Timing }) {
  const T = o.timing ?? DEFAULT_TIMING;
  const elapsed = () => o.now() - o.ctl.t0;
  const yieldNow = (): never => { o.ctl.yielded = true; throw STOPPED(); };
  const live = async (path: string, body: Record<string, unknown>) => {
    try { return await o.raw(path, body, Math.max(4_000, T.hardMs - elapsed())); }
    catch (e) {
      // the request ran into the end of this slice: nothing failed, the next slice asks again
      if (elapsed() >= T.hardMs - 2_000 || /abort|timeout|timed out/i.test(String((e as Error)?.message))) yieldNow();
      throw e;
    }
  };
  return async (path: string, body: Record<string, unknown>) => {
    if (o.ctl.stopped) throw STOPPED();
    if (!isJournaled(path, body)) {
      if (elapsed() > T.yieldAfterMs) yieldNow();
      return live(path, body);
    }
    const key = callKey(path, body);
    if (!o.journal.wouldReplay(key) && elapsed() > (o.ctl.heavy === 0 ? T.firstHeavyMs : T.heavyStartMs)) yieldNow();
    const { value } = await o.journal.call(key, async () => { o.ctl.heavy++; return live(path, body); }, (r) => r.ok && !r.data?.retry && !r.data?.error);
    return value;
  };
}

// ---------------------------------------------------------------- one slice
export type PipelineFn = (env: PipelineEnv, hooks: PipelineHooks, start: VenusProject, from: VenusProject["stage"]) => Promise<VenusProject>;
export type CoreEnvParts = { api: (path: string, body: Record<string, unknown>) => Promise<{ ok: boolean; status: number; data: any }>; saveProject: (uid: string, p: VenusProject) => Promise<void>; rand: () => number };

export type SliceArgs = {
  S: VenusStore; uid: string; pid: string; owner: string; now: () => number;
  timing?: Timing;
  pipeline: PipelineFn;
  loadProject: () => Promise<VenusProject | null>;
  saveProject: (p: VenusProject) => Promise<void>;
  /** the server's own pieces of the pipeline environment (keys, computers, transport) */
  makeEnv: (parts: CoreEnvParts, project: VenusProject) => PipelineEnv;
  raw: Raw;
  makeRand: (seed: string) => () => number;
  /** poll the stop flag about this often (ms) */
  stopEveryMs?: number;
  io: {
    /** the chat message for the finished (or failed) video. `url` = a download link or "" */
    postToChat: (text: string, at: number) => Promise<void>;
    notify: (text: string) => void;
    kick: () => void;
    downloadUrl: (path: string) => Promise<string>;
    link: string;
  };
};

export const endMessage = (p: Pick<VenusProject, "id" | "title" | "error">, ok: boolean, url: string) =>
  ok
    ? `✅ Your video is ready: **${p.title}**.\n\n- [Open and edit it in Venus Pro](/venus?project=${p.id})${url ? `\n- [Download the video](${url})` : ""}`
    : `⚠️ The video could not be finished: ${p.error ?? "unknown error"}\n\n[Open it in Venus Pro](/venus?project=${p.id}) to retry from the failed step.`;

export async function runVenusSlice(a: SliceArgs): Promise<{ status: "busy" | "continue" | "done" | "error" | "stopped" }> {
  const { S, uid, pid } = a;
  const T = a.timing ?? DEFAULT_TIMING;
  const t0 = a.now();
  const run = await S.claimLease(uid, pid, a.owner, T.hardMs + 30_000, t0);
  if (!run) return { status: "busy" };

  const ctl: Ctl = { t0, yielded: false, stopped: Boolean(run.stopRequested), heavy: 0 };
  const elapsed = () => a.now() - t0;
  let stopTimer: ReturnType<typeof setInterval> | null = null;
  let project: VenusProject | null = null;
  const pending: Promise<unknown>[] = [];
  try {
    if ((run.slices ?? 0) > MAX_SLICES) throw new Error("This video took too many steps and was stopped.");
    project = await a.loadProject();
    if (!project) throw new Error("The video project was not found.");

    const journal = await createJournal(S.journalStore(uid, pid));
    let curIdx = stageIdx(run.stage);

    stopTimer = setInterval(() => { void S.getRun(uid, pid).then((r) => { if (r?.stopRequested) ctl.stopped = true; }).catch(() => {}); }, a.stopEveryMs ?? 2_500);

    let lastProgress = 0;
    const hooks: PipelineHooks = {
      log: (m) => { pending.push(S.addLog(uid, pid, m, a.now()).catch(() => {}), S.patchRun(uid, pid, { label: m.slice(0, 120) }).catch(() => {})); },
      progress: (p) => {
        if (!p || a.now() - lastProgress < 3_000) return;
        lastProgress = a.now();
        pending.push(S.patchRun(uid, pid, { label: p.label.slice(0, 120), value: p.value }).catch(() => {}));
      },
      update: () => {},
      cancelled: () => ctl.stopped || ctl.yielded || elapsed() > T.yieldAfterMs,
      yielded: () => !ctl.stopped && (ctl.yielded || elapsed() > T.yieldAfterMs),
    };

    // every save of the project also notices when a NEW stage has begun: from then on the old stage's saved answers are not needed
    const saveProject = async (_uid: string, p: VenusProject) => {
      await a.saveProject(p);
      const idx = stageIdx(p.stage);
      if (idx > curIdx) { curIdx = idx; await journal.clear(); await S.patchRun(uid, pid, { stage: p.stage }); }
    };
    const api = makeApi({ journal, ctl, raw: a.raw, now: a.now, timing: T });
    const env = a.makeEnv({ api, saveProject, rand: a.makeRand(`${pid}:${run.stage}`) }, project);

    const from = (STAGE_ORDER[curIdx] ?? "studio") as VenusProject["stage"];
    const out = await a.pipeline(env, hooks, { ...project, status: "running" }, from);
    await Promise.all(pending);

    const now = a.now();
    if (out.status === "done" && out.finalPath) {
      await S.release(uid, pid, { status: "done", stage: "done", endedAt: now, finalPath: out.finalPath, error: null, label: "Done", value: 1, stopRequested: false }, null);
      await journal.clear();
      if (!run.quiet) await finishPost(a, run, out, true);
      return { status: "done" };
    }
    if (out.status === "error" || out.status === "done") {
      const stopped = ctl.stopped;
      await S.release(uid, pid, { status: stopped ? "stopped" : "error", endedAt: now, error: stopped ? null : out.error ?? "The video failed.", stopRequested: false }, null);
      await journal.clear();
      if (!stopped && !run.quiet) await finishPost(a, run, out, false);
      return { status: stopped ? "stopped" : "error" };
    }
    // time slice over: save the stage and go on in the next slice
    await S.release(uid, pid, { status: "queued", stage: STAGE_ORDER[curIdx] }, now + 90_000);
    a.io.kick();
    return { status: "continue" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The video failed.";
    await Promise.all(pending).catch(() => {});
    const fail = { id: pid, title: run.title, error: msg };
    await S.release(uid, pid, { status: "error", endedAt: a.now(), error: msg, stopRequested: false }, null).catch(() => {});
    if (!run.quiet) await finishPost(a, run, fail, false).catch(() => {});
    return { status: "error" };
  } finally {
    if (stopTimer) clearInterval(stopTimer);
  }
}

async function finishPost(a: SliceArgs, run: VenusRunDoc, p: Pick<VenusProject, "id" | "title" | "error"> & { finalPath?: string }, ok: boolean) {
  const url = ok && p.finalPath ? await a.io.downloadUrl(p.finalPath).catch(() => "") : "";
  const text = endMessage(p, ok, url);
  const at = a.now();
  await a.io.postToChat(text, at);
  await a.S.patchRun(a.uid, a.pid, { postedAt: at }).catch(() => {});
  a.io.notify(ok ? `Your video "${p.title}" is ready.\n${a.io.link}` : `Your video "${p.title}" failed: ${String(p.error ?? "").slice(0, 300)}\n${a.io.link}`);
}

// ---------------------------------------------------------------- the scheduler
export type VenusTickPlan = { do: "clear" } | { do: "resume" } | { do: "wait"; at: number } | { do: "post" };
export function planVenusTick(run: VenusRunDoc | null, now: number): VenusTickPlan {
  if (!run) return { do: "clear" };
  if (isEnded(run.status)) return run.status === "done" && !run.postedAt && !run.quiet && now - (run.endedAt ?? now) < 6 * 3600_000 ? { do: "post" } : { do: "clear" };
  if (run.status === "running" && run.lease && run.lease.until > now) return { do: "wait", at: run.lease.until };
  return { do: "resume" };
}
