// Server-only. A checklist the agent keeps for long tasks. The chat will not let the agent give a final answer
// while steps are still open, so no step is skipped. The same checklist feeds the "Progress" panel in the chat,
// so the owner sees every step, the one being worked on, and exactly where a step broke.
import type { Def } from "./plugins";
import { getAdminDb } from "@/lib/firebase-admin";
import { noteStatus, planStepState, type PlanStep } from "@/lib/steps";
import type { ToolCtx } from "./types";

type Step = PlanStep;
const s = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n);
const need = (ctx: ToolCtx | undefined): ToolCtx => { if (!ctx) throw new Error("Plans only work from a chat."); return ctx; };
const ref = (c: ToolCtx) => getAdminDb().collection("users").doc(c.uid).collection("chats").doc(c.chatId);

type Stored = { steps: Step[]; at: number; title: string };

async function read(c: ToolCtx): Promise<Stored> {
  const d = ((await ref(c).get()).data() ?? {}) as { plan?: { steps?: Step[]; updatedAt?: number; title?: string } };
  return { steps: Array.isArray(d.plan?.steps) ? d.plan!.steps! : [], at: Number(d.plan?.updatedAt) || 0, title: s(d.plan?.title, 80) };
}

/** Firestore rejects `undefined`, so optional fields are only written when they have a value. */
function tidy(steps: Step[]): Step[] {
  return steps.map((x) => {
    const o: Step = { t: x.t, done: x.s ? x.s !== "open" : x.done };
    if (x.s) o.s = x.s;
    if (x.note) o.note = x.note;
    if (x.st) o.st = x.st;
    if (x.at) o.at = x.at;
    return o;
  });
}

const write = (c: ToolCtx, steps: Step[], title: string, finished = false) =>
  ref(c).update({ plan: { steps: tidy(steps), updatedAt: Date.now(), ...(title ? { title } : {}), ...(finished ? { finished: true } : {}) } });

/** The first open step is the one being worked on: stamp its start time once. */
function stampStart(steps: Step[]) {
  const i = steps.findIndex((x) => planStepState(x) === "open");
  if (i >= 0 && !steps[i].st) steps[i] = { ...steps[i], st: Date.now() };
}

function render(steps: Step[]): string {
  const mark = (x: Step) => { const st = planStepState(x); return st === "done" ? "x" : st === "failed" ? "!" : st === "skipped" ? "-" : " "; };
  const open = steps.filter((x) => planStepState(x) === "open").length;
  const failed = steps.map((x, i) => (planStepState(x) === "failed" ? i + 1 : 0)).filter(Boolean);
  const rows = steps.map((x, i) => `${i + 1}. [${mark(x)}] ${x.t}${x.note ? ` — ${x.note}` : ""}`).join("\n");
  const tail = open
    ? `PLAN OPEN: ${open} step(s) left. Next: #${steps.findIndex((x) => planStepState(x) === "open") + 1}`
    : failed.length
      ? `PLAN ENDED WITH BROKEN STEP(S): #${failed.join(", #")}. In your final answer say exactly which step broke, why, and what the owner can do next.`
      : "PLAN COMPLETE: every step is done.";
  return `${rows}\n${tail}`;
}

export const PLAN_TOOLS: Def[] = [
  {
    name: "plan.set", risk: "read", params: "steps:string[] (EVERY step of the task in order, each concrete and checkable, max 40), title?:string (short name of the task)",
    description: "Start the checklist for a task with 3 or more steps or many items. Do this FIRST, then work through the steps in order. The owner sees these steps live in a Progress panel.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const steps: Step[] = (Array.isArray(a.steps) ? a.steps : []).map((x) => s(x)).filter(Boolean).slice(0, 40).map((t) => ({ t, done: false }));
      if (!steps.length) throw new Error("`steps` must be a non-empty list of strings.");
      stampStart(steps);
      await write(c, steps, s(a.title, 80));
      return `Plan saved.\n${render(steps)}`;
    },
  },
  {
    name: "plan.done", risk: "read", params: "step:number | number[] (1-based), note?:string (proof: what the tool result showed; or 'skipped: reason'; or 'failed: reason' if the step truly could not be done)",
    description: "Close one or more steps AFTER a tool result confirmed them. Put the proof in note. If a step is impossible after you tried other routes, close it with note 'failed: <exact reason>' so the owner sees where it broke; use 'skipped: <reason>' when it is not needed.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { steps, title } = await read(c);
      if (!steps.length) return "NO PLAN. Use plan.set first.";
      const idx = (Array.isArray(a.step) ? a.step : [a.step ?? a.steps]).map((x) => Math.floor(Number(x))).filter((n) => n >= 1 && n <= steps.length);
      if (!idx.length) throw new Error(`step must be a number from 1 to ${steps.length}.`);
      const now = Date.now();
      const note = s(a.note, 200);
      const kind = noteStatus(note);
      for (const n of idx) {
        const old = steps[n - 1];
        steps[n - 1] = { ...old, done: true, s: kind, at: now, st: old.st ?? now, ...(note ? { note } : {}) };
      }
      stampStart(steps);
      await write(c, steps, title);
      return render(steps);
    },
  },
  {
    name: "plan.add", risk: "read", params: "step:string, after?:number (insert after this step number; default: at the end)",
    description: "Add a step you discovered is needed.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { steps, title } = await read(c);
      const t = s(a.step);
      if (!t) throw new Error("`step` is required.");
      const at = Math.min(steps.length, Math.max(0, Math.floor(Number(a.after)) || steps.length));
      steps.splice(at, 0, { t, done: false });
      const kept = steps.slice(0, 40);
      stampStart(kept);
      await write(c, kept, title);
      return render(kept);
    },
  },
  {
    name: "plan.status", risk: "read", params: "",
    description: "Show the checklist and what is still open.",
    run: async (_a, _c, ctx) => {
      const c = need(ctx);
      const { steps, at } = await read(c);
      if (!steps.length || Date.now() - at > 3 * 86_400_000) return "NO PLAN.";
      return render(steps);
    },
  },
  {
    name: "plan.clear", risk: "read", params: "",
    description: "Delete the checklist when the owner changed the subject. A checklist whose steps are all closed stays visible as the record of the finished task, so the owner can still see every step.",
    run: async (_a, _c, ctx) => {
      const c = need(ctx);
      const { steps, title } = await read(c);
      const allClosed = steps.length > 0 && steps.every((x) => planStepState(x) !== "open");
      if (allClosed) { await write(c, steps, title, true); return "Plan finished and kept as the record of this task."; }
      await ref(c).update({ plan: { steps: [], updatedAt: Date.now() } });
      return "Plan cleared.";
    },
  },
];
