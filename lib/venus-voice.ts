// Venus Pro voice-over: uses the SAME voice system as phone calls (Settings -> Voice).
// Order, so a voice-over is always possible:
//   1. the cloud voice model saved in Settings -> Voice (OpenAI, ElevenLabs, Deepgram, Gemini)
//   2. the LOCAL voice model on your cloud PC (when it is selected or already running)
//   3. your OpenAI key
//   4. null -> the studio route speaks with a free voice on the studio computer (Hindi and English)
// Server-only.
import { getExistingOpenAIKey } from "@/lib/voice-utils";
import { ensureLocalVoice, voiceKey } from "@/lib/voice-local";
import { getResolvedVoiceSecrets, getVoiceSettings, type VoiceSettings } from "@/lib/voice-server";

export type VoiceAudio = { bytes: Buffer; ext: "mp3" | "wav"; provider: string };
export type VoiceState = { ready: boolean; provider: string; voice: string; note?: string };

const ELEVEN_IDS: Record<string, string> = { rachel: "21m00Tcm4TlvDq8ikWAM", adam: "pNInz6obpgDQGcFmaJgB", bella: "EXAVITQu4vr4xnSDxMaL", antoni: "ErXwobaYiN019PkySvjV" };
const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "ash", "coral", "sage"];
const LEGACY = ["nova", "alloy", "echo", "fable", "onyx", "shimmer"];
const TIMEOUT = () => AbortSignal.timeout(40_000);
const hasDevanagari = (t: string) => /[\u0900-\u097F]/.test(t);

function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

type Ctx = { s: VoiceSettings; keys: Awaited<ReturnType<typeof getResolvedVoiceSecrets>>; openai: string | null; localOk: boolean };

async function context(uid: string): Promise<Ctx> {
  const s = await getVoiceSettings(uid);
  const keys = await getResolvedVoiceSecrets(uid);
  const openai = keys.openaiKey || (await getExistingOpenAIKey(uid).catch(() => null)) || null;
  // the local model is only used when it was chosen or is already running (this never wakes a PC that the user did not ask for)
  const localOk = s.ttsProvider === "local" || Boolean(s.localVoiceUrl && s.localVoiceSandbox) || Boolean(s.localVoiceAt);
  return { s, keys, openai, localOk };
}

function cloudProvider(c: Ctx): "openai" | "elevenlabs" | "deepgram" | "gemini" | null {
  const p = c.s.ttsProvider ?? "twilio";
  if (p === "openai" && c.openai) return "openai";
  if (p === "elevenlabs" && c.keys.elevenLabsKey) return "elevenlabs";
  if (p === "deepgram" && c.keys.deepgramKey) return "deepgram";
  if (p === "gemini" && c.keys.geminiKey) return "gemini";
  return null;
}

/** Which voice will speak (for the form and the pipeline). A voice-over is always possible: the last fallback is free. */
export async function voiceStatus(uid: string): Promise<VoiceState> {
  const c = await context(uid);
  const cloud = cloudProvider(c);
  if (cloud) return { ready: true, provider: cloud, voice: c.s.ttsVoice || (cloud === "openai" ? "alloy" : "default") };
  if (c.localOk) return { ready: true, provider: "local", voice: c.s.ttsVoice || "local voice model", note: "Your local voice model speaks. If your PC is asleep, a free voice on the studio computer takes over." };
  if (c.openai) return { ready: true, provider: "openai", voice: "nova", note: "No voice provider is chosen in Settings -> Voice, so OpenAI speaks." };
  return { ready: true, provider: "studio-free", voice: "free neural voice", note: "No voice provider is connected, so a free voice on the studio computer speaks (Hindi and English)." };
}

async function viaCloud(c: Ctx, provider: string, input: string, over: string): Promise<VoiceAudio> {
  const { s, keys } = c;
  if (provider === "elevenlabs" && keys.elevenLabsKey) {
    const v = over && !LEGACY.includes(over.toLowerCase()) ? over : s.ttsVoice || "Rachel";
    const id = ELEVEN_IDS[v.toLowerCase()] ?? v;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": keys.elevenLabsKey, "Content-Type": "application/json" }, signal: TIMEOUT(),
      body: JSON.stringify({ text: input, model_id: s.ttsModel || "eleven_multilingual_v2" }),
    });
    if (!r.ok) throw new Error("ElevenLabs voice-over failed (HTTP " + r.status + ").");
    return { bytes: Buffer.from(await r.arrayBuffer()), ext: "mp3", provider: "elevenlabs" };
  }
  if (provider === "deepgram" && keys.deepgramKey) {
    const v = over && !LEGACY.includes(over.toLowerCase()) ? over : s.ttsVoice || "aura-2-thalia-en";
    const r = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(v)}&encoding=mp3`, {
      method: "POST", headers: { Authorization: `Token ${keys.deepgramKey}`, "Content-Type": "application/json" }, signal: TIMEOUT(), body: JSON.stringify({ text: input }),
    });
    if (!r.ok) throw new Error("Deepgram voice-over failed (HTTP " + r.status + ").");
    return { bytes: Buffer.from(await r.arrayBuffer()), ext: "mp3", provider: "deepgram" };
  }
  if (provider === "gemini" && keys.geminiKey) {
    const v = over && !LEGACY.includes(over.toLowerCase()) ? over : s.ttsVoice || "Kore";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.ttsModel || "gemini-2.5-flash-preview-tts")}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": keys.geminiKey, "Content-Type": "application/json" }, signal: TIMEOUT(),
      body: JSON.stringify({
        contents: [{ parts: [{ text: input }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } },
      }),
    });
    if (!r.ok) throw new Error("Gemini voice-over failed (HTTP " + r.status + ").");
    const j = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> };
    const part = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data)?.inlineData;
    if (!part?.data) throw new Error("Gemini returned no audio.");
    const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? "")?.[1]) || 24000;
    return { bytes: wav(Buffer.from(part.data, "base64"), rate), ext: "wav", provider: "gemini" };
  }
  // OpenAI
  const key = c.openai;
  if (!key) throw new Error("No OpenAI key for the voice-over.");
  const useSaved = s.ttsProvider === "openai";
  const v = over && (OPENAI_VOICES.includes(over.toLowerCase()) || useSaved) ? over.toLowerCase() : useSaved ? s.ttsVoice || "alloy" : "nova";
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: TIMEOUT(),
    body: JSON.stringify({ model: useSaved ? s.ttsModel || "gpt-4o-mini-tts" : "tts-1", voice: OPENAI_VOICES.includes(v) ? v : "alloy", input, response_format: "mp3" }),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error("OpenAI voice-over failed: " + (e.error?.message ?? "HTTP " + r.status));
  }
  return { bytes: Buffer.from(await r.arrayBuffer()), ext: "mp3", provider: "openai" };
}

const PIPER_NAME = /^[a-z]{2,3}_[A-Z]{2}-[A-Za-z0-9_]+-[a-z_]+$/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The local voice model on the cloud PC. Unlike a phone call, a video can wait: there is no short wake-up limit and no cool-down.
 * The PC is woken as often as needed, a sentence may take up to 45 s (the first one loads the voice) and a failed sentence is tried again.
 * One HTTP request can only last about a minute, so this works until `deadline` and then answers "retry": the pipeline asks again.
 */
async function viaLocal(c: Ctx, uid: string, chatId: string | undefined, input: string, lang: string, deadline: number): Promise<VoiceAudio | "retry" | null> {
  const voice = PIPER_NAME.test(c.s.ttsVoice ?? "") ? (c.s.ttsVoice as string) : "";
  let url = c.s.localVoiceUrl ?? "";
  let sandboxId = c.s.localVoiceSandbox ?? "";
  while (deadline - Date.now() > 6000) {
    try {
      if (!url || !sandboxId) {
        const st = await ensureLocalVoice(uid, chatId, Math.max(4000, Math.min(30_000, deadline - Date.now() - 2000)));
        if (st.state === "ready") { url = st.url; sandboxId = st.sandboxId; }
        else if (st.state === "no_computer") return null; // there is no PC to wake: the next voice takes over
        else { await sleep(2500); continue; } // still waking or installing
      }
      const left = deadline - Date.now();
      if (left < 6000) break;
      const r = await fetch(`${url}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Voice-Key": voiceKey(sandboxId) },
        body: JSON.stringify({ text: input.slice(0, 700), lang, voice }),
        signal: AbortSignal.timeout(Math.min(45_000, left - 1000)),
      });
      if (r.status === 404) return null; // the local model has no voice for this language: the next voice takes over
      if (r.ok) {
        const bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.length > 44) return { bytes, ext: "wav", provider: "local" };
      }
    } catch { /* the PC may be asleep: wake it and try again */ }
    url = ""; sandboxId = "";
    await sleep(2000);
  }
  return "retry";
}

/**
 * Speaks `text` with the best voice that works. Returns null when none of the server-side voices works:
 * the caller then uses the free voice of the studio computer. `voiceOverride` replaces only the voice name.
 */
export async function synthVoiceOver(uid: string, text: string, voiceOverride?: string, chatId?: string, localWait = false): Promise<VoiceAudio | null | "retry"> {
  const c = await context(uid);
  const deadline = Date.now() + 38_000; // one request lasts about a minute: the rest is for saving the file
  const input = text.slice(0, 900);
  const over = (voiceOverride || "").trim();

  const cloud = cloudProvider(c);
  if (cloud) {
    try { return await viaCloud(c, cloud, input, over); } catch { /* the next voice takes over */ }
  }
  if (c.localOk) {
    const lang = hasDevanagari(input) ? "hi-IN" : c.s.language && c.s.language !== "auto" ? c.s.language : "en-US";
    const a = await viaLocal(c, uid, chatId, input, lang, deadline);
    if (a && a !== "retry") return a;
    if (a === "retry" && localWait) return "retry"; // the caller waits for the local model and asks again
  }
  if (c.openai) {
    try { return await viaCloud(c, "openai", input, over); } catch { /* the free voice takes over */ }
  }
  return null;
}
