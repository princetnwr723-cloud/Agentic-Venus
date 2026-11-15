// Server-side Venus Pro: a video that takes many minutes is made by many ~1 minute slices, nothing is paid twice, nothing is lost.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.mjs";
import { createVenusStore, runVenusSlice, planVenusTick, isJournaled, makeApi, DEFAULT_TIMING } from "../../lib/venus-run.ts";
import { callKey, createJournal, seededRandom } from "../../lib/venus-journal.ts";

const STAGES = ["studio", "script", "design", "assets", "preview", "final"];

/** A stand-in for runPipeline: the same shape (stages, saves, heavy calls through env.io.api, polling a job, yield on the time slice). */
function fakePipeline() {
  return async (env, hooks, start, from) => {
    let p = { ...start };
    const save = async (patch) => { p = { ...p, ...patch }; await env.io.saveProject(env.uid, p); };
    const call = async (path, body) => { const r = await env.io.api(path, body); if (!r.ok) throw new Error(r.data?.error || "failed"); return r.data; };
    const poll = async (jobId) => { for (;;) { if (hooks.cancelled()) throw new Error("Stopped."); const r = await call("/api/venus/studio", { action: "progress", jobId }); if (r.done) return; } };
    try {
      for (const st of STAGES.slice(STAGES.indexOf(from))) {
        if (hooks.cancelled()) throw new Error("Stopped.");
        await save({ stage: st });
        if (st === "studio") await call("/api/venus/studio", { action: "status" });
        if (st === "script") await save({ storyboardJson: (await call("/api/venus/ai", { kind: "storyboard", brief: p.brief, apiKey: "secret" })).text });
        if (st === "design") { const codes = []; for (let i = 0; i < 3; i++) codes.push((await call("/api/venus/ai", { kind: "scene", i, sb: p.storyboardJson })).text); await save({ designJson: codes.join("|") }); }
        if (st === "assets") await call("/api/venus/studio", { action: "assets" });
        if (st === "preview" || st === "final") { const j = await call("/api/venus/studio", { action: "render", kind: st }); await poll(j.jobId); }
      }
      await save({ stage: "done", status: "done", finalPath: "u1/final.mp4" });
    } catch (e) {
      if (hooks.yielded?.()) return { ...p, status: "running" };
      return { ...p, status: "error", error: e.message };
    }
    return p;
  };
}

function rig(o = {}) {
  const { db } = fakeDb(); const S = createVenusStore(db);
  let clock = 1_000_000; let project = { id: "v1", title: "My video", brief: "about cats", status: "running", stage: "studio" };
  const chat = []; const live = {}; const sliceLive = []; let kicks = 0, counter = 0, polls = {};
  const raw = async (path, body, timeoutMs) => {
    const key = path + ":" + (body.action ?? body.kind);
    live[key] = (live[key] ?? 0) + 1; sliceLive[sliceLive.length - 1] = (sliceLive[sliceLive.length - 1] ?? 0) + 1;
    if (o.failOn && key === o.failOn) return { ok: false, status: 500, data: { error: "provider exploded" } };
    if (o.timeoutOn && key === o.timeoutOn && !o.timeoutDone) { o.timeoutDone = true; clock += 60_000; throw new Error("The operation was aborted due to timeout"); }
    if (path === "/api/venus/ai") { clock += 20_000; return { ok: true, status: 200, data: { text: `${body.kind}-${++counter}` } }; }
    if (body.action === "render") { clock += 2_000; return { ok: true, status: 200, data: { jobId: "job-" + body.kind } }; }
    if (body.action === "progress") { clock += 3_500; polls[body.jobId] = (polls[body.jobId] ?? 0) + 1; return { ok: true, status: 200, data: { done: polls[body.jobId] >= 12 } }; }
    clock += 1_000; return { ok: true, status: 200, data: { ok: true } };
  };
  const slice = (owner = "o1") => { sliceLive.push(0); return runVenusSlice({
    S, uid: "u1", pid: "v1", owner, now: () => clock, raw, pipeline: fakePipeline(), makeRand: seededRandom, stopEveryMs: 5,
    loadProject: async () => structuredClone(project), saveProject: async (p) => { project = structuredClone(p); },
    makeEnv: (parts) => ({ uid: "u1", token: async () => "", e2bKey: "k", apiKeys: {}, pexels: false, io: { api: parts.api, saveProject: parts.saveProject, rand: parts.rand } }),
    io: { postToChat: async (t) => { chat.push(t); }, notify: () => {}, kick: () => { kicks++; }, downloadUrl: async () => "https://dl.example/video.mp4", link: "x" },
  }); };
  const start = () => S.createRun("u1", { id: "v1", chatId: "c1", title: "My video", status: "queued", stage: "studio", createdAt: clock, updatedAt: clock, lease: null, slices: 0, origin: "https://x", ...(o.run ?? {}) });
  const drive = async (max = 60) => { let r; for (let i = 0; i < max; i++) { r = await slice(); if (r.status !== "continue") return { r, slices: i + 1 }; clock += 1_000; } return { r, slices: max }; };
  return { S, start, slice, drive, chat, live, sliceLive, get project() { return project; }, get kicks() { return kicks; }, tick: (n) => { clock += n; }, get clock() { return clock; } };
}

test("a long video is made across many slices, every expensive call exactly once", async () => {
  const t = rig(); await t.start();
  const { r, slices } = await t.drive();
  assert.equal(r.status, "done");
  assert.ok(slices >= 4, "needed several slices, got " + slices);
  for (const k of ["/api/venus/ai:storyboard", "/api/venus/ai:scene", "/api/venus/studio:render", "/api/venus/studio:assets"]) assert.ok(t.live[k] >= 1);
  assert.equal(t.live["/api/venus/ai:storyboard"], 1, "the plan was paid for once");
  assert.equal(t.live["/api/venus/ai:scene"], 3, "three scenes, three calls, never repeated by a later slice");
  assert.equal(t.live["/api/venus/studio:render"], 2, "preview and final each started once");
  assert.equal(t.project.finalPath, "u1/final.mp4");
  assert.equal(t.chat.length, 1);
  assert.match(t.chat[0], /Your video is ready: \*\*My video\*\*/);
  assert.match(t.chat[0], /Download the video\]\(https:\/\/dl\.example/);
  const run = await t.S.getRun("u1", "v1");
  assert.equal(run.status, "done"); assert.ok(run.postedAt); assert.equal(run.lease, null);
  assert.equal((await t.S.journalStore("u1", "v1").load()).length, 0, "the journal is cleaned up");
});

test("the second slice continues with the first slice's answers, not new ones", async () => {
  const t = rig(); await t.start();
  await t.drive();
  assert.match(t.project.storyboardJson, /^storyboard-1$/);
  assert.equal(t.project.designJson, "scene-2|scene-3|scene-4");
});

test("a slice never starts a second heavy call late in its minute", async () => {
  const t = rig(); await t.start();
  await t.drive();
  const heavyPerSlice = t.sliceLive.map((n) => n);
  assert.ok(heavyPerSlice.every((n) => n <= 12), "no runaway slice: " + heavyPerSlice.join(","));
  assert.ok(t.kicks >= 3, "each unfinished slice kicked the next one");
});

test("the studio keeps running while the job renders: progress polls are asked live every slice, the job is started once", async () => {
  const t = rig(); await t.start();
  await t.drive();
  assert.equal(t.live["/api/venus/studio:render"], 2);
  assert.ok(t.live["/api/venus/studio:progress"] >= 24);
});

test("a failing provider ends the run with the real reason and tells the chat", async () => {
  const t = rig({ failOn: "/api/venus/ai:storyboard" }); await t.start();
  const { r } = await t.drive();
  assert.equal(r.status, "error");
  const run = await t.S.getRun("u1", "v1");
  assert.equal(run.status, "error"); assert.match(run.error, /provider exploded/);
  assert.equal(t.chat.length, 1);
  assert.match(t.chat[0], /could not be finished: provider exploded/);
});

test("a request that ran into the end of the slice is NOT a failure: the next slice asks again", async () => {
  const t = rig({ timeoutOn: "/api/venus/ai:storyboard" }); await t.start();
  const { r } = await t.drive();
  assert.equal(r.status, "done");
  assert.equal(t.chat.length, 1);
  assert.doesNotMatch(t.chat[0], /could not be finished/);
});

test("Stop: the video stops, no 'failed' message, the lease is free", async () => {
  const t = rig(); await t.start();
  assert.equal((await t.slice()).status, "continue");
  await t.S.patchRun("u1", "v1", { stopRequested: true });
  const r = await t.slice();
  assert.equal(r.status, "stopped");
  const run = await t.S.getRun("u1", "v1");
  assert.equal(run.status, "stopped"); assert.equal(run.lease, null);
  assert.equal(t.chat.length, 0);
  assert.equal((await t.slice()).status, "busy", "a stopped run cannot be claimed again");
});

test("only one slice runs at a time; a dead slice is taken over once its lease has run out", async () => {
  const t = rig(); await t.start();
  const claimed = await t.S.claimLease("u1", "v1", "dead-worker", 80_000, t.clock);
  assert.ok(claimed);
  assert.equal((await t.slice("o2")).status, "busy", "the lease is held");
  assert.deepEqual(planVenusTick(await t.S.getRun("u1", "v1"), t.clock + 1000), { do: "wait", at: t.clock + 80_000 });
  t.tick(100_000);
  assert.deepEqual(planVenusTick(await t.S.getRun("u1", "v1"), t.clock), { do: "resume" });
  const { r } = await t.drive();
  assert.equal(r.status, "done");
});

test("quiet runs (started by the agent or a routine) do not post their own chat message", async () => {
  const t = rig({ run: { quiet: true } }); await t.start();
  const { r } = await t.drive();
  assert.equal(r.status, "done");
  assert.equal(t.chat.length, 0);
});

test("the scheduler: finished-but-unannounced videos are announced, old or announced ones are cleared", () => {
  const base = { id: "v", chatId: "c", title: "t", stage: "done", createdAt: 0, updatedAt: 0, lease: null, slices: 3, origin: "x" };
  assert.deepEqual(planVenusTick(null, 5), { do: "clear" });
  assert.deepEqual(planVenusTick({ ...base, status: "done", endedAt: 1000 }, 2000), { do: "post" });
  assert.deepEqual(planVenusTick({ ...base, status: "done", endedAt: 1000, postedAt: 1500 }, 2000), { do: "clear" });
  assert.deepEqual(planVenusTick({ ...base, status: "done", endedAt: 1000 }, 1000 + 7 * 3600_000), { do: "clear" });
  assert.deepEqual(planVenusTick({ ...base, status: "error", endedAt: 1000 }, 2000), { do: "clear" });
  assert.deepEqual(planVenusTick({ ...base, status: "queued" }, 2000), { do: "resume" });
});

test("journal: same call, same answer; repeated identical calls replay in order; secrets do not change the key", async () => {
  const mem = new Map();
  const store = { load: async () => [...mem.values()], put: async (e) => { mem.set(e.k + ":" + e.n, e); }, clear: async () => mem.clear() };
  const k = callKey("/api/venus/ai", { kind: "x", apiKey: "A", uid: "u" });
  assert.equal(k, callKey("/api/venus/ai", { uid: "other", kind: "x", apiKey: "B" }));
  assert.notEqual(k, callKey("/api/venus/ai", { kind: "y" }));
  let n = 0;
  const j1 = await createJournal(store);
  assert.equal((await j1.call(k, async () => ++n)).value, 1);
  assert.equal((await j1.call(k, async () => ++n)).value, 2, "a repair loop may repeat a call");
  const j2 = await createJournal(store); // the next slice
  const a = await j2.call(k, async () => ++n), b = await j2.call(k, async () => ++n), c = await j2.call(k, async () => ++n);
  assert.deepEqual([a.value, a.replayed, b.value, b.replayed, c.value, c.replayed], [1, true, 2, true, 3, false]);
  assert.equal((await j2.call("f", async () => "bad", () => false)).value, "bad");
  assert.equal((await (await createJournal(store)).call("f", async () => "again")).value, "again", "failures are not kept");
});

test("which calls are journaled", () => {
  assert.ok(isJournaled("/api/venus/ai", { kind: "scene" }));
  assert.ok(isJournaled("/api/venus/studio", { action: "render" }));
  assert.ok(isJournaled("/api/venus/studio", { action: "tts" }));
  assert.ok(!isJournaled("/api/venus/studio", { action: "progress" }));
  assert.ok(!isJournaled("/api/venus/studio", { action: "status" }));
  assert.ok(!isJournaled("/api/code/ws", { action: "exec" }));
  assert.ok(!isJournaled("/api/venus/media", { action: "url" }));
});

test("seededRandom: the same seed gives the same style again in the next slice", () => {
  const a = seededRandom("v1:script"), b = seededRandom("v1:script"), c = seededRandom("v2:script");
  const xs = [a(), a(), a()], ys = [b(), b(), b()];
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test("timing defaults leave room inside a 60 s function", () => {
  assert.ok(DEFAULT_TIMING.hardMs < 60_000);
  assert.ok(DEFAULT_TIMING.yieldAfterMs < DEFAULT_TIMING.hardMs);
  assert.ok(DEFAULT_TIMING.firstHeavyMs >= DEFAULT_TIMING.heavyStartMs);
});
