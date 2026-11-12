// A small stand-in for the whole server: the REAL store, slice logic, loop, cards and takeover rules, with a fake Firestore,
// a scripted model and fake tools. It plays the three roles the real system has: the worker (runs a slice), the owner (taps cards)
// and the scheduler (/api/agent/tick). Time is a variable, so "24 hours later" costs nothing.
import { fakeDb } from "./fake-db.mjs";
import { createStore } from "../../../lib/agent/store.ts";
import { DEFAULT_LOOP, newState } from "../../../lib/agent/loop.ts";
import { costCap, preflight, runSliceCore } from "../../../lib/agent/slice.ts";
import { planTick, replyFor } from "../../../lib/agent/actions.ts";
import { decline, startTakeover, beat, handBack, nextCheck, takeoverSeconds } from "../../../lib/agent/takeover.ts";
import { HITL_TOOLS } from "../../../lib/agent/hitl.ts";
import { paramsToSchema } from "../../../lib/agent/tool-schema.ts";
import { DEFAULT_COMPACT } from "../../../lib/agent/compaction.ts";

export const U = (i = 100, o = 50) => ({ inTok: i, outTok: o, cacheRead: 0, cacheWrite: 0 });
export const say = (text, usage = U()) => ({ text, calls: [], stop: "end", usage });
export const use = (...calls) => ({ text: "", calls: calls.map(([name, input, id], i) => ({ id: id ?? `c${i}_${Math.random().toString(36).slice(2, 5)}`, name, input })), stop: "tool_use", usage: U() });
export const TOOLS = [
  { name: "web.search", description: "search", schema: paramsToSchema("query:string"), risk: "read" },
  { name: "mail.send", description: "send mail", schema: paramsToSchema("to:string, body:string"), risk: "write" },
  { name: "db.write", description: "write a row", schema: paramsToSchema("row:string"), risk: "write" },
  ...HITL_TOOLS,
];
const UID = "u1";

export function platform({ script = [], tools = {}, sliceMs = 40_000, capBase, maxRounds = 60, windowTokens = 200_000 } = {}) {
  const { db, data } = fakeDb();
  const S = createStore(db);
  const P = { S, data, clock: 1_700_000_000_000, chat: [], notes: [], kicks: 0, vault: new Map(), toolLog: [], calls: [], queue: [...script], events: [], runId: "r1", hangOn: null, extraTime: 0 };
  P.at = (ms) => { P.clock += ms; };

  P.start = async (task = "do the job") => {
    const now = P.clock;
    await S.createRun(UID, {
      id: P.runId, chatId: "c1", task, provider: "anthropic", model: "claude-sonnet-4-5", keyRef: "vault:k", fallbacks: [], status: "queued", round: 0, createdAt: now, updatedAt: now,
      lease: null, pending: null, reply: null, usage: { inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0 }, costMicros: 0, calls: 0, compactions: 0, tainted: false,
      stateVer: 0, stateChunks: 0, maxRounds, slices: 0, origin: "https://x",
    });
    await S.saveState(UID, P.runId, newState(task));
    await S.setQueue(UID, P.runId, "run", now + 100_000);
    return P.runId;
  };

  /** The worker: one slice. Returns {status}. A "hang" in a tool or model call plays a process that was killed: no catch, no cleanup, lease stays. */
  P.slice = async ({ owner = "w" + Math.random().toString(36).slice(2, 5), reserve } = {}) => {
    const startedAt = P.clock;
    const run = await S.claimLease(UID, P.runId, owner, sliceMs + 25_000, startedAt);
    if (!run) return { status: "busy" };
    const emit = async (e) => { P.events.push(e); await S.addEvent(UID, P.runId, e, P.clock); };
    const finish = (patch, wake) => S.release(UID, P.runId, patch, wake);
    const cleanup = async () => {};
    let kill;
    const killed = new Promise((r) => { kill = r; });
    const hang = () => { kill({ status: "killed" }); return new Promise(() => {}); };
    const work = (async () => {
      try {
        const stop = await preflight({ S, run, uid: UID, runId: P.runId, startedAt, emit, finish, cleanup, maxSlices: 200 });
        if (stop) return stop;
        const state = (await S.loadState(UID, P.runId)) ?? newState(run.task);
        let stopAsked = false;
        const deps = {
          model: run.model, now: () => P.clock, sleep: async (ms) => { P.clock += ms; }, emit,
          save: (s) => S.saveState(UID, P.runId, s),
          shouldStop: async () => (stopAsked ||= Boolean((await S.getRun(UID, P.runId))?.stopRequested)),
          summarize: async () => "SUMMARY", reserve, step: (r) => { void S.addStep(UID, P.runId, r); },
          callModel: async (req) => {
            P.calls.push(JSON.parse(JSON.stringify(req)));
            if (P.hangOn === "model" || (P.hangModelAt && P.calls.length === P.hangModelAt)) { P.hangOn = null; P.hangModelAt = 0; return hang(); }
            const next = P.queue.shift();
            if (!next) throw new Error("script ran out");
            if (next instanceof Error) throw next;
            P.at(P.extraTime);
            return typeof next === "function" ? next(req) : next;
          },
          runTool: async (name, input, flags) => {
            P.toolLog.push({ name, input, ...flags });
            if (P.hangOn === name) { P.hangOn = null; return hang(); }
            const t = tools[name];
            P.at(P.toolMs ?? 0);
            return t ? t(input, flags) : { ok: true, text: `ok:${name}` };
          },
        };
        const opts = { ...DEFAULT_LOOP, tools: TOOLS, system: { stable: "S", volatile: "V" }, maxRounds: run.maxRounds, deadline: startedAt + sliceMs, maxCostMicros: costCap(run, capBase), compact: { ...DEFAULT_COMPACT, windowTokens } };
        return await runSliceCore({
          S, run, uid: UID, runId: P.runId, startedAt, state, deps, opts, emit, finish, cleanup,
          io: { postToChat: async (t, at) => { P.chat.push({ t, at }); }, notify: (t) => P.notes.push(t), kick: () => { P.kicks++; }, afterDone: () => {}, link: "https://x/dashboard" },
        });
      } catch (e) {
        await emit({ kind: "error", text: String(e.message) });
        await finish({ status: "error", endedAt: P.clock, error: { code: "x", message: String(e.message) } }, null);
        return { status: "error" };
      }
    })();
    return Promise.race([work, killed]);
  };

  /** Run slices until the run is at rest (done / error / stopped / budget / paused) or `max` slices. */
  P.drive = async (max = 30) => {
    let last = { status: "none" };
    for (let i = 0; i < max; i++) {
      last = await P.slice();
      if (!["continue", "busy"].includes(last.status)) break;
    }
    return last;
  };

  P.run = () => S.getRun(UID, P.runId);

  /** The owner taps a card. */
  P.owner = async (body) => {
    const run = await P.run();
    if (run.status !== "paused" || !run.pending) throw new Error("no card is waiting");
    const ans = replyFor(run.pending, body, run.chatId);
    if (ans.secret) P.vault.set(ans.secret.name, ans.secret.value);
    await S.patchRun(UID, P.runId, { reply: ans.reply, ...(ans.declineTakeover ? { takeover: decline(run.takeover ?? undefined, P.clock) } : {}) });
    await S.setQueue(UID, P.runId, "run", P.clock + 90_000);
    return ans;
  };
  P.takeoverStart = async () => { const r = await P.run(); const t = startTakeover(r.takeover, P.clock); await S.patchRun(UID, P.runId, { takeover: t }); await S.setQueue(UID, P.runId, "takeover", nextCheck(t)); return t; };
  P.takeoverBeat = async () => { const r = await P.run(); const t = beat(r.takeover, P.clock); await S.patchRun(UID, P.runId, { takeover: t }); await S.setQueue(UID, P.runId, "takeover", nextCheck(t)); return t; };
  P.takeoverHandBack = async (note = "") => {
    const r = await P.run(); const t = handBack(r.takeover, P.clock, "owner");
    await S.patchRun(UID, P.runId, { reply: { action: "takeover_done", seconds: takeoverSeconds(t), note, reason: r.pending.summary.slice(0, 80) }, takeover: t });
    await S.setQueue(UID, P.runId, "run", P.clock + 90_000);
  };

  /** The scheduler: what /api/agent/tick does with everything that is due. Returns what it did. */
  P.tick = async () => {
    const did = [];
    for (const q of await S.dueQueue(P.clock, 25)) {
      const run = await S.getRun(q.uid, q.id);
      const plan = planTick(run, run?.status === "budget" ? await S.readLatch(q.uid) : null, P.clock);
      did.push(plan.do === "answer" ? `answer:${plan.counted}` : plan.do);
      switch (plan.do) {
        case "clear": await S.clearQueue(q.id); break;
        case "resume": await S.setQueue(q.uid, q.id, "run", P.clock + 90_000); break;
        case "wait": await S.setQueue(q.uid, q.id, plan.kind, plan.at); break;
        case "requeue": await S.patchRun(q.uid, q.id, { status: "queued", error: null }); await S.setQueue(q.uid, q.id, "run", P.clock + 90_000); break;
        case "answer": await S.patchRun(q.uid, q.id, { reply: plan.reply, ...(plan.takeover ? { takeover: plan.takeover } : {}) }); await S.setQueue(q.uid, q.id, "run", P.clock + 90_000); break;
      }
    }
    return did;
  };
  return P;
}
