import { createHmac, timingSafeEqual } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { resolveValue, vaultDelete, vaultPut } from "@/lib/vault";
import { PROVIDERS, type ProviderId } from "@/lib/providers";

export type VoiceSettings = {
  openaiKey?: string;
  twilioSid?: string;
  twilioToken?: string;
  fromNumber?: string;
  llmProvider?: ProviderId;
  llmModel?: string;
  language?: string;
  inboundEnabled?: boolean;
  outboundEnabled?: boolean;
  approvalRequired?: boolean;
  dailyLimit?: number;
};

const db = () => getAdminDb();
const settingsRef = (uid: string) => db().collection("users").doc(uid);
export const voiceSafeError = (error: unknown) => error instanceof Error ? error.message.slice(0, 240) : "Voice request failed.";

export async function getVoiceSettings(uid: string): Promise<VoiceSettings> {
  const snap = await settingsRef(uid).get();
  const d = (snap.data() ?? {}) as { voiceSettings?: VoiceSettings; apiKeys?: Partial<Record<ProviderId, string>> };
  return { ...(d.voiceSettings ?? {}), openaiKey: d.voiceSettings?.openaiKey, twilioSid: d.voiceSettings?.twilioSid, twilioToken: d.voiceSettings?.twilioToken };
}

export async function saveVoiceSettings(uid: string, patch: Partial<VoiceSettings>) {
  const ref = settingsRef(uid);
  const snap = await ref.get();
  const current = ((snap.data()?.voiceSettings ?? {}) as VoiceSettings);
  const next: VoiceSettings = { ...current };
  if (typeof patch.openaiKey === "string" && patch.openaiKey.trim()) next.openaiKey = await vaultPut(uid, "voice.openai", patch.openaiKey.trim(), true);
  if (typeof patch.twilioSid === "string" && patch.twilioSid.trim()) next.twilioSid = await vaultPut(uid, "voice.twilio.sid", patch.twilioSid.trim(), true);
  if (typeof patch.twilioToken === "string" && patch.twilioToken.trim()) next.twilioToken = await vaultPut(uid, "voice.twilio.token", patch.twilioToken.trim(), true);
  if (typeof patch.fromNumber === "string") next.fromNumber = patch.fromNumber.trim();
  if (patch.llmProvider && PROVIDERS.some(p => p.id === patch.llmProvider)) next.llmProvider = patch.llmProvider;
  if (typeof patch.llmModel === "string" && patch.llmModel.trim().length <= 120) next.llmModel = patch.llmModel.trim();
  if (typeof patch.language === "string" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(patch.language)) next.language = patch.language;
  if (typeof patch.inboundEnabled === "boolean") next.inboundEnabled = patch.inboundEnabled;
  if (typeof patch.outboundEnabled === "boolean") next.outboundEnabled = patch.outboundEnabled;
  if (typeof patch.approvalRequired === "boolean") next.approvalRequired = patch.approvalRequired;
  if (typeof patch.dailyLimit === "number" && Number.isInteger(patch.dailyLimit)) next.dailyLimit = Math.max(1, Math.min(500, patch.dailyLimit));
  await ref.set({ voiceSettings: next }, { merge: true });
  return next;
}

export async function clearVoiceSecret(uid: string, field: "openaiKey" | "twilioSid" | "twilioToken") {
  const name = field === "openaiKey" ? "voice.openai" : field === "twilioSid" ? "voice.twilio.sid" : "voice.twilio.token";
  await vaultDelete(uid, name);
  const ref = settingsRef(uid);
  const snap = await ref.get();
  const current = ((snap.data()?.voiceSettings ?? {}) as VoiceSettings);
  delete current[field];
  await ref.update({ [`voiceSettings.${field}`]: FieldValue.delete() }).catch(async () => { await ref.set({ voiceSettings: current }, { merge: true }); });
}

export async function getResolvedVoiceSecrets(uid: string) {
  const settings = await getVoiceSettings(uid);
  const snap = await settingsRef(uid).get();
  const data = (snap.data() ?? {}) as { apiKeys?: Partial<Record<ProviderId, string>> };
  const rawProviderKey = settings.llmProvider ? data.apiKeys?.[settings.llmProvider] : undefined;
  const providerKey = rawProviderKey ? await resolveValue(uid, rawProviderKey) : (settings.llmProvider === "openai" && settings.openaiKey ? await resolveValue(uid, settings.openaiKey) : null);
  return {
    settings,
    openaiKey: settings.openaiKey ? await resolveValue(uid, settings.openaiKey) : null,
    twilioSid: settings.twilioSid ? await resolveValue(uid, settings.twilioSid) : null,
    twilioToken: settings.twilioToken ? await resolveValue(uid, settings.twilioToken) : null,
    providerKey,
  };
}

function signingSecret() {
  const s = process.env.ROUTINE_RUNNER_SECRET;
  if (!s || s.length < 32) throw new Error("Voice webhooks require ROUTINE_RUNNER_SECRET (at least 32 characters). ");
  return s;
}
export type VoiceToken = { uid: string; callId?: string; purpose: "call" | "inbound" | "status"; exp: number };
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
    if (!c.uid || !Number.isFinite(c.exp) || c.exp < Date.now() || !["call", "inbound", "status"].includes(c.purpose)) return null;
    if (c.purpose === "call" && !c.callId) return null;
    return c;
  } catch { return null; }
}
export function appBaseUrl(req: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(req.url).origin);
  const u = new URL(configured);
  if (u.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
  return u.origin;
}

/** Validate Twilio's signature for a URL-encoded webhook using the user's stored Auth Token. */
export function verifyTwilioSignature(req: Request, authToken: string, form: FormData): boolean {
  const supplied = req.headers.get("x-twilio-signature") || "";
  if (!supplied || !authToken) return false;
  const url = req.url;
  let payload = url;
  const keys = Array.from(new Set(Array.from(form.keys()))).sort();
  for (const key of keys) {
    const values = form.getAll(key).map(v => String(v)).sort();
    for (const value of values) payload += key + value;
  }
  const expected = createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}
export function twimlResponse(xml: string, status = 200) {
  return new Response(xml, { status, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
export function gatherXml(message: string, language: string, actionUrl: string) {
  const lang = /^[a-z]{2,3}-[A-Z]{2}$/.test(language) ? language : "en-US";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="${xmlEscape(actionUrl)}" method="POST" language="${lang}" speechTimeout="auto" timeout="8"><Say language="${lang}">${xmlEscape(message)}</Say></Gather><Say language="${lang}">I did not hear a response. Goodbye.</Say><Hangup/></Response>`;
}