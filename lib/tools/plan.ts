// Server-only. A checklist the agent keeps for long tasks. The chat will not let the agent give a final answer
// while steps are still open, so no step is skipped.
import type { Def } from "./plugins";
import { getAdminDb } from "@/lib/firebase-admin";
import type { ToolCtx } from "./types";

type Step = { t: string; done: boolean; note?: string };
const s = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n);
const need = (ctx: ToolCtx | undefined): ToolCtx => { if (!ctx) throw new Error("Plans only work from a chat."); return ctx; };
const ref = (c: ToolCtx) => getAdminDb().collection("users").doc(c.uid).collection("chats").doc(c.chatId);

async function read(c: ToolCtx): Promise<{ steps: Step[]; at: number }> {
  const d = ((await ref(c).get()).data() ?? {}) as { plan?: { steps?: Step[]; updatedAt?: number } };
  return { steps: Array.isArray(d.plan?.steps) ? d.plan!.steps! : [], at: Number(d.plan?.updatedAt) || 0 };
}
const write = (c: ToolCtx, steps: Step[]) => ref(c).update({ plan: { steps, updatedAt: Date.now() } });

function render(steps: Step[]): string {
  const open = steps.filter((x) => !x.done).length;
  const rows = steps.map((x, i) => `${i + 1}. [${x.done ? "x" : " "}] ${x.t}${x.note ? ` — ${x.note}` : ""}`).join("\n");
  return `${rows}\n${open ? `PLAN OPEN: ${open} step(s) left. Next: #${steps.findIndex((x) => !x.done) + 1}` : "PLAN COMPLETE: every step is done."}`;
}

export const PLAN_TOOLS: Def[] = [
  {
    name: "plan.set", risk: "read", params: "steps:string[] (EVERY step of the task in order, each concrete and checkable, max 40)",
    description: "Start the checklist for a task with 3 or more steps or many items. Do this FIRST, then work through the steps in order.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const steps = (Array.isArray(a.steps) ? a.steps : []).map((x) => s(x)).filter(Boolean).slice(0, 40).map((t) => ({ t, done: false }));
      if (!steps.length) throw new Error("`steps` must be a non-empty list of strings.");
      await write(c, steps);
      return `Plan saved.\n${render(steps)}`;
    },
  },
  {
    name: "plan.done", risk: "read", params: "step:number | number[] (1-based), note?:string (proof: what the tool result showed, or 'skipped: reason')",
    description: "Mark one or more steps done AFTER a tool result confirmed them. Put the proof in note.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { steps } = await read(c);
      if (!steps.length) return "NO PLAN. Use plan.set first.";
      const idx = (Array.isArray(a.step) ? a.step : [a.step ?? a.steps]).map((x) => Math.floor(Number(x))).filter((n) => n >= 1 && n <= steps.length);
      if (!idx.length) throw new Error(`step must be a number from 1 to ${steps.length}.`);
      for (const n of idx) steps[n - 1] = { ...steps[n - 1], done: true, ...(s(a.note, 200) ? { note: s(a.note, 200) } : {}) };
      await write(c, steps);
      return render(steps);
    },
  },
  {
    name: "plan.add", risk: "read", params: "step:string, after?:number (insert after this step number; default: at the end)",
    description: "Add a step you discovered is needed.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { steps } = await read(c);
      const t = s(a.step);
      if (!t) throw new Error("`step` is required.");
      const at = Math.min(steps.length, Math.max(0, Math.floor(Number(a.after)) || steps.length));
      steps.splice(at, 0, { t, done: false });
      await write(c, steps.slice(0, 40));
      return render(steps.slice(0, 40));
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
    description: "Delete the checklist (the task is finished or the owner changed the subject).",
    run: async (_a, _c, ctx) => { const c = need(ctx); await ref(c).update({ plan: { steps: [], updatedAt: Date.now() } }); return "Plan cleared."; },
  },
];