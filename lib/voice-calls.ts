import { randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { audit } from "@/lib/audit";
import { resolveValue } from "@/lib/vault";
import { callProvider } from "@/lib/ai-providers-server";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { getExistingOpenAIKey } from "@/lib/voice-utils";
import { resolveConnectorsSafe } from "@/lib/tools/connectors";
import { appBaseUrl, getResolvedVoiceSecrets, getVoiceSettings, sayTag, signVoiceToken, xmlEscape, type VoiceSettings } from "@/lib/voice-server";

export class VoiceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const timeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const db = () => getAdminDb();
const userRef = (uid: string) => db().collection("users").doc(uid);

// ---------------- the agent behind the phone ----------------
export type Agent = { chatId: string; name: string; provider: ProviderId; model: string; apiKey: string; connectors: Record<string, string> };

/** The call is answered by a chat of yours: same model, same memory and role, same connected tools. */
export async function loadAgent(uid: string, chatId?: string): Promise<Agent> {
  const user = userRef(uid);
  const s = await getVoiceSettings(uid);
  let snap = chatId || s.voiceChatId ? await user.collection("chats").doc((chatId || s.voiceChatId) as string).get() : null;
  if (!snap || !snap.exists) {
    const q = await user.collection("chats").orderBy("createdAt", "desc").limit(1).get();
    snap = q.docs[0] ?? null;
  }
  if (!snap || !snap.exists) throw new VoiceError("Pehle dashboard me ek chat (agent) banao: call usi agent se hogi.");
  const chat = snap.data() as { agentName?: string; provider: ProviderId; model: string; connectors?: Record<string, string> };
  const keys = ((await user.get()).data() as { apiKeys?: Partial<Record<ProviderId, string>> } | undefined)?.apiKeys ?? {};
  let provider = chat.provider, model = chat.model;
  if (!keys[provider]) {
    const alt = PROVIDERS.find((p) => keys[p.id]);
    if (!alt) throw new VoiceError("Koi AI provider key saved nahi hai (API keys me add karo).");
    provider = alt.id; model = alt.models[0];
  }
  const apiKey = await resolveValue(uid, keys[provider] as string);
  const stored: Record<string, string> = {};
  for (const [k, v] of Object.entries(chat.connectors ?? {})) if (typeof v === "string") stored[k] = v;
  const { connectors } = await resolveConnectorsSafe(uid, stored);
  return { chatId: snap.id, name: chat.agentName || "Agent", provider, model, apiKey, connectors };
}

export async function defaultChatId(uid: string): Promise<string> {
  const s = await getVoiceSettings(uid);
  if (s.voiceChatId) return s.voiceChatId;
  const q = await userRef(uid).collection("chats").orderBy("createdAt", "desc").limit(1).get();
  return q.docs[0]?.id ?? "";
}

async function brain(uid: string, chatId: string) {
  const snap = await userRef(uid).collection("chats").doc(chatId).collection("brain").doc("memories").get();
  const items = ((snap.data() as { items?: Array<{ text: string; kind?: string }> } | undefined)?.items ?? []);
  const role = items.find((i) => i.kind === "role")?.text ?? "";
  const mem = items.filter((i) => i.kind !== "role").slice(-15).map((i) => `- ${i.text}`).join("\n");
  return { role, mem };
}

export type CallDoc = {
  direction?: string; to?: string; from?: string; status?: string; goal?: string; context?: string; chatId?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  transcript?: Array<{ role: string; text: string; at: number }>; followUps?: string[]; durationSeconds?: number;
  summary?: string; finalizedAt?: number; createdAt?: number;
};

export async function voicePrompt(uid: string, agent: Agent, call: CallDoc, s: VoiceSettings): Promise<string> {
  const { role, mem } = await brain(uid, agent.chatId);
  const lang = s.language ?? "en-US";
  return [
    `You are ${agent.name}, an AI teammate, now on a live PHONE CALL. You are speaking, not writing.`,
    `RULES: Your very first sentence must make clear you are an AI assistant. Speak 1-3 short, natural sentences. No lists, no markdown, no URLs, no emojis. Speak in the language of the caller (call language setting: ${lang}); if the caller uses Hindi or Hinglish, answer the same way.`,
    `Never claim you did something unless a tool result confirms it. During the call you may use READ-ONLY tools. For anything that changes something (send, book, buy, write, update), say you will take care of it right after the call and add [[TODO:<exact task with all details>]] at the end of your reply. If the goal is reached or the caller wants to end, say goodbye and add [[HANGUP]] at the end. Never say passwords, keys or private data.`,
    role ? `YOUR ROLE: ${role}` : "",
    mem ? `WHAT YOU REMEMBER:\n${mem}` : "",
    call.direction === "outbound"
      ? `YOU CALLED THEM. CALL GOAL: ${call.goal || "(no goal given: ask how you can help)"}${call.context ? `\nCONTEXT: ${call.context}` : ""}\nDo not stop until the goal is handled or the person declines.`
      : "THE CALLER PHONED YOU. Greet them, find out what they need and handle it like a team member.",
  ].filter(Boolean).join("\n\n");
}

/** Separates what is spoken from the hidden markers. */
export function parseSpoken(raw: string): { say: string; todos: string[]; hangup: boolean } {
  const todos: string[] = [];
  let hangup = false;
  let t = raw.replace(/\[\[TODO:([\s\S]*?)\]\]/gi, (_m, x: string) => { todos.push(String(x).trim().slice(0, 600)); return ""; });
  t = t.replace(/\[\[HANGUP\]\]/gi, () => { hangup = true; return ""; });
  t = t.replace(/\[\[[\s\S]*?\]\]/g, "").replace(/https?:\/\/\S+/g, "the link in chat").replace(/[*_#`>]+/g, "").replace(/\s+/g, " ").trim();
  return { say: t.slice(0, 500) || "Okay.", todos, hangup };
}

// ---------------- speech (voice provider) ----------------
const ELEVEN_IDS: Record<string, string> = { rachel: "21m00Tcm4TlvDq8ikWAM", adam: "pNInz6obpgDQGcFmaJgB", bella: "EXAVITQu4vr4xnSDxMaL", antoni: "ErXwobaYiN019PkySvjV" };

function wav(pcm: Buffer, rate: number) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function ttsBytes(uid: string, text: string, s: VoiceSettings): Promise<{ bytes: Buffer; mime: string } | null> {
  const p = s.ttsProvider ?? "twilio";
  const keys = await getResolvedVoiceSecrets(uid);
  const sig = () => AbortSignal.timeout(9000);
  if (p === "openai") {
    const key = keys.openaiKey || (await getExistingOpenAIKey(uid));
    if (!key) return null;
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: sig(),
      body: JSON.stringify({ model: s.ttsModel || "gpt-4o-mini-tts", voice: s.ttsVoice || "alloy", input: text, response_format: "mp3" }),
    });
    return r.ok ? { bytes: Buffer.from(await r.arrayBuffer()), mime: "audio/mpeg" } : null;
  }
  if (p === "elevenlabs" && keys.elevenLabsKey) {
    const v = s.ttsVoice || "Rachel";
    const id = ELEVEN_IDS[v.toLowerCase()] ?? v;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_64`, {
      method: "POST", headers: { "xi-api-key": keys.elevenLabsKey, "Content-Type": "application/json" }, signal: sig(),
      body: JSON.stringify({ text, model_id: s.ttsModel || "eleven_flash_v2_5" }),
    });
    return r.ok ? { bytes: Buffer.from(await r.arrayBuffer()), mime: "audio/mpeg" } : null;
  }
  if (p === "deepgram" && keys.deepgramKey) {
    const r = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(s.ttsVoice || "aura-2-thalia-en")}&encoding=mp3`, {
      method: "POST", headers: { Authorization: `Token ${keys.deepgramKey}`, "Content-Type": "application/json" }, signal: sig(), body: JSON.stringify({ text }),
    });
    return r.ok ? { bytes: Buffer.from(await r.arrayBuffer()), mime: "audio/mpeg" } : null;
  }
  if (p === "gemini" && keys.geminiKey) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.ttsModel || "gemini-2.5-flash-preview-tts")}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": keys.geminiKey, "Content-Type": "application/json" }, signal: sig(),
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: s.ttsVoice || "Kore" } } } },
      }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> };
    const part = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data)?.inlineData;
    if (!part?.data) return null;
    const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? "")?.[1]) || 24000;
    return { bytes: wav(Buffer.from(part.data, "base64"), rate), mime: "audio/wav" };
  }
  return null; // azure / cartesia / playht are not wired for phone audio: the free built-in voice is used instead
}

/** XML that speaks `text`: the chosen voice provider, or the free Twilio voice when none works. */
export async function speechXml(uid: string, base: string, text: string, s: VoiceSettings): Promise<string> {
  if ((s.ttsProvider ?? "twilio") !== "twilio") {
    try {
      const a = await ttsBytes(uid, text, s);
      if (a && a.bytes.length < 700_000) {
        const id = randomUUID().replace(/-/g, "");
        await userRef(uid).collection("voiceAudio").doc(id).set({ b64: a.bytes.toString("base64"), mime: a.mime, at: Date.now(), expireAt: new Date(Date.now() + 3600_000) });
        const token = signVoiceToken({ uid, callId: id, purpose: "tts", exp: Date.now() + 15 * 60_000 });
        return `<Play>${xmlEscape(`${base}/api/voice/tts?token=${encodeURIComponent(token)}`)}</Play>`;
      }
    } catch { /* fall back to the built-in voice */ }
  }
  return sayTag(text, s.language ?? "en-US");
}

// ---------------- calls ----------------
export async function openingLine(uid: string, callId: string): Promise<string> {
  const ref = userRef(uid).collection("voiceCalls").doc(callId);
  const d = ((await ref.get()).data() ?? {}) as CallDoc;
  const s = await getVoiceSettings(uid);
  const hi = (s.language ?? "").startsWith("hi");
  let text = d.direction === "inbound"
    ? hi ? "Namaste! Main ek AI assistant hoon. Bataiye, main aapki kya madad kar sakta hoon?" : "Hello! I am an AI assistant. How can I help you today?"
    : hi ? "Namaste! Main ek AI assistant bol raha hoon. Kya abhi aapse do minute baat ho sakti hai?" : "Hello! This is an AI assistant calling. Do you have a minute?";
  try {
    const agent = await loadAgent(uid, d.chatId);
    const sys = await voicePrompt(uid, agent, d, s);
    const raw = await timeout(callProvider({
      provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 200,
      messages: [{ role: "system", content: sys }, { role: "user", content: d.direction === "inbound" ? "(The caller just connected. Greet them.)" : "(The person just answered. Greet them and say why you are calling.)" }],
    }), 6500);
    text = parseSpoken(raw).say;
  } catch { /* the fixed greeting is used */ }
  await ref.set({ transcript: FieldValue.arrayUnion({ role: "assistant", text, at: Date.now() }), history: [{ role: "assistant", content: text }] }, { merge: true });
  return text;
}

export async function placeOutboundCall(uid: string, p: { to: string; goal?: string; context?: string; chatId?: string; approved: boolean; req?: Request }) {
  const to = String(p.to || "").trim();
  if (!/^\+[1-9]\d{5,14}$/.test(to)) throw new VoiceError("Number international format me do, jaise +919876543210.");
  const sec = await getResolvedVoiceSecrets(uid);
  const st = sec.settings;
  if (!st.outboundEnabled) throw new VoiceError("Outgoing calls band hain. Voice page par Twilio connect karo.");
  if (st.approvalRequired !== false && !p.approved) throw new VoiceError("Call se pehle confirm karo.", 403);
  if (!sec.twilioSid || !sec.twilioToken || !st.fromNumber) throw new VoiceError("Pehle Voice page par Twilio key paste karke connect karo.");
  const agent = await loadAgent(uid, p.chatId); // checks that a chat and a model key exist
  const base = appBaseUrl(p.req);
  const calls = userRef(uid).collection("voiceCalls");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const snap = await calls.where("createdAt", ">=", today.getTime()).get();
  const limit = st.dailyLimit ?? 50;
  if (snap.docs.filter((d) => d.data().direction === "outbound").length >= limit) throw new VoiceError(`Daily outbound limit (${limit}) pura ho gaya.`, 429);

  const callId = randomUUID().replace(/-/g, "");
  const now = Date.now();
  const callToken = signVoiceToken({ uid, callId, purpose: "call", exp: now + 4 * 3600_000 });
  const statusToken = signVoiceToken({ uid, callId, purpose: "status", exp: now + 24 * 3600_000 });
  await calls.doc(callId).set({
    direction: "outbound", to, from: st.fromNumber, status: "queued", createdAt: now, updatedAt: now, chatId: agent.chatId,
    goal: String(p.goal || "").slice(0, 1500), context: String(p.context || "").slice(0, 3000), history: [], transcript: [], followUps: [],
  });
  const form = new URLSearchParams({
    To: to, From: st.fromNumber,
    Url: `${base}/api/voice/twiml?token=${encodeURIComponent(callToken)}`, Method: "POST",
    StatusCallback: `${base}/api/voice/status?token=${encodeURIComponent(statusToken)}`, StatusCallbackMethod: "POST",
  });
  for (const e of ["initiated", "ringing", "answered", "completed"]) form.append("StatusCallbackEvent", e);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sec.twilioSid)}/Calls.json`, {
    method: "POST", signal: AbortSignal.timeout(20000), body: form,
    headers: { Authorization: `Basic ${Buffer.from(`${sec.twilioSid}:${sec.twilioToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = (await r.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string };
  if (!r.ok || !data.sid) {
    await calls.doc(callId).set({ status: "failed", failure: String(data.message || `HTTP ${r.status}`).slice(0, 240), updatedAt: Date.now() }, { merge: true });
    throw new VoiceError(String(data.message || `Twilio call start nahi kar paya (HTTP ${r.status}).`), r.status === 401 ? 400 : 502);
  }
  await calls.doc(callId).set({ providerCallId: data.sid, status: data.status || "queued", updatedAt: Date.now() }, { merge: true });
  await audit(uid, { kind: "voice_call_started", chatId: agent.chatId, text: `Outbound call ${to}; goal: ${String(p.goal || "").slice(0, 120)}` });
  return { id: callId, providerCallId: data.sid, status: data.status || "queued", to };
}

/** When a call ends: a summary and the follow-up tasks are posted into the chat. */
export async function finalizeCall(uid: string, callId: string) {
  const ref = userRef(uid).collection("voiceCalls").doc(callId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const d = snap.data() as CallDoc;
  if (d.finalizedAt) return;
  await ref.set({ finalizedAt: Date.now() }, { merge: true });
  const transcript = (d.transcript ?? []).slice(-60);
  const who = d.direction === "inbound" ? `from ${d.from ?? "unknown"}` : `to ${d.to ?? "unknown"}`;
  let summary = "";
  if (transcript.length) {
    const text = transcript.map((t) => `${t.role === "assistant" ? "AGENT" : "PERSON"}: ${t.text}`).join("\n").slice(0, 9000);
    try {
      const agent = await loadAgent(uid, d.chatId);
      summary = (await timeout(callProvider({
        provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 400,
        messages: [{ role: "system", content: "Summarize this phone call for the account owner in 3-5 short bullet points: outcome, key facts (names, numbers, dates), and what is still open. Same language as the call. Never invent anything." }, { role: "user", content: `GOAL: ${d.goal || "(inbound call)"}\n\nTRANSCRIPT:\n${text}` }],
      }), 20000)).trim();
    } catch { summary = transcript.slice(-6).map((t) => `${t.role === "assistant" ? "Agent" : "Person"}: ${t.text}`).join("\n"); }
  } else summary = `No conversation happened (status: ${d.status ?? "unknown"}).`;
  await ref.set({ summary }, { merge: true });

  const todos = d.followUps ?? [];
  const content = `📞 **Call ${who} finished** (${Math.round(d.durationSeconds ?? 0)}s)\n\n${summary}${todos.length ? `\n\n**Follow-ups the agent promised on the call:**\n${todos.map((t) => `- ${t}`).join("\n")}\n\nReply "do the follow-ups" and I will start them.` : ""}`;
  const chatId = d.chatId || (await defaultChatId(uid));
  if (!chatId) return;
  const chatRef = userRef(uid).collection("chats").doc(chatId);
  const cs = await chatRef.get();
  if (!cs.exists) return;
  const prior = Array.isArray((cs.data() as { messages?: unknown[] }).messages) ? (cs.data() as { messages: unknown[] }).messages : [];
  await chatRef.update({ messages: [...prior, { role: "assistant", content, at: Date.now() }] });
}