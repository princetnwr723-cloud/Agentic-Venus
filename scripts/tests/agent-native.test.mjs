import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnthropic, parseAnthropic, buildOpenAI, parseOpenAI, buildGemini, parseGemini, geminiSchema,
  supportsNative, textProtocol, renderAsText, parseTextTurn,
} from "../../lib/agent/native-call.ts";
import { buildNameMap, paramsToSchema } from "../../lib/agent/tool-schema.ts";

const tools = [
  { name: "web.search", description: "Search", schema: paramsToSchema("query:string"), risk: "read" },
  { name: "mail.send", description: "Send", schema: paramsToSchema("to:string, body:string"), risk: "write" },
];
const names = buildNameMap(tools.map((t) => t.name));
const base = { apiKey: "k", model: "m", system: { stable: "STABLE", volatile: "VOL" }, tools, maxTokens: 1000, names };
const convo = [
  { role: "user", content: [{ type: "text", text: "find x" }] },
  { role: "assistant", content: [{ type: "text", text: "searching" }, { type: "tool_use", id: "tu1", name: "web.search", input: { query: "x" } }] },
  { role: "user", content: [{ type: "tool_result", toolUseId: "tu1", content: "found it" }] },
];

test("provider support table", () => {
  for (const p of ["anthropic", "openai", "gemini", "grok", "openrouter", "mistral", "groq", "deepseek", "apinex"]) assert.ok(supportsNative(p), p);
  for (const p of ["cohere", "perplexity"]) assert.ok(!supportsNative(p), p);
});

test("anthropic request: cached system, tools, tool_use and tool_result blocks", () => {
  const b = buildAnthropic({ ...base, provider: "anthropic", messages: convo });
  assert.equal(b.system[0].text, "STABLE");
  assert.ok(b.system[0].cache_control);
  assert.equal(b.system[1].cache_control, undefined);
  assert.equal(b.tools[0].name, "web__search");
  assert.equal(b.tools[0].input_schema.type, "object");
  assert.equal(b.messages[1].content[1].type, "tool_use");
  assert.equal(b.messages[2].content[0].tool_use_id, "tu1");
  const plain = buildAnthropic({ ...base, provider: "anthropic", messages: convo, cache: false });
  assert.ok(!JSON.stringify(plain).includes("cache_control"));
});

test("anthropic response parsing: calls, native names back, usage with cache", () => {
  const t = parseAnthropic({
    content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "x1", name: "mail__send", input: { to: "a" } }],
    stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
  }, names.fromNative);
  assert.equal(t.text, "ok");
  assert.deepEqual(t.calls, [{ id: "x1", name: "mail.send", input: { to: "a" } }]);
  assert.equal(t.stop, "tool_use");
  assert.deepEqual(t.usage, { inTok: 10, outTok: 5, cacheRead: 100, cacheWrite: 20 });
  assert.equal(parseAnthropic({ content: [{ type: "text", text: "x" }], stop_reason: "max_tokens", usage: {} }, names.fromNative).stop, "max_tokens");
});

test("openai request: tool role messages, tool_calls, max_completion_tokens for openai", () => {
  const b = buildOpenAI({ ...base, provider: "openai", messages: convo });
  assert.equal(b.messages[0].role, "system");
  assert.match(b.messages[0].content, /STABLE[\s\S]*VOL/);
  const asst = b.messages.find((m) => m.role === "assistant");
  assert.equal(asst.tool_calls[0].function.name, "web__search");
  assert.equal(asst.tool_calls[0].function.arguments, '{"query":"x"}');
  const tool = b.messages.find((m) => m.role === "tool");
  assert.equal(tool.tool_call_id, "tu1");
  assert.equal(b.max_completion_tokens, 1000);
  assert.equal(b.tools[0].function.parameters.type, "object");
  const g = buildOpenAI({ ...base, provider: "groq", messages: convo });
  assert.equal(g.max_tokens, 1000);
  assert.equal(g.max_completion_tokens, undefined);
});

test("openai response: arguments string is repaired, broken arguments are flagged, cached tokens split out", () => {
  const t = parseOpenAI({
    choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [
      { id: "c1", function: { name: "web__search", arguments: "{'query': 'x',}" } },
      { id: "c2", function: { name: "mail__send", arguments: "totally broken" } },
    ] } }],
    usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } },
  }, names.fromNative);
  assert.deepEqual(t.calls[0], { id: "c1", name: "web.search", input: { query: "x" }, raw: undefined });
  assert.equal(t.calls[1].raw, "totally broken");
  assert.equal(t.stop, "tool_use");
  assert.deepEqual(t.usage, { inTok: 200, outTok: 50, cacheRead: 800, cacheWrite: 0 });
  assert.equal(parseOpenAI({ choices: [{ finish_reason: "length", message: { content: "cut" } }], usage: {} }, names.fromNative).stop, "max_tokens");
});

test("gemini request: functionCall / functionResponse with the right names, schema without extras", () => {
  const b = buildGemini({ ...base, provider: "gemini", messages: convo });
  assert.equal(b.contents[1].role, "model");
  assert.equal(b.contents[1].parts[1].functionCall.name, "web__search");
  assert.equal(b.contents[2].parts[0].functionResponse.name, "web__search");
  assert.equal(b.systemInstruction.parts[0].text.includes("VOL"), true);
  assert.equal(b.tools[0].functionDeclarations.length, 2);
  const s = geminiSchema(paramsToSchema("a:string[], b?:number"));
  assert.equal(s.properties.a.items.type, "string");
  assert.deepEqual(s.required, ["a"]);
});

test("gemini response: calls get ids, thought signatures travel back", () => {
  const t = parseGemini({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hi" }, { functionCall: { name: "web__search", args: { query: "q" } }, thoughtSignature: "SIG" }] } }],
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, cachedContentTokenCount: 20 },
  }, names.fromNative);
  assert.equal(t.calls[0].name, "web.search");
  assert.ok(t.calls[0].id.length > 4);
  assert.deepEqual(t.calls[0].meta, { thoughtSignature: "SIG" });
  assert.equal(t.stop, "tool_use");
  assert.deepEqual(t.usage, { inTok: 30, outTok: 10, cacheRead: 20, cacheWrite: 0 });
  const again = buildGemini({ ...base, provider: "gemini", messages: [convo[0], { role: "assistant", content: [{ type: "tool_use", id: t.calls[0].id, name: "web.search", input: { query: "q" }, meta: t.calls[0].meta }] }] });
  assert.equal(again.contents[1].parts[0].thoughtSignature, "SIG");
});

test("text protocol for providers without native tools", () => {
  const p = textProtocol(tools);
  assert.match(p, /web\.search\(query:string\)/);
  const call = parseTextTurn('Sure!\n{"tool_calls":[{"name":"web.search","args":{"query":"x"}}]}', "r1");
  assert.equal(call.calls.length, 1);
  assert.equal(call.calls[0].name, "web.search");
  assert.deepEqual(call.calls[0].input, { query: "x" });
  const fin = parseTextTurn("All done, here is the answer.", "r2");
  assert.equal(fin.calls.length, 0);
  assert.equal(fin.text, "All done, here is the answer.");
  const rendered = renderAsText(convo);
  assert.match(rendered[1].content, /tool_calls/);
  assert.match(rendered[2].content, /TOOL RESULT \(tu1\)/);
});
