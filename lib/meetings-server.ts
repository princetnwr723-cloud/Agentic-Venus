// Meetings, server side: sends a notetaker bot (Meeting BaaS) into Zoom / Google Meet / Teams, receives the "meeting is over, here is the
// transcript" webhook, has the owner's agent write the notes, posts them to the chat and turns the owner's action items into proposals
// (the owner still says yes or no to each one: see watchers-server.ts).
// Needs ONE secret: MEETINGBAAS_API_KEY (see .env.example). MEETINGBAAS_API_URL and MEETING_WEBHOOK_SECRET are optional.
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider } from "@/lib/ai-providers-server";
import { loadAgent } from "@/lib/voice-calls";
import { notifyOwner } from "@/lib/channels";
import { audit } from "@/lib/audit";
import { addProposal } from "@/lib/watchers-server";
import { appBaseUrl } from "@/lib/voice-server";
import { DEFAULT_SETTINGS, signalsToProposals } from "@/lib/watchers-core";
import { cleanMeetingUrl, extractionPrompt, itemsForAgent, itemsToSignals, meetingWebhookToken, normalizeTranscript, notesMessage, parseMeetingNotes, speakersOf, statusFromCode, transcriptToText, type MeetingNotes } from "@/lib/meetings-core";

const db = () => getAdminDb();
const meetings = () => db().collection("meetings");
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export type MeetingDoc = {
  botId: string; uid: string; chatId: string; url: string; platform: string; title: string; botName: string;
  status: "joining" | "in_call" | "ended" | "processing" | "done" | "failed";
  createdAt: number; updatedAt: number; note?: string; notes?: MeetingNotes; speakers?: string[]; proposalsSent?: number;
};

// Meeting BaaS runs in regions and an API key only works on the platform it was made on (an EU account's key is refused elsewhere
// with "WrongPlatformApiKey"). Set MEETINGBAAS_API_URL to the API address of your account, or leave it empty and the right one is found.
const HOSTS = ["https://api.meetingbaas.com", "https://eu.api.meetingbaas.com", "https://us.api.meetingbaas.com"];
let goodHost = "";
const configuredBase = () => {
  const v = String(process.env.MEETINGBAAS_API_URL || "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s/]+$/i.test(v) ? v : "";
};
const apiKey = () => String(process.env.MEETINGBAAS_API_KEY || process.env.MEETING_BAAS_API_KEY || "").trim();
/** The secret that signs the webhook URL. Defaults to the API key, so no second setting is needed. */
export const webhookSecret = () => String(process.env.MEETING_WEBHOOK_SECRET || "").trim() || apiKey();
export const meetingsApiKey = apiKey;
export const meetingsConfigured = () => Boolean(apiKey());
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

async function botApi(path: string, init: RequestInit = {}): Promise<Response> {
  const key = apiKey();
  if (!key) throw fail("The meeting bot is not set up on this server (MEETINGBAAS_API_KEY is missing).", 503);
  const fixed = configuredBase();
  const hosts = fixed ? [fixed] : Array.from(new Set([goodHost, ...HOSTS].filter(Boolean)));
  let last: Response | null = null;
  for (const host of hosts) {
    let r: Response;
    try {
      r = await fetch(host + path, {
        ...init,
        headers: { "x-meeting-baas-api-key": key, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(20_000),
      });
    } catch { continue; }
    if ((r.status === 401 || r.status === 403) && hosts.length > 1) {
      const text = await r.clone().text().catch(() => "");
      if (/WrongPlatform/i.test(text)) { last = r; continue; } // this key belongs to another region: try the next one
    }
    if (r.status < 500) goodHost = host;
    return r;
  }
  if (last) return last;
  throw fail("Could not reach the meeting service. Try again in a minute.", 502);
}

function errorText(j: Record<string, unknown>): string {
  const v = j.message ?? j.error ?? j.detail ?? "";
  const text = typeof v === "string" ? v : v ? JSON.stringify(v) : "";
  return text.replace(/\s+/g, " ").slice(0, 160);
}

export async function joinMeeting(uid: string, a: { url: string; chatId?: string; title?: string; botName?: string; site?: string }): Promise<MeetingDoc> {
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
  const webhook = `${site}/api/meetings/webhook?t=${meetingWebhookToken(webhookSecret())}`;

  const res = await botApi("/bots", {
    method: "POST",
    body: JSON.stringify({
      meeting_url: m.url, bot_name: botName, reserved: false,
      webhook_url: webhook, extra: { uid, chatId },
    }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const botId = String(j.bot_id ?? j.id ?? "");
  if (!res.ok || !botId) {
    const why = errorText(j);
    const hint = /WrongPlatform/i.test(why) ? " This key belongs to another Meeting BaaS region: set MEETINGBAAS_API_URL to the API address of your account." : res.status === 401 || res.status === 403 ? " Check MEETINGBAAS_API_KEY." : res.status === 402 ? " The free hours may be used up." : res.status === 429 ? " Too many requests, try again in a minute." : "";
    throw fail(`The meeting service refused the bot (HTTP ${res.status}${why ? ": " + why : ""}).${hint}`, res.status === 401 || res.status === 403 ? 502 : 400);
  }
  const now = Date.now();
  const doc: MeetingDoc = { botId, uid, chatId, url: m.url, platform: m.platform, title: String(a.title || "").slice(0, 120), botName, status: "joining", createdAt: now, updatedAt: now };
  await meetings().doc(botId).set(clean(doc));
  await audit(uid, { kind: "meeting_join", chatId, text: `${m.platform} bot ${botId}` }).catch(() => {});
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

const say = (uid: string, chatId: string, text: string) =>
  db().collection("users").doc(uid).collection("chats").doc(chatId).update({ messages: FieldValue.arrayUnion({ role: "assistant", content: text, at: Date.now() }) }).catch(() => {});

async function setStatus(botId: string, status: MeetingDoc["status"], note?: string) {
  await meetings().doc(botId).set(clean({ status, updatedAt: Date.now(), ...(note ? { note } : {}) }), { merge: true });
}

/** Fallback: ask the bot service for the transcript when the webhook did not carry it. */
async function fetchTranscript(botId: string): Promise<unknown> {
  try {
    const r = await botApi(`/bots/meeting_data?bot_id=${encodeURIComponent(botId)}`);
    if (!r.ok) return [];
    return await r.json().catch(() => []);
  } catch { return []; }
}

/** The meeting is over and the transcript is here: write the notes with the owner's own model, post them, propose the owner's action items. */
export async function processTranscript(botId: string, rawTranscript: unknown, site: string): Promise<void> {
  const snap = await meetings().doc(botId).get();
  if (!snap.exists) return;
  const m = snap.data() as MeetingDoc;
  if (m.status === "done" || m.status === "processing") return; // webhooks can arrive twice
  await setStatus(botId, "processing");
  try {
    let segs = normalizeTranscript(rawTranscript);
    if (!segs.length) segs = normalizeTranscript(await fetchTranscript(botId));
    if (!segs.length) { await setStatus(botId, "failed", "The meeting had no speech to write down."); await say(m.uid, m.chatId, "📝 The meeting ended, but nobody was heard, so there are no notes."); return; }

    const agent = await loadAgent(m.uid, m.chatId);
    const speakers = speakersOf(segs);
    const p = extractionPrompt(transcriptToText(segs), { title: m.title, speakers, today: new Date().toISOString().slice(0, 10) });
    const reply = await callProvider({ provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 2500, messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }] });
    const notes = parseMeetingNotes(reply);
    if (!notes) throw new Error("The model did not return usable notes. Try again later.");

    const owner = ((await db().collection("users").doc(m.uid).get()).data() ?? {}) as { displayName?: string; name?: string; email?: string };
    const names = [owner.displayName, owner.name, (owner.email ?? "").split("@")[0]].filter((x): x is string => Boolean(x));
    const mine = itemsForAgent(notes.items, names);
    await say(m.uid, m.chatId, notesMessage(m.title || `${m.platform} meeting`, notes, Math.min(mine.length, 5)));
    await notifyOwner(m.uid, m.chatId, `📝 Meeting notes are ready: ${notes.summary.slice(0, 600)}`).catch(() => {});

    // proposals: at most 5 per meeting, each one needs the owner's yes
    const proposals = signalsToProposals(itemsToSignals(botId, mine, notes.summary), Date.now(), { ...DEFAULT_SETTINGS, enabled: true }).slice(0, 5);
    let sent = 0;
    for (const pr of proposals) if (await addProposal(m.uid, m.chatId, pr, site).catch(() => false)) sent++;
    await meetings().doc(botId).set(clean({ status: "done", updatedAt: Date.now(), notes, speakers, proposalsSent: sent }), { merge: true });
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 200) : "unknown error";
    await setStatus(botId, "failed", why);
    await say(m.uid, m.chatId, `⚠️ The meeting ended but the notes failed: ${why}`);
  }
}

export type MeetingEvent = { event?: string; data?: { bot_id?: string; transcript?: unknown; error?: unknown; status?: { code?: string } } };

/** One webhook event from the bot service. The route has already checked that it is genuine. */
export async function handleMeetingEvent(ev: MeetingEvent, site: string): Promise<void> {
  const botId = String(ev.data?.bot_id ?? "");
  if (!botId) return;
  const snap = await meetings().doc(botId).get();
  if (!snap.exists) return; // a bot of someone else sharing the same account
  const m = snap.data() as MeetingDoc;
  switch (ev.event) {
    case "bot.status_change": {
      const st = statusFromCode(ev.data?.status?.code);
      if (!st || m.status === "done" || m.status === "processing") return;
      if (st.status === "in_call") {
        if (m.status !== "in_call") { await setStatus(botId, "in_call"); await say(m.uid, m.chatId, "🎙 The notetaker is in the meeting."); }
        return;
      }
      if (st.status === "ended") { if (m.status === "in_call" || m.status === "joining") await setStatus(botId, "ended"); return; }
      if (st.status === "failed") {
        if (m.status === "failed") return;
        await setStatus(botId, "failed", st.note);
        await say(m.uid, m.chatId, `⚠️ The notetaker could not join or stay in the meeting. Check that the link works and that it was admitted from the waiting room.`);
        return;
      }
      if (m.status === "joining" || m.status === "ended") await setStatus(botId, "joining");
      return;
    }
    case "complete": await processTranscript(botId, ev.data?.transcript, site); return;
    case "failed": {
      if (m.status === "done" || m.status === "processing") return;
      const errRaw = ev.data?.error;
      const code = typeof errRaw === "string" && errRaw ? errRaw.slice(0, 80) : "unknown";
      await setStatus(botId, "failed", `The bot could not finish the meeting (${code}).`);
      await say(m.uid, m.chatId, `⚠️ The notetaker could not join or stay in the meeting (${code}). Check that the link works and that it was admitted from the waiting room.`);
      return;
    }
  }
}
