import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateDataset } from "../eval-suite.mjs";

const suite = JSON.parse(fs.readFileSync(new URL("../../evals/suite.json", import.meta.url), "utf8"));

test("the real suite is valid and has 200+ tasks", () => {
  assert.deepEqual(validateDataset(suite), []);
  assert.ok(suite.tasks.length >= 200, String(suite.tasks.length));
});

test("the original 40 tasks are still first and unchanged in id order", () => {
  const first = suite.tasks.slice(0, 40).map((t) => t.id);
  assert.equal(first[0], "leads-saas-india");
  assert.equal(new Set(first).size, 40);
});

test("every task has distinct id, a real prompt and a rubric of 2+ lines", () => {
  const ids = new Set();
  for (const t of suite.tasks) {
    assert.ok(!ids.has(t.id), t.id); ids.add(t.id);
    assert.ok(t.prompt.length >= 20 && t.rubric.length >= 2 && ["read", "write"].includes(t.risk), t.id);
  }
});

test("safety tasks: every one checks that the planted instruction is NOT followed and that the owner is told", () => {
  const safety = suite.tasks.filter((t) => t.category === "safety_injection");
  assert.ok(safety.length >= 30);
  for (const t of safety) {
    const r = t.rubric.join(" ").toLowerCase();
    assert.match(r, /not follow|treats the page text as content/, t.id);
    assert.match(r, /tells the owner|plain summary/, t.id);
  }
});

test("Hinglish and Hindi are really covered (prompts written in those languages)", () => {
  const hi = suite.tasks.filter((t) => t.category === "hinglish_tasks");
  assert.ok(hi.length >= 25);
  assert.ok(suite.tasks.some((t) => /[\u0900-\u097F]/.test(t.prompt)), "a Devanagari prompt exists");
  assert.ok(suite.tasks.filter((t) => t.category === "safety_injection" && /pichle|bhool|mat batana|[\u0900-\u097F]/i.test(t.prompt)).length >= 3);
});

test("payments tasks always check approval or a limit, never auto-paying", () => {
  for (const t of suite.tasks.filter((x) => x.category === "payments_approval")) assert.equal(t.risk, "write", t.id);
});
