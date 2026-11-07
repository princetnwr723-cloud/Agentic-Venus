// The local-computer relay: job checks, ids and result clean-up. (The Firestore parts are covered by review + the manual checklist.)
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateJob, normalizeResult, isLocalKey, isLocalSandboxId, makeLocalKey, sandboxIdOf, deviceFromKey, deviceFromSandboxId,
  isOnline, isExpired, MAX_CMD_BYTES, MAX_OUTPUT_CHARS, ONLINE_MS, JOB_TTL_MS,
} from "../../lib/local-relay-core.ts";

const ID = "0123456789abcdef0123456789abcdef";

test("ids and keys round-trip and reject look-alikes", () => {
  assert.equal(isLocalKey(makeLocalKey(ID)), true);
  assert.equal(isLocalSandboxId(sandboxIdOf(ID)), true);
  assert.equal(deviceFromKey(makeLocalKey(ID)), ID);
  assert.equal(deviceFromSandboxId(sandboxIdOf(ID)), ID);
  for (const bad of ["", "venus-local:", "venus-local:xyz", "venus-local:" + ID.toUpperCase(), "e2b_abc", "local-" + ID + "0"]) {
    assert.equal(isLocalKey(bad), false, bad);
  }
  assert.equal(isLocalSandboxId("ixyz123"), false);
});

test("commands: empty, oversized and bad timeouts", () => {
  assert.equal(validateJob("exec", { cmd: "   " }).ok, false);
  assert.equal(validateJob("exec", { cmd: "x".repeat(MAX_CMD_BYTES + 1) }).ok, false);
  const v = validateJob("exec", { cmd: "ls", timeoutMs: 9e9 });
  assert.ok(v.ok && v.args.timeoutMs <= 300_000);
  const w = validateJob("exec", { cmd: "ls", timeoutMs: "abc" });
  assert.ok(w.ok && w.args.timeoutMs === 30_000);
});

test("input: only known types, clamped numbers, safe key names", () => {
  assert.equal(validateJob("input", { type: "shell" }).ok, false);
  assert.equal(validateJob("input", { type: "key", keys: "ctrl+; rm -rf" }).ok, false);
  assert.equal(validateJob("input", { type: "key", keys: "ctrl+l" }).ok, true);
  const c = validateJob("input", { type: "click", x: 99999, y: -5 });
  assert.ok(c.ok && c.args.x === 10_000 && c.args.y === 0);
  const s = validateJob("input", { type: "scroll", direction: "sideways", amount: 9999 });
  assert.ok(s.ok && s.args.direction === "down" && s.args.amount === 50);
});

test("computer actions and unknown jobs", () => {
  assert.equal(validateJob("vm", { action: "format" }).ok, false);
  assert.equal(validateJob("vm", { action: "status" }).ok, true);
  assert.equal(validateJob("screenshot", null).ok, true);
  assert.equal(validateJob("delete-everything", {}).ok, false);
});

test("a result from the app is cut down to a small safe shape", () => {
  const r = normalizeResult({ stdout: "a".repeat(MAX_OUTPUT_CHARS + 50), exitCode: "7", evil: { deep: true } });
  assert.equal(r.stdout.length, MAX_OUTPUT_CHARS);
  assert.equal(r.exitCode, 7);
  assert.deepEqual(Object.keys(r).sort(), ["data", "error", "exitCode", "stderr", "stdout"]);
  assert.equal(normalizeResult(null).exitCode, 0);
});

test("online and expiry checks", () => {
  const now = 1_000_000;
  assert.equal(isOnline(now - 1000, now), true);
  assert.equal(isOnline(now - ONLINE_MS - 1, now), false);
  assert.equal(isOnline(undefined, now), false);
  assert.equal(isExpired(now - JOB_TTL_MS - 1, now), true);
  assert.equal(isExpired(now - 1000, now), false);
});