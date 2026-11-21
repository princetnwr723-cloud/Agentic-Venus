// The AgenticVenus calendar, the WRITING side: the pure part. Turns what the owner says ("kal", "11 baje", "friday 3 pm",
// "rahul@x.com") into exact times and clean e-mail lists, finds clashes, finds the event the owner means, and builds the
// body Google Calendar wants. No network and no database here (tested with node --test). calendar-actions.ts talks to Google.
import { addDays, startOfDay, weekdayOf, ymdIn, type CalEvent } from "./calendar-core.ts";

const MIN = 60_000;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// ---------------------------------------------------------------- the day
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const MONTH_LIST = MONTHS.split("|");
const WEEKDAYS: Array<[RegExp, number]> = [
  [/\b(sun|sunday|ravivar|ravi|itwar|raviwar)\b/, 0],
  [/\b(mon|monday|somvar|somwar|som)\b/, 1],
  [/\b(tue|tues|tuesday|mangalvar|mangalwar|mangal)\b/, 2],
  [/\b(wed|wednesday|budhvar|budhwar|budh)\b/, 3],
  [/\b(thu|thur|thurs|thursday|guruvar|guruwar|brihaspativar|vrihaspativar|guru)\b/, 4],
  [/\b(fri|friday|shukravar|shukrawar|shukra)\b/, 5],
  [/\b(sat|saturday|shanivar|shaniwar|shani)\b/, 6],
];
const isoValid = (ymd: string) => /^\d{4}-\d{2}-\d{2}$/.test(ymd) && new Date(ymd + "T00:00:00Z").toISOString().slice(0, 10) === ymd;
const pad = (n: number) => String(n).padStart(2, "0");

/** "today", "kal", "friday", "22 nov", "22/11", "2026-11-22" -> "2026-11-22" in the owner's time zone. null = not understood (never guess a date). */
export function resolveDay(input: string, now: number, tz: string): string | null {
  const t = String(input ?? "").toLowerCase().trim();
  const today = ymdIn(now, tz);
  if (!t) return today;
  const iso = /\d{4}-\d{2}-\d{2}/.exec(t);
  if (iso) return isoValid(iso[0]) ? iso[0] : null;
  if (/day after tomorrow|parso|parson/.test(t)) return addDays(today, 2);
  if (/tomorrow|tmrw|\bkal\b/.test(t)) return addDays(today, 1);
  if (/today|\baaj\b|\bnow\b|\babhi\b/.test(t)) return today;
  const year = Number(today.slice(0, 4));
  const fromParts = (d: number, mo: number): string | null => {
    let ymd = `${year}-${pad(mo)}-${pad(d)}`;
    if (!isoValid(ymd)) return null;
    if (ymd < today) { ymd = `${year + 1}-${pad(mo)}-${pad(d)}`; if (!isoValid(ymd)) return null; }
    return ymd;
  };
  const a = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MONTHS})[a-z]*`).exec(t);
  if (a) return fromParts(Number(a[1]), MONTH_LIST.indexOf(a[2]) + 1);
  const b = new RegExp(`(${MONTHS})[a-z]*\\s*(\\d{1,2})`).exec(t);
  if (b) return fromParts(Number(b[2]), MONTH_LIST.indexOf(b[1]) + 1);
  const dm = /(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/.exec(t); // day first, the way it is written in India
  if (dm) {
    const d = Number(dm[1]), mo = Number(dm[2]);
    if (mo < 1 || mo > 12) return null;
    if (dm[3]) { const y = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]); const ymd = `${y}-${pad(mo)}-${pad(d)}`; return isoValid(ymd) ? ymd : null; }
    return fromParts(d, mo);
  }
  for (const [re, wd] of WEEKDAYS) if (re.test(t)) return addDays(today, ((wd - weekdayOf(today) + 7) % 7) || 7); // always a day in the future
  return null;
}

// ---------------------------------------------------------------- the time of day
export type Clock = { h: number; m: number; assumed: boolean };
/** "11", "11:30", "11am", "3 pm", "15:00", "subah 11 baje", "shaam 5", "saade 3" -> hour and minute. `assumed` = no am/pm was said and the hour could be either. */
export function parseClock(input: string): Clock | null {
  const s = String(input ?? "").toLowerCase().trim();
  if (!s) return null;
  if (/\bnoon\b/.test(s)) return { h: 12, m: 0, assumed: false };
  if (/\bmidnight\b/.test(s)) return { h: 0, m: 0, assumed: false };
  const pm = /\d\s*p\.?m(?![a-z])|\bpm\b|dopahar|dopahr|afternoon|shaam|sham|evening|raat|night/.test(s);
  const am = /\d\s*a\.?m(?![a-z])|\bam\b|subah|subha|savere|morning/.test(s);
  const half = /saade?\s*(\d{1,2})/.exec(s);
  let h: number, m: number;
  if (half) { h = Number(half[1]); m = 30; }
  else {
    const x = /(\d{1,2})(?:\s*[:.]\s*(\d{2}))?/.exec(s);
    if (!x) return null;
    h = Number(x[1]); m = x[2] ? Number(x[2]) : 0;
  }
  if (!Number.isFinite(h) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  if (h >= 13 || h === 0) return { h, m, assumed: false }; // already a 24-hour time
  if (pm) return { h: h === 12 ? 12 : h + 12, m, assumed: false };
  if (am) return { h: h === 12 ? 0 : h, m, assumed: false };
  if (h === 12) return { h: 12, m, assumed: true };
  return { h: h >= 1 && h <= 7 ? h + 12 : h, m, assumed: true }; // meetings: 1-7 means afternoon, 8-11 means morning
}

export const clockIn = (ms: number, tz: string): { h: number; m: number } => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { h: g("hour") % 24, m: g("minute") };
};
export const atClock = (day: string, h: number, m: number, tz: string): number => startOfDay(day, tz) + (h * 60 + m) * MIN;

export type Start = { ok: true; startMs: number; day: string; h: number; m: number; note: string } | { ok: false; error: string };
export function resolveStart(dateIn: unknown, timeIn: unknown, now: number, tz: string): Start {
  const dateS = String(dateIn ?? "").trim(), timeS = String(timeIn ?? "").trim();
  const full = /(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(`${dateS} ${timeS}`); // a full date-time such as 2026-11-22T11:00
  if (full && isoValid(full[1]) && Number(full[2]) < 24 && Number(full[3]) < 60) {
    const h = Number(full[2]), m = Number(full[3]);
    return { ok: true, startMs: atClock(full[1], h, m, tz), day: full[1], h, m, note: "" };
  }
  const day = dateS ? resolveDay(dateS, now, tz) : (resolveDay(timeS.replace(/\d{1,2}\s*[:.]\s*\d{2}/g, " "), now, tz) ?? ymdIn(now, tz));
  if (!day) return { ok: false, error: `I could not understand the date "${clip(dateS, 40)}". Use today, tomorrow, a weekday or YYYY-MM-DD.` };
  const clock = parseClock(timeS);
  if (!clock) return { ok: false, error: timeS ? `I could not understand the time "${clip(timeS, 40)}". Use something like 11:00, 11am or 15:30.` : "The meeting needs a start time. Ask the owner (ask_user) what time they want." };
  const note = clock.assumed ? `I read the time as ${pad(clock.h)}:${pad(clock.m)} (${clock.h >= 12 ? "afternoon" : "morning"}); tell the owner so they can correct it.` : "";
  return { ok: true, startMs: atClock(day, clock.h, clock.m, tz), day, h: clock.h, m: clock.m, note };
}

// ---------------------------------------------------------------- showing times
export function whenText(startMs: number, endMs: number, tz: string): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(startMs));
  const hm = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
  return `${day}, ${hm(startMs)}–${hm(endMs)} (${tz})`;
}
export const clampMinutes = (v: unknown, fallback = 30) => Math.min(720, Math.max(5, Math.round(Number(v)) || fallback));

// ---------------------------------------------------------------- people
const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const FILLER = new Set(["ko", "and", "aur", "invite", "send", "kro", "karo", "email", "mail", "bhi", "the", "to"]);
/** Real e-mail addresses (lower case, no duplicates, at most 50) and the names that came without an address. */
export function parseEmails(input: unknown): { ok: string[]; bad: string[] } {
  const raw = Array.isArray(input) ? input.map((x) => String(x ?? "")).join(",") : String(input ?? "");
  const ok: string[] = [], bad: string[] = [];
  for (const chunk of raw.split(/[,;\n\r]+/)) {
    const found = chunk.match(EMAIL);
    if (found) { for (const e of found) { const l = e.toLowerCase(); if (!ok.includes(l)) ok.push(l); } continue; }
    const words = chunk.toLowerCase().replace(/[^a-z0-9@._\u0900-\u097f\s-]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w));
    if (words.length) bad.push(clip(chunk, 40));
  }
  return { ok: ok.slice(0, 50), bad };
}

// ---------------------------------------------------------------- clashes and finding the event
export function findClash(events: CalEvent[], startMs: number, endMs: number, ignoreId?: string): CalEvent[] {
  return events.filter((e) => !e.allDay && e.reply !== "declined" && !e.tentative && e.id !== ignoreId && e.endMs > startMs && e.startMs < endMs).slice(0, 4);
}

export type Pick = { ok: true; event: CalEvent } | { ok: false; error: string };
/** The upcoming event the owner means: by its id, or by (part of) its title. Several matches -> the list with ids so the owner can choose. */
export function pickEvent(events: CalEvent[], a: { id?: unknown; title?: unknown }, now: number, tz: string): Pick {
  const id = clip(a.id, 200), title = clip(a.title, 200).toLowerCase();
  if (!id && !title) return { ok: false, error: "Which event? Give its title (or the id from the list)." };
  if (id) { const e = events.find((x) => x.id === id); return e ? { ok: true, event: e } : { ok: false, error: `No event with id ${id} on the calendar. Use calendar.show to see the events.` }; }
  const upcoming = events.filter((e) => e.endMs > now - 60 * MIN && e.reply !== "declined");
  const exact = upcoming.filter((e) => e.title.toLowerCase() === title);
  const hits = exact.length ? exact : upcoming.filter((e) => e.title.toLowerCase().includes(title));
  if (!hits.length) return { ok: false, error: `No upcoming event matches "${clip(a.title, 60)}". Use calendar.show to see the events.` };
  if (hits.length === 1) return { ok: true, event: hits[0] };
  const list = hits.slice(0, 6).map((e) => `id=${e.id} · ${whenText(e.startMs, e.endMs, tz)} · ${e.title}`).join("\n");
  return { ok: false, error: `Several events match "${clip(a.title, 60)}". Ask the owner which one (ask_user), then call again with its id:\n${list}` };
}

// ---------------------------------------------------------------- what Google Calendar wants
export function eventBody(a: { title: string; description?: string; location?: string; startMs: number; endMs: number; tz: string; emails: string[]; meet: boolean; reminder: number; requestId: string }) {
  return {
    summary: a.title,
    ...(a.description ? { description: a.description } : {}),
    ...(a.location ? { location: a.location } : {}),
    start: { dateTime: new Date(a.startMs).toISOString(), timeZone: a.tz },
    end: { dateTime: new Date(a.endMs).toISOString(), timeZone: a.tz },
    ...(a.emails.length ? { attendees: a.emails.map((email) => ({ email })) } : {}),
    reminders: a.reminder > 0 ? { useDefault: false, overrides: [{ method: "popup", minutes: a.reminder }] } : { useDefault: false },
    ...(a.meet ? { conferenceData: { createRequest: { requestId: a.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
  };
}
export const meetLinkOf = (j: any): string => {
  const entry = Array.isArray(j?.conferenceData?.entryPoints) ? j.conferenceData.entryPoints.find((e: any) => e?.entryPointType === "video") : null;
  return String(j?.hangoutLink || entry?.uri || "");
};
