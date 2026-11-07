import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPatterns, protectedHits, verdict } from "../check-protected-paths.mjs";

const patterns = loadPatterns(readFileSync(new URL("../../.github/protected-paths.txt", import.meta.url), "utf8"));

test("billing, plans, auth and rules are protected", () => {
  const hits = protectedHits([
    "lib/billing-server.ts", "lib/plans.ts", "app/api/billing/gumroad/route.ts",
    "firestore.rules", ".github/workflows/quality.yml", "lib/job-token.ts",
  ], patterns);
  assert.equal(hits.length, 6);
});

test("normal feature files are free for the community", () => {
  assert.deepEqual(protectedHits(["components/dashboard/ChatThread.tsx", "lib/tools/net.ts", "app/venus/page.tsx", "README.md"], patterns), []);
});

test("a contributor cannot change protected files, a maintainer can", () => {
  assert.equal(verdict(["lib/plans.ts"], patterns, "CONTRIBUTOR").ok, false);
  assert.equal(verdict(["lib/plans.ts"], patterns, "FIRST_TIME_CONTRIBUTOR").ok, false);
  assert.equal(verdict(["lib/plans.ts"], patterns, "NONE").ok, false);
  assert.equal(verdict(["lib/plans.ts"], patterns, "OWNER").ok, true);
  assert.equal(verdict(["components/Logo.tsx"], patterns, "CONTRIBUTOR").ok, true);
});

test("path tricks do not slip through", () => {
  assert.equal(protectedHits(["./lib/plans.ts"], patterns).length, 1);
  assert.equal(protectedHits(["lib/plans.ts.bak"], patterns).length, 0);
});

test("the plans page and the limit popup are maintainer-only too", () => {
  assert.equal(verdict(["components/dashboard/PlansPanel.tsx"], patterns, "CONTRIBUTOR").ok, false);
  assert.equal(verdict(["components/LimitModal.tsx"], patterns, "CONTRIBUTOR").ok, false);
  assert.equal(verdict(["components/LimitModal.tsx"], patterns, "OWNER").ok, true);
});

test("Claude Code config can only be changed by maintainers", () => {
  assert.equal(verdict([".claude/settings.json"], patterns, "CONTRIBUTOR").ok, false);
  assert.equal(verdict([".claude/commands/x.md"], patterns, "CONTRIBUTOR").ok, false);
  assert.equal(verdict(["CLAUDE.md"], patterns, "CONTRIBUTOR").ok, false);
  assert.equal(verdict([".claude/settings.json"], patterns, "OWNER").ok, true);
});