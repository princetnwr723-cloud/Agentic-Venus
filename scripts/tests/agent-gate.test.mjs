import test from "node:test";
import assert from "node:assert/strict";
import { openPlanSteps, planGate } from "../../lib/agent/plan-gate.ts";
import { contextWindow } from "../../lib/agent/budget.ts";

const res = (content) => [{ role: "user", content: [{ type: "tool_result", toolUseId: "t", content }] }];

test("plan gate: no plan tool used -> null", () => {
  assert.equal(openPlanSteps([{ role: "user", content: [{ type: "text", text: "hi" }] }]), null);
  assert.equal(planGate([]), null);
});
test("plan gate: open steps send the agent back to work", () => {
  assert.equal(openPlanSteps(res("ok\nPLAN OPEN: 3 step(s)")), 3);
  assert.match(planGate(res("PLAN OPEN: 2 step(s)")), /2 open step/);
});
test("plan gate: complete plan lets it finish", () => {
  assert.equal(planGate(res("PLAN COMPLETE")), null);
  assert.equal(planGate(res("PLAN ENDED WITH BROKEN steps")), null);
});
test("plan gate: the LAST status wins", () => {
  const m = [...res("PLAN OPEN: 2 step(s)"), ...res("PLAN COMPLETE")];
  assert.equal(openPlanSteps(m), 0);
});
test("contextWindow by model family", () => {
  assert.equal(contextWindow("claude-sonnet-5-5"), 200_000);
  assert.equal(contextWindow("gemini-2.5-pro"), 1_000_000);
  assert.equal(contextWindow("deepseek-chat"), 64_000);
  assert.equal(contextWindow("something-new"), 100_000);
});
