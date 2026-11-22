// Venus Goals: the pure rules. No Firebase, no network, so it runs on the server and inside the tests.
//
// A GOAL is something that takes days or weeks ("get me 20 paying customers", "lose 5 kg by March").
// It is NOT a mission (one background job) and NOT a routine (the same job on a clock). A goal owns:
//   - SUCCESS CRITERIA: measurable finish lines. "Achieved" is only accepted with evidence AND a second-model check.
//   - MILESTONES: the plan. A milestone only closes with PROOF (a link, an id, a number, a tool result).
//   - PULSES: work sessions (each one runs as a background mission). They come on a cadence, faster when the goal
//     is behind or the deadline is close, never in quiet hours, never beyond the daily / total budget.
//   - STALL HANDLING: no real progress twice -> replan; three times -> the agent stops and asks the owner.
//   - AN AUDIT LOG of everything that happened, and a short digest to the owner only when something worth saying happened.
import { dayKey, formatLocal, inQuietHours, safeTz, zonedToUtc } from "./schedule.ts";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const MAX_ACTIVE_GOALS = 8;
export const MAX_MILESTONES = 12;
export const MAX_LOG = 60;
/** A pulse that has not finished after this long is considered dead and is released. */
export const PULSE_STALE_MS = 45 * MIN;
/** A pulse waiting for the owner's approval of a write may wait much longer. */
export const PULSE_APPROVAL_MS = 24 * HOUR;

export type GoalStatus = "active" | "paused" | "needs_owner" | "achieved" | "failed" | "cancelled";
export type MilestoneState = "open" | "done" | "skipped" | "blocked";
export type Pace = "on_track" | "at_risk" | "behind" | "no_deadline" | "done";
export type Autonomy = "ask" | "auto";
export type NotifyPolicy = "smart" | "always" | "quiet";
export type LogKind = "set" | "pulse" | "progress" | "verify" | "owner" | "stall" | "replan" | "status" | "error";

export type Milestone = { id: string; t: string; state: MilestoneState; proof?: string; at?: number };
export type LogEntry = { at: number; kind: LogKind; text: string };
export type Pulse = { id: string; missionId: string; startedAt: number; reason: string };
export type Limits = { maxPulsesPerDay: number; maxPulsesTotal: number; maxSteps: number; maxCalls: number };

export type Goal = {
  id?: string;
  chatId: string;
  title: string;
  objective: string;
  success: string[];
  milestones: Milestone[];
  status: GoalStatus;
  progress: number;
  pace: Pace;
  cadenceMinutes: number;
  tz: string;
  quiet?: { start: string; end: string };
  deadline?: number;
  autonomy: Autonomy;
  notify: NotifyPolicy;
  limits: Limits;
  nextAction: string;
  lessons: string[];
  blockers: string[];
  /** Instructions from the owner that the next pulse must follow first. Cleared when a pulse has started with them. */
  ownerNotes: string[];
  replan: boolean;
  pulse: Pulse | null;
  pulses: number;
  stalls: number;
  errors: number;
  lastProgressAt: number;
  lastPulseAt: number;
  nextPulseAt: number;
  dayKey: string;
  dayPulses: number;
  log: LogEntry[];
  createdAt: number;
  updatedAt: number;
  verifiedAt?: number;
  result?: string;
};

export type GoalEvent = { kind: LogKind; text: string };

// ---------------- small helpers ----------------
export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + "…" : s);
const txt = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const strList = (v: unknown, max: number, each: number): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? v.split(/\n|;/) : [])
    .map((x) => txt(x, each)).filter(Boolean).slice(0, max);
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const has = (xs: string[], s: string) => xs.some((x) => x.toLowerCase() === s.toLowerCase());

export function pushLog(log: LogEntry[] | undefined, events: GoalEvent[], now: number): LogEntry[] {
  const add = events.map((e) => ({ at: now, kind: e.kind, text: clip(e.text, 300) }));
  return [...(Array.isArray(log) ? log : []), ...add].slice(-MAX_LOG);
}

export function parseQuiet(v: unknown): { start: string; end: string } | undefined {
  const m = /^\s*(\d{1,2}):(\d{2})\s*[-–to ]+\s*(\d{1,2}):(\d{2})\s*$/i.exec(String(v ?? ""));
  if (!m) return undefined;
  const ok = (h: number, mi: number) => h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
  if (!ok(Number(m[1]), Number(m[2])) || !ok(Number(m[3]), Number(m[4]))) return undefined;
  const p = (h: string, mi: string) => `${h.padStart(2, "0")}:${mi}`;
  const start = p(m[1], m[2]), end = p(m[3], m[4]);
  return start === end ? undefined : { start, end };
}

/** deadline_days (number) or deadline (ISO date / date-time / "in 30 days" / "in 6 weeks"). Empty = no deadline. */
export function parseDeadline(a: Record<string, unknown>, now: number, tz: string): { deadline?: number } | { error: string } {
  const days = Number(a.deadline_days);
  let at: number | undefined;
  if (Number.isFinite(days) && days > 0) at = now + days * DAY;
  const raw = txt(a.deadline, 60);
  if (at === undefined && raw) {
    const rel = /^in\s+(\d+(?:\.\d+)?)\s*(day|week|month)s?$/i.exec(raw);
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (rel) at = now + Number(rel[1]) * DAY * (rel[2].toLowerCase() === "day" ? 1 : rel[2].toLowerCase() === "week" ? 7 : 30);
    else if (dateOnly) at = zonedToUtc(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), 23, 59, tz);
    else { const t = Date.parse(raw); if (Number.isFinite(t)) at = t; else return { error: `Cannot read deadline "${raw}". Use a date like 2026-12-31, or deadline_days.` }; }
  }
  if (at === undefined) return {};
  if (at <= now + HOUR) return { error: "The deadline must be at least an hour in the future." };
  if (at > now + 3 * 365 * DAY) return { error: "The deadline is more than 3 years away. Pick a nearer finish line or split the goal." };
  return { deadline: at };
}

export function computePace(g: Pick<Goal, "status" | "deadline" | "createdAt" | "progress">, now: number): Pace {
  if (g.status === "achieved") return "done";
  if (!g.deadline) return "no_deadline";
  if (now > g.deadline) return "behind";
  const total = g.deadline - g.createdAt;
  if (total <= 0) return "behind";
  const expected = (Math.min(Math.max(now - g.createdAt, 0), total) / total) * 100;
  const gap = expected - g.progress;
  return gap <= 10 ? "on_track" : gap <= 30 ? "at_risk" : "behind";
}

const nextId = (ms: Milestone[]) => {
  let n = ms.length + 1;
  while (ms.some((m) => m.id === `m${n}`)) n++;
  return `m${n}`;
};

// ---------------- creating a goal ----------------
export function newGoal(a: Record<string, unknown>, chatId: string, now = Date.now()): { goal: Goal } | { error: string } {
  const title = txt(a.title, 100);
  const objective = txt(a.objective, 700);
  if (title.length < 3) return { error: "`title` is required: a short name for the goal (3+ characters)." };
  if (objective.length < 15) return { error: "`objective` must say what the owner wants and why (15+ characters)." };
  const success = strList(a.success, 8, 300).filter((s) => s.length >= 5);
  if (!success.length) {
    return { error: "`success` needs at least one MEASURABLE finish line: a number, a thing that exists, a date. Example: [\"20 paying customers\", \"revenue of 50000 in one month\"]. Without it nobody can prove the goal is reached." };
  }
  const tz = safeTz(txt(a.tz, 60) || undefined);
  const dl = parseDeadline(a, now, tz);
  if ("error" in dl) return { error: dl.error };
  const quiet = parseQuiet(a.quiet);
  const notify: NotifyPolicy = a.notify === "always" || a.notify === "quiet" ? a.notify : "smart";
  const milestones: Milestone[] = [];
  for (const t of strList(a.milestones, MAX_MILESTONES, 140)) milestones.push({ id: nextId(milestones), t, state: "open" });
  const goal: Goal = {
    chatId, title, objective, success, milestones,
    status: "active", progress: 0, pace: "no_deadline",
    cadenceMinutes: Math.round(num(a.cadence_hours, 1, 168, 24) * 60),
    tz,
    ...(quiet ? { quiet } : {}),
    ...(dl.deadline ? { deadline: dl.deadline } : {}),
    autonomy: a.autonomy === "auto" ? "auto" : "ask",
    notify,
    limits: {
      maxPulsesPerDay: Math.round(num(a.max_pulses_per_day, 1, 12, 3)),
      maxPulsesTotal: Math.round(num(a.max_pulses_total, 1, 500, 60)),
      maxSteps: Math.round(num(a.max_steps, 10, 120, 40)),
      maxCalls: Math.round(num(a.max_calls, 0, 20, 0)),
    },
    nextAction: milestones.length ? "Start with the first milestone." : "Plan 3 to 8 concrete milestones, then do the first one.",
    lessons: [], blockers: [], ownerNotes: [],
    replan: milestones.length === 0,
    pulse: null, pulses: 0, stalls: 0, errors: 0,
    lastProgressAt: now, lastPulseAt: 0, nextPulseAt: now,
    dayKey: "", dayPulses: 0,
    log: [], createdAt: now, updatedAt: now,
  };
  goal.pace = computePace(goal, now);
  goal.log = pushLog([], [{ kind: "set", text: `Goal created. ${success.length} success criteria, ${milestones.length} milestones, every ${Math.round(goal.cadenceMinutes / 60 * 10) / 10}h, ${goal.autonomy === "auto" ? "may write on its own" : "asks before writing"}.` }], now);
  return { goal };
}

// ---------------- when may a pulse run? ----------------
export function pulseDue(g: Goal, now: number, manual = false): { due: boolean; why: string } {
  const no = (why: string) => ({ due: false, why });
  if (g.status !== "active") return no(`the goal is ${g.status}`);
  if (g.pulse && now - g.pulse.startedAt < PULSE_STALE_MS) return no("a work session is already running");
  if (g.deadline && now > g.deadline) return no("the deadline has passed");
  if (g.pulses >= g.limits.maxPulsesTotal) return no(`the total budget of ${g.limits.maxPulsesTotal} work sessions is used up`);
  const used = g.dayKey === dayKey(now, g.tz) ? g.dayPulses : 0;
  if (used >= g.limits.maxPulsesPerDay) return no(`today's limit of ${g.limits.maxPulsesPerDay} work sessions is reached`);
  if (manual) return { due: true, why: "started by the owner" };
  if (now < g.nextPulseAt) return no("not time yet");
  const urgent = g.deadline !== undefined && g.deadline - now < DAY;
  if (!urgent && g.quiet && inQuietHours(now, g.tz, g.quiet.start, g.quiet.end)) return no("quiet hours");
  return { due: true, why: g.pulses === 0 ? "first work session" : g.pace === "behind" || g.pace === "at_risk" ? "scheduled (the goal is behind, so sessions come faster)" : "scheduled" };
}

/** The time of the next pulse: the cadence, halved when behind or near the deadline (never under 30 minutes), pushed out of quiet hours. */
export function nextPulseTime(g: Pick<Goal, "cadenceMinutes" | "deadline" | "pace" | "quiet" | "tz">, now: number): number {
  let gap = g.cadenceMinutes * MIN;
  if (g.deadline && g.deadline - now > 0 && g.deadline - now < gap * 3) gap /= 2;
  if (g.pace === "behind" || g.pace === "at_risk") gap /= 2;
  gap = Math.max(gap, 30 * MIN);
  let t = now + gap;
  const urgent = g.deadline !== undefined && g.deadline - now < DAY;
  if (g.quiet && !urgent) {
    let guard = 0;
    while (inQuietHours(t, g.tz, g.quiet.start, g.quiet.end) && guard++ < 96) t += 15 * MIN;
  }
  return t;
}

// ---------------- the instructions of one pulse ----------------
export function buildPulseGoalText(g: Goal, now: number, reason: string): string {
  const ms = g.milestones.length
    ? g.milestones.map((m) => `${m.id} [${m.state}] ${m.t}${m.proof ? ` (proof: ${clip(m.proof, 90)})` : ""}`).join("\n")
    : "(none yet: PLAN 3 to 8 concrete, checkable milestones first and send them as new_milestones)";
  const left = g.deadline ? `${Math.max(0, Math.round((g.deadline - now) / DAY * 10) / 10)} days left (deadline ${formatLocal(g.deadline, g.tz)})` : "no deadline";
  const parts = [
    `GOAL WORK SESSION #${g.pulses} (${reason}). You work for the owner toward ONE long-term goal. This is one focused session: do the most valuable next actions you can with your tools, then report.`,
    `GOAL: ${g.title}\nWHY / OBJECTIVE: ${g.objective}`,
    `SUCCESS means ALL of these are true, with evidence:\n${g.success.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    `MILESTONES:\n${ms}`,
    `STATE: progress ${g.progress}% · pace ${g.pace.replace("_", " ")} · ${left} · sessions used ${g.pulses}/${g.limits.maxPulsesTotal}`,
    g.nextAction ? `NEXT ACTION (decided last session): ${g.nextAction}` : "",
    g.lessons.length ? `LESSONS FROM EARLIER SESSIONS (do not repeat mistakes):\n${g.lessons.slice(-6).map((l) => `- ${l}`).join("\n")}` : "",
    g.blockers.length ? `OPEN BLOCKERS: ${g.blockers.join(" | ")}` : "",
    g.ownerNotes.length ? `NEW INSTRUCTIONS FROM THE OWNER (follow these first):\n${g.ownerNotes.map((n) => `- ${n}`).join("\n")}` : "",
    g.replan ? "REPLAN REQUESTED: the plan is not working or the owner changed it. Rewrite the open milestones (send new_milestones, mark obsolete ones skipped with a reason)." : "",
    g.log.length ? `RECENT LOG:\n${g.log.slice(-4).map((l) => `- ${clip(l.text, 140)}`).join("\n")}` : "",
    `RULES
- Work only toward this goal. Use tools. Never invent results: a milestone is "done" only with proof (a link, id, figure or tool output) in its proof field.
- Writes (sending messages, posting, spending, editing someone's data): ${g.autonomy === "auto" ? "allowed within the goal, but never spend money and never contact people the owner did not name or approve" : "ask first (the system will pause for the owner's approval)"}.
- Never create, change or stop goals, missions or routines. Do not redo work that is already done.
- If only the owner can decide or provide something, stop and put ONE precise question in needs_owner. Do not guess.
- Budget: at most ${g.limits.maxSteps} steps${g.limits.maxCalls ? `, ${g.limits.maxCalls} phone calls` : ", no phone calls"}.
- Say "achieved": true ONLY if every success criterion is met; list the evidence. A second model will check it.`,
    `FINISH with [[DONE: 2-3 line report for the owner, then on the LAST line:
GOAL_UPDATE:{"progress":0-100,"milestones":[{"id":"m1","state":"done|open|blocked|skipped","proof":"..."}],"new_milestones":["..."],"next_action":"...","lesson":"one thing learned or empty","blockers":["..."],"needs_owner":"question or empty","achieved":false,"evidence":["..."],"summary":"1-2 lines for the owner"}]]`,
  ];
  return clip(parts.filter(Boolean).join("\n\n"), 3950);
}

// ---------------- reading what a pulse reported ----------------
export type GoalUpdate = {
  progress?: number;
  milestones: Array<{ id: string; state: MilestoneState; proof: string }>;
  newMilestones: string[];
  nextAction: string;
  lesson: string;
  blockers: string[];
  needsOwner: string;
  achieved: boolean;
  evidence: string[];
  summary: string;
};

export const emptyUpdate = (): GoalUpdate => ({ milestones: [], newMilestones: [], nextAction: "", lesson: "", blockers: [], needsOwner: "", achieved: false, evidence: [], summary: "" });

/** The first balanced {...} after `marker` (string aware), or "". */
export function jsonAfter(text: string, marker: string): string {
  const at = text.lastIndexOf(marker);
  if (at < 0) return "";
  const start = text.indexOf("{", at + marker.length);
  if (start < 0) return "";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === "\"") inStr = false; continue; }
    if (c === "\"") inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return "";
}

export function parseUpdate(text: string): GoalUpdate | null {
  const raw = jsonAfter(String(text ?? ""), "GOAL_UPDATE:");
  if (!raw) return null;
  let o: Record<string, unknown> | null = null;
  for (const candidate of [raw, raw.replace(/,\s*([}\]])/g, "$1")]) {
    try { const v = JSON.parse(candidate); if (v && typeof v === "object" && !Array.isArray(v)) { o = v as Record<string, unknown>; break; } } catch { /* try the repaired text */ }
  }
  if (!o) return null;
  const states: MilestoneState[] = ["open", "done", "skipped", "blocked"];
  const p = Number(o.progress);
  return {
    ...(Number.isFinite(p) ? { progress: Math.round(Math.min(100, Math.max(0, p))) } : {}),
    milestones: (Array.isArray(o.milestones) ? o.milestones : []).map((m) => {
      const r = (m ?? {}) as Record<string, unknown>;
      const st = String(r.state ?? "open").toLowerCase() as MilestoneState;
      return { id: txt(r.id, 12), state: states.includes(st) ? st : "open", proof: txt(r.proof, 240) };
    }).filter((m) => m.id).slice(0, 24),
    newMilestones: strList(o.new_milestones, 6, 140).filter((s) => s.length >= 3),
    nextAction: txt(o.next_action, 300),
    lesson: txt(o.lesson, 200),
    blockers: strList(o.blockers, 5, 200),
    needsOwner: txt(o.needs_owner, 400),
    achieved: o.achieved === true,
    evidence: strList(o.evidence, 10, 240),
    summary: txt(o.summary, 400),
  };
}

export function applyUpdate(before: Goal, u: GoalUpdate, now: number): {
  goal: Goal; events: GoalEvent[]; progressed: boolean; done: Milestone[]; added: number; rejected: string[];
} {
  const goal: Goal = JSON.parse(JSON.stringify(before));
  const events: GoalEvent[] = [];
  const rejected: string[] = [];
  const done: Milestone[] = [];
  for (const m of u.milestones) {
    const cur = goal.milestones.find((x) => x.id === m.id);
    if (!cur) continue;
    if (m.state === "done" || m.state === "skipped") {
      if (cur.state === "done" || cur.state === "skipped") continue;
      if (!m.proof) { rejected.push(`${cur.id} was marked ${m.state} without proof or reason`); continue; }
      cur.state = m.state; cur.proof = m.proof; cur.at = now;
      done.push({ ...cur });
      events.push({ kind: "progress", text: `${m.state === "done" ? "Done" : "Skipped"}: ${cur.t} (${clip(m.proof, 120)})` });
    } else if (m.state === "blocked") {
      if (cur.state === "open") cur.state = "blocked";
      if (m.proof) cur.proof = m.proof;
    } else if (cur.state === "blocked") cur.state = "open";
  }
  let added = 0;
  for (const t of u.newMilestones) {
    if (goal.milestones.length >= MAX_MILESTONES) break;
    if (goal.milestones.some((x) => x.t.toLowerCase() === t.toLowerCase())) continue;
    goal.milestones.push({ id: nextId(goal.milestones), t, state: "open" });
    added++;
  }
  if (added) events.push({ kind: "replan", text: `Plan updated: ${added} new milestone${added > 1 ? "s" : ""}.` });
  for (const r of rejected) events.push({ kind: "verify", text: `Not accepted: ${r}.` });

  const total = goal.milestones.length;
  const closed = goal.milestones.filter((m) => m.state === "done" || m.state === "skipped").length;
  const raw = total ? Math.round((closed / total) * 100) : u.progress ?? goal.progress;
  goal.progress = Math.min(95, Math.max(0, raw)); // 100 only after a verified finish
  const progressed = done.length > 0 || goal.progress > before.progress;

  if (u.nextAction) goal.nextAction = u.nextAction;
  if (u.lesson && !has(goal.lessons, u.lesson)) goal.lessons = [...goal.lessons, u.lesson].slice(-8);
  goal.blockers = u.blockers;
  if (progressed) { goal.stalls = 0; goal.lastProgressAt = now; }
  else if (!u.needsOwner) {
    goal.stalls += 1;
    events.push({ kind: "stall", text: `No real progress in this session (${goal.stalls} in a row).` });
  }
  if (goal.stalls >= 2 && !goal.replan) { goal.replan = true; events.push({ kind: "replan", text: "Two sessions without progress: the next one will rebuild the plan." }); }
  else if (goal.replan) goal.replan = goal.stalls >= 2;
  events.unshift({ kind: "pulse", text: clip(u.summary || "Work session finished.", 260) });
  return { goal, events, progressed, done, added, rejected };
}

/** Evidence the owner could check: the update's own list plus the proofs of closed milestones. */
export function evidenceOf(g: Goal, u: GoalUpdate): string[] {
  return [...u.evidence, ...g.milestones.filter((m) => m.state === "done" && m.proof).map((m) => `${m.id}: ${m.proof}`)].slice(0, 14);
}

/** The finish claim is checked by a second model only when there is evidence to check. */
export function needsVerification(g: Goal, u: GoalUpdate | null): boolean {
  return Boolean(u && u.achieved && evidenceOf(g, u).length > 0);
}

export function verifyInput(g: Goal, u: GoalUpdate): { task: string; summary: string; evidence: string[] } {
  return {
    task: `${g.title}: ${g.objective}\nSuccess criteria (ALL must be met):\n${g.success.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    summary: `${u.summary || "The agent says the goal is achieved."}\nMilestones: ${g.milestones.map((m) => `${m.id} ${m.state}`).join(", ") || "none"}`,
    evidence: evidenceOf(g, u),
  };
}

export type Verdict = { verdict: "pass" | "partial" | "fail"; reason: string };
export type Settled = { goal: Goal; events: GoalEvent[]; message: string; notify: boolean; achieved: boolean; question: string };

const PACE_LABEL: Record<Pace, string> = { on_track: "on track", at_risk: "at risk", behind: "behind", no_deadline: "", done: "done" };
export const bar = (p: number) => { const n = Math.round(Math.min(100, Math.max(0, p)) / 10); return "█".repeat(n) + "░".repeat(10 - n); };

/** Everything that happens when a work session ends: apply the report, check a finish claim, decide status, next time, and what to tell the owner. */
export function settlePulseResult(before: Goal, u: GoalUpdate | null, verdict: Verdict | null, now: number): Settled {
  const upd = u ?? emptyUpdate();
  const ap = applyUpdate(before, upd, now);
  const g = ap.goal;
  const events = ap.events.slice();
  let achieved = false;
  if (upd.achieved) {
    if (!verdict) {
      events.push({ kind: "verify", text: "Said the goal is reached but gave no evidence: not accepted." });
      g.nextAction = "Collect concrete evidence for every success criterion, then claim it again.";
    } else if (verdict.verdict === "pass") {
      achieved = true;
      g.status = "achieved"; g.progress = 100; g.verifiedAt = now;
      g.result = clip(upd.summary || "Goal achieved.", 1000);
      events.push({ kind: "verify", text: `Verified by a second check: ${verdict.reason}` });
    } else {
      events.push({ kind: "verify", text: `Finish not accepted (${verdict.verdict}): ${verdict.reason}` });
      g.nextAction = clip(`Close the gap: ${verdict.reason}`, 300);
    }
  }
  g.errors = 0;
  g.pulse = null;
  let question = clip(upd.needsOwner, 400);
  if (!achieved) {
    if (question) {
      g.status = "needs_owner";
      g.blockers = [question, ...g.blockers.filter((b) => b !== question)].slice(0, 5);
      events.push({ kind: "status", text: `Waiting for the owner: ${question}` });
    } else if (g.stalls >= 3) {
      question = `I made no real progress in ${g.stalls} work sessions in a row. ${g.blockers.length ? `Blocked by: ${g.blockers.join("; ")}. ` : ""}What should change: the plan, the finish line, my permissions, or should I stop?`;
      g.status = "needs_owner";
      events.push({ kind: "stall", text: "Stopped after 3 stalled sessions and asked the owner." });
    }
  }
  g.pace = computePace(g, now);
  if (g.status === "active") g.nextPulseAt = nextPulseTime(g, now);
  g.updatedAt = now;

  const worse = (before.pace === "on_track" || before.pace === "no_deadline") && (g.pace === "at_risk" || g.pace === "behind");
  const notify =
    before.notify === "always" ? true
    : before.notify === "quiet" ? achieved || Boolean(question)
    : achieved || Boolean(question) || ap.done.length > 0 || (ap.added > 0 && before.pulses <= 1) || g.progress - before.progress >= 10 || worse || g.stalls >= 2;

  const lines: string[] = [];
  lines.push(`🎯 ${g.title} · ${bar(g.progress)} ${g.progress}%${PACE_LABEL[g.pace] ? ` · ${PACE_LABEL[g.pace]}` : ""}`);
  if (upd.summary) lines.push(upd.summary);
  for (const m of ap.done) lines.push(`✅ ${m.t}${m.proof ? ` — ${clip(m.proof, 100)}` : ""}`);
  if (ap.added) lines.push(`🧭 Plan: ${ap.added} new milestone${ap.added > 1 ? "s" : ""} added.`);
  for (const r of ap.rejected) lines.push(`⚠️ Not accepted: ${r}.`);
  if (upd.achieved && !achieved) lines.push("⚠️ I claimed the goal was reached, but the check did not accept it. I will close the gap.");
  if (achieved) lines.push("🏁 Goal achieved. A second check confirmed it against your success criteria.");
  else if (question) lines.push(`❓ I need you: ${question}\nAnswer here in the chat and I continue.`);
  else if (g.nextAction) lines.push(`➡️ Next: ${g.nextAction}`);
  return { goal: g, events, message: clip(lines.join("\n"), 1500), notify, achieved, question };
}

/** A pulse that crashed or timed out (not a stall: nothing was learned). Three in a row hand the goal to the owner. */
export function failPulse(before: Goal, reason: string, now: number): Settled {
  const g: Goal = JSON.parse(JSON.stringify(before));
  g.pulse = null; g.errors += 1; g.updatedAt = now;
  const events: GoalEvent[] = [{ kind: "error", text: clip(`A work session failed: ${reason}`, 260) }];
  let question = "";
  if (g.errors >= 3) {
    g.status = "needs_owner";
    question = `The last ${g.errors} work sessions failed (${clip(reason, 160)}). Check the connection or tool it needs, then tell me to continue.`;
    g.blockers = [question, ...g.blockers].slice(0, 5);
    events.push({ kind: "status", text: "Paused after 3 failed sessions." });
  } else g.nextPulseAt = now + Math.max(30 * MIN, Math.min(g.cadenceMinutes * MIN, 3 * HOUR));
  const message = question ? `🎯 ${g.title}\n⚠️ ${question}` : "";
  return { goal: g, events, message, notify: Boolean(question), achieved: false, question };
}

// ---------------- the owner steers the goal ----------------
export function patchGoal(before: Goal, a: Record<string, unknown>, now: number): { goal: Goal; changes: string[]; resumed: boolean } | { error: string } {
  if (before.status === "achieved" || before.status === "cancelled" || before.status === "failed") {
    return { error: `This goal is ${before.status}. Create a new goal instead.` };
  }
  const g: Goal = JSON.parse(JSON.stringify(before));
  const changes: string[] = [];
  const events: GoalEvent[] = [];
  const title = txt(a.title, 100);
  if (title.length >= 3 && title !== g.title) { g.title = title; changes.push("title"); }
  const objective = txt(a.objective, 700);
  if (objective.length >= 15 && objective !== g.objective) { g.objective = objective; changes.push("objective"); g.replan = true; }
  if (a.success !== undefined) {
    const s = strList(a.success, 8, 300).filter((x) => x.length >= 5);
    if (!s.length) return { error: "`success` must contain at least one measurable finish line." };
    g.success = s; changes.push("success criteria"); g.replan = true;
  }
  if (a.cadence_hours !== undefined) { g.cadenceMinutes = Math.round(num(a.cadence_hours, 1, 168, g.cadenceMinutes / 60) * 60); changes.push("cadence"); g.nextPulseAt = Math.min(g.nextPulseAt, now + g.cadenceMinutes * MIN); }
  if (a.deadline !== undefined || a.deadline_days !== undefined) {
    const dl = parseDeadline(a, now, g.tz);
    if ("error" in dl) return { error: dl.error };
    if (dl.deadline) g.deadline = dl.deadline; else delete g.deadline;
    changes.push("deadline");
  }
  if (a.quiet !== undefined) { const q = parseQuiet(a.quiet); if (q) g.quiet = q; else delete g.quiet; changes.push("quiet hours"); }
  if (a.autonomy === "auto" || a.autonomy === "ask") { if (a.autonomy !== g.autonomy) { g.autonomy = a.autonomy; changes.push(`autonomy: ${a.autonomy}`); } }
  if (a.notify === "smart" || a.notify === "always" || a.notify === "quiet") { g.notify = a.notify; changes.push("notifications"); }
  if (a.max_pulses_per_day !== undefined) { g.limits.maxPulsesPerDay = Math.round(num(a.max_pulses_per_day, 1, 12, g.limits.maxPulsesPerDay)); changes.push("daily limit"); }
  if (a.max_pulses_total !== undefined) { g.limits.maxPulsesTotal = Math.round(num(a.max_pulses_total, 1, 500, g.limits.maxPulsesTotal)); changes.push("total limit"); }
  if (a.max_calls !== undefined) { g.limits.maxCalls = Math.round(num(a.max_calls, 0, 20, g.limits.maxCalls)); changes.push("call limit"); }
  const note = txt(a.note ?? a.answer, 400);
  let resumed = false;
  if (note) {
    g.ownerNotes = [...g.ownerNotes, note].slice(-6);
    changes.push("a note for the next session");
    events.push({ kind: "owner", text: `Owner: ${clip(note, 220)}` });
    if (before.status === "needs_owner") { g.blockers = []; resumed = true; }
  }
  if (a.replan === true) { g.replan = true; changes.push("replan requested"); }
  if (a.resume === true && (before.status === "paused" || before.status === "needs_owner")) resumed = true;
  if (resumed) {
    g.status = "active"; g.stalls = 0; g.errors = 0; g.nextPulseAt = now;
    events.push({ kind: "status", text: "Resumed." });
  }
  if (!changes.length && !resumed) return { error: "Nothing to change. Give a note, an answer, or a field to update (title, objective, success, cadence_hours, deadline, quiet, autonomy, notify, limits, resume, replan)." };
  g.pace = computePace(g, now);
  g.log = pushLog(g.log, [{ kind: "owner", text: `Updated: ${changes.join(", ")}.` }, ...events], now);
  g.updatedAt = now;
  return { goal: g, changes, resumed };
}

// ---------------- showing goals in the chat ----------------
export function renderGoal(g: Goal, now: number, withLog = true): string {
  const mark = (s: MilestoneState) => (s === "done" ? "[x]" : s === "skipped" ? "[-]" : s === "blocked" ? "[!]" : "[ ]");
  const when = (ms: number) => formatLocal(ms, g.tz);
  const head = `🎯 ${g.title}  (id ${g.id ?? "?"})\n${bar(g.progress)} ${g.progress}% · ${g.status.replace("_", " ")}${PACE_LABEL[g.pace] ? ` · ${PACE_LABEL[g.pace]}` : ""}`;
  const rows = [
    head,
    `Objective: ${g.objective}`,
    `Success when: ${g.success.join(" · ")}`,
    g.milestones.length ? g.milestones.map((m) => `${mark(m.state)} ${m.id} ${m.t}${m.proof ? ` — ${clip(m.proof, 80)}` : ""}`).join("\n") : "Milestones: not planned yet (the first session plans them).",
    g.status === "needs_owner" && g.blockers[0] ? `❓ Waiting for you: ${g.blockers[0]}` : g.nextAction ? `Next: ${g.nextAction}` : "",
    g.status === "active" ? (g.pulse ? "A work session is running now." : `Next work session: ${g.nextPulseAt <= now ? "due" : when(g.nextPulseAt)}`) : "",
    `Sessions: ${g.pulses}/${g.limits.maxPulsesTotal} (max ${g.limits.maxPulsesPerDay}/day) · every ${Math.round(g.cadenceMinutes / 6) / 10}h${g.deadline ? ` · deadline ${when(g.deadline)}` : ""}${g.quiet ? ` · quiet ${g.quiet.start}-${g.quiet.end}` : ""} · ${g.autonomy === "auto" ? "writes on its own" : "asks before writing"}`,
    g.lessons.length ? `Learned: ${g.lessons.slice(-3).join(" | ")}` : "",
    withLog && g.log.length ? `Log:\n${g.log.slice(-8).map((l) => `- ${when(l.at)} ${l.kind}: ${clip(l.text, 140)}`).join("\n")}` : "",
  ];
  return rows.filter(Boolean).join("\n");
}

export function renderList(goals: Goal[], now: number): string {
  if (!goals.length) return "No goals yet. Tell me what you want to achieve and by when.";
  return goals.map((g) => `• ${g.title} (id ${g.id}) · ${bar(g.progress)} ${g.progress}% · ${g.status.replace("_", " ")}${PACE_LABEL[g.pace] ? ` · ${PACE_LABEL[g.pace]}` : ""}${g.status === "active" && !g.pulse ? ` · next ${g.nextPulseAt <= now ? "due" : formatLocal(g.nextPulseAt, g.tz)}` : ""}`).join("\n");
}
