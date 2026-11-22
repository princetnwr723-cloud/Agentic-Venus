// Server-only. The goal tools. A GOAL is something that takes days or weeks; the agent keeps working toward it by itself,
// proves progress, checks its own finish, and asks the owner only when it must. The engine lives in lib/goals-server.ts.
import type { Def } from "./plugins";
import type { ToolCtx } from "./types";

const need = (ctx: ToolCtx | undefined): ToolCtx => {
  if (!ctx) throw new Error("Goals only work from a chat.");
  return ctx;
};

const INSIDE = "A goal work session is running for this chat right now, and sessions cannot create or change goals. Try again in a few minutes.";

export const GOAL_TOOLS: Def[] = [
  {
    name: "goal.set", risk: "write",
    params: "title:string (short name), objective:string (what the owner wants and why), success:string[] (MEASURABLE finish lines: a number, a thing that exists, a date), milestones?:string[] (optional plan; if empty the first session plans it), cadence_hours?:number (work session every N hours, default 24, min 1), deadline?:string (2026-12-31 or 'in 30 days') | deadline_days?:number, tz?:string (IANA, e.g. Asia/Kolkata, default UTC), quiet?:string ('22:00-07:00' no sessions at night), autonomy?:'ask'|'auto' (ask = approvals before any write, default; auto = may write inside the goal), notify?:'smart'|'always'|'quiet' (default smart), max_pulses_per_day?:number (default 3), max_pulses_total?:number (default 60), max_steps?:number (per session, default 40), max_calls?:number (phone calls per session, default 0), start_now?:boolean (default true)",
    description: "Start a long-term GOAL the agent works on by itself for days or weeks: 'I want 20 customers by March', 'grow the channel to 10k', 'mera goal hai ...'. Use this, NOT mission.start (one job) and NOT routine.* (same job on a clock). Ask the owner for a measurable finish line if they did not give one. The agent plans milestones, works in sessions in the background, closes a milestone only with proof, checks its own finish with a second review, asks the owner only when it is blocked, and reports short updates here and on the connected channels.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { createGoal, startPulse, pulseRunningForChat } = await import("@/lib/goals-server");
      const { renderGoal } = await import("@/lib/goals-core");
      if (await pulseRunningForChat(c.uid, c.chatId)) throw new Error(INSIDE);
      const g = await createGoal(c.uid, c.chatId, a);
      let started = "The first work session will start within a few minutes.";
      if (a.start_now !== false) {
        const r = await startPulse(c.uid, g.id as string, "first work session", true);
        started = r.started ? "The first work session started now in the background." : `The first work session did not start (${r.why}); it will be retried automatically.`;
      }
      return `Goal saved. ${started}\n${renderGoal(g, Date.now(), false)}\nTell the owner, in their own language: the finish line you will aim for, how often you work on it, that you only message when there is real progress or you need them, and that they can say "goal status", "pause the goal" or give new instructions any time. Do not wait for the session.`;
    },
  },
  {
    name: "goal.list", risk: "read", params: "",
    description: "All goals of the owner with progress, status and when the next work session is.",
    run: async (_a, _c, ctx) => {
      const c = need(ctx);
      const { listGoals, settleIfFinished } = await import("@/lib/goals-server");
      const { renderList } = await import("@/lib/goals-core");
      const goals = await listGoals(c.uid, 20);
      for (const g of goals) if (g.pulse && g.id) await settleIfFinished(c.uid, g.id).catch(() => {});
      return renderList(await listGoals(c.uid, 20), Date.now());
    },
  },
  {
    name: "goal.status", risk: "read", params: "id?:string (omit when the owner has only one goal)",
    description: "The full state of a goal: progress, milestones with their proof, what comes next, what it is waiting for, and the audit log of what happened. Use it when the owner asks how the goal is going.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { getGoal, listGoals, settleIfFinished } = await import("@/lib/goals-server");
      const { renderGoal, renderList } = await import("@/lib/goals-core");
      let id = String(a.id ?? "").trim();
      if (!id) {
        const open = (await listGoals(c.uid, 20)).filter((g) => g.status === "active" || g.status === "needs_owner" || g.status === "paused");
        if (open.length === 1) id = open[0].id as string;
        else return open.length ? `Which goal?\n${renderList(open, Date.now())}` : "No open goals. Tell me what you want to achieve and by when.";
      }
      await settleIfFinished(c.uid, id).catch(() => {});
      const g = await getGoal(c.uid, id);
      if (!g) throw new Error("Goal not found. Use goal.list to see the ids.");
      return renderGoal(g, Date.now());
    },
  },
  {
    name: "goal.update", risk: "write",
    params: "id?:string (omit when only one goal is open), note?:string (new instruction, or the ANSWER to the question the goal is waiting on: it resumes the goal), replan?:boolean, resume?:boolean, pulse_now?:boolean (run a work session now), title?, objective?, success?:string[], cadence_hours?, deadline?|deadline_days?, quiet?, autonomy?:'ask'|'auto', notify?:'smart'|'always'|'quiet', max_pulses_per_day?, max_pulses_total?, max_calls?",
    description: "Steer a goal: give it new instructions, answer the question it is waiting on, change the finish line, deadline, speed or permissions, ask it to replan, resume it, or run a work session right now. Whenever the owner replies about a goal that is waiting for them, call this with their answer in note.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { listGoals, updateGoal, startPulse, pulseRunningForChat } = await import("@/lib/goals-server");
      const { renderGoal } = await import("@/lib/goals-core");
      if (await pulseRunningForChat(c.uid, c.chatId)) throw new Error(INSIDE);
      let id = String(a.id ?? "").trim();
      if (!id) {
        const open = (await listGoals(c.uid, 20)).filter((g) => g.status === "active" || g.status === "needs_owner" || g.status === "paused");
        if (open.length !== 1) throw new Error(open.length ? "More than one goal is open: give the id (see goal.list)." : "There is no open goal to update.");
        id = open[0].id as string;
      }
      const fields = Object.keys(a).filter((k) => !["id", "pulse_now"].includes(k));
      let line = "";
      let resumed = false;
      if (fields.length) {
        const r = await updateGoal(c.uid, id, a);
        resumed = r.resumed;
        line = `Updated: ${r.changes.join(", ")}.${r.resumed ? " The goal is active again." : ""}`;
      }
      let session = "";
      if (resumed || a.pulse_now === true) {
        const s = await startPulse(c.uid, id, resumed ? "the owner answered" : "the owner asked for it now", true);
        session = s.started ? " A work session started now." : ` No session started (${s.why}).`;
      }
      if (!line && !session) throw new Error("Nothing to change. Give a note, an answer, or a field to update.");
      const { getGoal } = await import("@/lib/goals-server");
      const g = await getGoal(c.uid, id);
      return `${line}${session}\n${g ? renderGoal(g, Date.now(), false) : ""}`.trim();
    },
  },
  {
    name: "goal.stop", risk: "read", params: "id?:string, mode?:'pause'|'cancel' (default pause)",
    description: "Pause a goal (it can be resumed with goal.update resume) or cancel it for good. A running work session is stopped. Do it at once when the owner says stop, pause or cancel.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { listGoals, stopGoal } = await import("@/lib/goals-server");
      let id = String(a.id ?? "").trim();
      if (!id) {
        const open = (await listGoals(c.uid, 20)).filter((g) => g.status === "active" || g.status === "needs_owner" || g.status === "paused");
        if (open.length !== 1) throw new Error(open.length ? "More than one goal is open: give the id (see goal.list)." : "There is no open goal.");
        id = open[0].id as string;
      }
      const mode = a.mode === "cancel" ? "cancel" : "pause";
      const g = await stopGoal(c.uid, id, mode);
      return mode === "cancel" ? `Goal "${g.title}" cancelled.` : `Goal "${g.title}" paused. Resume it any time with goal.update (resume: true).`;
    },
  },
];
