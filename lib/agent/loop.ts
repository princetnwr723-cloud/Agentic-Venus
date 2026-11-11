// THE agent loop. It runs on the server, keeps no state in memory, and saves after every step, so a closed tab, a
// killed function or a restart never loses a run: the next slice loads the state and carries on.
// Everything it needs from the outside is injected (LoopDeps), so it is tested with fakes and no network.
import type { AgentEvent, AgentMsg, Block, Latch, ModelCall, ModelTurn, Pending, Reply, RunState, ToolDef, ToolResultBlock, Usage } from "./types.ts";
import { addUsage, costMicros, emptyUsage, latchFromCost, latchFromError, latchFromPlan } from "./budget.ts";
import { DEFAULT_COMPACT, compactMessages, totalTokens, estTokens, buildHead, repairToolPairs, type CompactOpts, type Summarize } from "./compaction.ts";
import { backoffMs, classifyError, userMessage, type Classified } from "./provider-errors.ts";
import { HITL_NAMES, isHitlName, pendingFromApproval, pendingFromHitl, resultFromReply } from "./hitl.ts";
import { checkArgs, repairMessage, resolveToolName } from "./tool-repair.ts";

export type ToolOutcome = { ok: boolean; text: string; needsApproval?: { summary: string; risk: string }; flagged?: string[]; risk?: "read" | "write" };
export type ModelReq = { system: { stable: string; volatile: string }; messages: AgentMsg[]; tools: ToolDef[]; maxTokens: number; round: number };
export type StepRow = { round: number; model: string; ms: number; usage: Usage; costMicros: number; tools: string[]; stop: string };

export type LoopDeps = {
  callModel: (req: ModelReq) => Promise<ModelTurn>;
  runTool: (name: string, input: Record<string, unknown>, o: { approved: boolean; force: boolean }) => Promise<ToolOutcome>;
  summarize: Summarize;
  emit: (e: AgentEvent) => Promise<void> | void;
  save: (s: RunState) => Promise<void>;
  shouldStop: () => Promise<boolean>;
  /** Reserve tokens before a model call (throws when the plan is used up). */
  reserve?: (estTokens: number) => Promise<void>;
  settle?: (reserved: number, actual: number) => Promise<void>;
  step?: (row: StepRow) => Promise<void> | void;
  /** After the model stops calling tools: a nudge text when work is clearly unfinished (open plan steps), else null. */
  gate?: (s: RunState) => Promise<string | null>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  model: string;
};

export type LoopOpts = {
  tools: ToolDef[]; system: { stable: string; volatile: string };
  maxRounds: number; maxToolsPerRound: number; maxNudges: number; maxTokens: number;
  deadline: number; maxCostMicros: number; compact: CompactOpts; toolOutputChars: number; fromNative?: (n: string) => string | undefined;
};
export const DEFAULT_LOOP: Omit<LoopOpts, "tools" | "system" | "deadline"> = {
  maxRounds: 40, maxToolsPerRound: 8, maxNudges: 6, maxTokens: 8192, maxCostMicros: 3_000_000, compact: DEFAULT_COMPACT, toolOutputChars: 12_000,
};

export type LoopResult =
  | { status: "done"; text: string }
  | { status: "paused"; pending: Pending }
  | { status: "stopped" }
  | { status: "deadline" }
  | { status: "maxrounds"; text: string }
  | { status: "budget"; latch: Latch; message: string }
  | { status: "error"; code: string; message: string };

export function newState(task: string): RunState {
  return { task, summary: "", messages: [buildHead(task, "")], round: 0, tainted: false, queue: [], turnResults: [], pending: null, inflight: null, usage: emptyUsage(), costMicros: 0, nudges: 0, calls: 0, compactions: 0, lastText: "" };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.floor(n * 0.7))}\n[… ${s.length - n} characters cut …]\n${s.slice(-Math.floor(n * 0.3))}` : s);
const resultBlock = (id: string, content: string, isError = false): ToolResultBlock => ({ type: "tool_result", toolUseId: id, content: content || "(empty)", ...(isError ? { isError } : {}) });
const names = (tools: ToolDef[]) => tools.map((t) => t.name);

/** The owner answered a card: the call that was waiting gets its result and the run can go on. */
export async function resolvePending(s: RunState, deps: LoopDeps, reply: Reply): Promise<void> {
  const p = s.pending;
  if (!p) return;
  const call = s.queue[0];
  if (p.kind === "approve_tool" && reply.action === "approve" && call) {
    s.inflight = call.id;
    await deps.save(s);
    const r = await deps.runTool(p.name, p.args ?? call.input, { approved: true, force: s.tainted });
    if (r.flagged?.length) s.tainted = true;
    s.turnResults.push(resultBlock(call.id, clip(r.text, 12_000), !r.ok));
    await deps.emit({ kind: "result", text: `${p.name}: ${clip(r.text, 300)}`, data: { name: p.name, ok: r.ok, approved: true } });
  } else {
    const r = resultFromReply(p, reply);
    s.turnResults.push(resultBlock(p.toolUseId, r.content, r.isError));
  }
  s.queue = s.queue.filter((c) => c.id !== p.toolUseId);
  s.pending = null;
  s.inflight = null;
  await deps.emit({ kind: "resume", text: p.kind === "approve_tool" ? (reply.action === "approve" ? "Approved" : "Refused") : "Answered", data: { pendingId: p.id } });
  await deps.save(s);
}

export async function runLoop(s: RunState, deps: LoopDeps, o: LoopOpts): Promise<LoopResult> {
  const known = [...names(o.tools), ...HITL_NAMES];
  const toolByName = new Map(o.tools.map((t) => [t.name, t]));
  let forcedCompact = false;

  const compact = async (force: boolean) => {
    const r = await compactMessages(s.task, s.summary, s.messages, deps.summarize, o.compact, force);
    if (r.changed) {
      s.messages = r.messages; s.summary = r.summary;
      if (r.summarised) s.compactions++;
      await deps.emit({ kind: "compact", text: r.summarised ? `Trimmed the history (${r.before} -> ${r.after} tokens), the summary is saved.` : `Cut old tool outputs (${r.before} -> ${r.after} tokens).`, data: { before: r.before, after: r.after } });
      await deps.save(s);
    }
  };

  const modelWithRetry = async (): Promise<ModelTurn> => {
    for (let attempt = 0; ; attempt++) {
      const t0 = deps.now();
      const reserved = estTokens(JSON.stringify(s.messages)) + estTokens(o.system.stable + o.system.volatile) + o.maxTokens;
      await deps.reserve?.(reserved);
      try {
        const turn = await deps.callModel({ system: o.system, messages: s.messages, tools: o.tools, maxTokens: o.maxTokens, round: s.round });
        const actual = turn.usage.inTok + turn.usage.outTok + turn.usage.cacheRead + turn.usage.cacheWrite;
        await deps.settle?.(reserved, actual);
        const c = costMicros(deps.model, turn.usage);
        s.usage = addUsage(s.usage, turn.usage); s.costMicros += c; s.calls++;
        await deps.step?.({ round: s.round, model: deps.model, ms: deps.now() - t0, usage: turn.usage, costMicros: c, tools: turn.calls.map((x) => x.name), stop: turn.stop });
        return turn;
      } catch (e) {
        await deps.settle?.(reserved, 0).catch(() => {});
        const c = classifyError(e);
        if (c.code === "context_exceeded" && !forcedCompact) {
          forcedCompact = true;
          await deps.emit({ kind: "retry", text: "The history was too long for the model: shrinking it and trying again." });
          await compact(true);
          continue;
        }
        if (c.retryable && attempt < 3) {
          const wait = backoffMs(attempt, c);
          await deps.emit({ kind: "retry", text: `${userMessage(c)} Retry ${attempt + 1}/3 in ${Math.round(wait / 1000)}s.`, data: { code: c.code } });
          await deps.sleep(wait);
          if (deps.now() > o.deadline) throw e;
          continue;
        }
        throw e;
      }
    }
  };

  const failure = async (e: unknown): Promise<LoopResult> => {
    const c: Classified = classifyError(e);
    const plan = (e as { code?: string; resetAt?: number }).code === "plan_limit";
    const msg = plan ? c.message : userMessage(c);
    const latch = plan ? latchFromPlan(Number((e as { resetAt?: number }).resetAt) || deps.now() + 3600_000, deps.now(), c.message) : latchFromError(c, deps.now());
    await deps.emit({ kind: "error", text: msg, data: { code: c.code } });
    await deps.save(s);
    return latch ? { status: "budget", latch, message: msg } : { status: "error", code: c.code, message: msg };
  };

  // one tool call: ran, refused (bad call) or needs a human
  const execCall = async (call: ModelCall): Promise<Pending | null> => {
    if (s.inflight === call.id) {
      s.turnResults.push(resultBlock(call.id, "This action was started, but the server stopped before the result came back. It may or may not have happened. Check with a read-only tool before you try it again.", true));
      s.queue = s.queue.filter((c) => c.id !== call.id); s.inflight = null;
      return null;
    }
    const m = resolveToolName(call.name, known, o.fromNative);
    if (m.name === null) {
      s.turnResults.push(resultBlock(call.id, `Unknown tool "${call.name}".${m.suggestions.length ? ` Did you mean: ${m.suggestions.join(", ")}?` : ""} Use only the tools you were given.`, true));
      s.queue = s.queue.filter((c) => c.id !== call.id);
      return null;
    }
    const name = m.name;
    if (call.raw !== undefined) {
      s.turnResults.push(resultBlock(call.id, `The arguments of "${name}" were not valid JSON, so nothing ran. Send the call again with valid JSON arguments.`, true));
      s.queue = s.queue.filter((c) => c.id !== call.id);
      return null;
    }
    if (isHitlName(name)) return pendingFromHitl({ id: call.id, name, input: call.input }, deps.now(), s.tainted);
    const def = toolByName.get(name)!;
    const { args, errors } = checkArgs(def.schema, call.input);
    if (errors.length) {
      s.turnResults.push(resultBlock(call.id, repairMessage(name, errors, def.schema), true));
      s.queue = s.queue.filter((c) => c.id !== call.id);
      return null;
    }
    await deps.emit({ kind: "tool", text: name, data: { name, args: clip(JSON.stringify(args), 300) } });
    if (def.risk === "write") { s.inflight = call.id; await deps.save(s); }
    let r: ToolOutcome;
    try { r = await deps.runTool(name, args, { approved: false, force: s.tainted }); }
    catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Tool crashed." }; }
    s.inflight = null;
    if (r.needsApproval) return pendingFromApproval({ id: call.id, name, input: args }, r.needsApproval.summary, deps.now(), s.tainted);
    if (r.flagged?.length) { s.tainted = true; await deps.emit({ kind: "info", text: `"${name}" returned text that tries to give orders (${r.flagged.join(", ")}). Write actions now need your approval.` }); }
    s.turnResults.push(resultBlock(call.id, clip(r.text, o.toolOutputChars), !r.ok));
    s.queue = s.queue.filter((c) => c.id !== call.id);
    await deps.emit({ kind: "result", text: `${name}: ${clip(r.text, 300)}`, data: { name, ok: r.ok } });
    await deps.save(s);
    return null;
  };

  for (;;) {
    if (s.pending) return { status: "paused", pending: s.pending };

    // 1) finish the tool calls of the last model turn (resumes cleanly after a pause or a crash)
    while (s.queue.length) {
      if (await deps.shouldStop()) { await deps.save(s); return { status: "stopped" }; }
      if (deps.now() > o.deadline) { await deps.save(s); return { status: "deadline" }; }
      const pend = await execCall(s.queue[0]);
      if (pend) {
        s.pending = pend;
        await deps.emit({ kind: "pause", text: pend.summary, data: { pendingId: pend.id, kind: pend.kind } });
        await deps.save(s);
        return { status: "paused", pending: pend };
      }
    }
    if (s.turnResults.length) {
      s.messages.push({ role: "user", content: s.turnResults });
      s.turnResults = [];
      await deps.save(s);
    }

    // 2) limits
    if (await deps.shouldStop()) { await deps.save(s); return { status: "stopped" }; }
    if (deps.now() > o.deadline) { await deps.save(s); return { status: "deadline" }; }
    if (s.costMicros >= o.maxCostMicros) {
      const latch = latchFromCost(deps.now(), s.costMicros, o.maxCostMicros);
      await deps.emit({ kind: "latch", text: latch.reason });
      await deps.save(s);
      return { status: "budget", latch, message: latch.reason };
    }
    if (s.round >= o.maxRounds) {
      await deps.emit({ kind: "info", text: `Stopped after ${o.maxRounds} steps. Say "continue" to go on.` });
      await deps.save(s);
      return { status: "maxrounds", text: s.lastText || "I stopped after many steps. Say \"continue\" and I will pick up where I left off." };
    }

    // 3) keep the history inside the model's memory
    if (totalTokens(s.messages) > Math.min(o.compact.capTokens, Math.floor(o.compact.windowTokens * o.compact.trigger))) await compact(false);

    // 4) think
    s.round++;
    let turn: ModelTurn;
    try { turn = await modelWithRetry(); } catch (e) { s.round--; return failure(e); }

    const calls: ModelCall[] = turn.calls.slice(0, o.maxToolsPerRound).map((c, i) => ({ ...c, id: c.id || `c${s.round}_${i}` }));
    const skipped = turn.calls.slice(o.maxToolsPerRound);
    const blocks: Block[] = [];
    if (turn.text.trim()) { blocks.push({ type: "text", text: turn.text }); s.lastText = turn.text; await deps.emit({ kind: "text", text: clip(turn.text, 1500) }); }
    for (const c of [...calls, ...skipped]) blocks.push({ type: "tool_use", id: c.id || `c${s.round}_x`, name: c.name, input: c.input, ...(c.meta ? { meta: c.meta } : {}) });
    if (blocks.length) s.messages.push({ role: "assistant", content: blocks });
    for (const c of skipped) s.turnResults.push(resultBlock(c.id, `Not run: at most ${o.maxToolsPerRound} tool calls per step. Call it again in the next step.`, true));

    if (calls.length) { s.queue = calls; await deps.save(s); continue; }
    if (skipped.length) { await deps.save(s); continue; }

    // 5) no tool calls: finished, cut off, empty, or unfinished
    if (turn.stop === "max_tokens" && s.nudges < o.maxNudges) {
      s.nudges++;
      s.messages.push({ role: "user", content: [{ type: "text", text: "Your answer was cut off. Continue exactly where you stopped." }] });
      await deps.save(s);
      continue;
    }
    if (!turn.text.trim() && s.nudges < o.maxNudges) {
      s.nudges++;
      s.messages.push({ role: "user", content: [{ type: "text", text: "Your last reply was empty. Either call a tool or write the final answer for the owner." }] });
      await deps.save(s);
      continue;
    }
    const nudge = s.nudges < o.maxNudges ? await deps.gate?.(s) : null;
    if (nudge) {
      s.nudges++;
      s.messages.push({ role: "user", content: [{ type: "text", text: nudge }] });
      await deps.emit({ kind: "info", text: "Not finished yet: sending the agent back to work." });
      await deps.save(s);
      continue;
    }
    s.messages = repairToolPairs(s.messages);
    await deps.emit({ kind: "done", text: clip(s.lastText, 1500) });
    await deps.save(s);
    return { status: "done", text: s.lastText || "Done." };
  }
}
