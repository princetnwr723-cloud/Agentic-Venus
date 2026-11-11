// Keeps long jobs inside the model's memory without forgetting the work:
//   1. big old tool outputs are cut down to a stub (head + tail)
//   2. identical repeated outputs are collapsed
//   3. when the history passes ~75% of the window (never more than 150k tokens) the MIDDLE is summarised,
//      the first message (the task) and the last ~20k tokens are kept word for word
//   4. tool calls and their results are never separated (the API rejects orphans)
import type { AgentMsg, Block } from "./types.ts";

export type CompactOpts = { windowTokens: number; trigger: number; capTokens: number; tailTokens: number; pruneChars: number; pruneKeep: number };
export const DEFAULT_COMPACT: CompactOpts = { windowTokens: 200_000, trigger: 0.75, capTokens: 150_000, tailTokens: 20_000, pruneChars: 3000, pruneKeep: 700 };

export const estTokens = (s: string) => Math.ceil(String(s ?? "").length / 4);

export function blockTokens(b: Block): number {
  if (b.type === "text") return estTokens(b.text);
  if (b.type === "tool_use") return estTokens(b.name) + estTokens(JSON.stringify(b.input ?? {})) + 8;
  return estTokens(b.content) + 8;
}
export const msgTokens = (m: AgentMsg) => m.content.reduce((n, b) => n + blockTokens(b), 4);
export const totalTokens = (msgs: AgentMsg[]) => msgs.reduce((n, m) => n + msgTokens(m), 0);
export const triggerAt = (o: CompactOpts) => Math.min(o.capTokens, Math.floor(o.windowTokens * o.trigger));

const text = (t: string): Block => ({ type: "text", text: t });
const isResultOnly = (m: AgentMsg) => m.role === "user" && m.content.length > 0 && m.content.every((b) => b.type === "tool_result");

/** First message of a run: the task, plus the running summary after a compaction. */
export function buildHead(task: string, summary: string): AgentMsg {
  return { role: "user", content: [text(summary ? `${task}\n\n[CHECKPOINT: what already happened in this task, summarised. The newest messages below continue from here.]\n${summary}` : task)] };
}

/** Same role twice in a row is merged (providers reject it). Empty messages are dropped. */
export function normalizeRoles(msgs: AgentMsg[]): AgentMsg[] {
  const out: AgentMsg[] = [];
  for (const m of msgs) {
    const content = m.content.filter((b) => b.type !== "text" || b.text.trim() !== "");
    if (!content.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) out[out.length - 1] = { role: last.role, content: [...last.content, ...content] };
    else out.push({ role: m.role, content });
  }
  return out;
}

/** Every tool call gets exactly one result right after it; results without a call are dropped. */
export function repairToolPairs(msgs: AgentMsg[]): AgentMsg[] {
  const out: AgentMsg[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "assistant") {
      out.push(m);
      const uses = m.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
      if (!uses.length) continue;
      const next = msgs[i + 1];
      const have = new Map<string, Block>();
      if (next && next.role === "user") for (const b of next.content) if (b.type === "tool_result") have.set(b.toolUseId, b);
      const results: Block[] = uses.map((u) => have.get(u.id) ?? { type: "tool_result", toolUseId: u.id, content: "[result lost when the history was trimmed]", isError: true });
      const rest = next && next.role === "user" ? next.content.filter((b) => b.type !== "tool_result") : [];
      out.push({ role: "user", content: [...results, ...rest] });
      if (next && next.role === "user") i++;
    } else {
      const content = m.content.filter((b) => b.type !== "tool_result");
      if (content.length) out.push({ role: "user", content });
    }
  }
  return normalizeRoles(out);
}

const clipMid = (s: string, keep: number, label: string) =>
  s.length <= keep * 2 ? s : `${s.slice(0, Math.floor(keep * 0.6))}\n[… ${s.length - keep} characters cut: ${label} …]\n${s.slice(-Math.floor(keep * 0.4))}`;

/** Old, big tool outputs become stubs. Messages from `protectFrom` on are untouched. */
export function pruneToolResults(msgs: AgentMsg[], protectFrom: number, o: CompactOpts): AgentMsg[] {
  return msgs.map((m, i) => {
    if (i >= protectFrom || m.role !== "user") return m;
    return { ...m, content: m.content.map((b) => (b.type === "tool_result" && b.content.length > o.pruneChars ? { ...b, content: clipMid(b.content, o.pruneKeep, "old tool output, rerun the tool if you need it") } : b)) };
  });
}

/** The same output twice: only the LATER one stays in full. */
export function dedupeToolResults(msgs: AgentMsg[]): AgentMsg[] {
  const seen = new Map<string, string>();
  const out = msgs.map((m) => ({ ...m, content: [...m.content] }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role !== "user") continue;
    out[i].content = out[i].content.map((b) => {
      if (b.type !== "tool_result" || b.content.length < 200) return b;
      const later = seen.get(b.content);
      if (later) return { ...b, content: `[same output as the later call ${later}]` };
      seen.set(b.content, b.toolUseId);
      return b;
    });
  }
  return out;
}

/** Index where the kept tail starts: about `tailTokens` from the end, never inside a call/result pair. */
export function findSplit(msgs: AgentMsg[], tailTokens: number): number {
  let acc = 0, s = msgs.length;
  while (s > 1 && acc < tailTokens) { s--; acc += msgTokens(msgs[s]); }
  while (s < msgs.length && (msgs[s].role === "user" && isResultOnly(msgs[s]))) s++;
  return s;
}

export function renderForSummary(msgs: AgentMsg[], clip = 900): string {
  const lines: string[] = [];
  for (const m of msgs) for (const b of m.content) {
    if (b.type === "text") lines.push(`${m.role === "user" ? "USER" : "AGENT"}: ${b.text.slice(0, clip * 2)}`);
    else if (b.type === "tool_use") lines.push(`CALL ${b.name} ${JSON.stringify(b.input).slice(0, 400)}`);
    else lines.push(`RESULT${b.isError ? " (error)" : ""}: ${b.content.slice(0, clip)}`);
  }
  return lines.join("\n");
}

/** Used when the summariser model fails: a plain list is worse than a summary but loses nothing silently. */
export function digest(msgs: AgentMsg[]): string {
  const rows: string[] = [];
  for (const m of msgs) for (const b of m.content) {
    if (b.type === "tool_use") rows.push(`- called ${b.name}`);
    else if (b.type === "tool_result") rows.push(`  -> ${b.isError ? "ERROR: " : ""}${b.content.replace(/\s+/g, " ").slice(0, 160)}`);
    else if (m.role === "assistant" && b.text.trim()) rows.push(`- said: ${b.text.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  return rows.slice(-60).join("\n");
}

export type Summarize = (transcript: string, previous: string) => Promise<string>;
export type CompactResult = { messages: AgentMsg[]; summary: string; changed: boolean; before: number; after: number; summarised: boolean };

/**
 * messages[0] is always the head (task + checkpoint). Returns the new message list and the new running summary.
 * `force` shrinks even below the trigger (used after a "context too long" error, with a smaller tail).
 */
export async function compactMessages(
  task: string, summary: string, msgs: AgentMsg[], summarize: Summarize,
  o: CompactOpts = DEFAULT_COMPACT, force = false
): Promise<CompactResult> {
  const before = totalTokens(msgs);
  const tail = force ? Math.floor(o.tailTokens / 2) : o.tailTokens;
  const split = findSplit(msgs, tail);
  let work = dedupeToolResults(pruneToolResults(msgs, split, o));
  let sum = summary;
  let summarised = false;
  if (force || totalTokens(work) > triggerAt(o)) {
    const middle = work.slice(1, split);
    if (middle.length) {
      let next: string;
      try { next = (await summarize(renderForSummary(middle), summary)).trim(); } catch { next = ""; }
      if (!next) next = [summary, digest(middle)].filter(Boolean).join("\n").slice(-6000);
      sum = next.slice(0, 8000);
      summarised = true;
      work = [buildHead(task, sum), ...work.slice(split)];
    }
  }
  const messages = repairToolPairs(work);
  const after = totalTokens(messages);
  return { messages, summary: sum, changed: summarised || after < before, before, after, summarised };
}

export const SUMMARY_PROMPT = `You are compressing the middle of a long agent task so the agent can keep working without it.
Write a dense summary (max 600 words) with these headings:
GOAL (what the owner wants), DONE (what is finished, with exact ids, urls, file names, numbers), FOUND (facts the agent learned), DECISIONS (what the owner approved or refused), OPEN (what is still to do, next step), WATCH OUT (errors, dead ends, things not to repeat).
Keep every identifier, link and number that later steps may need. No filler. If a PREVIOUS SUMMARY is given, merge it: keep what still matters.`;
