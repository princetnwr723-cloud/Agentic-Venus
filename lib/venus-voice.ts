// Venus Pro voice-over: uses the SAME voice system as phone calls (Settings -> Voice): the TTS provider, model and voice that
// the user saved there. Server-only. "twilio" (the free built-in phone voice) has no audio file, so it falls back to OpenAI.
import { getExistingOpenAIKey } from "@/lib/voice-utils";
import { localTts } from "@/lib/voice-local";
import { getResolvedVoiceSecrets, getVoiceSettings, type VoiceSettings } from "@/lib/voice-server";

export type VoiceAudio = { bytes: Buffer; ext: "mp3" | "wav"; provider: string };

const ELEVEN_IDS: Record<string, string> = { rachel: "21m00Tcm4TlvDq8ikWAM", adam: "pNInz6obpgDQGcFmaJgB", bella: "EXAVITQu4vr4xnSDxMaL", antoni: "ErXwobaYiN019PkySvjV" };
const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "ash", "coral", "sage"];
const LEGACY = ["nova", "alloy", "echo", "fable", "onyx", "shimmer"];

function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const TIMEOUT = () => AbortSignal.timeout(40_000);

/** Which provider will speak (for the UI / the pipeline), without synthesizing anything. */
export async function voiceStatus(uid: string): Promise<{ ready: boolean; provider: string; voice: string; note?: string }> {
  const s = await getVoiceSettings(uid);
  const keys = await getResolvedVoiceSecrets(uid);
  const p = s.ttsProvider ?? "twilio";
  const openai = keys.openaiKey || (await getExistingOpenAIKey(uid));
  if (p === "openai" && openai) return { ready: true, provider: "openai", voice: s.ttsVoice || "alloy" };
  if (p === "elevenlabs" && keys.elevenLabsKey) return { ready: true, provider: "elevenlabs", voice: s.ttsVoice || "Rachel" };
  if (p === "deepgram" && keys.deepgramKey) return { ready: true, provider: "deepgram", voice: s.ttsVoice || "aura-2-thalia-en" };
  if (p === "gemini" && keys.geminiKey) return { ready: true, provider: "gemini", voice: s.ttsVoice || "Kore" };
  if (p === "local" && s.localVoiceUrl && s.localVoiceSandbox) return { ready: true, provider: "local", voice: s.ttsVoice || "local" };
  if (openai) return { ready: true, provider: "openai", voice: "nova", note: p === "twilio" ? "The free phone voice has no audio file, so OpenAI speaks." : "Your saved voice provider is not connected, so OpenAI speaks." };
  return { ready: false, provider: p, voice: "", note: "Connect a voice provider (Settings -> Voice) or an OpenAI key to get a voice-over." };
}

/** Speaks `text` with the user's voice system. `voiceOverride` (optional) replaces only the voice name. */
export async function synthVoiceOver(uid: string, text: string, voiceOverride?: string): Promise<VoiceAudio> {
  const s: VoiceSettings = await getVoiceSettings(uid);
  const keys = await getResolvedVoiceSecrets(uid);
  const st = await voiceStatus(uid);
  if (!st.ready) throw new Error(st.note || "No voice provider is connected.");
  const input = text.slice(0, 900);
  const over = (voiceOverride || "").trim();

  if (st.provider === "local") {
    const a = await localTts(s, input, s.language && s.language !== "auto" ? s.language : "en-US", { uid, wake: true });
    if (a?.bytes?.length) return { bytes: a.bytes, ext: /wav/i.test(a.mime) ? "wav" : "mp3", provider: "local" };
    throw new Error("The local voice model on your cloud PC did not answer. Open Settings -> Voice and wake it, or pick another provider.");
  }

  if (st.provider === "elevenlabs" && keys.elevenLabsKey) {
    const v = over && !LEGACY.includes(over.toLowerCase()) ? over : s.ttsVoice || "Rachel";
    const id = ELEVEN_IDS[v.toLowerCase()] ?? v;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": keys.elevenLabsKey, "Content-Type": "application/json" }, signal: TIMEOUT(),
      body: JSON.stringify({ text: input, model_id: s.ttsModel || "eleven_multilingual_v2" }),
    });
    if (!r.ok) throw new Error("ElevenLabs voice-over failed (HTTP " + r.status + ").");
    return { bytes: Buffer.from(await r.arrayBuffer()), ext: "mp3", provider: "elevenlabs" };
  }

  if (st.provider === "deepgram" && keys.deepgramKey) {
    const v = over && !LEGACY.includes(over.toLowerCase()) ? over : s.ttsVoice || "aura-2-thalia-en";
    const r = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(v)}&encoding=mp3`, {
      method: "POST", headers: { Authorization: `Token ${keys.deepgramKey}`, "Content-Type": "application/json" }, signal: TIMEOUT(), body: JSON.stringify({ text: input }),
    });
    if (!r.ok) throw new Error("Deepgram voice-over failed (HTTP " + r.status + ").");
    return { bytes: Buffer.from(await r.arrayBuffer()), ext: "mp3", provider: "deepgram" };
  }

  if (st.provider === "gemini" && keys.geminiKey) {
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

  // OpenAI (the chosen provider, or the fallback)
  const key = keys.openaiKey || (await getExistingOpenAIKey(uid));
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
