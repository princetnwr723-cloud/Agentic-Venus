// 508 fix (hop counting + relay command) and the Scout browser (pure parts).
import test from "node:test";
import assert from "node:assert/strict";
import { hopsOf, canKickDirect, MAX_HOPS } from "../../lib/hops.ts";
import { relayCommand } from "../../lib/kick-relay-core.ts";
import { splitUrls, cleanOps, scoutState, scoutCommand, formatPages, parseReply } from "../../lib/scout-core.ts";
import { SCOUT_DAEMON } from "../../lib/scout-script.ts";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

test("hopsOf counts the entries before ::", () => {
  assert.equal(hopsOf("iad1:iad1:iad1:iad1:iad1:iad1::abc-123"), 6);
  assert.equal(hopsOf("sfo1::iad1::id"), 1);
  assert.equal(hopsOf(""), 1); assert.equal(hopsOf(null), 1);
  assert.equal(hopsOf("iad1:iad1::x"), 2);
});
test("canKickDirect only while shallow", () => {
  assert.equal(canKickDirect(1), true); assert.equal(canKickDirect(3), true);
  assert.equal(canKickDirect(4), false); assert.equal(canKickDirect(6), false);
  assert.equal(MAX_HOPS, 5);
});
const TOKEN = "job:" + "a".repeat(40) + "." + "b".repeat(20);
test("relayCommand builds a safe curl and refuses injection", () => {
  const ok = relayCommand("https://x.vercel.app/api/venus/run/step", TOKEN, '{"pid":"abc_1"}');
  assert.match(ok, /^nohup curl /); assert.match(ok, /&$/);
  assert.equal(relayCommand("https://x.com/api/other", TOKEN, '{"pid":"a"}'), null);
  assert.equal(relayCommand("https://x.com/api/agent/step; rm -rf /", TOKEN, '{"runId":"a"}'), null);
  assert.equal(relayCommand("https://x.com/api/agent/step", "tok'; id #" + "a".repeat(30), '{"runId":"a"}'), null);
  assert.equal(relayCommand("https://x.com/api/agent/step", TOKEN, '{"runId":"a\'; id"}'), null);
  assert.ok(relayCommand("https://x.com/api/agent/step", TOKEN, '{"runId":"r1"}'));
});
test("splitUrls / cleanOps / scoutState", () => {
  const r = splitUrls("https://a.com, https://b.com\nhttp://localhost/x http://192.168.1.5");
  assert.equal(r.urls.length, 2); assert.equal(r.skipped.length, 2);
  const many = splitUrls(Array.from({ length: 20 }, (_, i) => `https://s${i}.com`).join(" "));
  assert.equal(many.urls.length, 8);
  const ops = cleanOps([{ op: "click", id: 1 }, { op: "secret", id: 1 }, { op: "eval", code: "x" }, "x"]);
  assert.deepEqual(ops.map((o) => o.op), ["click"]);
  assert.equal(cleanOps(Array.from({ length: 40 }, () => ({ op: "back" }))).length, 15);
  assert.equal(scoutState("ready|ok"), "ready"); assert.equal(scoutState("installing|"), "installing");
  assert.equal(scoutState("failed|"), "failed"); assert.equal(scoutState("ready|"), "stopped"); assert.equal(scoutState(""), "none");
});
test("scoutCommand is base64-safe and formatPages marks content untrusted", () => {
  const c = scoutCommand(JSON.stringify({ action: "read", urls: ["https://a.com/'; rm -rf /"] }));
  assert.doesNotMatch(c.replace(/echo '[A-Za-z0-9+/=]+'/, ""), /rm -rf/);
  assert.match(formatPages([{ url: "https://a.com", title: "A", text: "hello" }], ""), /untrusted/i);
  assert.ok(parseReply === undefined || typeof parseReply === "function");
});
test("the Scout daemon is valid JavaScript", () => {
  const f = "/tmp/scout-daemon-test.js"; writeFileSync(f, SCOUT_DAEMON);
  execFileSync("node", ["--check", f]);
});
