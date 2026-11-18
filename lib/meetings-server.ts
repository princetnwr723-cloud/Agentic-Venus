// Meetings, server side: sends a Recall.ai bot into Zoom / Google Meet / Teams / Webex, receives the "transcript is ready" webhook,
// has the owner's agent write the notes, posts them to the chat and turns the owner's action items into proposals (the owner still
// says yes or no to each one: see watchers-server.ts). Needs RECALL_API_KEY, RECALL_REGION and RECALL_WEBHOOK_SECRET (see .env.example).
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider } from "@/lib/ai-providers-server";
import { loadAgent } from "@/lib/voice-calls";
import { notifyOwner } from "@/lib/channels";
import { audit } from "@/lib/audit";
import { addProposal } from "@/lib/watchers-server";
import { DEFAULT_SETTINGS, signalsToProposals } from "@/lib/watchers-core";
import { cleanMeetingUrl, extractionPrompt, itemsForAgent, itemsToSignals, normalizeTranscript, notesMessage, parseMeetingNotes, speakersOf, transcriptToText, type MeetingNotes } from "@/lib/meetings-core";

const db = () => getAdminDb();
const meetings = () => db().collection("meetings");
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export type MeetingDoc = {
  botId: string; uid: string; chatId: string; url: string; platform: string; title: string; botName: string;
  status: "joining" | "in_call" | "ended" | "processing" | "done" | "failed";
  createdAt: number; updatedAt: number; note?: string; notes?: MeetingNotes; speakers?: string[]; proposalsSent?: number;
};

const region = () => (process.env.RECALL_REGION || "us-east-1").replace(/[^a-z0-9-]/gi, "");
const base = () => `https://${region()}.recall.ai/api/v1`;
export const meetingsConfigured = () => Boolean(process.env.RECALL_API_KEY);
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

/** Recall documents the bare key in the Authorization header; older accounts use "Token <key>". Try the documented form first. */
async function recall(path: string, init: RequestInit = {}): Promise<Response> {
  const key = process.env.RECALL_API_KEY || "";
  if (!key) throw fail("The meeting bot is not set up on this server (RECALL_API_KEY is missing).", 503);
  const go = (auth: string) => fetch(base() + path, { ...init, headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  let r = await go(key);
  if (r.status === 401 || r.status === 403) r = await go(`Token ${key}`);
  return r;
}

export async function joinMeeting(uid: string, a: { url: string; chatId?: string; title?: string; botName?: string }): Promise<MeetingDoc> {
  const m = cleanMeetingUrl(a.url);
  if (!m) throw fail("That is not a Zoom, Google Meet, Microsoft Teams or Webex meeting link.");
  let chatId = a.chatId || "";
  if (!chatId) chatId = (await loadAgent(uid)).chatId;
  const agent = await loadAgent(uid, chatId);
  const botName = String(a.botName || `${agent.name} (notetaker)`).slice(0, 80);
  const res = await recall("/bot/", {
    method: "POST",
    body: JSON.stringify({
      meeting_url: m.url, bot_name: botName, metadata: { uid, chatId },
      recording_config: { transcript: { provider: { recallai_streaming: { mode: "prioritize_accuracy", language_code: "auto" } } } },
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; detail?: string };
  if (!res.ok || !j.id) throw fail(`The meeting service refused the bot (HTTP ${res.status}${j.detail ? ": " + String(j.detail).slice(0, 120) : ""}).`, res.status === 401 ? 502 : 400);
  const now = Date.now();
  const doc: MeetingDoc = { botId: j.id, uid, chatId, url: m.url, platform: m.platform, title: String(a.title || "").slice(0, 120), botName, status: "joining", createdAt: now, updatedAt: now };
  await meetings().doc(j.id).set(clean(doc));
  await audit(uid, { kind: "meeting_join", chatId, text: `${m.platform} bot ${j.id}` }).catch(() => {});
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

/** The transcript is ready: download it, write the notes with the owner's own model, post them, propose the owner's action items. */
export async function processTranscript(botId: string, transcriptId: string, site: string): Promise<void> {
  const snap = await meetings().doc(botId).get();
  if (!snap.exists) return;
  const m = snap.data() as MeetingDoc;
  if (m.status === "done" || m.status === "processing") return; // webhooks can arrive twice
  await setStatus(botId, "processing");
  try {
    const meta = await recall(`/transcript/${encodeURIComponent(transcriptId)}/`);
    const mj = (await meta.json().catch(() => ({}))) as { data?: { download_url?: string } };
    const dl = mj.data?.download_url;
    if (!meta.ok || !dl || !/^https:\/\//.test(dl)) throw new Error(`The transcript could not be fetched (HTTP ${meta.status}).`);
    const raw = await (await fetch(dl, { signal: AbortSignal.timeout(30_000) })).json().catch(() => null);
    const segs = normalizeTranscript(raw);
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

/** One Recall webhook event. The route has already checked the signature. */
export async function handleRecallEvent(ev: { event?: string; data?: { bot?: { id?: string }; transcript?: { id?: string }; data?: { sub_code?: string; code?: string } } }, site: string): Promise<void> {
  const botId = ev.data?.bot?.id;
  if (!botId) return;
  const snap = await meetings().doc(botId).get();
  if (!snap.exists) return; // a bot of someone else sharing the same Recall account
  const m = snap.data() as MeetingDoc;
  switch (ev.event) {
    case "bot.joining_call": case "bot.in_waiting_room": return setStatus(botId, "joining");
    case "bot.in_call_recording": case "bot.in_call_not_recording":
      if (m.status !== "in_call") { await setStatus(botId, "in_call"); await say(m.uid, m.chatId, "🎙 The notetaker is in the meeting."); }
      return;
    case "bot.call_ended": return m.status === "in_call" || m.status === "joining" ? setStatus(botId, "ended") : undefined;
    case "bot.fatal": {
      const code = ev.data?.data?.sub_code || ev.data?.data?.code || "unknown";
      await setStatus(botId, "failed", `The bot could not stay in the meeting (${code}).`);
      await say(m.uid, m.chatId, `⚠️ The notetaker could not join or stay in the meeting (${code}). Check that the link works and that it was admitted from the waiting room.`);
      return;
    }
    case "transcript.done": { const id = ev.data?.transcript?.id; if (id) await processTranscript(botId, id, site); return; }
    case "transcript.failed": await setStatus(botId, "failed", "The transcript failed."); await say(m.uid, m.chatId, "⚠️ The meeting transcript failed, so there are no notes."); return;
  }
}
