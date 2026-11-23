import test from "node:test";
import assert from "node:assert/strict";
import { MemoryLimiter, userRuleFor, ipRuleFor, clientIp, retryAfterSeconds, rateLimitOn, DEFAULT_USER_RULE } from "../../lib/rate-limit.ts";

const R = { name: "t", limit: 3, windowMs: 60_000 };

test("allows up to the limit, then refuses with a retry time", () => {
  const l = new MemoryLimiter();
  const t0 = 1_000_000_000_000;
  for (let i = 0; i < 3; i++) assert.equal(l.hit("a", R, t0 + i).ok, true);
  const d = l.hit("a", R, t0 + 10);
  assert.equal(d.ok, false);
  assert.ok(d.retryAfterMs >= 250 && d.retryAfterMs <= 60_000);
});

test("keys are independent", () => {
  const l = new MemoryLimiter();
  const t0 = 2_000_000_000_000;
  for (let i = 0; i < 3; i++) l.hit("a", R, t0);
  assert.equal(l.hit("a", R, t0).ok, false);
  assert.equal(l.hit("b", R, t0).ok, true);
});

test("a new window frees the key (after enough time)", () => {
  const l = new MemoryLimiter();
  const t0 = Math.floor(3_000_000_000_000 / 60_000) * 60_000; // start of a window
  for (let i = 0; i < 3; i++) l.hit("a", R, t0 + 1000);
  assert.equal(l.hit("a", R, t0 + 2000).ok, false);
  // two windows later nothing of the old count is left
  assert.equal(l.hit("a", R, t0 + 2 * 60_000 + 1).ok, true);
});

test("sliding window: a burst at the edge of two windows does not get double speed", () => {
  const l = new MemoryLimiter();
  const t0 = Math.floor(4_000_000_000_000 / 60_000) * 60_000;
  // 3 requests at the very end of window 1
  for (let i = 0; i < 3; i++) assert.equal(l.hit("a", R, t0 + 59_900).ok, true);
  // right at the start of window 2 the old 3 still weigh almost fully
  assert.equal(l.hit("a", R, t0 + 60_100).ok, false);
  // halfway through window 2 only half of them count: 1.5 used, so one more fits
  assert.equal(l.hit("a", R, t0 + 90_000).ok, true);
});

test("the map stays bounded", () => {
  const l = new MemoryLimiter(100);
  const t0 = 5_000_000_000_000;
  for (let i = 0; i < 1000; i++) l.hit("k" + i, R, t0 + i);
  assert.ok(l.size <= 100);
});

test("route rules: costly ones are tight, polling ones are generous", () => {
  assert.equal(userRuleFor("/api/e2b/create").name, "pc-create");
  assert.equal(userRuleFor("/api/e2b/create").limit, 6);
  assert.equal(userRuleFor("/api/connectors/mcp-search").name, "mcp-search");
  assert.equal(userRuleFor("/api/connectors/catalog").name, "mcp-catalog");
  assert.equal(userRuleFor("/api/vpassword").name, "secrets");
  assert.equal(userRuleFor("/api/deploy").name, "deploy");
  // multi-call pipelines and polling stay on the generous default
  assert.equal(userRuleFor("/api/venus/studio"), DEFAULT_USER_RULE);
  assert.equal(userRuleFor("/api/venus/run/step"), DEFAULT_USER_RULE);
  assert.equal(userRuleFor("/api/agent"), DEFAULT_USER_RULE);
  assert.equal(userRuleFor("/api/dashboard"), DEFAULT_USER_RULE);
});

test("IP rules: webhooks and cron ticks are exempt, auth routes are tight", () => {
  for (const p of ["/api/channels/telegram", "/api/channels/slack", "/api/channels/twilio", "/api/billing/gumroad", "/api/meetings/webhook", "/api/voice/twiml", "/api/routines/hook", "/api/agent/tick"]) assert.equal(ipRuleFor(p), null, p);
  assert.equal(ipRuleFor("/api/native-auth/start").name, "ip-auth");
  assert.equal(ipRuleFor("/api/mcp/oauth/token").name, "ip-auth");
  assert.equal(ipRuleFor("/api/billing/checkout").name, "ip-sensitive");
  assert.equal(ipRuleFor("/api/chat").name, "ip-api");
});

test("client ip comes from the proxy headers", () => {
  const h = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });
  assert.equal(clientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
  assert.equal(clientIp(h({ "x-real-ip": "5.6.7.8" })), "5.6.7.8");
  assert.equal(clientIp(h({})), "unknown");
});

test("helpers", () => {
  assert.equal(retryAfterSeconds(250), 1);
  assert.equal(retryAfterSeconds(1500), 2);
  assert.equal(rateLimitOn({}), true);
  assert.equal(rateLimitOn({ RATE_LIMIT: "off" }), false);
  assert.equal(rateLimitOn({ RATE_LIMIT: "on" }), true);
});
