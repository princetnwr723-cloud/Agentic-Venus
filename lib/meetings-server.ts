// Meetings, server side: sends a notetaker bot (Meeting BaaS v2) into Zoom / Google Meet / Teams, follows it live (joining -> waiting room ->
// in the call -> writing notes), joins calendar meetings on its own, has the owner's agent write the notes, posts them to the chat and turns
// the owner's action items into proposals (the owner still says yes or no to each one: see watchers-server.ts).
// Needs ONE secret: MEETINGBAAS_API_KEY (see .env.example). MEETING_WEBHOOK_SECRET is optional.
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider } from "@/lib/ai-providers-server";
import { loadAgent } from "@/lib/voice-calls";
import { notifyOwner } from "@/lib/channels";
import { audit } from "@/lib/audit";
import { addProposal } from "@/lib/watchers-server";
import { appBaseUrl } from "@/lib/voice-server";
import { callTool } from "@/lib/tools/registry";
import { makeCtx } from "@/lib/tools/connectors";
import { DEFAULT_SETTINGS, signalsToProposals } from "@/lib/watchers-core";
import {
  autoKey, cleanAutoSettings, cleanMeetingUrl, DEFAULT_AUTO, extractionPrompt, itemsForAgent, itemsToSignals, meetingWebhookToken, normalizeTranscript,
  notesMessage, parseCalendarMeetings, parseMeetingNotes, shouldJoinNow, speakersOf, statusFromCode, talkStats, transcriptToText,
  type AutoSettings, type BotStatus, type MeetingNotes, type TalkStat,
} from "@/lib/meetings-core";

const db = () => getAdminDb();
const meetings = () => db().collection("meetings");
const userDoc = (uid: string) => db().collection("users").doc(uid);
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const MIN = 60_000, HOUR = 3600_000;

export type MeetingStatus = "joining" | "waiting" | "in_call" | "ended" | "processing" | "done" | "failed";
export type MeetingDoc = {
  botId: string; uid: string; chatId: string; url: string; platform: string; title: string; botName: string;
  status: MeetingStatus;
  createdAt: number; updatedAt: number; note?: string; notes?: MeetingNotes; speakers?: string[]; proposalsSent?: number;
  joinedAt?: number; checkedAt?: number; completedSeenAt?: number; doneAt?: number; durationSec?: number; talk?: TalkStat[];
  auto?: boolean; eventId?: string;
};

const API_BASE = "https://api.meetingbaas.com";
const apiKey = () => String(process.env.MEETINGBAAS_API_KEY || process.env.MEETING_BAAS_API_KEY || "").trim();
/** The secret that signs the callback URL. Defaults to the API key, so no second setting is needed. */
export const webhookSecret = () => String(process.env.MEETING_WEBHOOK_SECRET || "").trim() || apiKey();
export const meetingsApiKey = apiKey;
export const meetingsConfigured = () => Boolean(apiKey());
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const PLATFORM_NAME: Record<string, string> = { meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams", webex: "Webex" };

async function botApi(path: string, init: RequestInit = {}): Promise<Response> {
  const key = apiKey();
  if (!key) throw fail("The meeting bot is not set up on this server (MEETINGBAAS_API_KEY is missing).", 503);
  try {
    return await fetch(API_BASE + path, {
      ...init,
      headers: { "x-meeting-baas-api-key": key, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } } | null)?.cause?.code;
    throw fail(`Could not reach the meeting service (${cause || (e instanceof Error ? e.name : "network error")}). Try again in a minute.`, 502);
  }
}

function errorText(j: Record<string, unknown>): { text: string; code: string } {
  const v = j.message ?? j.error ?? j.detail ?? "";
  const text = typeof v === "string" ? v : v ? JSON.stringify(v) : "";
  return { text: text.replace(/\s+/g, " ").slice(0, 160), code: typeof j.code === "string" ? j.code : "" };
}

/** A tiny per-owner list of the meetings the chat is showing: the page polls it every few seconds, so it must cost one read, not a query. */
const liveRef = (uid: string) => userDoc(uid).collection("meetingSettings").doc("live");

const say = (uid: string, chatId: string, text: string) =>
  userDoc(uid).collection("chats").doc(chatId).update({ messages: FieldValue.arrayUnion({ role: "assistant", content: text, at: Date.now() }) }).catch(() => {});

async function setStatus(botId: string, status: MeetingStatus, note?: string) {
  await meetings().doc(botId).set(clean({ status, updatedAt: Date.now(), ...(note ? { note } : {}) }), { merge: true });
}

// A status only ever moves forward, and only one caller gets to announce a change (the page, the scheduler and the callback can all see it).
const RANK: Record<MeetingStatus, number> = { joining: 1, waiting: 2, in_call: 3, ended: 4, processing: 5, done: 6, failed: 7 };
async function transition(botId: string, to: MeetingStatus, patch: Record<string, unknown> = {}): Promise<boolean> {
  const ref = meetings().doc(botId);
  return db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return false;
    const cur = (s.data() as MeetingDoc).status;
    if (to === "failed" ? RANK[cur] >= RANK.processing : RANK[cur] >= RANK[to]) return false;
    tx.set(ref, clean({ status: to, updatedAt: Date.now(), ...patch }), { merge: true });
    return true;
  });
}
/** Only one caller writes the notes of a meeting. Returns the meeting when this caller won. */
async function claimProcessing(botId: string): Promise<MeetingDoc | null> {
  const ref = meetings().doc(botId);
  return db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return null;
    const m = s.data() as MeetingDoc;
    if (m.status === "done" || m.status === "processing") return null;
    tx.set(ref, clean({ status: "processing", updatedAt: Date.now() }), { merge: true });
    return m;
  });
}

// ---------------------------------------------------------------- sending the bot
export async function joinMeeting(uid: string, a: { url: string; chatId?: string; title?: string; botName?: string; site?: string; auto?: boolean; eventId?: string }): Promise<MeetingDoc> {
  const m = cleanMeetingUrl(a.url);
  if (!m) throw fail("That is not a Zoom, Google Meet, Microsoft Teams or Webex meeting link.");
  if (m.platform === "webex") throw fail("The notetaker supports Zoom, Google Meet and Microsoft Teams links.");
  if (!apiKey()) throw fail("The meeting bot is not set up on this server (MEETINGBAAS_API_KEY is missing).", 503);

  let site = "";
  try { site = a.site || appBaseUrl(); } catch { site = ""; }
  if (!/^https:\/\//.test(site)) throw fail("Set NEXT_PUBLIC_APP_URL to your https domain, so the notetaker can report back when the meeting ends.", 503);

  let chatId = a.chatId || "";
  if (!chatId) chatId = (await loadAgent(uid)).chatId;
  const agent = await loadAgent(uid, chatId);
  const botName = String(a.botName || `${agent.name} (notetaker)`).slice(0, 80);
  const token = meetingWebhookToken(webhookSecret());
  const callbackUrl = `${site}/api/meetings/webhook?t=${token}`;

  const base = {
    meeting_url: m.url, bot_name: botName, recording_mode: "audio_only",
    transcription_enabled: true, transcription_config: { provider: "gladia" },
    callback_enabled: true, callback_config: { url: callbackUrl, method: "POST", secret: token },
    extra: { uid, chatId },
  };
  // The bot leaves on its own once everyone else has gone (the service starts checking 5 minutes into the call) and after a long silence.
  // If the service ever refuses these numbers, the bot is sent without them rather than not at all.
  const attempts = [{ ...base, timeout_config: { everyone_left_timeout: 10, silence_timeout: 240 } }, { ...base, timeout_config: { everyone_left_timeout: 10 } }, base];
  let res!: Response;
  let j: Record<string, any> = {};
  for (const body of attempts) {
    res = await botApi("/v2/bots", { method: "POST", body: JSON.stringify(body) });
    j = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (res.ok || (res.status !== 400 && res.status !== 422)) break;
  }
  const botId = String(j.data?.bot_id ?? j.bot_id ?? "");
  if (!res.ok || j.success === false || !botId) {
    const { text, code } = errorText(j);
    const hint = res.status === 401 || res.status === 403 ? " Check MEETINGBAAS_API_KEY (use a key from dashboard.meetingbaas.com with Full access)."
      : /INSUFFICIENT_TOKENS/i.test(code) || res.status === 402 ? " The free tokens may be used up."
      : /ALREADY_EXISTS/i.test(code) ? " A notetaker is already in this meeting."
      : res.status === 429 ? " Too many requests, try again in a minute." : "";
    throw fail(`The meeting service refused the bot (HTTP ${res.status}${text ? ": " + text : ""}${code ? " [" + code + "]" : ""}).${hint}`, res.status === 401 || res.status === 403 ? 502 : 400);
  }
  const now = Date.now();
  const doc: MeetingDoc = {
    botId, uid, chatId, url: m.url, platform: m.platform, title: String(a.title || "").slice(0, 120), botName, status: "joining", createdAt: now, updatedAt: now,
    ...(a.auto ? { auto: true } : {}), ...(a.eventId ? { eventId: a.eventId } : {}),
  };
  await meetings().doc(botId).set(clean(doc));
  await liveRef(uid).set({ ids: FieldValue.arrayUnion(botId), at: now }, { merge: true }).catch(() => {});
  await audit(uid, { kind: "meeting_join", chatId, text: `${m.platform} bot ${botId}${a.auto ? " (calendar)" : ""}` }).catch(() => {});
  await say(uid, chatId, `${a.auto ? "🗓 Joining from your calendar:" : "🟢 Joining"} **${doc.title || PLATFORM_NAME[m.platform] || "the meeting"}** (${PLATFORM_NAME[m.platform] || m.platform}). I will keep you posted here. If there is a waiting room, please admit “${botName}”.`);
  return doc;
}

export async function listMeetings(uid: string, limit = 20): Promise<MeetingDoc[]> {
  const q = await meetings().where("uid", "==", uid).limit(60).get();
  return q.docs.map((d) => d.data() as MeetingDoc).sort((x, y) => y.createdAt - x.createdAt).slice(0, limit).map((d) => ({ ...d, url: "" }));
}
export async function getMeeting(uid: string, botId: string): Promise<MeetingDoc | null> {
  const s = await meetings().doc(botId).get();
  const d = s.exists ? (s.data() as MeetingDoc) : null;
  return d && d.uid === uid ? { ...d, url: "" } : null;
}
/** The saved transcript of one finished meeting (the owner's own copy; the bot service's copy is deleted after the notes are written). */
export async function getTranscript(uid: string, botId: string): Promise<string | null> {
  const m = await getMeeting(uid, botId);
  if (!m) return null;
  const s = await meetings().doc(botId).collection("private").doc("transcript").get();
  const t = s.exists ? (s.data() as { text?: string }).text : "";
  return t || null;
}

// ---------------------------------------------------------------- following the bot live
async function applyStatus(m: MeetingDoc, st: { status: BotStatus; note?: string }, d: Record<string, any>, site: string, now: number): Promise<void> {
  const id = m.botId;
  switch (st.status) {
    case "waiting":
      if (await transition(id, "waiting")) await say(m.uid, m.chatId, `⏳ The notetaker is waiting in the lobby. Please admit “${m.botName}” to let it in.`);
      return;
    case "in_call": {
      const joined = Date.parse(String(d?.joined_at ?? "")) || now;
      if (await transition(id, "in_call", { joinedAt: joined })) await say(m.uid, m.chatId, `🎙 I am in **${m.title || PLATFORM_NAME[m.platform] || "the meeting"}** now, listening and taking notes.`);
      return;
    }
    case "ended":
      if (await transition(id, "ended")) await say(m.uid, m.chatId, "📴 The meeting ended. I am getting the transcript and will write the notes next.");
      return;
    case "failed":
      if (await transition(id, "failed", { note: st.note })) await say(m.uid, m.chatId, "⚠️ The notetaker could not join or stay in the meeting. Check that the link works and that it was admitted from the waiting room.");
      return;
    case "completed": {
      // normally the bot's own callback delivers the transcript; if it never arrives, take it from the bot service after a short grace time
      if (m.status === "done" || m.status === "processing") return;
      if (!m.completedSeenAt) { await meetings().doc(id).set({ completedSeenAt: now }, { merge: true }); return; }
      if (now - m.completedSeenAt > 40_000) await processTranscript(id, d, site);
      return;
    }
    default: return;
  }
}

/** Asks the bot service where the bot is (at most every 5 seconds per meeting) and moves our record forward. */
async function refreshMeeting(m: MeetingDoc, site: string, now = Date.now()): Promise<void> {
  if (m.status === "done" || m.status === "failed" || m.status === "processing") return;
  if (now - (m.checkedAt ?? 0) < 5000) return;
  await meetings().doc(m.botId).set({ checkedAt: now }, { merge: true });
  let d: Record<string, any> | null = null;
  try {
    const r = await botApi(`/v2/bots/${encodeURIComponent(m.botId)}`);
    if (!r.ok) return;
    const j = (await r.json().catch(() => null)) as Record<string, any> | null;
    d = (j?.data ?? j) as Record<string, any> | null;
  } catch { return; }
  if (!d) return;
  const code = typeof d.status === "string" ? d.status : d.status?.code;
  const st = statusFromCode(code);
  if (st) await applyStatus(m, st, d, site, now);
}

export type LiveMeeting = {
  botId: string; chatId: string; title: string; platform: string; status: MeetingStatus; createdAt: number; updatedAt: number; joinedAt?: number;
  botName: string; agentName: string; auto?: boolean; note?: string; summary?: string; items?: number; durationSec?: number;
};
const LIVE: MeetingStatus[] = ["joining", "waiting", "in_call", "ended", "processing"];

/** What the chat shows: the meetings the agent is in (or just left), refreshed from the bot service. */
export async function liveMeetings(uid: string, site: string, chatId?: string): Promise<LiveMeeting[]> {
  const now = Date.now();
  const ids = (((await liveRef(uid).get()).data() as { ids?: unknown } | undefined)?.ids ?? []) as unknown[];
  const list = ids.filter((x): x is string => typeof x === "string").slice(-6);
  if (!list.length) return [];
  const load = async () => {
    const snaps = await db().getAll(...list.map((id) => meetings().doc(id)));
    return snaps.filter((s) => s.exists).map((s) => s.data() as MeetingDoc).filter((m) => m.uid === uid);
  };
  let rows = await load();
  const active = rows.filter((m) => LIVE.includes(m.status)).slice(0, 3);
  if (active.length) { await Promise.all(active.map((m) => refreshMeeting(m, site, now).catch(() => {}))); rows = await load(); }
  const isShown = (m: MeetingDoc) => m.createdAt > now - 8 * HOUR && (LIVE.includes(m.status) || ((m.status === "done" || m.status === "failed") && now - m.updatedAt < 150_000));
  const mineFirst = (m: MeetingDoc) => (chatId && m.chatId === chatId ? 1 : 0);
  const shown = rows.filter(isShown).sort((x, y) => mineFirst(y) - mineFirst(x) || y.createdAt - x.createdAt).slice(0, 3);
  const keep = new Set(shown.map((m) => m.botId));
  const stale = list.filter((id) => !keep.has(id) && !rows.some((m) => m.botId === id && isShown(m)));
  if (stale.length) await liveRef(uid).set({ ids: FieldValue.arrayRemove(...stale) }, { merge: true }).catch(() => {});
  const names = new Map<string, string>();
  for (const m of shown) {
    if (names.has(m.chatId)) continue;
    try { names.set(m.chatId, String((await loadAgent(uid, m.chatId)).name || "Agent")); } catch { names.set(m.chatId, "Agent"); }
  }
  return shown.map((m) => ({
    botId: m.botId, chatId: m.chatId, title: m.title || PLATFORM_NAME[m.platform] || "Meeting", platform: m.platform, status: m.status, createdAt: m.createdAt, updatedAt: m.updatedAt,
    ...(m.joinedAt ? { joinedAt: m.joinedAt } : {}), botName: m.botName, agentName: names.get(m.chatId) || "Agent",
    ...(m.auto ? { auto: true } : {}), ...(m.note ? { note: m.note } : {}),
    ...(m.notes ? { summary: m.notes.summary.slice(0, 220), items: m.notes.items.length } : {}), ...(m.durationSec ? { durationSec: m.durationSec } : {}),
  }));
}

/** The owner asks the notetaker to leave the call now. The notes are still written from what it heard. */
export async function leaveMeeting(uid: string, botId: string): Promise<void> {
  const s = await meetings().doc(botId).get();
  const m = s.exists ? (s.data() as MeetingDoc) : null;
  if (!m || m.uid !== uid) throw fail("Meeting not found.", 404);
  if (m.status !== "joining" && m.status !== "waiting" && m.status !== "in_call") throw fail("The notetaker is not in a meeting right now.");
  const r = await botApi(`/v2/bots/${encodeURIComponent(botId)}/leave`, { method: "POST", body: "{}" });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    const { text } = errorText(j);
    throw fail(`The meeting service could not remove the notetaker (HTTP ${r.status}${text ? ": " + text : ""}). Remove “${m.botName}” from the meeting yourself.`, 502);
  }
  await transition(botId, "ended", { note: "You asked the notetaker to leave." });
  await say(uid, m.chatId, "👋 The notetaker left the meeting. I will write the notes from what it heard.");
}

// ---------------------------------------------------------------- joining calendar meetings on its own
const autoRef = (uid: string) => userDoc(uid).collection("meetingSettings").doc("auto");
const markerRef = (uid: string, eventId: string, startMs: number) => db().collection("meetingAuto").doc(`${uid}_${autoKey(eventId, startMs)}`);

export async function getAutoSettings(uid: string): Promise<AutoSettings> {
  const d = (await autoRef(uid).get()).data();
  return d ? cleanAutoSettings(d) : { ...DEFAULT_AUTO };
}
/** The chat (agent) the calendar meetings belong to: the one the owner turned auto-join on in. */
async function getAutoChatId(uid: string): Promise<string> {
  const d = (await autoRef(uid).get()).data() as { chatId?: unknown } | undefined;
  return typeof d?.chatId === "string" ? d.chatId : "";
}
export async function saveAutoSettings(uid: string, raw: unknown, chatId?: string): Promise<AutoSettings> {
  const s = cleanAutoSettings({ ...(await getAutoSettings(uid)), ...(raw && typeof raw === "object" ? raw : {}) });
  await autoRef(uid).set(clean({ ...s, ...(chatId ? { chatId } : {}) }), { merge: true });
  await db().collection("meetingUsers").doc(uid).set({ enabled: s.enabled, updatedAt: Date.now() }, { merge: true });
  return s;
}

/** The owner's Google Calendar events in a time window, read through the given chat's agent. connected=false when Google Calendar is not connected to it. */
async function calendarJson(uid: string, fromMs: number, toMs: number, max: number, chatId?: string): Promise<{ json: unknown | null; connected: boolean; chatId: string | null; agentName: string }> {
  let agent: Awaited<ReturnType<typeof loadAgent>>;
  try { agent = await loadAgent(uid, chatId || undefined); } catch { return { json: null, connected: false, chatId: null, agentName: "" }; }
  const out = (json: unknown | null, connected: boolean) => ({ json, connected, chatId: agent.chatId, agentName: String(agent.name || "Agent") });
  try {
    const ctx = makeCtx(uid, agent.chatId);
    const path = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=${max}&timeMin=${encodeURIComponent(new Date(fromMs).toISOString())}&timeMax=${encodeURIComponent(new Date(toMs).toISOString())}`;
    const r = await callTool(agent.connectors, "oauth_google.request", { method: "GET", path }, false, { ctx });
    if (!r.ok) return out(null, false);
    const body = r.text.slice(r.text.indexOf("{"));
    try { return out(JSON.parse(body), true); } catch { return out(null, true); }
  } catch { return out(null, false); }
}

export type UpcomingMeeting = { eventId: string; title: string; platform: string; startMs: number; endMs: number; state: "will_join" | "joined" | "skipped" | "private" | "off"; skip?: string };
/** The next 24 hours of video meetings in the owner's calendar, and what the notetaker will do with each. */
export async function upcomingMeetings(uid: string, chatId?: string): Promise<{ connected: boolean; enabled: boolean; agentName: string; meetings: UpcomingMeeting[] }> {
  const now = Date.now();
  const s = await getAutoSettings(uid);
  const { json, connected, agentName } = await calendarJson(uid, now - HOUR, now + 24 * HOUR, 20, chatId || (await getAutoChatId(uid)) || undefined);
  const list = parseCalendarMeetings(json, s).filter((m) => m.endMs > now).slice(0, 12);
  const marks = await Promise.all(list.map(async (m) => (await markerRef(uid, m.eventId, m.startMs).get()).data() as { status?: string } | undefined));
  return {
    connected, enabled: s.enabled, agentName,
    meetings: list.map((m, i) => {
      const mk = marks[i]?.status;
      const state: UpcomingMeeting["state"] = mk === "joined" ? "joined" : mk === "cancelled" ? "skipped" : m.skip ? "private" : s.enabled ? "will_join" : "off";
      return { eventId: m.eventId, title: m.title, platform: m.platform, startMs: m.startMs, endMs: m.endMs, state, ...(m.skip ? { skip: m.skip } : {}) };
    }),
  };
}
/** Skip one calendar meeting (or take the skip back). A meeting the notetaker already joined cannot be skipped. */
export async function skipUpcoming(uid: string, eventId: string, startMs: number, skip: boolean): Promise<void> {
  if (!eventId || !Number.isFinite(startMs)) throw fail("Unknown meeting.");
  const ref = markerRef(uid, eventId, startMs);
  const cur = (await ref.get()).data() as { status?: string } | undefined;
  if (skip) {
    if (cur?.status === "joined" || cur?.status === "joining") throw fail("The notetaker is already in that meeting.");
    await ref.set({ uid, eventId, startMs, status: "cancelled", at: Date.now() }, { merge: true });
  } else if (cur?.status === "cancelled") await ref.delete();
}

async function runAutoJoinForUser(uid: string, site: string, now: number): Promise<number> {
  const s = await getAutoSettings(uid);
  if (!s.enabled) return 0;
  const { json, chatId } = await calendarJson(uid, now - 25 * MIN, now + 8 * MIN, 12, (await getAutoChatId(uid)) || undefined);
  const due = parseCalendarMeetings(json, s).filter((m) => !m.skip && shouldJoinNow(m, now));
  if (!due.length) return 0;
  const recent = (await meetings().where("uid", "==", uid).limit(30).get()).docs.map((d) => d.data() as MeetingDoc).filter((m) => m.createdAt > now - 3 * HOUR && m.status !== "failed");
  let joined = 0;
  for (const m of due) {
    const ref = markerRef(uid, m.eventId, m.startMs);
    let attempts = 1;
    try { await ref.create({ uid, eventId: m.eventId, startMs: m.startMs, title: m.title, status: "joining", attempts: 1, at: now }); }
    catch {
      const ex = (await ref.get()).data() as { status?: string; attempts?: number } | undefined;
      if (!ex || ex.status !== "failed" || (ex.attempts ?? 1) >= 2) continue; // already joined / skipped / tried twice
      attempts = (ex.attempts ?? 1) + 1;
      await ref.set({ status: "joining", attempts }, { merge: true });
    }
    if (recent.some((r) => r.url === m.url)) { await ref.set({ status: "joined", note: "already in this meeting" }, { merge: true }); continue; }
    try {
      const doc = await joinMeeting(uid, { url: m.url, title: m.title, site, auto: true, eventId: m.eventId, chatId: chatId || undefined });
      await ref.set({ status: "joined", botId: doc.botId }, { merge: true });
      joined++;
    } catch (e) {
      const why = e instanceof Error ? e.message.slice(0, 200) : "unknown error";
      await ref.set({ status: "failed", error: why, attempts }, { merge: true });
      if (attempts >= 2 && chatId) await say(uid, chatId, `⚠️ I could not join **${m.title}** from your calendar: ${why}`);
    }
  }
  return joined;
}

/** Called by the scheduler (agent/tick): joins calendar meetings that are about to start, and moves every open meeting forward. */
export async function tickMeetings(site: string, now = Date.now()): Promise<{ joined: number; refreshed: number }> {
  let joined = 0, refreshed = 0;
  const users = await db().collection("meetingUsers").where("enabled", "==", true).limit(30).get().catch(() => null);
  for (const d of users?.docs ?? []) { try { joined += await runAutoJoinForUser(d.id, site, now); } catch { /* one user's calendar problem must not stop the others */ } }
  const open = await meetings().where("status", "in", ["joining", "waiting", "in_call", "ended"]).limit(40).get().catch(() => null);
  for (const d of open?.docs ?? []) {
    const m = d.data() as MeetingDoc;
    if (m.createdAt < now - 8 * HOUR) { await transition(m.botId, "failed", { note: "The meeting took too long; I stopped checking." }).catch(() => {}); continue; }
    await refreshMeeting(m, site, now).catch(() => {});
    refreshed++;
  }
  return { joined, refreshed };
}

// ---------------------------------------------------------------- the notes
/** Downloads a signed artifact file (valid for 4 hours) and parses it as JSON. */
async function downloadJson(url: string): Promise<unknown> {
  if (!/^https:\/\//i.test(url)) return [];
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return [];
    if (Number(r.headers.get("content-length") || 0) > 20_000_000) return [];
    return await r.json().catch(() => []);
  } catch { return []; }
}

/** The finished-bot payload carries a link to the transcription file; if it does not, ask the bot service for it. */
async function fetchTranscript(botId: string, completed: unknown): Promise<unknown> {
  let url = "";
  const c = (completed && typeof completed === "object" ? completed : {}) as Record<string, unknown>;
  if (typeof c.transcription === "string") url = c.transcription;
  if (!url) {
    try {
      const r = await botApi(`/v2/bots/${encodeURIComponent(botId)}`);
      if (r.ok) {
        const j = (await r.json().catch(() => null)) as Record<string, any> | null;
        const d = j?.data ?? j;
        if (typeof d?.transcription === "string") url = d.transcription;
      }
    } catch { /* no transcript link: handled by the caller */ }
  }
  return url ? downloadJson(url) : [];
}

/** The meeting is over and the transcript is here: write the notes with the owner's own model, post them, propose the owner's action items. */
export async function processTranscript(botId: string, completed: unknown, site: string): Promise<void> {
  const m = await claimProcessing(botId); // webhooks can arrive twice: only one caller goes on
  if (!m) return;
  try {
    const segs = normalizeTranscript(await fetchTranscript(botId, completed));
    if (!segs.length) { await setStatus(botId, "failed", "The meeting had no speech to write down."); await say(m.uid, m.chatId, "📝 The meeting ended, but nobody was heard, so there are no notes."); return; }

    const agent = await loadAgent(m.uid, m.chatId);
    const speakers = speakersOf(segs);
    const stats = talkStats(segs);
    const given = Number((completed as { duration_seconds?: unknown } | null)?.duration_seconds);
    const durationSec = Number.isFinite(given) && given > 0 ? Math.round(given) : stats.durationSec;
    const p = extractionPrompt(transcriptToText(segs), { title: m.title, speakers, today: new Date().toISOString().slice(0, 10) });
    const reply = await callProvider({ provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 3500, messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }] });
    const notes = parseMeetingNotes(reply);
    if (!notes) throw new Error("The model did not return usable notes. Try again later.");

    const owner = ((await userDoc(m.uid).get()).data() ?? {}) as { displayName?: string; name?: string; email?: string };
    const names = [owner.displayName, owner.name, (owner.email ?? "").split("@")[0]].filter((x): x is string => Boolean(x));
    const mine = itemsForAgent(notes.items, names);
    await say(m.uid, m.chatId, notesMessage(m.title || `${PLATFORM_NAME[m.platform] || m.platform} meeting`, notes, Math.min(mine.length, 5), { durationSec, talk: stats.speakers }));
    await notifyOwner(m.uid, m.chatId, `📝 Meeting notes are ready: ${notes.summary.slice(0, 600)}`).catch(() => {});

    // the owner's own copy of the transcript (so "give me the transcript of that meeting" works later)
    await meetings().doc(botId).collection("private").doc("transcript").set({ text: transcriptToText(segs, 300_000), segments: segs.length, savedAt: Date.now() }).catch(() => {});

    // proposals: at most 5 per meeting, each one needs the owner's yes
    const proposals = signalsToProposals(itemsToSignals(botId, mine, notes.summary), Date.now(), { ...DEFAULT_SETTINGS, enabled: true }).slice(0, 5);
    let sent = 0;
    for (const pr of proposals) if (await addProposal(m.uid, m.chatId, pr, site).catch(() => false)) sent++;
    await meetings().doc(botId).set(clean({ status: "done", updatedAt: Date.now(), doneAt: Date.now(), notes, speakers, proposalsSent: sent, durationSec, talk: stats.speakers.slice(0, 8) }), { merge: true });

    // privacy: our copy is saved, so the bot service's copy of the recording and transcript can go (best effort)
    await botApi(`/v2/bots/${encodeURIComponent(botId)}/delete-data`, { method: "DELETE" }).catch(() => {});
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 200) : "unknown error";
    await setStatus(botId, "failed", why);
    await say(m.uid, m.chatId, `⚠️ The meeting ended but the notes failed: ${why}`);
  }
}

export type MeetingEvent = {
  event?: string;
  data?: { bot_id?: string; transcription?: unknown; error_code?: unknown; error_message?: unknown; status?: { code?: string } };
};

/** One event from the bot service (the bot's own callback). The route has already checked that it is genuine. */
export async function handleMeetingEvent(ev: MeetingEvent, site: string): Promise<void> {
  const botId = String(ev.data?.bot_id ?? "");
  if (!botId) return;
  const snap = await meetings().doc(botId).get();
  if (!snap.exists) return; // a bot of someone else sharing the same account
  const m = snap.data() as MeetingDoc;
  switch (ev.event) {
    case "bot.status_change": {
      const st = statusFromCode(ev.data?.status?.code);
      if (st) await applyStatus(m, st, (ev.data ?? {}) as Record<string, any>, site, Date.now());
      return;
    }
    case "bot.completed": await processTranscript(botId, ev.data, site); return;
    case "bot.failed": {
      if (m.status === "done" || m.status === "processing") return;
      const codeRaw = ev.data?.error_code, msgRaw = ev.data?.error_message;
      const code = typeof codeRaw === "string" && codeRaw ? codeRaw.slice(0, 80) : "unknown";
      const detail = typeof msgRaw === "string" ? msgRaw.slice(0, 160) : "";
      if (await transition(botId, "failed", { note: `The bot could not finish the meeting (${code}${detail ? ": " + detail : ""}).` })) {
        await say(m.uid, m.chatId, `⚠️ The notetaker could not join or stay in the meeting (${code}). Check that the link works and that it was admitted from the waiting room.`);
      }
      return;
    }
  }
}
