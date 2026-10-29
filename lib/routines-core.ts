// Shared by the browser and the server: routine types, defaults and input checking. No Firebase in here.
import { nextRun, parseHuman, safeTz, validateSchedule, type Schedule } from "./schedule";

export type NotifyPolicy = "always" | "changes" | "smart"; // changes = only when the result differs; smart = the agent stays silent when nothing is new
export type RoutineMode = "auto" | "lite" | "agent";       // lite = web research only (fast, cheap); agent = full tools via the mission engine
export const CHANNEL_IDS = ["telegram", "whatsapp", "sms", "slackbot", "email", "webhook"];

export type Routine = {
  id: string;
  chatId: string;
  name: string;
  instructions: string;
  everyMinutes: number; // kept for old routines; `schedule` is the truth when present
  nextRunAt: number;
  enabled: boolean;
  lastRunAt?: number;
  lastResult?: string;
  // ---- new, all optional: old routines keep working untouched ----
  schedule?: Schedule;
  tz?: string;
  mode?: RoutineMode;
  allowWrites?: boolean;
  notify?: NotifyPolicy;
  toChat?: boolean;
  channels?: string[];
  catchUp?: "once" | "skip";
  graceMinutes?: number;
  quiet?: { start: string; end: string };
  retries?: number;
  maxRunsPerDay?: number;
  maxRuns?: number;
  expiresAt?: number;
  hook?: boolean;
  hookVersion?: number;
  thenRun?: string[];
  // ---- engine state (written by the server) ----
  runCount?: number;
  attempt?: number;
  scheduledFor?: number;
  consecutiveFailures?: number;
  pausedReason?: string;
  lastStatus?: string;
  lastHash?: string;
  lastDurationMs?: number;
  leaseUntil?: number;
  activeRunId?: string;
  dayKey?: string;
  dayRuns?: number;
  lastHookAt?: number;
  createdAt?: unknown;
};

/** Old routines only have `everyMinutes`: they are read as an "every" schedule anchored at their next run. */
export const effectiveSchedule = (r: Pick<Routine, "schedule" | "everyMinutes" | "nextRunAt">, now = Date.now()): Schedule =>
  r.schedule ?? { kind: "every", minutes: Math.max(5, Math.round(r.everyMinutes) || 1440), anchor: r.nextRunAt || now };

/** A rough "how often" number for the old `everyMinutes` field. */
export function approxMinutes(s: Schedule, now = Date.now()): number {
  if (s.kind === "every") return s.minutes;
  const a = nextRun(s, now);
  const b = a === null ? null : nextRun(s, a);
  return a !== null && b !== null ? Math.max(5, Math.round((b - a) / 60_000)) : 1440;
}

export function firstRunAt(s: Schedule, now: number, o: { startAt?: number; runNow?: boolean } = {}): number | null {
  if (s.kind === "at") return s.at;
  if (o.startAt && o.startAt > now) return s.kind === "every" ? o.startAt : nextRun(s, o.startAt - 1);
  if (s.kind === "every" && o.runNow) return now;
  return nextRun(s, now);
}

export function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
  return out as Partial<T>;
}

const num = (x: unknown, lo: number, hi: number): number | null => {
  const n = Math.round(Number(x));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * Checks any (partial) routine input, from the form, the agent tools or an edit.
 * A value of null means "clear this field". The schedule may be a Schedule object or plain text ("every day at 9am").
 */
export function normalizePatch(raw: Record<string, any>, o: { tz?: string; now?: number } = {}): { value: Record<string, unknown>; error?: string } {
  const now = o.now ?? Date.now();
  const v: Record<string, unknown> = {};
  const bad = (error: string) => ({ value: {} as Record<string, unknown>, error });

  const tzRaw = raw.tz ?? raw.timezone;
  const tz = safeTz(String(tzRaw ?? o.tz ?? ""));
  if (tzRaw !== undefined) {
    if (safeTz(String(tzRaw)) !== String(tzRaw)) return bad(`Unknown timezone "${String(tzRaw)}" (use a name like Asia/Kolkata).`);
    v.tz = tz;
  }
  if (raw.name !== undefined) {
    const s = String(raw.name).trim().slice(0, 80);
    if (!s) return bad("Name is empty.");
    v.name = s;
  }
  if (raw.instructions !== undefined) {
    const s = String(raw.instructions).trim().slice(0, 4000);
    if (s.length < 5) return bad("Instructions are too short: say what to do on every run.");
    v.instructions = s;
  }
  if (raw.schedule !== undefined && raw.schedule !== null) {
    let sch: Schedule | undefined;
    if (typeof raw.schedule === "string") {
      const h = parseHuman(raw.schedule, tz, now);
      if (h.error) return bad(h.error);
      sch = h.schedule;
    } else if (typeof raw.schedule === "object") {
      const x = raw.schedule as Record<string, any>;
      if (x.kind === "every") sch = { kind: "every", minutes: Math.round(Number(x.minutes)), anchor: Number(x.anchor) || now };
      else if (x.kind === "cron") sch = { kind: "cron", expr: String(x.expr ?? "").trim(), tz: safeTz(String(x.tz ?? tz)) };
      else if (x.kind === "at") sch = { kind: "at", at: Number(x.at) };
    }
    if (!sch) return bad("Unknown schedule.");
    const e = validateSchedule(sch, now);
    if (e) return bad(e);
    v.schedule = sch;
    v.everyMinutes = approxMinutes(sch, now);
    if (sch.kind === "cron") v.tz = sch.tz;
  }
  if (raw.mode !== undefined) {
    if (!["auto", "lite", "agent"].includes(raw.mode)) return bad('mode must be "auto", "lite" or "agent".');
    v.mode = raw.mode;
  }
  if (raw.notify !== undefined) {
    if (!["always", "changes", "smart"].includes(raw.notify)) return bad('notify must be "always", "changes" or "smart".');
    v.notify = raw.notify;
  }
  if (raw.catchUp !== undefined) {
    if (!["once", "skip"].includes(raw.catchUp)) return bad('catchUp must be "once" or "skip".');
    v.catchUp = raw.catchUp;
  }
  for (const k of ["allowWrites", "toChat", "hook"]) if (raw[k] !== undefined) v[k] = raw[k] === true || raw[k] === "true";
  if (raw.channels !== undefined) v.channels = (Array.isArray(raw.channels) ? raw.channels : []).map(String).filter((c) => CHANNEL_IDS.includes(c));
  const n1 = (k: string, lo: number, hi: number) => {
    if (raw[k] === undefined) return;
    if (raw[k] === null || raw[k] === "") { v[k] = null; return; }
    const n = num(raw[k], lo, hi);
    if (n !== null) v[k] = n;
  };
  n1("graceMinutes", 5, 1440); n1("retries", 0, 5); n1("maxRunsPerDay", 1, 500); n1("maxRuns", 1, 100_000);
  if (raw.expiresAt !== undefined) {
    if (raw.expiresAt === null) v.expiresAt = null;
    else if (Number(raw.expiresAt) > now) v.expiresAt = Number(raw.expiresAt);
    else return bad("The end date is already in the past.");
  }
  if (raw.quiet !== undefined) {
    if (raw.quiet === null) v.quiet = null;
    else {
      const q = raw.quiet as Record<string, unknown>;
      if (!HHMM.test(String(q.start)) || !HHMM.test(String(q.end))) return bad("Quiet hours need a start and an end like 22:00 and 07:00.");
      v.quiet = { start: String(q.start), end: String(q.end) };
    }
  }
  if (raw.thenRun !== undefined) v.thenRun = (Array.isArray(raw.thenRun) ? raw.thenRun : []).map(String).filter((x) => /^[A-Za-z0-9]{10,40}$/.test(x)).slice(0, 5);
  return { value: v };
}