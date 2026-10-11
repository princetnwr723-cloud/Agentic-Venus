import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { signChannelToken } from "@/lib/channels";
import { audit } from "@/lib/audit";
import { clearVoiceSecret, getVoiceSettings, saveVoiceSettings, signVoiceToken, appBaseUrl, voiceSafeError, TTS_PROVIDERS, type SecretField, type TtsProvider, type VoiceSettings } from "@/lib/voice-server";
import { defaultChatId } from "@/lib/voice-calls";
import { readBody, requestStatus } from "@/lib/request";
import { getExistingOpenAIKey } from "@/lib/voice-utils";

export const runtime = "nodejs";
export const maxDuration = 30;
const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

const TTS_FIELD: Record<string, SecretField> = {
  openai: "openaiKey", gemini: "geminiKey", elevenlabs: "elevenLabsKey", deepgram: "deepgramKey",
  azure: "azureSpeechKey", cartesia: "cartesiaKey", playht: "playhtKey",
};

const inboundUrl = (uid: string, req: Request) =>
  `${appBaseUrl(req)}/api/voice/twiml?token=${encodeURIComponent(signVoiceToken({ uid, purpose: "inbound", exp: 4102444800000 }))}`;

async function publicSettings(uid: string, s: VoiceSettings) {
  const openai = Boolean(await getExistingOpenAIKey(uid));
  return {
    openaiConnected: openai,
    twilioConnected: Boolean(s.twilioSid && s.twilioToken),
    ttsConnected: { twilio: true, openai, gemini: Boolean(s.geminiKey), elevenlabs: Boolean(s.elevenLabsKey), deepgram: Boolean(s.deepgramKey), azure: Boolean(s.azureSpeechKey), cartesia: Boolean(s.cartesiaKey), playht: Boolean(s.playhtKey) },
    ttsProvider: s.ttsProvider ?? "twilio", ttsModel: s.ttsModel ?? "", ttsVoice: s.ttsVoice ?? "",
    fromNumber: s.fromNumber ?? "", voiceChatId: s.voiceChatId ?? "",
    language: s.language ?? "en-US", inboundEnabled: s.inboundEnabled ?? false, outboundEnabled: s.outboundEnabled ?? false,
    approvalRequired: s.approvalRequired ?? true, dailyLimit: s.dailyLimit ?? 50,
  };
}

/** Pulls the Account SID (AC + 32 hex) and Auth Token (32 hex) out of whatever the user pasted. */
function parseTwilio(raw: string) {
  const sid = /\bAC[a-f0-9]{32}\b/i.exec(raw)?.[0];
  const rest = sid ? raw.replace(sid, " ") : raw;
  const token = /\b[a-f0-9]{32}\b/i.exec(rest)?.[0];
  return { sid, token };
}

export async function GET(req: Request) {
  try {
    const auth = await authFromRequest(req);
    if (auth.job) return err("Background jobs cannot manage voice settings.", 403);
    const s = await getVoiceSettings(auth.uid);
    return NextResponse.json({ settings: await publicSettings(auth.uid, s), inboundWebhookUrl: inboundUrl(auth.uid, req) });
  } catch (e) { return err(voiceSafeError(e), requestStatus(e, 401)); }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 32 * 1024 });
    const uid = body.uid as string;

    // ---- ONE paste: Twilio SID + token. Everything else is set up automatically. ----
    if (body.action === "connect_twilio") {
      const { sid, token } = parseTwilio(String(body.credentials || ""));
      if (!sid || !token) return err("Account SID (AC… se shuru) aur Auth Token (32 characters) dono paste karo.");
      const basic = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
      const acct = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers: { Authorization: basic }, signal: AbortSignal.timeout(12000) });
      const ad = (await acct.json().catch(() => ({}))) as { friendly_name?: string; type?: string; message?: string };
      if (!acct.ok) return err(acct.status === 401 ? "Twilio ne ye SID/token reject kiya. Dubara copy karo." : String(ad.message || `Twilio error (HTTP ${acct.status}).`));

      const current = await getVoiceSettings(uid);
      const numRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=20`, { headers: { Authorization: basic }, signal: AbortSignal.timeout(12000) });
      const nums = ((await numRes.json().catch(() => ({}))) as { incoming_phone_numbers?: Array<{ sid: string; phone_number: string; capabilities?: { voice?: boolean } }> }).incoming_phone_numbers ?? [];
      const usable = nums.filter((n) => n.capabilities?.voice !== false);
      const pick = usable.find((n) => n.phone_number === current.fromNumber) ?? usable[0];

      const chatId = current.voiceChatId || (await defaultChatId(uid));
      const patch: Partial<VoiceSettings> & Record<string, unknown> = {
        twilioSid: sid, twilioToken: token, inboundEnabled: true, outboundEnabled: true, approvalRequired: false,
        ...(chatId ? { voiceChatId: chatId } : {}),
      };
      let webhook = false;
      if (pick) {
        patch.fromNumber = pick.phone_number;
        const form = new URLSearchParams({VoiceUrl: inboundUrl(uid, req), VoiceMethod: "POST",SmsUrl: `${appBaseUrl(req)}/api/channels/twilio?token=${encodeURIComponent(signChannelToken(uid, "twilio"))}`, SmsMethod: "POST",});
        const up = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${pick.sid}.json`, {
          method: "POST", headers: { Authorization: basic, "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(12000),
        });
        webhook = up.ok;
      }
      const saved = await saveVoiceSettings(uid, patch);
      await audit(uid, { kind: "voice_twilio_connected", text: `${ad.friendly_name ?? sid}; number ${pick?.phone_number ?? "none"}` });
      const trial = ad.type === "Trial";
      return NextResponse.json({
        ok: true, webhook, number: pick?.phone_number ?? null, needsNumber: !pick, trial,
        message: !pick
          ? "Twilio connect ho gaya, par is account me koi phone number nahi hai. Twilio Console → Phone Numbers se ek number lo (trial me free milta hai), phir yahin Refresh dabao."
          : `✅ Connected: ${pick.phone_number}. Incoming calls ka webhook automatically set ho gaya${webhook ? "" : " (nahi hua: Twilio me number ka Voice webhook khud paste karna padega)"}, aur calling aur accept dono ON hain.${trial ? " Trial account hai: sirf Twilio me verified numbers ko call ja sakti hai." : ""}`,
        settings: await publicSettings(uid, saved), inboundWebhookUrl: inboundUrl(uid, req),
      });
    }

    if (body.action === "disconnect") {
      const field = String(body.field || "");
      if (field === "twilio") { await clearVoiceSecret(uid, "twilioSid"); await clearVoiceSecret(uid, "twilioToken"); await saveVoiceSettings(uid, { inboundEnabled: false, outboundEnabled: false }); }
      else if (TTS_FIELD[field]) await clearVoiceSecret(uid, TTS_FIELD[field]);
      else return err("Unknown credential.");
      await audit(uid, { kind: "voice_disconnect", text: field });
      return NextResponse.json({ ok: true });
    }

    if (body.action !== "save") return err("Unknown voice settings action.");
    const patch: Partial<VoiceSettings> & Record<string, unknown> = {};
    if (body.ttsProvider !== undefined) {
      if (!TTS_PROVIDERS.includes(String(body.ttsProvider) as TtsProvider)) return err("Choose a supported voice provider.");
      patch.ttsProvider = body.ttsProvider;
      const key = typeof body.ttsKey === "string" ? body.ttsKey.trim() : "";
      if (key) {
        if (key.length > 4096) return err("Key bahut lambi hai.");
        const f = TTS_FIELD[String(body.ttsProvider)];
        if (f) patch[f] = key;
      }
    }
    if (body.ttsModel !== undefined) patch.ttsModel = String(body.ttsModel).trim().slice(0, 120);
    if (body.ttsVoice !== undefined) patch.ttsVoice = String(body.ttsVoice).trim().slice(0, 160);
    if (body.voiceChatId !== undefined) patch.voiceChatId = String(body.voiceChatId);
    if (body.language !== undefined) {
      const lang = String(body.language);
      if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(lang)) return err("Language tag galat hai (jaise en-IN, hi-IN).");
      patch.language = lang;
    }
    for (const f of ["inboundEnabled", "outboundEnabled", "approvalRequired"] as const) if (typeof body[f] === "boolean") patch[f] = body[f];
    if (body.dailyLimit !== undefined) {
      const limit = Number(body.dailyLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) return err("Daily limit 1 se 500 ke beech rakho.");
      patch.dailyLimit = limit;
    }
    if (body.fromNumber !== undefined) {
      const n = String(body.fromNumber).trim();
      if (n && !/^\+[1-9]\d{5,14}$/.test(n)) return err("Number E.164 format me do, jaise +14155550123.");
      patch.fromNumber = n;
    }
    const saved = await saveVoiceSettings(uid, patch);
    await audit(uid, { kind: "voice_settings_saved", text: "Voice settings updated" });
    return NextResponse.json({ ok: true, settings: await publicSettings(uid, saved) });
  } catch (e) { return err(voiceSafeError(e), requestStatus(e)); }
}