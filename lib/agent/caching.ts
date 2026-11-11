// Prompt caching for Anthropic. A long agent run re-sends the same system prompt, tool list and history every round;
// marked as cacheable they are read at ~10% of the price. Rules of the API: at most 4 breakpoints, the cache looks back
// ~20 blocks. So: tools (1), stable system (1), the end of the previous round (1) and the end of this round (1).
import type { AgentMsg, Block, ToolDef } from "./types.ts";

export type Cache = { type: "ephemeral"; ttl?: "1h" };
export const cacheMark = (long: boolean): Cache => (long ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" });

/** Stable part first (cached), volatile part (date, recalled memories) after it, never cached. */
export function systemBlocks(stable: string, volatile: string, long = false, cache = true) {
  const out: Array<{ type: "text"; text: string; cache_control?: Cache }> = [];
  if (stable.trim()) out.push({ type: "text", text: stable, ...(cache ? { cache_control: cacheMark(long) } : {}) });
  if (volatile.trim()) out.push({ type: "text", text: volatile });
  return out;
}

export type WireTool = { name: string; description: string; input_schema: unknown; cache_control?: Cache };
export function wireTools(tools: ToolDef[], toNative: (n: string) => string, long = false, cache = true): WireTool[] {
  const list: WireTool[] = tools.map((t) => ({ name: toNative(t.name), description: t.description, input_schema: t.schema }));
  if (cache && list.length) list[list.length - 1] = { ...list[list.length - 1], cache_control: cacheMark(long) };
  return list;
}

type WireBlock = Record<string, unknown>;
const wireBlock = (b: Block, toNative: (n: string) => string): WireBlock | null => {
  if (b.type === "text") return b.text.trim() ? { type: "text", text: b.text } : null;
  if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: toNative(b.name), input: b.input ?? {} };
  return { type: "tool_result", tool_use_id: b.toolUseId, content: b.content || "(empty)", ...(b.isError ? { is_error: true } : {}) };
};

/** Messages in Anthropic format with the two moving breakpoints. Reasoning blocks are never replayed (they only cost tokens). */
export function wireMessages(msgs: AgentMsg[], toNative: (n: string) => string, long = false, cache = true) {
  const wire = msgs.map((m) => ({ role: m.role, content: m.content.map((b) => wireBlock(b, toNative)).filter((b): b is WireBlock => b !== null) })).filter((m) => m.content.length);
  if (!cache) return wire;
  const mark = (idx: number) => {
    if (idx < 0 || idx >= wire.length) return;
    const c = wire[idx].content;
    c[c.length - 1] = { ...c[c.length - 1], cache_control: cacheMark(long) };
  };
  mark(wire.length - 1);
  if (wire.length >= 4) mark(wire.length - 3);
  return wire;
}

export const countBreakpoints = (body: { system?: unknown; tools?: unknown; messages?: unknown }): number => JSON.stringify(body).split('"cache_control"').length - 1;
