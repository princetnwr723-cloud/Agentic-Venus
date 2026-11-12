// The decisions behind the agent routes, as pure functions (so they are tested without a server):
//   replyFor  - what the owner's tap on a card means for the run
//   planTick  - what the scheduler has to do with one run that is due
import type { Latch, Pending, Reply, RunStatus } from "./types.ts";
import { END_TEXT, endedBecause, handBack, nextCheck, takeoverSeconds, type Takeover } from "./takeover.ts";
import { latchActive } from "./budget.ts";

export class ActionError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.name = "ActionError"; this.status = status; }
}
const cut = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export type CardBody = { reply?: unknown; text?: unknown; value?: unknown; note?: unknown };
export type CardAnswer = {
  reply: Reply;
  /** a secret to put into the vault (never into the run, the chat or the model) */
  secret?: { name: string; value: string };
  /** the owner said no to a takeover */
  declineTakeover?: boolean;
};

/** The vault name a secret asked for by a run is saved under. Letters and digits of the chat id keep it inside the vault's name rules. */
export const secretVaultName = (chatId: string, wanted: string | undefined): string =>
  `agent.${chatId.toLowerCase().replace(/[^a-z0-9]/g, "")}.${wanted || "secret"}`.slice(0, 90);

export function replyFor(card: Pending, body: CardBody, chatId: string): CardAnswer {
  const act = String(body.reply ?? "");
  switch (card.kind) {
    case "request_secret": {
      if (act !== "secret") return { reply: { action: "deny" } };
      const value = String(body.value ?? "");
      if (!value || value.length > 8000) throw new ActionError("Enter the value.", 400);
      const name = secretVaultName(chatId, card.secretName);
      return { reply: { action: "secret", name }, secret: { name, value } };
    }
    case "ask_user":
      return act === "answer" ? { reply: { action: "answer", text: cut(body.text, 4000) } } : { reply: { action: "deny" } };
    case "request_takeover":
      return { reply: { action: "deny" }, declineTakeover: true };
    default: // approve_tool, request_approval
      return act === "approve" ? { reply: { action: "approve" } } : { reply: { action: "deny", note: cut(body.note, 300) } };
  }
}

export type TickPlan =
  | { do: "clear" }
  | { do: "resume" }
  | { do: "wait"; kind: "run" | "takeover" | "expire"; at: number }
  | { do: "requeue" }
  | { do: "answer"; reply: Reply; takeover?: Takeover; counted: "handedBack" | "timedOut" };

export type TickRun = { status: RunStatus; pending: Pending | null; takeover?: Takeover | null };

export function planTick(run: TickRun | null, latch: Latch | null, now: number): TickPlan {
  if (!run || run.status === "done" || run.status === "error" || run.status === "stopped") return { do: "clear" };
  if (run.status === "queued" || run.status === "running") return { do: "resume" };
  if (run.status === "budget") return latchActive(latch, now) ? { do: "wait", kind: "run", at: latch!.until } : { do: "requeue" };
  if (run.status === "paused" && run.pending) {
    const t = run.takeover;
    if (t?.status === "active") {
      const why = endedBecause(t, now);
      if (!why) return { do: "wait", kind: "takeover", at: nextCheck(t) };
      const ended = handBack(t, now, why);
      return {
        do: "answer", counted: "handedBack", takeover: ended,
        reply: { action: "takeover_done", seconds: takeoverSeconds(ended), note: `The screen was handed back because ${END_TEXT[why]}.`, reason: run.pending.summary.slice(0, 80) },
      };
    }
    if (run.pending.expiresAt <= now) return { do: "answer", reply: { action: "timeout" }, counted: "timedOut" };
    return { do: "wait", kind: "expire", at: run.pending.expiresAt };
  }
  return { do: "clear" };
}
