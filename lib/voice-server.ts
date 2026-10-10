import { createHmac, timingSafeEqual } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { resolveValue, vaultDelete, vaultPut } from "@/lib/vault";
import { PROVIDERS, type ProviderId } from "@/lib/providers";

export type TtsProvider = "twilio" | "openai" | "gemini" | "elevenlabs" | "deepgram" | "azure" | "cartesia" | "playht";
export const TTS_PROVIDERS: TtsProvider[] = ["twilio", "openai", "gemini", "elevenlabs", "deepgram", "azure", "cartesia", "playht"];

export type VoiceSettings = {
  openaiKey?: string;
  geminiKey?: string;
  elevenLabsKey?: string;
  azureSpeechKey?: string;
  deepgramKey?: string;
  cartesiaKey?: string;
  playhtKey?: string;
  ttsProvider?: TtsProvider;
  ttsModel?: string;
  ttsVoice?: string;
  twilioSid?: string;
  twilioToken?: string;
  fromNumber?: string;
  /** The chat (agent) that answers calls. Its model, memory, role and tools are used. */
  voiceChatId?: string;
  /** Old field, kept so earlier saved settings still load. Calls now use the chat's model. */
  llmProvider?: ProviderId;
  llmModel?: string;
  language?: string;
  inboundEnabled?: boolean;
  outboundEnabled?: boolean;
  approvalRequired?: boolean;
  dailyLimit?: number;
};

export type SecretField = "openaiKey" | "geminiKey" | "elevenLabsKey" | "azureSpeechKey" | "deepgramKey" | "cartesiaKey" | "playhtKey" | "twilioSid" | "twilioToken";

const db = () => getAdminDb();
const settingsRef = (uid: string) => db().collection("users").doc(uid);
export const voiceSafeError = (error: unknown) => (error instanceof Error ? error.message.slice(0, 240) : "Voice request failed.");

export async function getVoiceSettings(uid: string): Promise<VoiceSettings> {
  const snap = await settingsRef(uid).get();
  const d = (snap.data() ?? {}) as { voiceSettings?: VoiceSettings };
  return { ...(d.voiceSettings ?? {}) };
}

export async function saveVoiceSettings(uid: string, patch: Partial<VoiceSettings>) {
  const ref = settingsRef(uid);
  const snap = await ref.get();
  const current = (snap.data()?.voiceSettings ?? {}) as VoiceSettings;
  const next: VoiceSettings = { ...current };
  const secrets: Array<[keyof VoiceSettings, string]> = [
    ["openaiKey", "voice.openai"], ["geminiKey", "voice.gemini"], ["elevenLabsKey", "voice.elevenlabs"],
    ["azureSpeechKey", "voice.azure"], ["deepgramKey", "voice.deepgram"], ["cartesiaKey", "voice.cartesia"],
    ["playhtKey", "voice.playht"], ["twilioSid", "voice.twilio.sid"], ["twilioToken", "voice.twilio.token"],
  ];
  for (const [field, vaultName] of secrets) {
    const v = patch[field];
    if (typeof v === "string" && v.trim()) (next as Record<string, unknown>)[field] = await vaultPut(uid, vaultName, v.trim(), true);
  }
  if (patch.ttsProvider && TTS_PROVIDERS.includes(patch.ttsProvider)) next.ttsProvider = patch.ttsProvider;
  if (typeof patch.ttsModel === "string" && patch.ttsModel.trim().length <= 120) next.ttsModel = patch.ttsModel.trim();
  if (typeof patch.ttsVoice === "string" && patch.ttsVoice.trim().length <= 160) next.ttsVoice = patch.ttsVoice.trim();
  if (typeof patch.fromNumber === "string") next.fromNumber = patch.fromNumber.trim();
  if (typeof patch.voiceChatId === "string" && /^[A-Za-z0-9_-]{0,160}$/.test(patch.voiceChatId)) next.voiceChatId = patch.voiceChatId;
  if (patch.llmProvider && PROVIDERS.some((p) => p.id === patch.llmProvider)) next.llmProvider = patch.llmProvider;
  if (typeof patch.llmModel === "string" && patch.llmModel.trim().length <= 120) next.llmModel = patch.llmModel.trim();
  if (typeof patch.language === "string" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(patch.language)) next.language = patch.language;
  for (const f of ["inboundEnabled", "outboundEnabled", "approvalRequired"] as const) if (typeof patch[f] === "boolean") next[f] = patch[f];
  if (typeof patch.dailyLimit === "number" && Number.isInteger(patch.dailyLimit)) next.dailyLimit = Math.max(1, Math.min(500, patch.dailyLimit));
  await ref.set({ voiceSettings: next }, { merge: true });
  return next;
}

export async function clearVoiceSecret(uid: string, field: SecretField) {
  const names: Record<SecretField, string> = {
    openaiKey: "voice.openai", geminiKey: "voice.gemini", elevenLabsKey: "voice.elevenlabs", azureSpeechKey: "voice.azure",
    deepgramKey: "voice.deepgram", cartesiaKey: "voice.cartesia", playhtKey: "voice.playht",
    twilioSid: "voice.twilio.sid", twilioToken: "voice.twilio.token",
  };
  await vaultDelete(uid, names[field]);
  const ref = settingsRef(uid);
  await ref.update({ [`voiceSettings.${field}`]: FieldValue.delete() }).catch(() => {});
}

export async function getResolvedVoiceSecrets(uid: string) {
  const settings = await getVoiceSettings(uid);
  const snap = await settingsRef(uid).get();
  const data = (snap.data() ?? {}) as { apiKeys?: Partial<Record<ProviderId, string>> };
  const r = async (v?: string) => (v ? resolveValue(uid, v) : null);
  const rawProviderKey = settings.llmProvider ? data.apiKeys?.[settings.llmProvider] : undefined;
  return {
    settings,
    openaiKey: await r(settings.openaiKey),
    geminiKey: await r(settings.geminiKey),
    elevenLabsKey: await r(settings.elevenLabsKey),
    azureSpeechKey: await r(settings.azureSpeechKey),
    deepgramKey: await r(settings.deepgramKey),
    cartesiaKey: await r(settings.cartesiaKey),
    playhtKey: await r(settings.playhtKey),
    twilioSid: await r(settings.twilioSid),
    twilioToken: await r(settings.twilioToken),
    providerKey: await r(rawProviderKey),
  };
}

function signingSecret() {
  const s = process.env.ROUTINE_RUNNER_SECRET;
  if (!s || s.length < 32) throw new Error("Voice webhooks require ROUTINE_RUNNER_SECRET (at least 32 characters).");
  return s;
}
export type VoiceToken = { uid: string; callId?: string; purpose: "call" | "inbound" | "status" | "tts"; exp: number };
export function signVoiceToken(claims: VoiceToken) {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyVoiceToken(token: string): VoiceToken | null {
  if (!token || token.length > 2048) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  try {
    const expected = createHmac("sha256", signingSecret()).update(body).digest();
    const supplied = Buffer.from(sig, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as VoiceToken;
    if (!c.uid || !Number.isFinite(c.exp) || c.exp < Date.now() || !["call", "inbound", "status", "tts"].includes(c.purpose)) return null;
    if ((c.purpose === "call" || c.purpose === "tts") && !c.callId) return null;
    return c;
  } catch { return null; }
}

/** The public https address of this app. Twilio must be told exactly this host, so it is read from NEXT_PUBLIC_APP_URL first. */
export function appBaseUrl(req?: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req ? new URL(req.url).origin : "");
  if (!configured) throw new Error("Set NEXT_PUBLIC_APP_URL (your https domain) in Vercel.");
  const u = new URL(configured);
  if (u.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
  return u.origin;
}

/** Validates Twilio's signature. Twilio signs the exact URL configured in its dashboard, so we try the public URL first and then req.url. */
export function verifyTwilioSignature(req: Request, authToken: string, form: FormData): boolean {
  const supplied = req.headers.get("x-twilio-signature") || "";
  if (!supplied || !authToken) return false;
  const u = new URL(req.url);
  const candidates = [req.url];
  try { candidates.unshift(appBaseUrl(req) + u.pathname + u.search); } catch { /* use req.url only */ }
  const keys = Array.from(new Set(Array.from(form.keys()))).sort();
  let params = "";
  for (const key of keys) for (const value of form.getAll(key).map((v) => String(v)).sort()) params += key + value;
  const b = Buffer.from(supplied);
  return candidates.some((url) => {
    const a = Buffer.from(createHmac("sha1", authToken).update(url + params, "utf8").digest("base64"));
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
export function twimlResponse(xml: string, status = 200) {
  return new Response(xml, { status, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
const langOf = (language: string) => (/^[a-z]{2,3}-[A-Z]{2}$/.test(language) ? language : "en-US");

/** Free built-in voice (used when no voice provider key is saved). Polly Aditi speaks Indian English and Hindi. */
export function sayTag(text: string, language: string) {
  const lang = langOf(language);
  const voice = lang === "hi-IN" || lang === "en-IN" ? "Polly.Aditi" : lang === "en-US" ? "Polly.Joanna" : "";
  return `<Say language="${lang}"${voice ? ` voice="${voice}"` : ""}>${xmlEscape(text)}</Say>`;
}
export function gatherXml(inner: string, language: string, actionUrl: string) {
  const lang = langOf(language);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="${xmlEscape(actionUrl)}" method="POST" language="${lang}" speechTimeout="auto" timeout="8">${inner}</Gather>${sayTag("I did not hear a response. Goodbye.", lang)}<Hangup/></Response>`;
}
export function hangupXml(inner: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}<Hangup/></Response>`;
}