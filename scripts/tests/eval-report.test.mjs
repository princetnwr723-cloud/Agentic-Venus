// Eval report: confidence intervals, honest wording, polling runner.
import test from "node:test";
import assert from "node:assert/strict";
import { renderReport, summarizeEntry, wilson } from "../eval-report.mjs";
import { runTask } from "../eval-run.mjs";

const dataset = { tasks: Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, category: i < 5 ? "mail" : "web", prompt: "p", rubric: ["x"], risk: "read" })) };
const res = (wins, cost) => Array.from({ length: 10 }, (_, i) => ({ taskId: `t${i}`, success: i < wins, durationMs: 10_000 + i * 1000, costUsd: cost, ...(i >= wins ? { notes: "missing x" } : {}) }));

test("wilson interval", () => {
  const w = wilson(8, 10);
  assert.ok(w.lo > 0.48 && w.lo < 0.5 && w.hi > 0.93 && w.hi < 0.96, JSON.stringify(w));
  assert.deepEqual(wilson(0, 0), { lo: null, hi: null });
  assert.equal(wilson(10, 10).hi, 1);
});

test("overlapping intervals are NOT reported as a difference", () => {
  const md = renderReport(dataset, [{ label: "Cheap + FOUNT", results: res(8, 0.01) }, { label: "Opus", results: res(9, 0.2) }], { now: "2026-11-18" });
  assert.match(md, /do(es)? not show a real difference/);
  assert.match(md, /8\/10/); assert.match(md, /\$0\.010/); assert.match(md, /\$0\.222/, "cost per success = total / successes");
  assert.match(md, /missing x/);
});
test("separated intervals are reported as a difference; incomplete runs are flagged", () => {
  const big = { tasks: Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, category: "c", prompt: "p", rubric: ["x"], risk: "read" })) };
  const mk = (w) => Array.from({ length: 40 }, (_, i) => ({ taskId: `t${i}`, success: i < w, durationMs: 1000 }));
  assert.match(renderReport(big, [{ label: "A", results: mk(38) }, { label: "B", results: mk(15) }]), /unlikely to be chance/);
  assert.equal(summarizeEntry(dataset, { label: "x", results: res(8, 0.01).slice(0, 6) }).complete, false);
});

test("runner polls a long task until the run is over", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    const out = body.runId ? (calls.filter((c) => c.runId).length < 3 ? { status: "running" } : { status: "done", output: "the answer text is here", costUsd: 0.02 }) : { runId: "r1", status: "running" };
    return { ok: true, status: 200, json: async () => out };
  };
  process.env.EVAL_POLL_MS = "1";
  const r = await runTask({ id: "t", prompt: "p", rubric: ["answer text"] }, { endpoint: "http://e", fetchImpl, timeoutMs: 5000 });
  assert.equal(r.success, true); assert.equal(r.costUsd, 0.02); assert.equal(calls.filter((c) => c.runId).length, 3);
  const failing = async (url, init) => ({ ok: true, status: 200, json: async () => (JSON.parse(init.body).runId ? { status: "failed", notes: "waiting for a human: pay" } : { runId: "r", status: "running" }) });
  const f = await runTask({ id: "t", prompt: "p", rubric: ["answer text"] }, { endpoint: "http://e", fetchImpl: failing, timeoutMs: 5000 });
  assert.equal(f.success, false); assert.match(f.notes, /waiting for a human/);
});
