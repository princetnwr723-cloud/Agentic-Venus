import test from "node:test";
import assert from "node:assert/strict";
import { classifyError, parseRetryAfter, backoffMs, ProviderError, userMessage } from "../../lib/agent/provider-errors.ts";
import { parseLooseJson, parseArgs, resolveToolName, checkArgs, repairMessage } from "../../lib/agent/tool-repair.ts";
import { paramsToSchema, buildNameMap, toolDef } from "../../lib/agent/tool-schema.ts";
import { computeStrength, tierOf, sweep, touch, recallScore } from "../../lib/agent/decay.ts";
import { requestTakeover, startTakeover, beat, endedBecause, handBack, nextCheck, TAKEOVER_CAP_MS, TAKEOVER_UNWATCHED_MS } from "../../lib/agent/takeover.ts";
import { costMicros, latchFromError, latchActive, latchFromPlan, summarizeRuns, emptyUsage, addUsage } from "../../lib/agent/budget.ts";
import { HITL_TOOLS, pendingFromHitl, pendingFromApproval, resultFromReply, safeSecretName, isHitlName } from "../../lib/agent/hitl.ts";
import { wireMessages, wireTools, systemBlocks, countBreakpoints } from "../../lib/agent/caching.ts";

// ---------- provider errors ----------
test("classifies the common provider errors", () => {
  assert.equal(classifyError(new Error("Anthropic 429: rate_limit_error")).code, "rate_limited");
  assert.equal(classifyError(new Error("529 overloaded_error")).code, "overloaded");
  assert.equal(classifyError(new Error("Your credit balance is too low")).code, "no_credit");
  assert.equal(classifyError(new Error("429 You exceeded your current quota (insufficient_quota)")).code, "no_credit");
  assert.equal(classifyError(new Error("402: Insufficient Balance (request_id: abc)")).code, "no_credit");
  assert.equal(classifyError(new Error("monthly limit reached")).code, "usage_limit");
  assert.equal(classifyError(new Error("invalid x-api-key")).code, "unauthorized");
  assert.equal(classifyError(new Error("prompt is too long: 250000 tokens > 200000 maximum")).code, "context_exceeded");
  assert.equal(classifyError(new Error("model: gpt-9 does not exist")).code, "model_not_found");
  assert.equal(classifyError(new Error("fetch failed")).code, "network");
  assert.equal(classifyError(new Error("something odd")).code, "unknown");
  assert.equal(classifyError(new ProviderError("boom", 503)).code, "overloaded");
});
test("retry flags follow the code", () => {
  assert.equal(classifyError(new Error("429 rate limit")).retryable, true);
  assert.equal(classifyError(new Error("401 unauthorized")).retryable, false);
  assert.equal(classifyError(new Error("401 unauthorized")).permanent, true);
  assert.equal(classifyError(new Error("invalid_request_error")).switchProvider, false);
});
test("retry-after is parsed in all units and bounds the backoff", () => {
  assert.equal(parseRetryAfter("Please retry after 20 seconds"), 20_000);
  assert.equal(parseRetryAfter("try again in 1.5s"), 1500);
  assert.equal(parseRetryAfter("retry-after: 2 minutes"), 120_000);
  assert.equal(parseRetryAfter("nothing"), undefined);
  const c = classifyError(new Error("429 rate limit, retry after 5 seconds"));
  assert.equal(backoffMs(0, c), 5000);
  assert.equal(backoffMs(5, c), 20_000);
});
test("user messages tell the owner what to do", () => {
  assert.match(userMessage(classifyError(new Error("insufficient_quota"))), /credit|quota/i);
  assert.match(userMessage(classifyError(new Error("invalid api key"))), /Settings/);
});

// ---------- lenient json / tool repair ----------
test("loose json repairs the usual model mistakes", () => {
  const cases = [
    ['{"a":1,}', { a: 1 }],
    ["{'a': 'x', b: 2}", { a: "x", b: 2 }],
    ['```json\n{"a":[1,2,]}\n```', { a: [1, 2] }],
    ['{"a": True, "b": None}', { a: true, b: null }],
    ['{"text": "line1\nline2"}', { text: "line1\nline2" }],
    ['{"a": 1, "b": "cut off', { a: 1, b: "cut off" }],
    ['{"a": {"b": [1, 2', { a: { b: [1, 2] } }],
    ['// note\n{"a": 1 /* x */}', { a: 1 }],
  ];
  for (const [input, want] of cases) {
    const r = parseLooseJson(input);
    assert.ok(r.ok, input);
    assert.deepEqual(r.value, want, input);
  }
  assert.equal(parseLooseJson("no json here").ok, false);
  assert.equal(parseLooseJson("").ok, false);
});
test("valid json is not marked repaired", () => {
  const r = parseLooseJson('{"a":1}');
  assert.equal(r.repaired, false);
});
test("parseArgs handles objects, strings and garbage", () => {
  assert.deepEqual(parseArgs({ a: 1 }).args, { a: 1 });
  assert.equal(parseArgs("{'a':1}").repaired, true);
  assert.equal(parseArgs("").failed, false);
  assert.equal(parseArgs("not json at all").failed, true);
});
test("tool names are matched across spellings and typos, never guessed when ambiguous", () => {
  const known = ["plan.set", "plan.done", "web.search", "web.read", "github.create_issue"];
  const from = (n) => (n === "plan__set" ? "plan.set" : undefined);
  assert.deepEqual(resolveToolName("plan.set", known), { name: "plan.set", how: "exact" });
  assert.equal(resolveToolName("plan__set", known, from).name, "plan.set");
  assert.equal(resolveToolName("Plan.Set", known).name, "plan.set");
  assert.equal(resolveToolName("web-search", known).name, "web.search");
  assert.equal(resolveToolName("web.serch", known).name, "web.search");
  const bad = resolveToolName("send_nuclear_email", known);
  assert.equal(bad.name, null);
  assert.ok(bad.suggestions.length > 0);
  assert.equal(resolveToolName("plan", known).name, null);
});
test("arguments are coerced and checked against the schema", () => {
  const schema = paramsToSchema("steps:string[], title?:string, limit?:number, flag?:boolean");
  const r = checkArgs(schema, { steps: '["a","b"]', limit: "5", flag: "true" });
  assert.deepEqual(r.args, { steps: ["a", "b"], limit: 5, flag: true });
  assert.deepEqual(r.errors, []);
  const miss = checkArgs(schema, { title: "x" });
  assert.match(miss.errors[0], /missing required argument "steps"/);
  assert.equal(checkArgs(schema, { steps: "one" }).args.steps[0], "one");
  assert.match(repairMessage("plan.set", miss.errors, schema), /Expected arguments: steps:array/);
});

// ---------- schema from Venus param strings ----------
test("Venus param strings become JSON schemas", () => {
  const s = paramsToSchema("to:string, subject:string, body:string, cc?:string[] (extra), items:[{to, subject}] (up to 30), limit?:number");
  assert.deepEqual(s.required, ["to", "subject", "body", "items"]);
  assert.equal(s.properties.cc.type, "array");
  assert.equal(s.properties.items.type, "array");
  assert.equal(s.properties.items.items.type, "object");
  assert.equal(s.properties.limit.type, "number");
  assert.deepEqual(paramsToSchema("").properties, {});
  assert.deepEqual(paramsToSchema("(none)").properties, {});
});
test("commas inside brackets and notes do not split parameters", () => {
  const s = paramsToSchema("text:string, to?:+E164 number (default: the owner, or a list), items:[{to:+E164, text}] (up to 20)");
  assert.deepEqual(Object.keys(s.properties), ["text", "to", "items"]);
  assert.deepEqual(s.required, ["text", "items"]);
});
test("native names are safe, unique and reversible", () => {
  const m = buildNameMap(["plan.set", "plan__set", "mcp_my-server.do:it", "9lives.x"]);
  const a = m.toNative("plan.set"), b = m.toNative("plan__set");
  assert.notEqual(a, b);
  assert.equal(m.fromNative(a), "plan.set");
  assert.equal(m.fromNative(b), "plan__set");
  for (const n of ["plan.set", "mcp_my-server.do:it", "9lives.x"]) assert.match(m.toNative(n), /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/);
  const d = toolDef({ name: "a.b", description: "d", params: "x:string", risk: "write" });
  assert.equal(d.risk, "write");
});

// ---------- memory decay ----------
const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 10);
test("strength halves at the half-life and grows with use", () => {
  const pref = { id: "1", text: "x", at: now - 90 * DAY, kind: "preference", weight: 1 };
  assert.ok(Math.abs(computeStrength(pref, now) - 0.5) < 1e-9);
  const used = { ...pref, accessCount: 3, lastAccessedAt: now - DAY };
  assert.ok(computeStrength(used, now) > 1.9);
});
test("tasks fade fast, roles never fade, pinned never fade", () => {
  assert.equal(tierOf({ id: "t", text: "", at: now - 20 * DAY, kind: "task" }, now), "archived");
  assert.equal(tierOf({ id: "r", text: "", at: now - 5000 * DAY, kind: "role" }, now), "active");
  assert.equal(tierOf({ id: "p", text: "", at: now - 5000 * DAY, kind: "fact", pinned: true }, now), "active");
});
test("sweep splits into tiers and touch revives", () => {
  const items = [
    { id: "a", text: "", at: now - DAY, kind: "fact" },
    { id: "b", text: "", at: now - 11 * DAY, kind: "task" },
    { id: "c", text: "", at: now - 20 * DAY, kind: "task" },
  ];
  const s = sweep(items, now);
  assert.deepEqual(s.active.map((m) => m.id), ["a"]);
  assert.deepEqual(s.dormant.map((m) => m.id), ["b"]);
  assert.deepEqual(s.archived.map((m) => m.id), ["c"]);
  const revived = touch(items, new Set(["b"]), now);
  assert.equal(revived[1].accessCount, 1);
  assert.equal(tierOf(revived[1], now), "active");
  assert.ok(recallScore(1, items[1], now) < recallScore(1, items[0], now));
});

// ---------- takeover ----------
test("takeover: request, start, beat, hand back", () => {
  let t = requestTakeover(1000);
  assert.equal(t.status, "requested");
  t = startTakeover(t, 2000);
  assert.equal(t.status, "active");
  assert.equal(endedBecause(t, 2000 + 10_000), null);
  t = beat(t, 50_000);
  assert.equal(endedBecause(t, 50_000 + TAKEOVER_UNWATCHED_MS - 1), null);
  assert.equal(endedBecause(t, 50_000 + TAKEOVER_UNWATCHED_MS), "unwatched");
  const done = handBack(t, 60_000);
  assert.equal(done.status, "handed_back");
  assert.throws(() => startTakeover(done, 1));
});
test("takeover ends at the time cap even with heartbeats", () => {
  let t = startTakeover(requestTakeover(0), 0);
  t = beat(t, TAKEOVER_CAP_MS - 1000);
  assert.equal(endedBecause(t, TAKEOVER_CAP_MS), "time_cap");
  assert.equal(handBack(t, TAKEOVER_CAP_MS, "time_cap").status, "expired");
  assert.equal(nextCheck(startTakeover(requestTakeover(0), 0)), TAKEOVER_UNWATCHED_MS);
  assert.equal(nextCheck(requestTakeover(0)), Number.MAX_SAFE_INTEGER);
});

// ---------- budget ----------
test("cost uses real token counts and cache discounts", () => {
  const u = { inTok: 1_000_000, outTok: 1_000_000, cacheRead: 0, cacheWrite: 0 };
  assert.equal(costMicros("claude-sonnet-4-5", u), 18_000_000);
  const cached = { inTok: 0, outTok: 0, cacheRead: 1_000_000, cacheWrite: 0 };
  assert.equal(costMicros("claude-sonnet-4-5", cached), 300_000);
  assert.equal(costMicros("claude-3-opus", { ...u, outTok: 0 }), 15_000_000);
  assert.ok(costMicros("unknown-model-x", u) > 0);
  assert.deepEqual(addUsage(emptyUsage(), { inTok: 1, outTok: 2, cacheRead: 3, cacheWrite: 4 }), { inTok: 1, outTok: 2, cacheRead: 3, cacheWrite: 4 });
});
test("only lasting errors arm the latch", () => {
  const t0 = 1_000_000;
  assert.equal(latchFromError(classifyError(new Error("429 rate limit")), t0), null);
  assert.equal(latchFromError(classifyError(new Error("insufficient_quota")), t0), null);
  const l = latchFromError(classifyError(new Error("monthly limit reached")), t0);
  assert.equal(l.kind, "provider");
  assert.ok(latchActive(l, t0 + 1000));
  assert.ok(!latchActive(l, l.until + 1));
  const long = latchFromError(classifyError(new Error("429 rate limit, retry after 1 hour")), t0);
  assert.ok(long && long.until >= t0 + 3600_000);
  assert.equal(latchFromPlan(t0 - 5, t0, "x").until, t0 + 60_000);
});
test("report adds up runs by model and day", () => {
  const n = Date.UTC(2026, 10, 10, 12);
  const row = (id, status, model, off, cost) => ({ id, status, model, createdAt: n - off, endedAt: n - off + 30_000, costMicros: cost, usage: { inTok: 100, outTok: 50, cacheRead: 0, cacheWrite: 0 }, calls: 2, rounds: 2 });
  const r = summarizeRuns([row("1", "done", "m1", 1000, 500), row("2", "error", "m1", 2000, 300), row("3", "done", "m2", 9 * DAY, 100)], n, 7);
  assert.equal(r.runs, 2);
  assert.equal(r.done, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.costMicros, 800);
  assert.equal(r.byModel.m1.runs, 2);
  assert.equal(r.avgSeconds, 30);
});

// ---------- HITL ----------
test("four HITL tools exist with schemas", () => {
  assert.deepEqual(HITL_TOOLS.map((t) => t.name), ["ask_user", "request_approval", "request_secret", "request_takeover"]);
  assert.ok(isHitlName("ask_user"));
  assert.ok(!isHitlName("plan.set"));
});
test("pending cards are built clean and expire", () => {
  const p = pendingFromHitl({ id: "c1", name: "ask_user", input: { question: "  Which   one? ", options: ["A", "B", "", "C", "D", "E", "F"] } }, 1000);
  assert.equal(p.kind, "ask_user");
  assert.equal(p.question, "Which one?");
  assert.deepEqual(p.options, ["A", "B", "C", "D", "E"]);
  assert.equal(p.expiresAt, 1000 + 24 * 3600_000);
  const s = pendingFromHitl({ id: "c2", name: "request_secret", input: { name: "Stripe Key!!", reason: "pay" } }, 1);
  assert.equal(s.secretName, "stripe_key");
  assert.equal(safeSecretName("  A/B c "), "a_b_c");
  const a = pendingFromApproval({ id: "c3", name: "mail.send", input: { to: "x" } }, "Send mail", 1, true);
  assert.equal(a.kind, "approve_tool");
  assert.equal(a.tainted, true);
});
test("replies become tool results, secrets never contain the value", () => {
  const ask = pendingFromHitl({ id: "c", name: "ask_user", input: { question: "q" } }, 1);
  assert.match(resultFromReply(ask, { action: "answer", text: "Blue" }).content, /Blue/);
  const app = pendingFromApproval({ id: "c", name: "mail.send", input: {} }, "s", 1, false);
  assert.equal(resultFromReply(app, { action: "approve" }).isError, false);
  assert.equal(resultFromReply(app, { action: "deny", note: "no" }).isError, true);
  assert.match(resultFromReply(app, { action: "timeout" }).content, /24 hours/);
  const sec = pendingFromHitl({ id: "c", name: "request_secret", input: { name: "k", reason: "r" } }, 1);
  const r = resultFromReply(sec, { action: "secret", name: "agent.chat.k" });
  assert.match(r.content, /vault:agent\.chat\.k/);
  const tk = pendingFromHitl({ id: "c", name: "request_takeover", input: { reason: "captcha" } }, 1);
  assert.match(resultFromReply(tk, { action: "takeover_done", seconds: 180, note: "solved" }).content, /3 min/);
});

// ---------- prompt caching ----------
test("cache marks: stable system, last tool, tail and previous tail; never more than 4", () => {
  const nm = (n) => n.replace(/\./g, "__");
  const msgs = [];
  for (let i = 0; i < 6; i++) msgs.push({ role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: `m${i}` }] });
  const body = {
    system: systemBlocks("STABLE", "volatile today", false),
    tools: wireTools([{ name: "a.b", description: "d", schema: { type: "object", properties: {} } }], nm),
    messages: wireMessages(msgs, nm),
  };
  assert.equal(countBreakpoints(body), 4);
  assert.ok(body.system[0].cache_control);
  assert.equal(body.system[1].cache_control, undefined);
  assert.ok(body.messages.at(-1).content.at(-1).cache_control);
  assert.ok(body.messages.at(-3).content.at(-1).cache_control);
  assert.equal(body.tools[0].name, "a__b");
  const none = wireMessages(msgs, nm, false, false);
  assert.equal(countBreakpoints({ messages: none }), 0);
  assert.equal(systemBlocks("S", "", true)[0].cache_control.ttl, "1h");
});
test("wire messages drop empty text and keep tool pairs", () => {
  const w = wireMessages([
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "assistant", content: [{ type: "text", text: "  " }, { type: "tool_use", id: "t1", name: "web.read", input: { url: "u" } }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: "", isError: true }] },
  ], (n) => n.replace(".", "__"), false, false);
  assert.equal(w[1].content.length, 1);
  assert.equal(w[1].content[0].name, "web__read");
  assert.equal(w[2].content[0].tool_use_id, "t1");
  assert.equal(w[2].content[0].is_error, true);
  assert.equal(w[2].content[0].content, "(empty)");
});
