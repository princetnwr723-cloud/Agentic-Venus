import test from "node:test";
import assert from "node:assert/strict";
import { createStore, CHUNK_CHARS } from "../../lib/agent/store.ts";
import { createStrictBilling, PlanLimitError, BillingUnavailableError } from "../../lib/agent/strict-billing.ts";
import { newState } from "../../lib/agent/loop.ts";

/** A tiny in-memory Firestore: enough for the calls the store makes. */
function fakeDb() {
  const data = new Map();
  const snap = (path) => ({ exists: data.has(path), id: path.split("/").pop(), data: () => (data.has(path) ? structuredClone(data.get(path)) : undefined) });
  const docRef = (path) => ({
    path,
    get: async () => snap(path),
    set: async (d, o) => { data.set(path, o?.merge ? { ...(data.get(path) ?? {}), ...structuredClone(d) } : structuredClone(d)); },
    update: async (d) => { if (!data.has(path)) throw new Error("NOT_FOUND " + path); data.set(path, { ...data.get(path), ...structuredClone(d) }); },
    delete: async () => { data.delete(path); },
    collection: (n) => colRef(path + "/" + n),
  });
  const colRef = (path, filters = [], order = null, lim = Infinity) => ({
    doc: (id) => docRef(path + "/" + (id ?? Math.random().toString(36).slice(2))),
    where: (f, op, v) => colRef(path, [...filters, [f, op, v]], order, lim),
    orderBy: (f, dir = "asc") => colRef(path, filters, [f, dir], lim),
    limit: (n) => colRef(path, filters, order, n),
    get: async () => {
      let docs = [...data.keys()].filter((k) => k.startsWith(path + "/") && !k.slice(path.length + 1).includes("/")).map((k) => ({ k, v: data.get(k) }));
      for (const [f, op, v] of filters) docs = docs.filter(({ v: x }) => (op === "<" ? x[f] < v : op === ">" ? x[f] > v : x[f] === v));
      if (order) docs.sort((a, b) => (order[1] === "desc" ? b.v[order[0]] - a.v[order[0]] : a.v[order[0]] - b.v[order[0]]));
      return { docs: docs.slice(0, lim).map(({ k }) => snap(k)) };
    },
  });
  const db = {
    collection: (n) => colRef(n),
    runTransaction: async (fn) => {
      const writes = [];
      const tx = { get: async (r) => r.get(), set: (r, d, o) => writes.push(() => r.set(d, o)), update: (r, d) => writes.push(() => r.update(d)), delete: (r) => writes.push(() => r.delete()) };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
  };
  return { db, data };
}

const baseRun = (over = {}) => ({
  id: "r1", chatId: "c1", task: "t", provider: "anthropic", model: "m", keyRef: "vault:k", fallbacks: [], status: "queued", round: 0, createdAt: 1000, updatedAt: 1000,
  lease: null, pending: null, reply: null, usage: { inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0 }, costMicros: 0, calls: 0, compactions: 0, tainted: false,
  stateVer: 0, stateChunks: 0, maxRounds: 40, slices: 0, ...over,
});

test("state is saved in versioned chunks and loaded back exactly; old chunks are removed", async () => {
  const { db, data } = fakeDb();
  const st = createStore(db);
  await st.createRun("u1", baseRun());
  const s = newState("a task with ünïcode and 😀");
  s.messages.push({ role: "assistant", content: [{ type: "text", text: "x".repeat(CHUNK_CHARS * 2 + 5) }] });
  await st.saveState("u1", "r1", s);
  const run1 = await st.getRun("u1", "r1");
  assert.equal(run1.stateVer, 1);
  assert.equal(run1.stateChunks, 3);
  assert.deepEqual(await st.loadState("u1", "r1"), s);
  s.round = 5;
  s.messages.pop();
  await st.saveState("u1", "r1", s);
  const run2 = await st.getRun("u1", "r1");
  assert.equal(run2.stateVer, 2);
  assert.equal(run2.stateChunks, 1);
  assert.equal(run2.round, 5);
  assert.equal([...data.keys()].filter((k) => k.includes("/chunks/1_")).length, 0);
  assert.equal((await st.loadState("u1", "r1")).round, 5);
});

test("a half-written new version never replaces a complete old one", async () => {
  const { db, data } = fakeDb();
  const st = createStore(db);
  await st.createRun("u1", baseRun());
  const s = newState("t");
  await st.saveState("u1", "r1", s);
  // crash after writing chunk files of version 2 but before the pointer moved
  data.set("users/u1/runs/r1/chunks/2_0", { d: "{broken" });
  assert.deepEqual(await st.loadState("u1", "r1"), s);
});

test("only one worker can hold the lease; an expired lease can be taken over", async () => {
  const { db, data } = fakeDb();
  const st = createStore(db);
  await st.createRun("u1", baseRun());
  const a = await st.claimLease("u1", "r1", "A", 60_000, 10_000);
  assert.equal(a.status, "running");
  assert.equal(await st.claimLease("u1", "r1", "B", 60_000, 20_000), null);
  assert.equal((await st.claimLease("u1", "r1", "A", 60_000, 20_000)).lease.owner, "A");
  const b = await st.claimLease("u1", "r1", "B", 60_000, 10_000 + 60_000 + 1 + 20_000);
  assert.equal(b.lease.owner, "B");
  assert.equal(b.slices, 3);
  assert.equal(data.get("agentQueue/r1").kind, "run");
});

test("finished runs and paused runs without a reply cannot be claimed", async () => {
  const { db } = fakeDb();
  const st = createStore(db);
  await st.createRun("u1", baseRun({ id: "d", status: "done" }));
  await st.createRun("u1", baseRun({ id: "p", status: "paused" }));
  await st.createRun("u1", baseRun({ id: "q", status: "paused", reply: { action: "approve" } }));
  assert.equal(await st.claimLease("u1", "d", "A", 1000), null);
  assert.equal(await st.claimLease("u1", "p", "A", 1000), null);
  assert.equal((await st.claimLease("u1", "q", "A", 1000)).status, "running");
  assert.equal(await st.claimLease("u1", "missing", "A", 1000), null);
});

test("release frees the lease and sets the queue (or clears it)", async () => {
  const { db, data } = fakeDb();
  const st = createStore(db);
  await st.createRun("u1", baseRun());
  await st.claimLease("u1", "r1", "A", 60_000);
  await st.release("u1", "r1", { status: "paused" }, { kind: "expire", at: 5000 });
  assert.equal((await st.getRun("u1", "r1")).lease, null);
  assert.deepEqual(data.get("agentQueue/r1"), { uid: "u1", kind: "expire", wakeAt: 5000 });
  await st.release("u1", "r1", { status: "done" }, null);
  assert.equal(data.has("agentQueue/r1"), false);
});

test("the scheduler finds only entries that are due", async () => {
  const { db } = fakeDb();
  const st = createStore(db);
  await st.setQueue("u1", "a", "run", 100);
  await st.setQueue("u2", "b", "takeover", 500);
  await st.setQueue("u3", "c", "expire", 100);
  const due = await st.dueQueue(300);
  assert.deepEqual(due.map((d) => d.id).sort(), ["a", "c"]);
});

test("events, steps, latch and run list", async () => {
  const { db } = fakeDb();
  const st = createStore(db);
  await st.createRun("u1", baseRun({ id: "a", createdAt: 1 }));
  await st.createRun("u1", baseRun({ id: "b", createdAt: 2 }));
  assert.deepEqual((await st.listRuns("u1")).map((r) => r.id), ["b", "a"]);
  await st.addEvent("u1", "a", { kind: "tool", text: "web.search", data: { n: 1, skip: undefined } });
  await st.addStep("u1", "a", { round: 1, model: "m", ms: 5, usage: { inTok: 1, outTok: 1, cacheRead: 0, cacheWrite: 0 }, costMicros: 3, tools: [], stop: "end" });
  assert.equal(await st.readLatch("u1"), null);
  await st.armLatch("u1", { kind: "plan", reason: "x", armedAt: 1, until: 99 });
  assert.equal((await st.readLatch("u1")).until, 99);
  await st.clearLatch("u1");
  assert.equal(await st.readLatch("u1"), null);
});

// ---------- strict billing ----------
const plan = (tokens, windowHours = 5) => () => ({ tokens, windowHours, name: "Free" });

test("reserve counts tokens and refuses when the window is used up, with the reset time", async () => {
  const { db, data } = fakeDb();
  const b = createStrictBilling(db, plan(1000));
  await b.reserve("u1", 600);
  assert.equal(data.get("users/u1/billing/usage").tokens, 600);
  await assert.rejects(b.reserve("u1", 500), (e) => e instanceof PlanLimitError && e.code === "plan_limit" && e.status === 402 && e.resetAt > Date.now() && /Free plan/.test(e.message));
  assert.equal(data.get("users/u1/billing/usage").tokens, 600);
});

test("settle replaces the estimate with the real count", async () => {
  const { db, data } = fakeDb();
  const b = createStrictBilling(db, plan(10_000));
  await b.reserve("u1", 4000);
  await b.settle("u1", 4000, 1200);
  assert.equal(data.get("users/u1/billing/usage").tokens, 1200);
  await b.settle("u1", 500, 0);
  assert.equal(data.get("users/u1/billing/usage").tokens, 700);
  await b.settle("u1", 100_000, 0);
  assert.equal(data.get("users/u1/billing/usage").tokens, 0);
});

test("an old window starts again from zero", async () => {
  const { db, data } = fakeDb();
  data.set("users/u1/billing/usage", { windowStart: Date.now() - 6 * 3600_000, tokens: 999_999 });
  await createStrictBilling(db, plan(1000)).reserve("u1", 100);
  assert.equal(data.get("users/u1/billing/usage").tokens, 100);
});

test("unlimited plans never refuse", async () => {
  const { db } = fakeDb();
  await createStrictBilling(db, plan(null)).reserve("u1", 10 ** 9);
});

test("billing database down: fails CLOSED by default, open only when switched on", async () => {
  const { db } = fakeDb();
  const broken = { ...db, runTransaction: async () => { throw new Error("UNAVAILABLE: firestore down"); } };
  await assert.rejects(createStrictBilling(broken, plan(1000)).reserve("u1", 1), (e) => e instanceof BillingUnavailableError && e.status === 503);
  await createStrictBilling(broken, plan(1000), true).reserve("u1", 1);
});
