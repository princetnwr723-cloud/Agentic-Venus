import test from "node:test";
import assert from "node:assert/strict";
import { runCostBase, PLAN_RUN_COST_MICROS, FALLBACK_RUN_COST_MICROS, MICROS } from "../../lib/agent/cost-policy.ts";
import { costCap } from "../../lib/agent/slice.ts";

test("every plan has a cap and the caps grow with the plan", () => {
  const order = ["free", "pro", "plus", "max", "max2x", "ultra"];
  let prev = 0;
  for (const id of order) { const c = runCostBase(id, {}); assert.ok(c > prev, id); prev = c; }
  assert.equal(runCostBase("free", {}), 0.6 * MICROS);
  assert.ok(runCostBase("free", {}) < 3 * MICROS, "Free must be far under the old 3 dollars");
});

test("an unknown plan is treated like Free", () => {
  assert.equal(runCostBase("nonsense", {}), FALLBACK_RUN_COST_MICROS);
  assert.equal(runCostBase("", {}), FALLBACK_RUN_COST_MICROS);
});

test("environment overrides: one plan, or all plans", () => {
  assert.equal(runCostBase("free", { AGENT_RUN_COST_USD_FREE: "0.25" }), 250_000);
  assert.equal(runCostBase("pro", { AGENT_RUN_COST_USD: "1" }), 1_000_000);
  assert.equal(runCostBase("pro", { AGENT_RUN_COST_USD: "1", AGENT_RUN_COST_USD_PRO: "2" }), 2_000_000);
  assert.equal(runCostBase("free", { AGENT_RUN_COST_USD: "abc" }), PLAN_RUN_COST_MICROS.free);
  assert.equal(runCostBase("free", { AGENT_RUN_COST_USD: "-5" }), PLAN_RUN_COST_MICROS.free);
});

test("costCap still adds one allowance per owner 'continue'", () => {
  const base = runCostBase("free", {});
  assert.equal(costCap({ costExtra: 0 }, base), base);
  assert.equal(costCap({ costExtra: 2 }, base), base * 3);
});
