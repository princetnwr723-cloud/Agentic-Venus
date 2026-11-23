import test from "node:test";
import assert from "node:assert/strict";
import { redact, parseDsn, fingerprint, buildEnvelope, captureError, shouldAlert, _resetAlerts, alertText } from "../../lib/monitor.ts";

test("secrets are cut out of messages", () => {
  const t = redact("fail sk-abcdefghijklmnop1234 and Bearer abcdefghijklmnopqrstuv and card 4242 4242 4242 4242 and ?token=abc123secret&x=1 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij");
  assert.ok(!/sk-abc|abcdefghijklmnopqrstuv|4242 4242|abc123secret|eyJhbGci/.test(t), t);
  assert.match(t, /\[key\]/); assert.match(t, /\[number\]/);
});

test("DSN parsing", () => {
  assert.deepEqual(parseDsn("https://pubkey@o123.ingest.sentry.io/456"), { url: "https://o123.ingest.sentry.io/api/456/envelope/", key: "pubkey", project: "456", host: "o123.ingest.sentry.io" });
  assert.equal(parseDsn(""), null); assert.equal(parseDsn("not a url"), null); assert.equal(parseDsn("https://host/1"), null);
});

test("same error with different ids has one fingerprint", () => {
  assert.equal(fingerprint(new Error("run r123abc failed"), "worker"), fingerprint(new Error("run r999xyz failed"), "worker"));
  assert.notEqual(fingerprint(new Error("boom"), "a"), fingerprint(new Error("boom"), "b"));
});

test("envelope has 3 lines, hashed user, redacted text", () => {
  const env = buildEnvelope(new Error("bad sk-abcdefghijklmnop1234"), { where: "worker", uid: "user-1" }, { key: "k", project: "1" }, 1_700_000_000_000, {});
  const lines = env.split("\n"); assert.equal(lines.length, 3);
  const ev = JSON.parse(lines[2]);
  assert.ok(!JSON.stringify(ev).includes("user-1")); assert.match(ev.user.id, /^u_/);
  assert.ok(!JSON.stringify(ev).includes("sk-abcdefghijklmnop1234"));
});

test("alerts are rate limited per error", () => {
  _resetAlerts();
  assert.equal(shouldAlert("a", 1000, 600_000), true);
  assert.equal(shouldAlert("a", 2000, 600_000), false);
  assert.equal(shouldAlert("b", 2000, 600_000), true);
  assert.equal(shouldAlert("a", 700_000, 600_000), true);
});

test("captureError sends to Sentry and the webhook once, and never throws", async () => {
  _resetAlerts();
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init]); return { ok: true, status: 200 }; };
  const env = { SENTRY_DSN: "https://k@o1.ingest.sentry.io/9", ALERT_WEBHOOK_URL: "https://hooks.example/x" };
  const quiet = console.error; console.error = () => {};
  try {
    await captureError(new Error("db down"), { where: "worker", runId: "r1" }, { env, fetchImpl, now: 5_000_000 });
    await captureError(new Error("db down"), { where: "worker", runId: "r2" }, { env, fetchImpl, now: 5_000_100 });
    assert.equal(calls.filter((c) => c[0].includes("sentry")).length, 2);
    assert.equal(calls.filter((c) => c[0].includes("hooks.example")).length, 1);
    await captureError(new Error("x"), {}, { env, fetchImpl: async () => { throw new Error("network"); }, now: 9_000_000 });
    await captureError(new Error("only log"), {}, { env: {}, fetchImpl, now: 1 });
  } finally { console.error = quiet; }
  assert.match(alertText(new Error("m"), { where: "w", runId: "r" }), /in w.*run r/);
});

test("warnings go to Sentry but never ping the webhook", async () => {
  _resetAlerts();
  const calls = [];
  const quiet = console.error; console.error = () => {};
  await captureError(new Error("slow"), { level: "warning" }, { env: { ALERT_WEBHOOK_URL: "https://h.example/x" }, fetchImpl: async (u) => { calls.push(u); return { ok: true, status: 200 }; }, now: 77 });
  console.error = quiet;
  assert.equal(calls.length, 0);
});
