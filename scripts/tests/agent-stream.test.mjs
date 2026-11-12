import test from "node:test";
import assert from "node:assert/strict";
import { SseParser, consume, liveSink } from "../../lib/agent/stream.ts";
import { callNative, parseAnthropic, parseOpenAI, parseGemini, withUsageEstimate } from "../../lib/agent/native-call.ts";
import { buildNameMap } from "../../lib/agent/tool-schema.ts";
import { classifyError } from "../../lib/agent/provider-errors.ts";

const names = buildNameMap(["web.search", "ask_user"]);
const sse = (items) => items.map((i) => (i.event ? `event: ${i.event}\n` : "") + `data: ${typeof i.data === "string" ? i.data : JSON.stringify(i.data)}\n\n`).join("");
/** A Response whose body arrives in pieces of `size` characters, so events are cut in the middle. */
const resp = (text, size = 7, init = {}) => {
  const enc = new TextEncoder();
  let i = 0;
  return new Response(new ReadableStream({ pull(c) { if (i >= text.length) return c.close(); c.enqueue(enc.encode(text.slice(i, i + size))); i += size; } }), { status: 200, headers: { "content-type": "text/event-stream" }, ...init });
};
const collect = async (r, kind, idle) => { const out = []; const j = await consume(r, kind, (d) => out.push(d), idle); return { j, text: out.join(""), pieces: out }; };

test("SSE parser: events cut anywhere, CRLF, comments, multi-line data", () => {
  const raw = ": ping\r\nevent: a\r\ndata: one\r\n\r\ndata: x\ndata: y\n\nevent: b\ndata: last\n\n";
  for (const size of [1, 2, 3, 5, 11, 100]) {
    const p = new SseParser(); const got = [];
    for (let i = 0; i < raw.length; i += size) got.push(...p.push(raw.slice(i, i + size)));
    got.push(...p.flush());
    assert.deepEqual(got, [{ event: "a", data: "one" }, { event: "message", data: "x\ny" }, { event: "b", data: "last" }], `size ${size}`);
  }
});
test("SSE parser: a final event without the blank line is not lost", () => {
  const p = new SseParser();
  assert.equal(p.push("data: tail").length, 0);
  assert.deepEqual(p.flush(), [{ event: "message", data: "tail" }]);
});

const anthropicStream = sse([
  { event: "message_start", data: { type: "message_start", message: { usage: { input_tokens: 120, cache_read_input_tokens: 80, output_tokens: 1 } } } },
  { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me " } } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "look that up." } } },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
  { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "web__search", input: {} } } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"query\": \"ven" } } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "us agent\", \"n\": 3}" } } },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
  { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } } },
  { event: "message_stop", data: { type: "message_stop" } },
]);

test("Anthropic stream: text pieces, tool call from partial json, usage, same result as a normal answer", async () => {
  const { j, text, pieces } = await collect(resp(anthropicStream), "anthropic");
  assert.equal(text, "Let me look that up.");
  assert.deepEqual(pieces, ["Let me ", "look that up."]);
  const t = parseAnthropic(j, names.fromNative);
  assert.equal(t.text, "Let me look that up.");
  assert.equal(t.stop, "tool_use");
  assert.deepEqual(t.calls, [{ id: "toolu_1", name: "web.search", input: { query: "venus agent", n: 3 } }]);
  assert.deepEqual(t.usage, { inTok: 120, outTok: 42, cacheRead: 80, cacheWrite: 0 });
});
test("Anthropic stream: a broken tool json is repaired, an empty one becomes {}", async () => {
  const s = sse([
    { data: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "a", name: "ask_user", input: {} } } },
    { data: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"question\": \"ok?\"" } } }, // never closed
    { data: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "b", name: "web__search", input: {} } } },
    { data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } } },
  ]);
  const t = parseAnthropic((await collect(resp(s, 5), "anthropic")).j, names.fromNative);
  assert.deepEqual(t.calls.map((c) => [c.name, c.input]), [["ask_user", { question: "ok?" }], ["web.search", {}]]);
});
test("Anthropic stream: an error event in the middle becomes a typed, retryable provider error", async () => {
  const s = sse([{ data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } }, { event: "error", data: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }]);
  await assert.rejects(collect(resp(s), "anthropic"), (e) => { assert.equal(e.status, 529); const c = classifyError(e); assert.equal(c.code, "overloaded"); assert.equal(c.retryable, true); return true; });
});

test("OpenAI stream: content pieces, two tool calls by index, usage chunk, [DONE]", async () => {
  const s = sse([
    { data: { choices: [{ delta: { role: "assistant", content: "Checking" } }] } },
    { data: { choices: [{ delta: { content: " now." } }] } },
    { data: { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "web__search", arguments: "" } }] } }] } },
    { data: { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"query\":" } }] } }] } },
    { data: { choices: [{ delta: { tool_calls: [{ index: 1, id: "c2", function: { name: "ask_user", arguments: "{\"question\":\"ok\"}" } }] } }] } },
    { data: { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: " \"hi\"}" } }] } }] } },
    { data: { choices: [{ delta: {}, finish_reason: "tool_calls" }] } },
    { data: { choices: [], usage: { prompt_tokens: 300, completion_tokens: 25, prompt_tokens_details: { cached_tokens: 100 } } } },
    { data: "[DONE]" },
  ]);
  const { j, text } = await collect(resp(s, 9), "openai");
  assert.equal(text, "Checking now.");
  const t = parseOpenAI(j, names.fromNative);
  assert.deepEqual(t.calls.map((c) => [c.id, c.name, c.input]), [["c1", "web.search", { query: "hi" }], ["c2", "ask_user", { question: "ok" }]]);
  assert.equal(t.stop, "tool_use");
  assert.deepEqual(t.usage, { inTok: 200, outTok: 25, cacheRead: 100, cacheWrite: 0 });
});
test("OpenAI stream: a provider with no usage is estimated from size, never billed as free", async () => {
  const s = sse([{ data: { choices: [{ delta: { content: "x".repeat(400) }, finish_reason: "stop" }] } }, { data: "[DONE]" }]);
  const t = parseOpenAI((await collect(resp(s), "openai")).j, names.fromNative);
  assert.equal(t.usage.outTok, 0);
  const e = withUsageEstimate(t, 4000);
  assert.deepEqual([e.usage.inTok, e.usage.outTok], [1000, 100]);
  assert.equal(withUsageEstimate({ ...t, usage: { inTok: 5, outTok: 1, cacheRead: 0, cacheWrite: 0 } }, 4000).usage.inTok, 5);
});
test("OpenAI stream: an error object in the stream is raised", async () => {
  await assert.rejects(collect(resp(sse([{ data: { error: { message: "rate limit", code: 429 } } }])), "openai"), (e) => e.status === 429 && classifyError(e).code === "rate_limited");
});

test("Gemini stream: text merged across chunks, function call kept with its signature, last usage wins", async () => {
  const s = sse([
    { data: { candidates: [{ content: { parts: [{ text: "Hel" }] } }], usageMetadata: { promptTokenCount: 10 } } },
    { data: { candidates: [{ content: { parts: [{ text: "lo." }] } }] } },
    { data: { candidates: [{ content: { parts: [{ functionCall: { name: "web__search", args: { query: "q" } }, thoughtSignature: "SIG" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 7 } } },
  ]);
  const { j, text } = await collect(resp(s, 13), "gemini");
  assert.equal(text, "Hello.");
  const t = parseGemini(j, names.fromNative);
  assert.equal(t.text, "Hello.");
  assert.equal(t.calls[0].name, "web.search");
  assert.deepEqual(t.calls[0].input, { query: "q" });
  assert.deepEqual(t.calls[0].meta, { thoughtSignature: "SIG" });
  assert.deepEqual([t.usage.inTok, t.usage.outTok], [50, 7]);
});
test("Gemini stream: thinking text is not shown", async () => {
  const s = sse([{ data: { candidates: [{ content: { parts: [{ text: "secret thoughts", thought: true }, { text: "Answer." }] }, finishReason: "STOP" }] } }]);
  const { text, j } = await collect(resp(s), "gemini");
  assert.equal(text, "Answer.");
  assert.equal(parseGemini(j, names.fromNative).text, "Answer.");
});

test("a stream that goes silent is cut after the idle time", async () => {
  const dead = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("data: {}\n\n")); } /* never closes */ }));
  await assert.rejects(consume(dead, "openai", () => {}, 40), (e) => e.status === 504 && classifyError(e).retryable);
});

test("liveSink: throttled writes, last piece always flushed, long text keeps the tail", async () => {
  let clock = 0; const writes = [];
  const sink = liveSink((t) => writes.push(t), { ms: 700, max: 20, now: () => clock });
  sink.push("a"); clock = 100; sink.push("b"); clock = 200; sink.push("c"); // first push writes at once, the others wait
  await sink.flush();
  assert.equal(writes.length, 2);
  assert.equal(writes[0], "a");
  assert.equal(writes[1], "abc");
  sink.push("x".repeat(50)); await sink.flush();
  assert.ok(writes.at(-1).startsWith("…") && writes.at(-1).length <= 21);
  await sink.flush();
  const n = writes.length; await sink.flush(); assert.equal(writes.length, n, "nothing new = nothing written");
  sink.reset(); assert.equal(sink.text, "");
});

// ---- callNative end to end against a stubbed fetch ----
const realFetch = globalThis.fetch;
const base = (provider, extra = {}) => ({ provider, apiKey: "k", model: "m", system: { stable: "s", volatile: "v" }, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], tools: [], maxTokens: 100, names, ...extra });
test("callNative streams on Anthropic: stream flag sent, pieces delivered, turn parsed", async () => {
  let body;
  globalThis.fetch = async (url, init) => { body = JSON.parse(init.body); assert.match(String(url), /anthropic/); return resp(anthropicStream, 11); };
  try {
    const got = [];
    const t = await callNative(base("anthropic", { onText: (d) => got.push(d) }));
    assert.equal(body.stream, true);
    assert.equal(got.join(""), "Let me look that up.");
    assert.equal(t.calls[0].name, "web.search");
  } finally { globalThis.fetch = realFetch; }
});
test("callNative without onText stays a normal call", async () => {
  let body;
  globalThis.fetch = async (_u, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ content: [{ type: "text", text: "plain" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }); };
  try { const t = await callNative(base("anthropic")); assert.equal(body.stream, undefined); assert.equal(t.text, "plain"); } finally { globalThis.fetch = realFetch; }
});
test("callNative OpenAI-compatible: provider that rejects stream_options is retried without it", async () => {
  const bodies = [];
  const ok = sse([{ data: { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] } }, { data: "[DONE]" }]);
  globalThis.fetch = async (_u, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    return b.stream_options ? new Response(JSON.stringify({ error: { message: "Unknown parameter: stream_options" } }), { status: 400 }) : resp(ok);
  };
  try {
    const got = []; const t = await callNative(base("groq", { onText: (d) => got.push(d) }));
    assert.equal(bodies.length, 2); assert.ok(bodies[0].stream_options); assert.equal(bodies[1].stream_options, undefined);
    assert.equal(t.text, "ok"); assert.ok(t.usage.inTok > 0 && t.usage.outTok > 0, "estimated usage");
  } finally { globalThis.fetch = realFetch; }
});
test("callNative: a provider that refuses streaming (405) falls back to a normal call; a real error does not", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body); calls.push(Boolean(b.stream));
    return b.stream ? new Response(JSON.stringify({ error: { message: "method not allowed" } }), { status: 405 }) : new Response(JSON.stringify({ choices: [{ message: { content: "plain" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } }), { status: 200 });
  };
  try { const t = await callNative(base("mistral", { onText: () => {} })); assert.deepEqual(calls, [true, false]); assert.equal(t.text, "plain"); } finally { globalThis.fetch = realFetch; }
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 });
  try { await assert.rejects(callNative(base("openai", { onText: () => {} })), (e) => classifyError(e).code === "unauthorized"); } finally { globalThis.fetch = realFetch; }
});
test("callNative Gemini uses the streaming endpoint", async () => {
  let url;
  globalThis.fetch = async (u) => { url = String(u); return resp(sse([{ data: { candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 } } }])); };
  try { const t = await callNative(base("gemini", { onText: () => {} })); assert.match(url, /:streamGenerateContent\?alt=sse$/); assert.equal(t.text, "hi"); } finally { globalThis.fetch = realFetch; }
});
