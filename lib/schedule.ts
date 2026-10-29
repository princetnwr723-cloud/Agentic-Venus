// Pure scheduling maths. No imports, no dependencies: it runs in the browser, on the server and in the Node tests.
// Supports: "every N minutes" (anchored, no drift), 5-field cron with timezone + DST, one-shot "at", quiet hours, and a human parser.

export type Schedule =
  | { kind: "every"; minutes: number; anchor: number }
  | { kind: "cron"; expr: string; tz: string }
  | { kind: "at"; at: number };

export const MIN_GAP_MS = 5 * 60_000; // the scheduler ticks every 5 minutes, so nothing can run more often
const MIN = 60_000;
const DAY = 86_400_000;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DOWS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MACROS: Record<string, string> = {
  "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *",
};

export type CronSpec = { min: number[]; hour: number[]; dom: Set<number>; mon: Set<number>; dow: Set<number>; domStar: boolean; dowStar: boolean };

function parseField(src: string, lo: number, hi: number, names?: string[], isDow = false): { values: number[]; star: boolean } {
  const out = new Set<number>();
  const num = (t: string): number => {
    const idx = names ? names.indexOf(t.toLowerCase().slice(0, 3)) : -1;
    const n = idx >= 0 && /^[a-z]+$/i.test(t) ? idx + (names === MONTHS ? 1 : 0) : Number(t);
    if (!Number.isInteger(n) || !/^[a-z0-9]+$/i.test(t)) throw new Error(`Bad value "${t}" in cron field "${src}".`);
    return n;
  };
  for (const part of src.split(",")) {
    if (!part) throw new Error(`Empty item in cron field "${src}".`);
    const [range, stepTxt] = part.split("/");
    const step = stepTxt === undefined ? 1 : Number(stepTxt);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in cron field "${src}".`);
    let a: number, b: number;
    if (range === "*") { a = lo; b = hi; }
    else if (range.includes("-")) { const [x, y] = range.split("-"); a = num(x); b = num(y); }
    else { a = num(range); b = stepTxt === undefined ? a : hi; }
    if (isDow) { if (a === 7 && b === 7) { a = 0; b = 0; } }
    const top = isDow ? 7 : hi;
    if (a < lo || b > top || a > b) throw new Error(`Value out of range in cron field "${src}" (${lo}-${top}).`);
    for (let v = a; v <= b; v += step) out.add(isDow && v === 7 ? 0 : v);
  }
  return { values: [...out].sort((x, y) => x - y), star: src.startsWith("*") };
}

export function parseCron(expr: string): CronSpec {
  const e = MACROS[expr.trim().toLowerCase()] ?? expr.trim();
  const f = e.split(/\s+/);
  if (f.length !== 5) throw new Error('A cron expression has 5 fields: "minute hour day-of-month month day-of-week", e.g. "30 9 * * 1-5".');
  const min = parseField(f[0], 0, 59), hour = parseField(f[1], 0, 23), dom = parseField(f[2], 1, 31), mon = parseField(f[3], 1, 12, MONTHS), dow = parseField(f[4], 0, 6, DOWS, true);
  return { min: min.values, hour: hour.values, dom: new Set(dom.values), mon: new Set(mon.values), dow: new Set(dow.values), domStar: dom.star, dowStar: dow.star };
}

// ---------------- timezones ----------------
const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    cache.set(tz, f);
  }
  return f;
}
export function isValidTz(tz: string): boolean { try { dtf(tz); return true; } catch { return false; } }
export const safeTz = (tz?: string): string => (tz && isValidTz(tz) ? tz : "UTC");

export type Parts = { y: number; mo: number; d: number; h: number; mi: number; s: number; dow: number };
export function localParts(ms: number, tz: string): Parts {
  const p: Record<string, number> = {};
  for (const x of dtf(tz).formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  const h = (p.hour ?? 0) % 24;
  return { y: p.year, mo: p.month, d: p.day, h, mi: p.minute, s: p.second, dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}
function offsetMs(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
/** Wall-clock time in a zone -> instant. Overlap (clocks go back) picks the first one; a gap (clocks go forward) runs right after the gap. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const valid: number[] = [], all: number[] = [];
  for (const off of new Set([offsetMs(guess - DAY, tz), offsetMs(guess + DAY, tz)])) {
    const t = guess - off;
    all.push(t);
    const p = localParts(t, tz);
    if (p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi) valid.push(t);
  }
  return valid.length ? Math.min(...valid) : Math.max(...all);
}

const dayOk = (c: CronSpec, mo: number, d: number, wd: number) => {
  if (!c.mon.has(mo)) return false;
  const a = c.dom.has(d), b = c.dow.has(wd);
  return c.domStar || c.dowStar ? a && b : a || b; // classic cron: both restricted means "either"
};

/** The first matching instant strictly after `after`. */
export function nextCron(expr: string, tz: string, after: number): number | null {
  const c = parseCron(expr);
  const z = safeTz(tz);
  const s = localParts(after, z);
  const base = Date.UTC(s.y, s.mo - 1, s.d);
  for (let i = 0; i <= 366 * 8; i++) {
    const day = new Date(base + i * DAY);
    const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, d = day.getUTCDate();
    if (!dayOk(c, mo, d, day.getUTCDay())) continue;
    for (const h of c.hour) for (const mi of c.min) {
      const t = zonedToUtc(y, mo, d, h, mi, z);
      if (t > after) return t;
    }
  }
  return null;
}

/** The first run strictly after `after` (null when there is none: a finished one-shot). */
export function nextRun(s: Schedule, after: number): number | null {
  if (s.kind === "every") {
    const step = Math.max(1, s.minutes) * MIN;
    return s.anchor + (Math.floor((after - s.anchor) / step) + 1) * step;
  }
  if (s.kind === "at") return s.at > after ? s.at : null;
  return nextCron(s.expr, s.tz, after);
}

export function occurrences(s: Schedule, after: number, n: number): number[] {
  const out: number[] = [];
  let t = after;
  for (let i = 0; i < n; i++) { const x = nextRun(s, t); if (x === null) break; out.push(x); t = x; }
  return out;
}

/** Returns an error message, or null when the schedule is fine. */
export function validateSchedule(s: Schedule, now = Date.now()): string | null {
  try {
    if (s.kind === "every") {
      if (!Number.isFinite(s.minutes) || s.minutes < 5) return "Repeat interval must be at least 5 minutes.";
      if (s.minutes > 525_600) return "Repeat interval is too long (max 1 year).";
      if (!Number.isFinite(s.anchor)) return "Bad start time.";
      return null;
    }
    if (s.kind === "at") return Number.isFinite(s.at) && s.at > now - MIN ? null : "That time is already in the past.";
    if (!isValidTz(s.tz)) return `Unknown timezone "${s.tz}" (use a name like Asia/Kolkata).`;
    parseCron(s.expr);
    const a = nextCron(s.expr, s.tz, now);
    if (a === null) return "This cron expression never matches a real date.";
    const b = nextCron(s.expr, s.tz, a);
    if (b !== null && b - a < MIN_GAP_MS) return "Routines can run at most once every 5 minutes.";
    return null;
  } catch (e) { return e instanceof Error ? e.message : "Bad schedule."; }
}

// ---------------- reading and writing ----------------
export const pad2 = (n: number) => String(n).padStart(2, "0");
export function formatLocal(ms: number, tz: string): string {
  const p = localParts(ms, safeTz(tz));
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.mi)}`;
}
export const dayKey = (ms: number, tz: string) => formatLocal(ms, tz).slice(0, 10);

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function everyLabel(minutes: number): string {
  if (minutes % 10080 === 0) return minutes === 10080 ? "every week" : `every ${minutes / 10080} weeks`;
  if (minutes % 1440 === 0) return minutes === 1440 ? "every day" : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "every hour" : `every ${minutes / 60} hours`;
  return `every ${minutes} minutes`;
}
export function describeSchedule(s: Schedule, tz = "UTC"): string {
  if (s.kind === "every") return everyLabel(s.minutes);
  if (s.kind === "at") return `once, ${formatLocal(s.at, tz)} (${tz})`;
  const [m, h, dom, mon, dow] = (MACROS[s.expr.trim().toLowerCase()] ?? s.expr.trim()).split(/\s+/);
  const z = ` (${s.tz})`;
  const step = m?.match(/^\*\/(\d+)$/);
  if (step && h === "*" && dom === "*" && mon === "*" && dow === "*") return `every ${step[1]} minutes${z}`;
  if (/^\d+$/.test(m ?? "") && /^\d+$/.test(h ?? "")) {
    const t = `${pad2(Number(h))}:${pad2(Number(m))}`;
    if (dom === "*" && mon === "*" && dow === "*") return `every day at ${t}${z}`;
    if (dom === "*" && mon === "*" && dow === "1-5") return `weekdays at ${t}${z}`;
    if (dom === "*" && mon === "*" && /^[0-7]$/.test(dow ?? "")) return `every ${DAY_NAMES[Number(dow) % 7]} at ${t}${z}`;
    if (/^\d+$/.test(dom ?? "") && mon === "*" && dow === "*") return `monthly on day ${dom} at ${t}${z}`;
  }
  if (/^\d+$/.test(m ?? "") && h === "*" && dom === "*" && mon === "*" && dow === "*") return `every hour at :${pad2(Number(m))}${z}`;
  return `cron "${s.expr}"${z}`;
}

/** Quiet hours: "22:00"-"07:00" (may cross midnight) in the routine's timezone. */
export function inQuietHours(ms: number, tz: string, start?: string, end?: string): boolean {
  const toMin = (t?: string) => { const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
  const a = toMin(start), b = toMin(end);
  if (a < 0 || b < 0 || a === b) return false;
  const p = localParts(ms, safeTz(tz));
  const t = p.h * 60 + p.mi;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

// ---------------- human text -> schedule ----------------
function parseTime(s: string): { h: number; m: number } | null {
  const r = s.match(/(?:\bat\s+|@\s*)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/) || s.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/) || s.match(/\b(\d{1,2})\s*(am|pm)\b/) || s.match(/\b(\d{1,2})\s*baje\b/);
  if (!r) return null;
  let h = Number(r[1]);
  const isMer = (x?: string) => x === "am" || x === "pm";
  const mer = isMer(r[3]) ? r[3] : isMer(r[2]) ? r[2] : undefined;
  const m = r[2] && !isMer(r[2]) ? Number(r[2]) : 0;
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return h > 23 || m > 59 ? null : { h, m };
}
const UNIT = (u: string) => (u.startsWith("m") ? 1 : u.startsWith("h") ? 60 : u.startsWith("d") ? 1440 : 10080);

/** Understands cron text, "every 2 hours", "daily at 9", "weekdays 09:30", "every monday and thursday at 6pm", "monthly on the 5th at 10:00", "in 20 minutes", "at 2026-11-01 18:30". */
export function parseHuman(input: string, tz = "UTC", now = Date.now()): { schedule?: Schedule; error?: string } {
  const raw = String(input ?? "").trim();
  const t = raw.toLowerCase().replace(/\s+/g, " ");
  if (!t) return { error: "Schedule is empty." };
  const z = safeTz(tz);
  const done = (schedule: Schedule) => { const e = validateSchedule(schedule, now); return e ? { error: e } : { schedule }; };

  const c = raw.match(/^cron:?\s*(.+)$/i);
  const cand = c ? c[1].trim() : raw;
  if (MACROS[cand.toLowerCase()] || (/^[\d*\/,\-a-z]+(\s+[\d*\/,\-a-z]+){4}$/i.test(cand) && /[\d*]/.test(cand.split(/\s+/)[0]))) return done({ kind: "cron", expr: cand, tz: z });

  const rel = t.match(/^in (\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)$/);
  if (rel) return done({ kind: "at", at: Math.round(now + Number(rel[1]) * UNIT(rel[2]) * MIN) });
  const abs = t.match(/^at (\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})$/);
  if (abs) return done({ kind: "at", at: zonedToUtc(+abs[1], +abs[2], +abs[3], +abs[4], +abs[5], z) });

  const ev = t.match(/^every (\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?)$/);
  if (ev) return done({ kind: "every", minutes: Number(ev[1]) * UNIT(ev[2]), anchor: now });
  if (/^(hourly|every hour)$/.test(t)) return done({ kind: "every", minutes: 60, anchor: now });

  const tm = parseTime(t) ?? { h: 9, m: 0 };
  const hm = `${tm.m} ${tm.h}`;
  const days = [...new Set([...t.matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/g)].map((x) => DOWS.indexOf(x[1])))].sort();
  if (/\b(weekdays?|mon-fri|monday to friday)\b/.test(t)) return done({ kind: "cron", expr: `${hm} * * 1-5`, tz: z });
  if (/\bweekends?\b/.test(t)) return done({ kind: "cron", expr: `${hm} * * 0,6`, tz: z });
  if (/\b(monthly|every month|har mahine)\b/.test(t)) {
    const d = t.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/) || t.match(/\bday (\d{1,2})\b/);
    return done({ kind: "cron", expr: `${hm} ${d ? Number(d[1]) : 1} * *`, tz: z });
  }
  if (days.length) return done({ kind: "cron", expr: `${hm} * * ${days.join(",")}`, tz: z });
  if (/\b(weekly|every week|har hafte)\b/.test(t)) return done({ kind: "cron", expr: `${hm} * * 1`, tz: z });
  if (/\b(daily|every day|everyday|each day|every morning|every evening|every night|roz|rozana|har din)\b/.test(t)) return done({ kind: "cron", expr: `${hm} * * *`, tz: z });
  return { error: `I could not understand the schedule "${raw}". Use e.g. "every day at 09:00", "weekdays at 18:30", "every 2 hours", "in 20 minutes" or a cron expression.` };
}