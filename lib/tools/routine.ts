// Lets the agent create and manage routines from the chat ("every morning at 9 send me the news").
// Server code is imported lazily to avoid an import cycle with the mission engine.
import type { Def } from "./plugins";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const need = <T,>(ctx: T | undefined): T => { if (!ctx) throw new Error("Routines can only be managed from a chat."); return ctx; };
const optBool = (v: unknown) => (v === undefined ? undefined : v === true || String(v).toLowerCase() === "true");

export const ROUTINE_TOOLS: Def[] = [
  {
    name: "routine.create", risk: "write",
    params: 'name:string, instructions:string (what to do on EVERY run, self-contained), schedule:string ("every day at 09:00", "weekdays 18:30", "every monday at 8am", "every 2 hours", "in 20 minutes", "at 2026-11-01 18:30" or a cron like "0 9 * * 1-5"), timezone?:string (IANA, e.g. Asia/Kolkata: ask the owner if you do not know it), notify?:"always"|"changes"|"smart" (smart = stay silent when nothing is new), channels?:string[] (extra delivery: telegram, whatsapp, sms, slackbot, email, webhook), mode?:"auto"|"lite"|"agent" (agent = may use connected tools), allow_writes?:boolean, quiet_start?:"22:00", quiet_end?:"07:00", webhook?:boolean (also start it from a URL), then_run?:string[] (routine ids to run after this one), max_runs?:number',
    description: "Create a recurring (or one-time) ROUTINE that runs by itself on a schedule while the owner is away. ALWAYS use this for 'every day/week/hour', 'remind me', 'daily report', 'har subah' style requests (never proactive.set). The owner approves it before it is saved.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { createRoutineServer, describeRoutine, pickMode } = await import("@/lib/routines-server");
      const { occurrences, formatLocal, safeTz } = await import("@/lib/schedule");
      const { effectiveSchedule } = await import("@/lib/routines-core");
      const quiet = a.quiet_start && a.quiet_end ? { start: s(a.quiet_start, 5), end: s(a.quiet_end, 5) } : undefined;
      const { routine: r, tzAssumed } = await createRoutineServer(c.uid, c.chatId, {
        name: a.name, instructions: a.instructions, schedule: a.schedule, timezone: a.timezone,
        notify: a.notify, channels: a.channels, mode: a.mode, allowWrites: optBool(a.allow_writes),
        hook: optBool(a.webhook), thenRun: a.then_run, maxRuns: a.max_runs, ...(quiet ? { quiet } : {}),
      });
      const tz = safeTz(r.tz);
      const next = occurrences(effectiveSchedule(r), Date.now(), 3).map((t) => formatLocal(t, tz)).join(", ");
      return `Routine created.\n${describeRoutine(r)}\nNext runs: ${next} (${tz}).\nWill run as: ${pickMode(r)}.${tzAssumed ? "\nNOTE: no timezone was given, so UTC is used. Ask the owner for their timezone and fix it with routine.edit (timezone)." : ""}${r.hook ? "\nThe webhook URL is shown in the Routines panel." : ""}`;
    },
  },
  {
    name: "routine.list", risk: "read", params: "",
    description: "List the routines of this chat with their schedule, next run and last result.",
    run: async (_a, _c, ctx) => {
      const c = need(ctx);
      const { listRoutinesServer, describeRoutine } = await import("@/lib/routines-server");
      const all = await listRoutinesServer(c.uid, c.chatId);
      return all.length ? all.map(describeRoutine).join("\n") : "No routines in this chat yet.";
    },
  },
  {
    name: "routine.edit", risk: "write",
    params: "id:string, name?:string, instructions?:string, schedule?:string, timezone?:string, notify?:string, channels?:string[], mode?:string, allow_writes?:boolean, quiet_start?:string, quiet_end?:string, max_runs?:number",
    description: "Change a routine (only the fields you pass). A new schedule or timezone recalculates the next run.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { updateRoutineServer, getRoutineServer, describeRoutine } = await import("@/lib/routines-server");
      const id = s(a.id, 40);
      const cur = await getRoutineServer(c.uid, id);
      if (!cur || cur.chatId !== c.chatId) throw new Error("No routine with that id in this chat (see routine.list).");
      const raw: Record<string, unknown> = {};
      for (const k of ["name", "instructions", "schedule", "timezone", "notify", "channels", "mode"]) if (a[k] !== undefined) raw[k] = a[k];
      if (a.allow_writes !== undefined) raw.allowWrites = optBool(a.allow_writes);
      if (a.max_runs !== undefined) raw.maxRuns = a.max_runs;
      if (a.quiet_start !== undefined && a.quiet_end !== undefined) raw.quiet = s(a.quiet_start) && s(a.quiet_end) ? { start: s(a.quiet_start, 5), end: s(a.quiet_end, 5) } : null;
      return `Updated.\n${describeRoutine(await updateRoutineServer(c.uid, id, raw))}`;
    },
  },
  {
    name: "routine.pause", risk: "read", params: "id:string",
    description: "Pause a routine (it keeps its settings and history).",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { setEnabledServer, getRoutineServer } = await import("@/lib/routines-server");
      const id = s(a.id, 40);
      const cur = await getRoutineServer(c.uid, id);
      if (!cur || cur.chatId !== c.chatId) throw new Error("No routine with that id in this chat.");
      return `Routine "${cur.name}" ${await setEnabledServer(c.uid, id, false)}.`;
    },
  },
  {
    name: "routine.resume", risk: "read", params: "id:string",
    description: "Switch a paused routine on again (also clears a pause caused by repeated failures).",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { setEnabledServer, getRoutineServer } = await import("@/lib/routines-server");
      const id = s(a.id, 40);
      const cur = await getRoutineServer(c.uid, id);
      if (!cur || cur.chatId !== c.chatId) throw new Error("No routine with that id in this chat.");
      return `Routine "${cur.name}" ${await setEnabledServer(c.uid, id, true)}.`;
    },
  },
  {
    name: "routine.run", risk: "write", params: "id:string",
    description: "Run a routine right now (it also keeps its normal schedule). The result is posted in this chat when it finishes.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { startManualRun, getRoutineServer } = await import("@/lib/routines-server");
      const id = s(a.id, 40);
      const cur = await getRoutineServer(c.uid, id);
      if (!cur || cur.chatId !== c.chatId) throw new Error("No routine with that id in this chat.");
      const r = await startManualRun(c.uid, id);
      return r.ok ? `Started "${cur.name}". The result will arrive in this chat.` : `Could not start it now: ${r.reason}.`;
    },
  },
  {
    name: "routine.delete", risk: "write", params: "id:string",
    description: "Delete a routine and its run history for good.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { deleteRoutineServer, getRoutineServer } = await import("@/lib/routines-server");
      const id = s(a.id, 40);
      const cur = await getRoutineServer(c.uid, id);
      if (!cur || cur.chatId !== c.chatId) throw new Error("No routine with that id in this chat.");
      await deleteRoutineServer(c.uid, id);
      return `Deleted "${cur.name}".`;
    },
  },
];