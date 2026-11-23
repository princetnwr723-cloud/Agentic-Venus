import test from "node:test";
import assert from "node:assert/strict";
import { shapeExport, confirmOk, DELETE_PHRASE, deleteBlockedByPlan, EXPORT_COLLECTIONS } from "../../lib/account-core.ts";

const doc = (id, n = 10) => ({ id, data: { text: "x".repeat(n) } });

test("small exports are complete and say so", () => {
  const f = shapeExport("u1", { chats: [doc("a"), doc("b")], teams: [doc("t")] }, 10_000, 1_700_000_000_000);
  assert.equal(f.format, "agenticvenus-export-v1");
  assert.deepEqual(f.truncated, {});
  assert.equal(f.data.chats.length, 2);
  assert.equal(f.exportedAt, "2023-11-14T22:13:20.000Z");
  assert.match(f.note, /never exported/);
});

test("big exports keep the newest documents and report what was left out", () => {
  const chats = Array.from({ length: 100 }, (_, i) => doc("c" + i, 1000));
  const f = shapeExport("u1", { chats, teams: [doc("t", 100)] }, 20_000);
  assert.ok(f.data.chats.length < 100 && f.data.chats[0].id === "c0");
  assert.equal(f.truncated.chats.total, 100);
  assert.equal(f.truncated.chats.kept, f.data.chats.length);
  assert.equal(f.data.teams.length, 1, "a small collection is never pushed out by a big one");
  assert.ok(JSON.stringify(f).length < 30_000);
});

test("one document bigger than its room is still kept (never an empty collection by accident)", () => {
  const f = shapeExport("u", { chats: [doc("big", 50_000), doc("b2", 50_000)] }, 10_000);
  assert.equal(f.data.chats.length, 1);
});

test("the delete phrase must be typed exactly (spaces around are fine)", () => {
  assert.equal(confirmOk(DELETE_PHRASE), true);
  assert.equal(confirmOk("  DELETE MY ACCOUNT \n"), true);
  for (const bad of ["delete my account", "DELETE", "", null, undefined, "DELETE MY ACCOUNT NOW"]) assert.equal(confirmOk(bad), false, String(bad));
});

test("a running paid plan blocks deletion, a cancelled or free one does not", () => {
  const now = 1_700_000_000_000;
  assert.match(deleteBlockedByPlan({ plan: "pro", status: "active", accessUntil: now + 1000 }, now), /Cancel the subscription/);
  assert.equal(deleteBlockedByPlan({ plan: "pro", status: "active", cancelled: true, accessUntil: now + 1000 }, now), "");
  assert.equal(deleteBlockedByPlan({ plan: "pro", status: "ended", accessUntil: now - 1 }, now), "");
  assert.equal(deleteBlockedByPlan({ plan: "free" }, now), "");
  assert.equal(deleteBlockedByPlan(undefined, now), "");
});

test("secrets are not in the export list", () => {
  for (const c of EXPORT_COLLECTIONS) assert.ok(!/vault|secret|token|key/i.test(c), c);
});
