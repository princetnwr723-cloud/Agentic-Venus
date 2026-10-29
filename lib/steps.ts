// Shared by the agent's checklist (lib/tools/plan.ts), the team runner (lib/team.ts) and the Progress panel.
// No imports on purpose: it runs in the browser, on the server and inside the tests.

export type StepStatus = "pending" | "active" | "done" | "failed" | "skipped";

/** One checklist step as the agent's plan tools store it. `done` stays true for every closed step (old readers rely on it). */
export type PlanStep = {
  t: string;
  done: boolean;
  s?: "open" | "done" | "failed" | "skipped";
  note?: string;
  st?: number; // when work on this step started
  at?: number; // when it was closed
};
export type PlanDoc = { steps?: PlanStep[]; updatedAt?: number; title?: string; finished?: boolean };

export type TeamStepDoc = {
  i: number;
  member: string;
  name: string;
  task: string;
  after: number[];
  status: "queued" | "running" | "done" | "failed" | "skipped";
  note?: string;
  startedAt?: number;
  endedAt?: number;
};
export type TeamRunDoc = {
  id: string;
  goal: string;
  status: "planning" | "running" | "done" | "partial" | "failed";
  steps: TeamStepDoc[];
  startedAt: number;
  endedAt?: number;
  updatedAt: number;
};

export type StepView = {
  n: number;
  title: string;
  status: StepStatus;
  note?: string;
  who?: string;
  startedAt?: number;
  endedAt?: number;
  after?: number[];
};
export type RunView = {
  source: "agent" | "team";
  key: string;
  title: string;
  steps: StepView[];
  updatedAt: number;
  startedAt?: number;
  /** the team run says it is still going */
  live: boolean;
  /** the run says it is going but nothing has been written for a long time (tab closed, server stopped) */
  stale: boolean;
  goal?: string;
};
export type RunSummary = {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  running: number;
  /** 1-based number of the step being worked on now (null when nothing is open) */
  current: number | null;
  /** the first step that broke */
  brokeAt: StepView | null;
  state: "running" | "paused" | "done" | "partial" | "broken";
  pct: number;
};

export const STALE_MS = 20 * 60_000;
export const KEEP_FINISHED_MS = 30 * 60_000;
export const PLAN_TTL_MS = 3 * 86_400_000;

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** "failed: login blocked" -> failed, "skipped: not needed" -> skipped, anything else -> done. */
export function noteStatus(note: string | undefined): "done" | "failed" | "skipped" {
  const t = String(note ?? "").trim();
  if (/^(failed|fail|broke|broken|error|blocked)\b\s*[:\-—]?/i.test(t)) return "failed";
  if (/^(skipped|skip)\b\s*[:\-—]?/i.test(t)) return "skipped";
  return "done";
}

/** Status of one stored plan step (works for steps saved before `s` existed). */
export function planStepState(x: PlanStep): "open" | "done" | "failed" | "skipped" {
  if (x.s === "open" || x.s === "done" || x.s === "failed" || x.s === "skipped") return x.s;
  if (!x.done) return "open";
  return noteStatus(x.note) === "skipped" ? "skipped" : noteStatus(x.note) === "failed" ? "failed" : "done";
}

/** The agent's checklist as a run view. Returns null when there is nothing to show. */
export function fromPlan(plan: PlanDoc | null | undefined, now = Date.now()): RunView | null {
  const raw = Array.isArray(plan?.steps) ? plan!.steps! : [];
  if (!raw.length) return null;
  const updatedAt = Number(plan?.updatedAt) || 0;
  if (updatedAt && now - updatedAt > PLAN_TTL_MS) return null;
  let firstOpen = -1;
  const steps: StepView[] = raw.map((x, i) => {
    const st = planStepState(x);
    if (st === "open" && firstOpen < 0) firstOpen = i;
    return {
      n: i + 1,
      title: clip(x.t, 300),
      status: st === "open" ? (i === firstOpen ? "active" : "pending") : st,
      note: x.note ? clip(x.note, 240) : undefined,
      startedAt: x.st,
      endedAt: x.at,
    };
  });
  return { source: "agent", key: `agent:${updatedAt}`, title: clip(plan?.title, 80) || "Task steps", steps, updatedAt, live: false, stale: false };
}

/** The team's run (written by lib/team.ts) as a run view. */
export function fromTeamRun(run: TeamRunDoc | null | undefined, now = Date.now()): RunView | null {
  if (!run || !Array.isArray(run.steps) || !run.steps.length) return null; // still planning: the working bar says so
  const updatedAt = Number(run.updatedAt) || Number(run.startedAt) || 0;
  const going = run.status === "planning" || run.status === "running";
  const stale = going && now - updatedAt > STALE_MS;
  const steps: StepView[] = run.steps.map((x, i) => ({
    n: i + 1,
    title: clip(x.task, 300),
    status: x.status === "queued" ? "pending" : x.status === "running" ? (stale ? "failed" : "active") : x.status,
    note: stale && x.status === "running" ? "Ruk gaya: kaafi der se koi update nahi aaya." : x.note ? clip(x.note, 240) : undefined,
    who: x.name,
    startedAt: x.startedAt,
    endedAt: x.endedAt,
    after: x.after,
  }));
  return { source: "team", key: `team:${run.id}:${updatedAt}`, title: clip(run.goal, 80) || "Team goal", steps, updatedAt, startedAt: run.startedAt, live: going && !stale, stale, goal: run.goal };
}

export function summarize(v: RunView, busy = false): RunSummary {
  const count = (s: StepStatus) => v.steps.filter((x) => x.status === s).length;
  const total = v.steps.length;
  const done = count("done");
  const failed = count("failed");
  const skipped = count("skipped");
  const running = count("active");
  const open = v.steps.filter((x) => x.status === "active" || x.status === "pending").length;
  const cur = v.steps.find((x) => x.status === "active") ?? v.steps.find((x) => x.status === "pending");
  const brokeAt = v.steps.find((x) => x.status === "failed") ?? null;
  const going = v.source === "team" ? v.live : busy;
  let state: RunSummary["state"];
  if (open > 0) state = going ? "running" : v.source === "team" && v.stale ? "broken" : "paused";
  else if (failed > 0) state = v.stale || done === 0 ? "broken" : "partial";
  else state = "done";
  const closed = done + failed + skipped;
  return { total, done, failed, skipped, running, current: cur ? cur.n : null, brokeAt, state, pct: total ? Math.round((closed / total) * 100) : 0 };
}

/** Should this run be on screen right now? Running or open runs always; finished ones for a while; broken ones until dismissed. */
export function isRelevant(v: RunView, sum: RunSummary, now = Date.now()): boolean {
  if (sum.state === "running" || sum.state === "paused") return true;
  if (sum.state === "broken" || sum.state === "partial") return now - v.updatedAt < 6 * 3600_000;
  return now - v.updatedAt < KEEP_FINISHED_MS;
}

/** The message that sends the agent back to work from a given step. */
export function retryText(v: RunView, stepNo: number): string {
  const st = v.steps.find((x) => x.n === stepNo);
  if (!st) return "continue";
  if (v.source === "agent") {
    return `Step ${st.n} ("${clip(st.title, 120)}") ${st.status === "failed" ? "toota tha" : "baaki hai"}${st.note ? ` (${clip(st.note, 120)})` : ""}. Wahin se dobara shuru karo: pehle plan.status dekho, ${st.status === "failed" ? "dusra raasta try karo, " : ""}phir bache hue saare steps poore karo. Koi step skip mat karna.`;
  }
  const rest = v.steps.filter((x) => x.n >= st.n).map((x) => `${x.n}. ${clip(x.title, 100)}`).join("\n");
  return `Team ka step ${st.n}${st.who ? ` (${st.who})` : ""} toota tha${st.note ? `: ${clip(st.note, 140)}` : ""}. Sirf yahan se dobara karo, jo steps pehle ho chuke hain unhe repeat mat karo:\n${rest}\n\nOverall goal: ${clip(v.goal ?? v.title, 300)}`;
}

export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 1) return "";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
