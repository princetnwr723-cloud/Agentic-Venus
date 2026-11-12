import test from "node:test";
import assert from "node:assert/strict";
import { guarded, BillingUnavailable, envFailOpen } from "../../lib/billing-policy.ts";

const noSleep = async () => {};
class Limit extends Error { constructor(m) { super(m); this.name = "RequestError"; this.status = 402; } }
const o = (extra = {}) => ({ kind: "k", uid: "u1", sleep: noSleep, ...extra });

test("gate: works normally", async () => {
  assert.equal(await guarded(async () => 5, o({ mode: "gate", fallback: 0 })), 5);
});
test("gate: a limit error (402) goes straight to the user, no retry", async () => {
  let n = 0;
  await assert.rejects(guarded(async () => { n++; throw new Limit("limit reached"); }, o({ mode: "gate", fallback: 0 })), /limit reached/);
  assert.equal(n, 1);
});
test("gate: a broken database FAILS CLOSED with 503 after one retry (the old code let the work through)", async () => {
  let n = 0;
  await assert.rejects(guarded(async () => { n++; throw new Error("firestore unavailable"); }, o({ mode: "gate", fallback: undefined })), (e) => e instanceof BillingUnavailable && e.status === 503);
  assert.equal(n, 2);
});
test("gate: one blip is absorbed by the retry", async () => {
  let n = 0;
  assert.equal(await guarded(async () => { if (n++ === 0) throw new Error("deadline exceeded"); return "ok"; }, o({ mode: "gate", fallback: "x" })), "ok");
});
test("gate: the emergency switch BILLING_FAIL_OPEN lets work through", async () => {
  assert.equal(await guarded(async () => { throw new Error("down"); }, o({ mode: "gate", fallback: "open", failOpen: true })), "open");
  assert.equal(envFailOpen({ BILLING_FAIL_OPEN: "true" }), true);
  assert.equal(envFailOpen({ BILLING_FAIL_OPEN: "1" }), true);
  assert.equal(envFailOpen({}), false);
  assert.equal(envFailOpen({ BILLING_FAIL_OPEN: "false" }), false);
});
test("gate: a custom error type is used (billing-server passes a RequestError)", async () => {
  await assert.rejects(guarded(async () => { throw new Error("down"); }, o({ mode: "gate", fallback: 0, unavailable: () => new Limit("custom 503") })), /custom 503/);
});
test("meter: retried twice, then the loss is recorded, never silent, and the caller is not failed", async () => {
  let n = 0; const lost = [];
  const r = await guarded(async () => { n++; throw new Error("write failed"); }, o({ mode: "meter", fallback: "fb", detail: { tokens: 900 }, onLost: (l) => lost.push(l) }));
  assert.equal(r, "fb"); assert.equal(n, 3);
  assert.equal(lost.length, 1);
  assert.deepEqual([lost[0].kind, lost[0].uid, lost[0].detail], ["k", "u1", { tokens: 900 }]);
  assert.match(lost[0].error, /write failed/);
});
test("meter: succeeds on a later retry, nothing recorded", async () => {
  let n = 0; const lost = [];
  assert.equal(await guarded(async () => { if (++n < 3) throw new Error("x"); return "done"; }, o({ mode: "meter", fallback: "fb", onLost: (l) => lost.push(l) })), "done");
  assert.equal(lost.length, 0);
});
test("meter: even a broken audit write does not break the work", async () => {
  assert.equal(await guarded(async () => { throw new Error("x"); }, o({ mode: "meter", fallback: 7, onLost: () => { throw new Error("audit down"); } })), 7);
});
test("meter: a limit error is still shown, not swallowed", async () => {
  await assert.rejects(guarded(async () => { throw new Limit("nope"); }, o({ mode: "meter", fallback: 0 })), /nope/);
});
test("backoff grows between retries", async () => {
  const waits = [];
  await guarded(async () => { throw new Error("x"); }, o({ mode: "meter", fallback: 0, sleep: async (ms) => { waits.push(ms); } }));
  assert.deepEqual(waits, [150, 300]);
});
