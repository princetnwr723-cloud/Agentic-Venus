// What happens in ONE slice around the loop, free of Next / Firebase / the network: check the run may start, answer a waiting
// card, run the loop, then finish / pause / hand over / stop. worker.ts builds the real deps and calls this; the scenario tests
// call it with fake ones (crash and resume, approvals, takeover, budget) against an in-memory Firestore.
import type { Store, RunDoc } from "./store.ts";
import { DEFAULT_LOOP, resolvePending, runLoop, type LoopDeps, type LoopOpts } from "./loop.ts";
import { describeLatch, latchActive } from "./budget.ts";
import { requestTakeover } from "./takeover.ts";
import type { AgentEvent, RunState } from "./types.ts";

type Wake = { kind: "run" | "takeover" | "expire"; at: number } | null;
type Common = {
  S: Store; run: RunDoc; uid: string; runId: string; startedAt: number;
  emit: (e: AgentEvent) => Promise<void> | void;
  finish: (patch: Record<string, unknown>, wake: Wake) => Promise<void>;
  cleanup: () => Promise<void>;
};

/** A run that was stopped by the cost cap and continued by the owner gets one more allowance per continue. */
/** how many times Automatic mode may raise the per-run cost cap on its own */
export const AUTO_EXTENSIONS = 3;
export const costCap = (run: Pick<RunDoc, "costExtra">, base = DEFAULT_LOOP.maxCostMicros) => base * (1 + Math.max(0, run.costExtra ?? 0));

/** Slice limit and budget latch. Returns a result when the slice must not run the loop. */
export async function preflight(a: Common & { maxSlices: number }): Promise<{ status: string } | null> {
  const { S, run, uid, startedAt } = a;
  if (run.slices > a.maxSlices) {
    await a.emit({ kind: "error", text: "This run used too many slices and was stopped." });
    await a.finish({ status: "error", endedAt: Date.now(), error: { code: "too_long", message: "This run used too many slices and was stopped." } }, null);
    await a.cleanup();
    return { status: "error" };
  }
  const latch = await S.readLatch(uid);
  if (latchActive(latch, startedAt)) {
    const msg = describeLatch(latch, startedAt);
    await a.emit({ kind: "latch", text: msg });
    await a.finish({ status: "budget", resumeAt: latch!.until, error: { code: "latch", message: msg } }, { kind: "run", at: latch!.until });
    return { status: "budget" };
  }
  return null;
}

export type SliceIO = {
  postToChat: (text: string, at: number) => Promise<void>;
  notify: (text: string) => void;
  kick: () => void;
  afterDone: () => void;
  link: string;
};

export async function runSliceCore(a: Common & { state: RunState; deps: LoopDeps; opts: LoopOpts; io: SliceIO }): Promise<{ status: string }> {
  const { S, run, uid, runId, state, deps, opts, io } = a;
  if (state.pending && run.reply) {
    await resolvePending(state, deps, run.reply);
    await S.patchRun(uid, runId, { reply: null, takeover: null });
  }
  await a.emit({ kind: "start", text: state.round ? "Continuing" : "Started", data: { slice: run.slices } });

  const res = await runLoop(state, deps, opts);
  const now = deps.now();
  const common = { round: state.round };

  switch (res.status) {
    case "done":
    case "maxrounds": {
      await a.finish({ ...common, status: "done", result: res.text.slice(0, 20_000), endedAt: now, pending: null, reply: null, error: null }, null);
      await io.postToChat(res.text.slice(0, 20_000), now);
      if (run.slices > 1 || now - run.createdAt > 60_000) io.notify(`Done: ${res.text.slice(0, 600)}`);
      await a.cleanup();
      io.afterDone();
      return { status: "done" };
    }
    case "paused": {
      const p = res.pending;
      await a.finish({ ...common, status: "paused", pending: p, reply: null, ...(p.kind === "request_takeover" ? { takeover: requestTakeover(now) } : {}) }, { kind: "expire", at: p.expiresAt });
      const what = p.kind === "approve_tool" ? `Approve? ${p.summary}` : p.kind === "request_takeover" ? `Please take over the screen: ${p.summary}` : p.kind === "request_secret" ? `I need a secret: ${p.summary}` : p.summary;
      io.notify(`Venus is waiting for you: ${what.slice(0, 500)}\n${io.link}`);
      return { status: "paused" };
    }
    case "stopped":
      await a.finish({ ...common, status: "stopped", endedAt: now, stopRequested: false }, null);
      await a.cleanup();
      return { status: "stopped" };
    case "deadline":
      await a.finish({ ...common, status: "queued" }, { kind: "run", at: now + 90_000 });
      io.kick();
      return { status: "continue" };
    case "budget": {
      const shared = res.latch.kind !== "cost";
      // Automatic mode: the per-run spending cap is raised by itself, up to 3 times, instead of asking for a Continue
      if (!shared && run.autoApprove && (run.costExtra ?? 0) < AUTO_EXTENSIONS) {
        await a.emit({ kind: "info", text: "Spending cap raised automatically" });
        await a.finish({ ...common, status: "queued", costExtra: (run.costExtra ?? 0) + 1, error: null }, { kind: "run", at: now + 90_000 });
        io.kick();
        return { status: "continue" };
      }
      if (shared) await S.armLatch(uid, res.latch);
      await a.emit({ kind: "latch", text: res.message });
      await a.finish({ ...common, status: "budget", error: { code: res.latch.kind, message: res.message }, ...(shared ? { resumeAt: res.latch.until } : { endedAt: now }) }, shared ? { kind: "run", at: res.latch.until } : null);
      if (!shared) await a.cleanup();
      return { status: "budget" };
    }
    default:
      await a.finish({ ...common, status: "error", endedAt: now, error: { code: res.code, message: res.message } }, null);
      await a.cleanup();
      return { status: "error" };
  }
}
