// The AgenticVenus calendar, server side. When Google is connected the whole calendar is read once, kept in our own store, refreshed by the
// scheduler, shown in the chat as a calendar card on request ("show my calendar"), and the agent works from it: a short brief before each
// meeting, today's plan every morning, free-time answers. Nothing here has a button: the owner just talks to the agent.
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider } from "@/lib/ai-providers-server";
import { loadAgent } from "@/lib/voice-calls";
import { googleEvents } from "@/lib/google-calendar";
import { getAutoSettings, saveAutoSettings, type MeetingDoc } from "@/lib/meetings-server";
import { autoKey } from "@/lib/meetings-core";
import {
  addDays, agendaText, briefPrompt, buildSpec, freeSlots, hourIn, isMeeting, overlaps, parseGoogleEvents, parseRange, slotText, startOfDay, validTz, vcalFence, ymdIn,
  type CalEvent, type PastMeeting, type VState,
} from "@/lib/calendar-core";

const db = () => getAdminDb();
const userDoc = (uid: string) => db().collection("users").doc(uid);
const prefsRef = (uid: string) => userDoc(uid).collection("meetingSettings").doc("calendar");
const storeRef = (uid: string) => userDoc(uid).collection("meetingSettings").doc("calEvents");
const indexRef = (uid: string) => db().collection("calendarUsers").doc(uid);
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const MIN = 60_000, DAY = 86_400_000;
const PAST_DAYS = 14, FUTURE_DAYS = 45, STALE = 20 * MIN;

export type CalPrefs = { enabled: boolean; chatId: string; tz: string; syncedAt: number; agenda: boolean; agendaHour: number; briefMin: number; lastAgendaDay: string };
const DEFAULT_PREFS: CalPrefs = { enabled: false, chatId: "", tz: "UTC", syncedAt: 0, agenda: true, agendaHour: 8, briefMin: 10, lastAgendaDay: "" };
export async function getPrefs(uid: string): Promise<CalPrefs> {
  const d = (await prefsRef(uid).get()).data() as Partial<CalPrefs> | undefined;
  return { ...DEFAULT_PREFS, ...(d ?? {}), tz: validTz(d?.tz) };
}
const say = (uid: string, chatId: string, text: string) =>
  userDoc(uid).collection("chats").doc(chatId).update({ messages: FieldValue.arrayUnion({ role: "assistant", content: text, at: Date.now() }) }).catch(() => {});

// ---------------------------------------------------------------- reading the calendar once, keeping our own copy
export type SyncResult = { connected: boolean; ok: boolean; count: number; meetings: number; tz: string; error?: string };
export async function syncCalendar(uid: string, chatId?: string): Promise<SyncResult> {
  const prefs = await getPrefs(uid);
  let agent: Awaited<ReturnType<typeof loadAgent>>;
  try { agent = await loadAgent(uid, chatId || prefs.chatId || undefined); } catch { return { connected: false, ok: false, count: 0, meetings: 0, tz: prefs.tz, error: "No chat found." }; }
  const now = Date.now();
  const g = await googleEvents(uid, agent, now - PAST_DAYS * DAY, now + FUTURE_DAYS * DAY);
  if (!g.connected || !g.ok || !g.json) return { connected: g.connected, ok: false, count: 0, meetings: 0, tz: prefs.tz, error: g.error };
  const { events, tz } = parseGoogleEvents(g.json);
  const kept = events.slice(0, 400);
  await storeRef(uid).set(clean({ events: kept, tz, from: now - PAST_DAYS * DAY, to: now + FUTURE_DAYS * DAY, syncedAt: now }));
  // the chat that connected Google owns the calendar (it is the agent that talks about it); a later sync from another chat does not take it over
  await prefsRef(uid).set(clean({ enabled: true, chatId: prefs.chatId || agent.chatId, tz, syncedAt: now }), { merge: true });
  await indexRef(uid).set({ enabled: true, updatedAt: now }, { merge: true });
  return { connected: true, ok: true, count: kept.length, meetings: kept.filter(isMeeting).length, tz };
}
async function readStore(uid: string): Promise<{ events: CalEvent[]; tz: string; syncedAt: number } | null> {
  const d = (await storeRef(uid).get()).data() as { events?: CalEvent[]; tz?: string; syncedAt?: number } | undefined;
  return d && Array.isArray(d.events) ? { events: d.events, tz: validTz(d.tz), syncedAt: Number(d.syncedAt) || 0 } : null;
}
/** The stored calendar; read again from Google first when it is old (or was never read). */
export async function loadCalendar(uid: string, chatId?: string): Promise<{ events: CalEvent[]; tz: string; connected: boolean; error?: string }> {
  let store = await readStore(uid);
  let error: string | undefined;
  if (!store || Date.now() - store.syncedAt > STALE) {
    const r = await syncCalendar(uid, chatId);
    if (r.ok) store = await readStore(uid);
    else { error = r.error; if (!store) return { events: [], tz: "UTC", connected: r.connected, error }; }
  }
  return { events: store?.events ?? [], tz: store?.tz ?? "UTC", connected: true, ...(error ? { error } : {}) };
}

// ---------------------------------------------------------------- what the notetaker is doing with each meeting
async function statesFor(uid: string, events: CalEvent[], now: number): Promise<Record<string, VState>> {
  const out: Record<string, VState> = {};
  const rows = (await db().collection("meetings").where("uid", "==", uid).limit(60).get().catch(() => null))?.docs.map((d) => d.data() as MeetingDoc) ?? [];
  for (const m of rows) {
    if (!m.eventId) continue;
    if (["joining", "waiting", "in_call", "ended", "processing"].includes(m.status)) out[m.eventId] = "live";
    else if (m.status === "done" && out[m.eventId] !== "live") out[m.eventId] = "notes";
  }
  const auto = await getAutoSettings(uid);
  const future = events.filter((e) => isMeeting(e) && e.startMs > now && e.url && e.platform !== "webex" && !out[e.id]).slice(0, 20);
  const marks = await Promise.all(future.map(async (e) => (await db().collection("meetingAuto").doc(`${uid}_${autoKey(e.id, e.startMs)}`).get().catch(() => null))?.data() as { status?: string } | undefined));
  future.forEach((e, i) => {
    const mk = marks[i]?.status;
    if (mk === "joined") out[e.id] = "joined";
    else if (mk === "cancelled") out[e.id] = "skipped";
    else if (auto.enabled && !auto.skipWords.some((w) => w && e.title.toLowerCase().includes(w))) out[e.id] = "will_join";
  });
  return out;
}

// ---------------------------------------------------------------- the chat side
const NOT_CONNECTED = "Google Calendar is not connected to this chat yet. Tell the owner to say \"connect Google\" (or open Connectors and press Connect on Google Workspace). The moment it is connected, the whole calendar is built and shown here.";
const SHOW = "To show the calendar in the chat, put the block below in your reply exactly as it is (do not edit it), then add one or two helpful sentences:";

export async function showCalendar(uid: string, chatId: string | undefined, a: { range?: string; from?: string; to?: string }): Promise<string> {
  const cal = await loadCalendar(uid, chatId);
  if (!cal.connected && !cal.events.length) return cal.error ? `The calendar could not be read: ${cal.error}` : NOT_CONNECTED;
  const now = Date.now();
  const range = parseRange(String(a.range ?? ""), now, cal.tz, { from: a.from, to: a.to });
  const inRange = cal.events.filter((e) => e.endMs > range.from && e.startMs < range.to);
  const states = await statesFor(uid, inRange, now);
  const spec = buildSpec(inRange, { tz: cal.tz, now, range, states });
  const clash = overlaps(inRange);
  const text = agendaText(inRange, cal.tz, range) || "Nothing is planned in this time.";
  return [
    `${range.label} (${cal.tz}): ${spec.summary}`, text,
    clash.length ? `Overlapping meetings: ${clash.map(([x, y]) => `"${x.title}" and "${y.title}"`).join("; ")}.` : "",
    cal.error ? `(Note: the calendar could not be refreshed just now: ${cal.error})` : "", SHOW, vcalFence(spec),
  ].filter(Boolean).join("\n");
}

export async function freeTime(uid: string, chatId: string | undefined, a: { date?: string; minutes?: number }): Promise<string> {
  const cal = await loadCalendar(uid, chatId);
  if (!cal.connected && !cal.events.length) return NOT_CONNECTED;
  const now = Date.now();
  const day = parseRange(String(a.date ?? "today"), now, cal.tz).fromDay;
  const min = Math.min(240, Math.max(10, Math.round(Number(a.minutes) || 30)));
  const slots = freeSlots(cal.events, day, cal.tz, min).filter((s) => s.end > now);
  return slots.length ? `Free on ${day} (${cal.tz}, working hours 09:00-18:00, at least ${min} min): ${slots.map((s) => slotText(s, cal.tz)).join(", ")}.` : `No free block of ${min} minutes or more on ${day} between 09:00 and 18:00 (${cal.tz}).`;
}

export async function setCalendarPrefs(uid: string, chatId: string | undefined, a: { agenda?: boolean; briefMin?: number; autoJoin?: boolean }): Promise<string> {
  const patch: Partial<CalPrefs> = {};
  if (typeof a.agenda === "boolean") patch.agenda = a.agenda;
  if (Number.isFinite(a.briefMin)) patch.briefMin = Math.min(60, Math.max(0, Math.round(a.briefMin as number)));
  if (Object.keys(patch).length) await prefsRef(uid).set(patch, { merge: true });
  if (typeof a.autoJoin === "boolean") await saveAutoSettings(uid, { enabled: a.autoJoin }, chatId);
  const p = await getPrefs(uid), auto = await getAutoSettings(uid);
  return `Calendar settings: morning plan ${p.agenda ? `on (about ${p.agendaHour}:00)` : "off"}; brief before a meeting ${p.briefMin ? `${p.briefMin} minutes before` : "off"}; notetaker joins calendar meetings by itself: ${auto.enabled ? "yes" : "no"}.`;
}

/** Called when Google gets connected: build the calendar and tell the owner in the chat. */
export async function startCalendar(uid: string, chatId: string): Promise<void> {
  const r = await syncCalendar(uid, chatId);
  if (!r.ok) return;
  const store = await readStore(uid);
  if (!store) return;
  const now = Date.now();
  const range = parseRange("next 7 days", now, store.tz);
  const inRange = store.events.filter((e) => e.endMs > range.from && e.startMs < range.to);
  const spec = buildSpec(inRange, { tz: store.tz, now, range, states: await statesFor(uid, inRange, now) });
  await say(uid, chatId, `📅 **Your AgenticVenus calendar is ready.** I read your Google Calendar: ${r.count} events in the next ${FUTURE_DAYS} days, ${r.meetings} of them meetings. I will tell you before each meeting and show your plan every morning. Just ask me here, for example “show my calendar”, “am I free tomorrow afternoon?” or “join my 3 pm meeting”.\n\n${vcalFence(spec)}`);
}

// ---------------------------------------------------------------- the agent at work (called by the scheduler)
async function pastMeetings(uid: string, title: string): Promise<PastMeeting[]> {
  const rows = (await db().collection("meetings").where("uid", "==", uid).limit(60).get().catch(() => null))?.docs.map((d) => d.data() as MeetingDoc) ?? [];
  const same = title.trim().toLowerCase();
  return rows.filter((m) => m.notes && m.title.trim().toLowerCase() === same).sort((x, y) => y.createdAt - x.createdAt).slice(0, 2)
    .map((m) => ({ title: m.title, summary: (m.notes?.summary ?? "").slice(0, 300), open: (m.notes?.items ?? []).slice(0, 4).map((i) => i.task.slice(0, 100)) }));
}
async function sendBrief(uid: string, prefs: CalPrefs, e: CalEvent, now: number): Promise<void> {
  const agent = await loadAgent(uid, prefs.chatId || undefined);
  const past = await pastMeetings(uid, e.title);
  let body = "";
  try {
    const p = briefPrompt(e, past, prefs.tz);
    body = String(await callProvider({ provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 500, messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }] })).trim().slice(0, 1500);
  } catch { /* the plain brief below is still useful */ }
  const auto = await getAutoSettings(uid);
  const joins = e.url && e.platform !== "webex" && auto.enabled && !auto.skipWords.some((w) => w && e.title.toLowerCase().includes(w));
  const mins = Math.max(1, Math.round((e.startMs - now) / MIN));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: prefs.tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(e.startMs));
  const lines = [`📅 **In ${mins} min: ${e.title}** (${time})`, e.who.length ? `With ${e.who.slice(0, 5).join(", ")}` : "", e.place ? `Place: ${e.place}` : "", e.url ? `Link: ${e.url}` : "", body ? `\n${body}` : "",
    e.url && e.platform !== "webex" ? (joins ? `\nI will join as “${agent.name} (notetaker)” and write the notes afterwards.` : "\nSay “join this meeting” and I will send the notetaker.") : ""];
  await say(uid, prefs.chatId || agent.chatId, lines.filter(Boolean).join("\n"));
}
async function sendAgenda(uid: string, prefs: CalPrefs, events: CalEvent[], now: number): Promise<boolean> {
  const today = ymdIn(now, prefs.tz);
  const range = parseRange(today, now, prefs.tz);
  const day = events.filter((e) => e.reply !== "declined" && e.endMs > range.from && e.startMs < range.to);
  if (!day.some((e) => !e.allDay)) return false;
  const spec = buildSpec(day, { tz: prefs.tz, now, range, title: "Today", states: await statesFor(uid, day, now) });
  const clash = overlaps(day);
  const free = freeSlots(day, today, prefs.tz, 60).filter((s) => s.end > now);
  const agent = await loadAgent(uid, prefs.chatId || undefined);
  await say(uid, prefs.chatId || agent.chatId, `☀️ **Your day:** ${spec.summary}.${clash.length ? `\n⚠️ Overlap: “${clash[0][0].title}” and “${clash[0][1].title}”.` : ""}${free.length ? `\n🟢 Longest free time: ${slotText(free.sort((x, y) => (y.end - y.start) - (x.end - x.start))[0], prefs.tz)}.` : ""}\n\n${vcalFence(spec)}`);
  return true;
}

export async function tickCalendar(now = Date.now()): Promise<{ users: number; synced: number; briefs: number; agendas: number }> {
  const out = { users: 0, synced: 0, briefs: 0, agendas: 0 };
  const users = await db().collection("calendarUsers").where("enabled", "==", true).limit(30).get().catch(() => null);
  for (const d of users?.docs ?? []) {
    try {
      let prefs = await getPrefs(d.id);
      if (!prefs.enabled) continue;
      out.users++;
      if (now - prefs.syncedAt > 25 * MIN) { const r = await syncCalendar(d.id); if (r.ok) { out.synced++; prefs = await getPrefs(d.id); } }
      const store = await readStore(d.id);
      if (!store) continue;
      const today = ymdIn(now, prefs.tz), hour = hourIn(now, prefs.tz);
      if (prefs.agenda && prefs.lastAgendaDay !== today && hour >= prefs.agendaHour && hour < 20) {
        await prefsRef(d.id).set({ lastAgendaDay: today }, { merge: true }); // marked first: a slow tick must not post it twice
        if (await sendAgenda(d.id, prefs, store.events, now)) out.agendas++;
      }
      if (prefs.briefMin > 0) {
        const skip = (await getAutoSettings(d.id)).skipWords;
        const due = store.events.filter((e) => isMeeting(e) && e.startMs > now + 2 * MIN && e.startMs <= now + (prefs.briefMin + 4) * MIN && !skip.some((w) => w && e.title.toLowerCase().includes(w)));
        for (const e of due) {
          try { await db().collection("calendarBriefs").doc(`${d.id}_${autoKey(e.id, e.startMs)}`).create({ uid: d.id, at: now }); } catch { continue; } // already briefed
          await sendBrief(d.id, prefs, e, now);
          out.briefs++;
        }
      }
    } catch { /* one owner's problem must not stop the others */ }
  }
  return out;
}
