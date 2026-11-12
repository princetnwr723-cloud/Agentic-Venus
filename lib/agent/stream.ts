// Token streaming. The providers answer as Server-Sent Events; this file turns them into (a) text pieces for the owner to watch
// and (b) the SAME json a normal (non-streaming) answer would have had, so the existing parsers (parseAnthropic / parseOpenAI /
// parseGemini) are reused unchanged. Everything here is pure except consume(), which only reads a Response body.
import { ProviderError } from "./provider-errors.ts";
import { parseArgs } from "./tool-repair.ts";

export type SseEvent = { event: string; data: string };

/** Incremental Server-Sent-Events parser: feed it text pieces of any size, it returns the events that are complete. */
export class SseParser {
  private buf = "";
  private carry = "";
  push(chunk: string): SseEvent[] {
    let s = this.carry + chunk;
    this.carry = "";
    if (s.endsWith("\r")) { this.carry = "\r"; s = s.slice(0, -1); } // a "\r" at the end may be the first half of "\r\n"
    this.buf += s.replace(/\r\n|\r/g, "\n");
    const parts = this.buf.split("\n\n");
    this.buf = parts.pop() ?? "";
    return parts.map(block).filter((e): e is SseEvent => e !== null);
  }
  flush(): SseEvent[] {
    const rest = (this.buf + (this.carry ? "\n" : "")).trim();
    this.buf = ""; this.carry = "";
    const e = rest ? block(rest) : null;
    return e ? [e] : [];
  }
}
function block(b: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of b.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const i = line.indexOf(":");
    const field = i < 0 ? line : line.slice(0, i);
    const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

const ANTHROPIC_ERR: Record<string, number> = { overloaded_error: 529, rate_limit_error: 429, api_error: 500, authentication_error: 401, permission_error: 403, not_found_error: 404, invalid_request_error: 400, request_too_large: 413 };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Every fold has push(event) -> the new visible text (may be ""), and result() -> the json of a complete answer. */
export interface Fold { push(ev: any, name?: string): string; result(): any }

export class AnthropicFold implements Fold {
  private blocks: any[] = [];
  private usage: Record<string, number> = {};
  private stop: string | undefined;
  push(d: any, name?: string): string {
    const type = String(d?.type ?? name ?? "");
    if (type === "error") {
      const t = String(d?.error?.type ?? "");
      throw new ProviderError(`${ANTHROPIC_ERR[t] ?? 500}: ${d?.error?.message ?? "stream error"}`, ANTHROPIC_ERR[t] ?? 500);
    }
    if (type === "message_start") { this.usage = { ...(d?.message?.usage ?? {}) }; return ""; }
    if (type === "content_block_start") {
      const b = d?.content_block ?? {};
      const i = num(d?.index);
      this.blocks[i] = b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, input: {}, json: "" } : b.type === "text" ? { type: "text", text: String(b.text ?? "") } : { type: String(b.type ?? "other") };
      return b.type === "text" ? String(b.text ?? "") : "";
    }
    if (type === "content_block_delta") {
      const i = num(d?.index);
      const dl = d?.delta ?? {};
      const b = (this.blocks[i] ??= dl.type === "input_json_delta" ? { type: "tool_use", id: "", name: "", input: {}, json: "" } : { type: "text", text: "" });
      if (dl.type === "text_delta" && b.type === "text") { b.text += String(dl.text ?? ""); return String(dl.text ?? ""); }
      if (dl.type === "input_json_delta" && b.type === "tool_use") b.json += String(dl.partial_json ?? "");
      return "";
    }
    if (type === "message_delta") {
      if (d?.delta?.stop_reason) this.stop = String(d.delta.stop_reason);
      this.usage = { ...this.usage, ...(d?.usage ?? {}) };
    }
    return "";
  }
  result() {
    const content = this.blocks.filter(Boolean).map((b) => {
      if (b.type !== "tool_use") return b;
      const { json, ...rest } = b;
      return { ...rest, input: json ? parseArgs(json).args : {} };
    });
    return { content, stop_reason: this.stop, usage: this.usage };
  }
}

export class OpenAIFold implements Fold {
  private text = "";
  private calls: Array<{ id: string; name: string; args: string }> = [];
  private finish: string | undefined;
  private usage: any;
  push(d: any): string {
    if (d?.error) {
      const code = typeof d.error.code === "number" ? d.error.code : 500;
      throw new ProviderError(`${code}: ${d.error.message ?? (typeof d.error === "string" ? d.error : "stream error")}`, code);
    }
    if (d?.usage) this.usage = d.usage;
    const ch = d?.choices?.[0];
    if (!ch) return "";
    if (ch.finish_reason) this.finish = String(ch.finish_reason);
    const dl = ch.delta ?? {};
    for (const tc of Array.isArray(dl.tool_calls) ? dl.tool_calls : []) {
      // standard: "index" says which call a piece belongs to. A few providers omit it: a new id then starts a new call.
      let i = typeof tc?.index === "number" ? tc.index : tc?.id && this.calls.length && this.calls[this.calls.length - 1].id !== tc.id ? this.calls.length : Math.max(0, this.calls.length - 1);
      const slot = (this.calls[i] ??= { id: "", name: "", args: "" });
      if (tc?.id) slot.id = String(tc.id);
      if (tc?.function?.name && !slot.name) slot.name = String(tc.function.name);
      if (typeof tc?.function?.arguments === "string") slot.args += tc.function.arguments;
    }
    if (typeof dl.content === "string" && dl.content) { this.text += dl.content; return dl.content; }
    return "";
  }
  result() {
    const tool_calls = this.calls.filter((c) => c && c.name).map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } }));
    return { choices: [{ message: { content: this.text || null, ...(tool_calls.length ? { tool_calls } : {}) }, finish_reason: this.finish }], usage: this.usage };
  }
}

export class GeminiFold implements Fold {
  private parts: any[] = [];
  private finish: string | undefined;
  private usage: any;
  push(d: any): string {
    if (d?.error) {
      const code = typeof d.error.code === "number" ? d.error.code : 500;
      throw new ProviderError(`${code}: ${d.error.message ?? "stream error"}`, code);
    }
    if (d?.usageMetadata) this.usage = d.usageMetadata;
    const cand = d?.candidates?.[0];
    if (cand?.finishReason) this.finish = String(cand.finishReason);
    let shown = "";
    for (const p of Array.isArray(cand?.content?.parts) ? cand.content.parts : []) {
      if (p?.functionCall) { this.parts.push(p); continue; }
      if (typeof p?.text !== "string") continue;
      const last = this.parts[this.parts.length - 1];
      if (last && typeof last.text === "string" && Boolean(last.thought) === Boolean(p.thought)) last.text += p.text;
      else this.parts.push({ text: p.text, ...(p.thought ? { thought: true } : {}) });
      if (!p.thought) shown += p.text;
    }
    return shown;
  }
  result() { return { candidates: [{ content: { parts: this.parts }, finishReason: this.finish }], usageMetadata: this.usage }; }
}

export type StreamKind = "anthropic" | "openai" | "gemini";
export const makeFold = (k: StreamKind): Fold => (k === "anthropic" ? new AnthropicFold() : k === "gemini" ? new GeminiFold() : new OpenAIFold());

/**
 * Reads a streaming Response to the end. onText gets every new piece of visible text. Returns the complete answer json.
 * idleMs: no data at all for that long = the connection is dead (the provider keeps pinging, so silence means trouble).
 */
export async function consume(res: Response, kind: StreamKind, onText: (delta: string) => void, idleMs = 45_000): Promise<any> {
  if (!res.body) throw new ProviderError("network: the provider sent an empty stream", 502);
  const fold = makeFold(kind);
  const parser = new SseParser();
  const dec = new TextDecoder();
  const reader = res.body.getReader();
  const handle = (events: SseEvent[]) => {
    for (const ev of events) {
      if (ev.data === "[DONE]") continue;
      let d: any;
      try { d = JSON.parse(ev.data); } catch { continue; } // a half line or a keep-alive: skip it
      const t = fold.push(d, ev.event);
      if (t) onText(t);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    for (;;) {
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new ProviderError("timeout: the provider stopped sending data", 504)), idleMs); }),
      ]);
      clearTimeout(timer);
      if (next.done) break;
      handle(parser.push(dec.decode(next.value, { stream: true })));
    }
    handle(parser.push(dec.decode())); handle(parser.flush());
  } finally { clearTimeout(timer); reader.cancel().catch(() => {}); }
  return fold.result();
}

/** Throttled sink for the live text: at most one write per `ms`, only the last `max` characters, and always a final flush. */
export function liveSink(write: (text: string) => Promise<unknown> | unknown, o: { ms?: number; max?: number; now?: () => number } = {}) {
  const ms = o.ms ?? 700, max = o.max ?? 8000, now = o.now ?? Date.now;
  let full = "", sent = "", last = -Infinity;
  let inflight: Promise<unknown> | null = null;
  const tail = () => (full.length > max ? "…" + full.slice(full.length - max) : full);
  const send = () => {
    const t = tail();
    if (t === sent) return Promise.resolve();
    sent = t; last = now();
    return (inflight = Promise.resolve().then(() => write(t)).catch(() => {}).finally(() => { inflight = null; }));
  };
  return {
    push(delta: string) { full += delta; if (!inflight && now() - last >= ms) void send(); },
    async flush() { if (inflight) await inflight; await send(); },
    reset() { full = ""; sent = ""; last = -Infinity; },
    get text() { return full; },
  };
}
