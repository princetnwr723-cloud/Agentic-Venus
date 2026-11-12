// Native tool calling for every provider Venus supports. Builders and parsers are pure (tested with fixtures);
// callNative() is the only function that touches the network.
//   Anthropic  -> tools + tool_use / tool_result blocks, prompt caching
//   OpenAI-compatible (OpenAI, Grok, OpenRouter, Mistral, Groq, DeepSeek, Apinex) -> tools + tool_calls
//   Gemini     -> functionDeclarations + functionCall / functionResponse
//   Cohere, Perplexity -> no reliable tool API: a JSON protocol in the prompt (text mode)
import type { ProviderId } from "@/lib/providers";
import type { AgentMsg, Block, JsonSchema, ModelCall, ModelTurn, Prop, ToolDef, Usage } from "./types.ts";
import { systemBlocks, wireMessages, wireTools } from "./caching.ts";
import { parseArgs, parseLooseJson } from "./tool-repair.ts";
import { ProviderError, parseRetryAfter } from "./provider-errors.ts";
import type { NameMap } from "./tool-schema.ts";
import { consume, type StreamKind } from "./stream.ts";

export type NativeReq = {
  provider: ProviderId; apiKey: string; model: string;
  system: { stable: string; volatile: string };
  messages: AgentMsg[]; tools: ToolDef[]; maxTokens: number; names: NameMap;
  signal?: AbortSignal; cache?: boolean; longCache?: boolean;
  /** when set, the answer is streamed and every new piece of visible text is passed here */
  onText?: (delta: string) => void;
};

const OPENAI_URLS: Partial<Record<ProviderId, string>> = {
  openai: "https://api.openai.com/v1/chat/completions", grok: "https://api.x.ai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions", mistral: "https://api.mistral.ai/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions", deepseek: "https://api.deepseek.com/chat/completions",
  apinex: "https://apinex.bond/v1/chat/completions",
};
export const supportsNative = (p: ProviderId) => p === "anthropic" || p === "gemini" || p in OPENAI_URLS;

const zero = (): Usage => ({ inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0 });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const uid = (round: string, i: number) => `call_${round}_${i}`;
const joinText = (m: AgentMsg) => m.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n");

// ---------------- Anthropic ----------------
export function buildAnthropic(r: NativeReq) {
  const cache = r.cache !== false;
  return {
    model: r.model, max_tokens: r.maxTokens,
    system: systemBlocks(r.system.stable, r.system.volatile, r.longCache, cache),
    ...(r.tools.length ? { tools: wireTools(r.tools, r.names.toNative, r.longCache, cache) } : {}),
    messages: wireMessages(r.messages, r.names.toNative, r.longCache, cache),
  };
}

export function parseAnthropic(j: any, fromNative: NameMap["fromNative"]): ModelTurn {
  const blocks: any[] = Array.isArray(j?.content) ? j.content : [];
  const calls: ModelCall[] = blocks.filter((b) => b?.type === "tool_use").map((b, i) => ({
    id: String(b.id || uid("a", i)), name: fromNative(String(b.name)) ?? String(b.name), input: b.input && typeof b.input === "object" ? b.input : {},
  }));
  const u = j?.usage ?? {};
  const stop = j?.stop_reason === "tool_use" ? "tool_use" : j?.stop_reason === "max_tokens" ? "max_tokens" : j?.stop_reason === "end_turn" || j?.stop_reason === "stop_sequence" ? "end" : "other";
  return {
    text: blocks.filter((b) => b?.type === "text").map((b) => String(b.text ?? "")).join(""), calls,
    stop: calls.length ? "tool_use" : stop,
    usage: { inTok: num(u.input_tokens), outTok: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens) },
  };
}

// ---------------- OpenAI-compatible ----------------
export function buildOpenAI(r: NativeReq) {
  const out: any[] = [];
  const sys = [r.system.stable, r.system.volatile].filter((s) => s.trim()).join("\n\n");
  if (sys) out.push({ role: "system", content: sys });
  for (const m of r.messages) {
    if (m.role === "assistant") {
      const uses = m.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
      out.push({ role: "assistant", content: joinText(m) || null, ...(uses.length ? { tool_calls: uses.map((u) => ({ id: u.id, type: "function", function: { name: r.names.toNative(u.name), arguments: JSON.stringify(u.input ?? {}) } })) } : {}) });
    } else {
      for (const b of m.content) if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.toolUseId, content: b.content || "(empty)" });
      const t = joinText(m);
      if (t.trim()) out.push({ role: "user", content: t });
    }
  }
  const o3 = r.provider === "openai";
  return {
    model: r.model, messages: out,
    ...(r.tools.length ? { tools: r.tools.map((t) => ({ type: "function", function: { name: r.names.toNative(t.name), description: t.description, parameters: t.schema } })), tool_choice: "auto" } : {}),
    ...(o3 ? { max_completion_tokens: r.maxTokens } : { max_tokens: r.maxTokens }),
  };
}

export function parseOpenAI(j: any, fromNative: NameMap["fromNative"]): ModelTurn {
  const ch = j?.choices?.[0];
  const msg = ch?.message ?? {};
  const calls: ModelCall[] = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((c: any, i: number) => {
    const raw = typeof c?.function?.arguments === "string" ? c.function.arguments : JSON.stringify(c?.function?.arguments ?? {});
    const p = parseArgs(raw);
    return { id: String(c?.id || uid("o", i)), name: fromNative(String(c?.function?.name)) ?? String(c?.function?.name), input: p.args, raw: p.failed ? raw : undefined };
  });
  const u = j?.usage ?? {};
  const cached = num(u.prompt_tokens_details?.cached_tokens) || num(u.prompt_cache_hit_tokens);
  const stop = ch?.finish_reason === "length" ? "max_tokens" : calls.length ? "tool_use" : ch?.finish_reason === "stop" ? "end" : "other";
  return {
    text: typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.map((p: any) => p?.text ?? "").join("") : "",
    calls, stop, usage: { inTok: Math.max(0, num(u.prompt_tokens) - cached), outTok: num(u.completion_tokens), cacheRead: cached, cacheWrite: 0 },
  };
}

// ---------------- Gemini ----------------
function geminiProp(p: Prop): Record<string, unknown> {
  const t = p.type ?? "string";
  return { type: t, ...(p.description ? { description: p.description } : {}), ...(t === "array" ? { items: geminiProp(p.items ?? { type: "string" }) } : {}), ...(p.enum ? { enum: p.enum } : {}) };
}
export const geminiSchema = (s: JsonSchema) => ({ type: "object", properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, geminiProp(v)])), ...(s.required?.length ? { required: s.required } : {}) });

export function buildGemini(r: NativeReq) {
  const idToName = new Map<string, string>();
  for (const m of r.messages) for (const b of m.content) if (b.type === "tool_use") idToName.set(b.id, b.name);
  const contents: any[] = [];
  for (const m of r.messages) {
    const parts: any[] = [];
    for (const b of m.content) {
      if (b.type === "text" && b.text.trim()) parts.push({ text: b.text });
      else if (b.type === "tool_use") parts.push({ functionCall: { name: r.names.toNative(b.name), args: b.input ?? {} }, ...(b.meta?.thoughtSignature ? { thoughtSignature: b.meta.thoughtSignature } : {}) });
      else if (b.type === "tool_result") parts.push({ functionResponse: { name: r.names.toNative(idToName.get(b.toolUseId) ?? "tool"), response: { result: b.content || "(empty)", ...(b.isError ? { error: true } : {}) } } });
    }
    if (parts.length) contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  const sys = [r.system.stable, r.system.volatile].filter((s) => s.trim()).join("\n\n");
  return {
    contents, ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
    ...(r.tools.length ? { tools: [{ functionDeclarations: r.tools.map((t) => ({ name: r.names.toNative(t.name), description: t.description, parameters: geminiSchema(t.schema) })) }] } : {}),
    generationConfig: { maxOutputTokens: r.maxTokens },
  };
}

export function parseGemini(j: any, fromNative: NameMap["fromNative"]): ModelTurn {
  const cand = j?.candidates?.[0];
  const parts: any[] = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
  const calls: ModelCall[] = parts.filter((p) => p?.functionCall).map((p, i) => ({
    id: uid("g", i) + Math.random().toString(36).slice(2, 6), name: fromNative(String(p.functionCall.name)) ?? String(p.functionCall.name),
    input: p.functionCall.args && typeof p.functionCall.args === "object" ? p.functionCall.args : {},
    ...(p.thoughtSignature ? { meta: { thoughtSignature: p.thoughtSignature } } : {}),
  }));
  const u = j?.usageMetadata ?? {};
  const cached = num(u.cachedContentTokenCount);
  return {
    text: parts.filter((p) => typeof p?.text === "string" && !p.thought).map((p) => p.text).join(""), calls,
    stop: calls.length ? "tool_use" : cand?.finishReason === "MAX_TOKENS" ? "max_tokens" : cand?.finishReason === "STOP" ? "end" : "other",
    usage: { inTok: Math.max(0, num(u.promptTokenCount) - cached), outTok: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount), cacheRead: cached, cacheWrite: 0 },
  };
}

// ---------------- text protocol (Cohere, Perplexity) ----------------
export function textProtocol(tools: ToolDef[]): string {
  const list = tools.map((t) => `- ${t.name}(${Object.entries(t.schema.properties).map(([k, p]) => `${k}${t.schema.required?.includes(k) ? "" : "?"}:${p.type ?? "any"}`).join(", ")}): ${t.description.slice(0, 200)}`).join("\n");
  return `You can call tools. To call tools reply with ONLY this JSON and nothing else:\n{"tool_calls":[{"name":"<tool name>","args":{...}}]}\nWhen you are finished reply with plain text (no JSON). Tools:\n${list}`;
}

export function renderAsText(msgs: AgentMsg[]): Array<{ role: "user" | "assistant"; content: string }> {
  return msgs.map((m) => ({
    role: m.role,
    content: m.content.map((b) => b.type === "text" ? b.text : b.type === "tool_use" ? `{"tool_calls":[{"name":"${b.name}","args":${JSON.stringify(b.input)}}]}` : `TOOL RESULT (${b.toolUseId})${b.isError ? " ERROR" : ""}:\n${b.content}`).join("\n"),
  }));
}

export function parseTextTurn(reply: string, round: string): ModelTurn {
  const loose = parseLooseJson(reply.slice(Math.max(0, reply.indexOf("{"))));
  const arr = loose.ok && loose.value && typeof loose.value === "object" ? (loose.value as { tool_calls?: unknown }).tool_calls : undefined;
  const calls: ModelCall[] = (Array.isArray(arr) ? arr : []).filter((c): c is { name: string; args?: unknown } => Boolean(c) && typeof (c as { name?: unknown }).name === "string")
    .map((c, i) => ({ id: uid(round, i), name: c.name, input: parseArgs(c.args ?? {}).args }));
  return { text: calls.length ? "" : reply, calls, stop: calls.length ? "tool_use" : "end", usage: zero() };
}

// ---------------- network ----------------
async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<any> {
  const timeout = AbortSignal.timeout(100_000);
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || (typeof data?.error === "string" ? data.error : "") || data?.message || `request failed`;
    const ra = Number(res.headers.get("retry-after"));
    throw new ProviderError(`${res.status}: ${msg}`, res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : parseRetryAfter(String(msg)));
  }
  return data;
}

async function postStream(url: string, headers: Record<string, string>, body: unknown, kind: StreamKind, onText: (d: string) => void, signal?: AbortSignal): Promise<any> {
  const timeout = AbortSignal.timeout(100_000);
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...headers }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}));
    const msg = data?.error?.message || (typeof data?.error === "string" ? data.error : "") || data?.message || "request failed";
    const ra = Number(res.headers.get("retry-after"));
    throw new ProviderError(`${res.status}: ${msg}`, res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : parseRetryAfter(String(msg)));
  }
  return consume(res, kind, onText);
}

/** A provider that answers 0 tokens in a stream (some OpenAI-compatible ones do) must not be billed as free: estimate from size. */
export function withUsageEstimate(t: ModelTurn, sentChars: number): ModelTurn {
  const u = t.usage;
  if (u.inTok + u.outTok + u.cacheRead + u.cacheWrite > 0) return t;
  const out = t.text.length + t.calls.reduce((n, c) => n + JSON.stringify(c.input ?? {}).length + c.name.length, 0);
  return { ...t, usage: { inTok: Math.ceil(sentChars / 4), outTok: Math.ceil(out / 4), cacheRead: 0, cacheWrite: 0 } };
}

/** Only an HTTP-level refusal of streaming itself may fall back to a normal call (never after text was already shown). */
export const streamUnsupported = (e: unknown) => e instanceof ProviderError && ((e.status === 400 && /\bstream/i.test(e.message) && !/stream_options|include_usage/i.test(e.message)) || e.status === 405 || e.status === 501);
const wantsNoStreamOptions = (e: unknown) => e instanceof ProviderError && e.status === 400 && /stream_options|include_usage|unknown (parameter|field)|unrecognized/i.test(e.message);

async function callStreaming(r: NativeReq): Promise<ModelTurn> {
  const on = r.onText as (d: string) => void;
  if (r.provider === "anthropic") {
    const headers = { "x-api-key": r.apiKey, "anthropic-version": "2023-06-01" };
    const go = (c: NativeReq) => postStream("https://api.anthropic.com/v1/messages", headers, { ...buildAnthropic(c), stream: true }, "anthropic", on, c.signal);
    try { return parseAnthropic(await go(r), r.names.fromNative); }
    catch (e) {
      if (e instanceof ProviderError && e.status === 400 && /cache_control|ttl/i.test(e.message)) return parseAnthropic(await go({ ...r, cache: false }), r.names.fromNative);
      throw e;
    }
  }
  if (r.provider === "gemini") {
    const body = buildGemini(r);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${r.model}:streamGenerateContent?alt=sse`;
    return withUsageEstimate(parseGemini(await postStream(url, { "x-goog-api-key": r.apiKey }, body, "gemini", on, r.signal), r.names.fromNative), JSON.stringify(body).length);
  }
  const url = OPENAI_URLS[r.provider];
  if (!url) throw new ProviderError(`No native tool endpoint for ${r.provider}`, 400);
  const base = buildOpenAI(r);
  const headers = { Authorization: `Bearer ${r.apiKey}` };
  const size = JSON.stringify(base).length;
  const go = (opts: boolean) => postStream(url, headers, { ...base, stream: true, ...(opts ? { stream_options: { include_usage: true } } : {}) }, "openai", on, r.signal);
  try { return withUsageEstimate(parseOpenAI(await go(true), r.names.fromNative), size); }
  catch (e) {
    if (wantsNoStreamOptions(e)) return withUsageEstimate(parseOpenAI(await go(false), r.names.fromNative), size);
    throw e;
  }
}

export async function callNative(r: NativeReq): Promise<ModelTurn> {
  if (r.onText) {
    try { return await callStreaming(r); }
    catch (e) { if (!streamUnsupported(e)) throw e; /* this provider or model refuses streaming: ask normally */ }
  }
  if (r.provider === "anthropic") {
    const headers = { "x-api-key": r.apiKey, "anthropic-version": "2023-06-01" };
    try { return parseAnthropic(await post("https://api.anthropic.com/v1/messages", headers, buildAnthropic(r), r.signal), r.names.fromNative); }
    catch (e) {
      // an account or model without caching support: same request, no cache marks
      if (e instanceof ProviderError && e.status === 400 && /cache_control|ttl/i.test(e.message)) return parseAnthropic(await post("https://api.anthropic.com/v1/messages", headers, buildAnthropic({ ...r, cache: false }), r.signal), r.names.fromNative);
      throw e;
    }
  }
  if (r.provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${r.model}:generateContent`;
    return parseGemini(await post(url, { "x-goog-api-key": r.apiKey }, buildGemini(r), r.signal), r.names.fromNative);
  }
  const url = OPENAI_URLS[r.provider];
  if (!url) throw new ProviderError(`No native tool endpoint for ${r.provider}`, 400);
  return parseOpenAI(await post(url, { Authorization: `Bearer ${r.apiKey}` }, buildOpenAI(r), r.signal), r.names.fromNative);
}
