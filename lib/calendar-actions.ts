// Server-only. The agent WRITES to the owner's Google Calendar: make a meeting (with a Google Meet link and invite e-mails),
// move it, cancel it, add people to it. Google itself sends the invitation e-mails from the owner's account (sendUpdates=all),
// so no mail tool is needed. Before anything is written the free time is checked, so the agent never double-books the owner.
// The tools that call these functions are "write" tools: the owner's approval comes first (see lib/tools/meetings.ts).
import { OAUTH_PROVIDERS } from "@/lib/tools/oauth-catalog";
import { oauthAccess } from "@/lib/tools/oauth-token";
import { makeCtx } from "@/lib/tools/connectors";
import { loadAgent } from "@/lib/voice-calls";
import { loadCalendar, syncCalendar } from "@/lib/calendar-server";
import { freeSlots, slotText, ymdIn } from "@/lib/calendar-core";
import {
  atClock, clampMinutes, clockIn, eventBody, findClash, meetLinkOf, parseClock, parseEmails, pickEvent, resolveDay, resolveStart, whenText,
} from "@/lib/calendar-write";

const MIN = 60_000;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const NOT_CONNECTED = "Google Calendar is not connected to this chat yet. Tell the owner to say \"connect Google\" (or open Connectors and press Connect on Google Workspace), then try again.";
const refuse = (why: string) => `Not done: ${why}`;

// ---------------------------------------------------------------- talking to Google
async function google(uid: string, chatId: string | undefined, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, o: { query?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; json: any }> {
  const provider = OAUTH_PROVIDERS.find((p) => p.id === "google");
  let agent: Awaited<ReturnType<typeof loadAgent>>;
  try { agent = await loadAgent(uid, chatId); } catch { throw new Error("No chat found for this calendar."); }
  const raw = (agent.connectors as Record<string, string | undefined>)["oauth:google"];
  if (!provider || !raw) throw new Error(NOT_CONNECTED);
  let access: string;
  try { access = await oauthAccess(provider, raw, makeCtx(uid, agent.chatId)); }
  catch (e) { throw new Error(e instanceof Error ? e.message.slice(0, 200) : "The Google login could not be used. Reconnect Google in Connectors."); }
  const qs = new URLSearchParams(o.query ?? {}).toString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/${path}${qs ? "?" + qs : ""}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json", ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res) throw new Error("Google Calendar could not be reached. Try again in a minute.");
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function explain(status: number, json: any, what: string): string {
  const why = clip(json?.error?.message, 160);
  if (status === 401) return "Google refused the login. Reconnect Google in Connectors.";
  if (status === 403) return `Google did not allow ${what} (HTTP 403${why ? ": " + why : ""}). Reconnect Google in Connectors and accept the Calendar permission, and check that the Google Calendar API is enabled. Only the organizer of a meeting can change it.`;
  if (status === 404) return "That event was not found on Google Calendar (it may have been deleted).";
  return `Google Calendar said no to ${what} (HTTP ${status}${why ? ": " + why : ""}).`;
}

/** The calendar as the agent knows it; null + message when it cannot be used. */
async function calendarOrWhy(uid: string, chatId: string | undefined) {
  await syncCalendar(uid, chatId).catch(() => null); // a fresh read first: a clash check on an old copy could double-book the owner
  const cal = await loadCalendar(uid, chatId);
  if (!cal.connected) return { cal: null, why: NOT_CONNECTED };
  if (!cal.events.length && cal.error) return { cal: null, why: refuse(`the calendar could not be read (${cal.error}).`) };
  return { cal, why: "" };
}
const refresh = (uid: string, chatId: string | undefined) => syncCalendar(uid, chatId).catch(() => null);

function clashText(events: Array<{ title: string; startMs: number; endMs: number }>, tz: string): string {
  return events.map((e) => `"${e.title}" ${whenText(e.startMs, e.endMs, tz)}`).join("; ");
}
function freeText(all: Parameters<typeof freeSlots>[0], day: string, tz: string, minutes: number, now: number): string {
  const free = freeSlots(all, day, tz, minutes).filter((s) => s.end > now).slice(0, 4);
  return free.length ? `Free that day (09:00-18:00): ${free.map((s) => slotText(s, tz)).join(", ")}.` : "There is no free block that long that day between 09:00 and 18:00.";
}

// ---------------------------------------------------------------- make a meeting
export type CreateArgs = {
  title: unknown; date: unknown; time: unknown; minutes?: unknown; invite?: unknown; description?: unknown; location?: unknown;
  meet?: boolean; reminder?: unknown; force?: boolean;
};
export async function createEvent(uid: string, chatId: string | undefined, a: CreateArgs): Promise<string> {
  const title = clip(a.title, 200);
  if (!title) return refuse("the meeting needs a title. Pick a clear one from what the owner said.");
  const { cal, why } = await calendarOrWhy(uid, chatId);
  if (!cal) return why;
  const now = Date.now(), tz = cal.tz;

  const st = resolveStart(a.date, a.time, now, tz);
  if (!st.ok) return refuse(st.error);
  const minutes = clampMinutes(a.minutes, 30);
  const startMs = st.startMs, endMs = startMs + minutes * MIN;
  if (startMs < now - 2 * MIN) return refuse(`${whenText(startMs, endMs, tz)} is already in the past. Ask the owner for a new day or time.`);

  const people = parseEmails(a.invite);
  if (people.bad.length) return refuse(`I need an e-mail address for: ${people.bad.join(", ")}. Ask the owner (ask_user) for it, then call calendar.create again.`);

  if (!a.force) {
    const same = cal.events.find((e) => !e.allDay && e.startMs === startMs && e.title.toLowerCase() === title.toLowerCase());
    if (same) return `Already on the calendar: "${same.title}" ${whenText(same.startMs, same.endMs, tz)}${same.url ? ` · ${same.url}` : ""}. Nothing new was created and no new invite was sent.`;
    const clash = findClash(cal.events, startMs, endMs);
    if (clash.length) return refuse(`that time overlaps ${clashText(clash, tz)}. ${freeText(cal.events, st.day, tz, minutes, now)} Tell the owner and ask which time they want (ask_user); call again with force=true only if they want the overlap.`);
  }

  const meet = a.meet !== false;
  const reminderN = Number(a.reminder);
  const reminder = Number.isFinite(reminderN) ? Math.min(1440, Math.max(0, Math.round(reminderN))) : 10;
  const body = eventBody({
    title, description: clip(a.description, 4000) || undefined, location: clip(a.location, 200) || undefined, startMs, endMs, tz,
    emails: people.ok, meet, reminder, requestId: `av-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const r = await google(uid, chatId, "POST", "events", { query: { sendUpdates: people.ok.length ? "all" : "none", ...(meet ? { conferenceDataVersion: "1" } : {}) }, body });
  if (r.status >= 300) throw new Error(explain(r.status, r.json, "creating the meeting"));
  await refresh(uid, chatId);

  const link = meetLinkOf(r.json);
  return [
    `Done. Meeting created: "${title}" ${whenText(startMs, endMs, tz)}.`,
    meet ? (link ? `Google Meet link: ${link}` : "The Google Meet link is still being made; it will show on the event in Google Calendar in a moment.") : "",
    people.ok.length ? `Invitation e-mails were sent by Google to: ${people.ok.join(", ")}.` : "No one was invited.",
    r.json?.htmlLink ? `Event: ${r.json.htmlLink}` : "",
    st.note,
    "Tell the owner the day, time, the Meet link and who was invited.",
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- move a meeting
export type MoveArgs = { id?: unknown; title?: unknown; date?: unknown; time?: unknown; minutes?: unknown; force?: boolean };
export async function moveEvent(uid: string, chatId: string | undefined, a: MoveArgs): Promise<string> {
  const { cal, why } = await calendarOrWhy(uid, chatId);
  if (!cal) return why;
  const now = Date.now(), tz = cal.tz;
  const p = pickEvent(cal.events, a, now, tz);
  if (!p.ok) return refuse(p.error);
  const ev = p.event;
  const dateS = clip(a.date, 60), timeS = clip(a.time, 60);
  if (!dateS && !timeS && !a.minutes) return refuse("say the new day, the new time or the new length.");

  const day = dateS ? resolveDay(dateS, now, tz) : ymdIn(ev.startMs, tz);
  if (!day) return refuse(`I could not understand the date "${dateS}". Use today, tomorrow, a weekday or YYYY-MM-DD.`);
  const old = clockIn(ev.startMs, tz);
  let h = old.h, m = old.m, note = "";
  if (timeS) {
    const c = parseClock(timeS);
    if (!c) return refuse(`I could not understand the time "${timeS}". Use something like 11:00, 11am or 15:30.`);
    h = c.h; m = c.m;
    if (c.assumed) note = `I read the time as ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${h >= 12 ? "afternoon" : "morning"}); tell the owner so they can correct it.`;
  }
  const startMs = atClock(day, h, m, tz);
  const minutes = a.minutes ? clampMinutes(a.minutes, 30) : Math.max(5, Math.round((ev.endMs - ev.startMs) / MIN));
  const endMs = startMs + minutes * MIN;
  if (startMs < now - 2 * MIN) return refuse(`${whenText(startMs, endMs, tz)} is already in the past.`);
  if (startMs === ev.startMs && endMs === ev.endMs) return `"${ev.title}" is already at ${whenText(ev.startMs, ev.endMs, tz)}. Nothing was changed.`;
  if (!a.force) {
    const clash = findClash(cal.events, startMs, endMs, ev.id);
    if (clash.length) return refuse(`the new time overlaps ${clashText(clash, tz)}. ${freeText(cal.events, day, tz, minutes, now)} Ask the owner which time they want (ask_user); call again with force=true only if they want the overlap.`);
  }
  const r = await google(uid, chatId, "PATCH", `events/${encodeURIComponent(ev.id)}`, {
    query: { sendUpdates: "all" },
    body: { start: { dateTime: new Date(startMs).toISOString(), timeZone: tz }, end: { dateTime: new Date(endMs).toISOString(), timeZone: tz } },
  });
  if (r.status >= 300) throw new Error(explain(r.status, r.json, "moving the meeting"));
  await refresh(uid, chatId);
  return [
    `Done. "${ev.title}" moved from ${whenText(ev.startMs, ev.endMs, tz)} to ${whenText(startMs, endMs, tz)}.`,
    ev.who.length ? "Google sent the guests an update." : "",
    ev.recurring ? "This changed only this one occurrence of a repeating meeting." : "",
    note,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- cancel a meeting
export async function cancelEvent(uid: string, chatId: string | undefined, a: { id?: unknown; title?: unknown }): Promise<string> {
  const { cal, why } = await calendarOrWhy(uid, chatId);
  if (!cal) return why;
  const p = pickEvent(cal.events, a, Date.now(), cal.tz);
  if (!p.ok) return refuse(p.error);
  const ev = p.event;
  const r = await google(uid, chatId, "DELETE", `events/${encodeURIComponent(ev.id)}`, { query: { sendUpdates: "all" } });
  if (r.status >= 300 && r.status !== 410) throw new Error(explain(r.status, r.json, "cancelling the meeting"));
  await refresh(uid, chatId);
  return [
    `Done. "${ev.title}" (${whenText(ev.startMs, ev.endMs, cal.tz)}) was cancelled.`,
    ev.who.length ? "Google told the guests that it is cancelled." : "",
    ev.recurring ? "Only this one occurrence of a repeating meeting was cancelled." : "",
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- add people to a meeting
export async function inviteToEvent(uid: string, chatId: string | undefined, a: { id?: unknown; title?: unknown; invite?: unknown }): Promise<string> {
  const people = parseEmails(a.invite);
  if (people.bad.length) return refuse(`I need an e-mail address for: ${people.bad.join(", ")}. Ask the owner (ask_user) for it.`);
  if (!people.ok.length) return refuse("give the e-mail address of the person to invite.");
  const { cal, why } = await calendarOrWhy(uid, chatId);
  if (!cal) return why;
  const p = pickEvent(cal.events, a, Date.now(), cal.tz);
  if (!p.ok) return refuse(p.error);
  const ev = p.event;
  const cur = await google(uid, chatId, "GET", `events/${encodeURIComponent(ev.id)}`, { query: { fields: "attendees" } });
  if (cur.status >= 300) throw new Error(explain(cur.status, cur.json, "reading the meeting"));
  const existing: Array<{ email?: string }> = Array.isArray(cur.json?.attendees) ? cur.json.attendees : [];
  const have = new Set(existing.map((x) => String(x.email ?? "").toLowerCase()));
  const fresh = people.ok.filter((e) => !have.has(e));
  if (!fresh.length) return `Everyone is already invited to "${ev.title}": ${people.ok.join(", ")}.`;
  const r = await google(uid, chatId, "PATCH", `events/${encodeURIComponent(ev.id)}`, { query: { sendUpdates: "all" }, body: { attendees: [...existing, ...fresh.map((email) => ({ email }))] } });
  if (r.status >= 300) throw new Error(explain(r.status, r.json, "adding guests"));
  await refresh(uid, chatId);
  const link = meetLinkOf(r.json) || ev.url || "";
  return [
    `Done. Invited to "${ev.title}" (${whenText(ev.startMs, ev.endMs, cal.tz)}): ${fresh.join(", ")}. Google sent them the invitation.`,
    link ? `Meeting link: ${link}` : "",
  ].filter(Boolean).join("\n");
}
