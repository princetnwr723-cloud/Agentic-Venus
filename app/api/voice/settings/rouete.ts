import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { audit } from "@/lib/audit";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { clearVoiceSecret, getVoiceSettings, saveVoiceSettings, voiceSafeError, type VoiceSettings } from "@/lib/voice-server";
import { readBody, requestStatus } from "@/lib/request";
import { signVoiceToken } from "@/lib/voice-server";
import { getExistingOpenAIKey } from "@/lib/voice-utils";

export const runtime = "nodejs";
export const maxDuration = 30;
const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET(req: Request) {
  try {
    const auth = await authFromRequest(req);
    if (auth.job) return err("Background jobs cannot manage voice settings.", 403);
    const settings = await getVoiceSettings(auth.uid);
    const token = signVoiceToken({ uid: auth.uid, purpose: "inbound", exp: 4102444800000 });
    const base = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(req.url).origin);
    return NextResponse.json({
      settings: {
        openaiConnected: Boolean(await getExistingOpenAIKey(auth.uid)),
        ttsConnected: { openai: Boolean(await getExistingOpenAIKey(auth.uid)), gemini: Boolean(settings.geminiKey), elevenlabs: Boolean(settings.elevenLabsKey), azure: Boolean(settings.azureSpeechKey), deepgram: Boolean(settings.deepgramKey), cartesia: Boolean(settings.cartesiaKey), playht: Boolean(settings.playhtKey) },
        ttsProvider: settings.ttsProvider ?? "openai", ttsModel: settings.ttsModel ?? "gpt-4o-mini-tts", ttsVoice: settings.ttsVoice ?? "alloy",
        twilioConnected: Boolean(settings.twilioSid && settings.twilioToken),
        fromNumber: settings.fromNumber ?? "", llmProvider: settings.llmProvider ?? "openai", llmModel: settings.llmModel ?? "gpt-4o-mini",
        language: settings.language ?? "en-US", inboundEnabled: settings.inboundEnabled ?? false, outboundEnabled: settings.outboundEnabled ?? false,
        approvalRequired: settings.approvalRequired ?? true, dailyLimit: settings.dailyLimit ?? 50,
      },
      providers: PROVIDERS.map(p => ({ id: p.id, label: p.label, models: p.models })),
      inboundWebhookUrl: `${base.replace(/\/$/, "")}/api/voice/twiml?token=${encodeURIComponent(token)}`,
    });
  } catch (e) { return err(voiceSafeError(e), requestStatus(e, 401)); }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 32 * 1024 });
    const uid = body.uid as string;
    if (body.action === "disconnect") {
      const field = String(body.field || "");
      const allowed = ["openaiKey", "geminiKey", "elevenLabsKey", "azureSpeechKey", "deepgramKey", "cartesiaKey", "playhtKey", "twilioSid", "twilioToken", "twilio"];
      if (!allowed.includes(field)) return err("Unknown credential.");
      if (field === "twilio") { await clearVoiceSecret(uid, "twilioSid"); await clearVoiceSecret(uid, "twilioToken"); }
      else await clearVoiceSecret(uid, field as "openaiKey" | "geminiKey" | "elevenLabsKey" | "azureSpeechKey" | "deepgramKey" | "cartesiaKey" | "playhtKey" | "twilioSid" | "twilioToken");
      await audit(uid, { kind: "voice_disconnect", text: field });
      return NextResponse.json({ ok: true });
    }
    if (body.action !== "save") return err("Unknown voice settings action.");
    const patch: Record<string, unknown> = {};
    for (const field of ["openaiKey", "geminiKey", "elevenLabsKey", "azureSpeechKey", "deepgramKey", "cartesiaKey", "playhtKey", "twilioSid", "twilioToken"] as const) {
      if (typeof body[field] === "string" && body[field].trim()) {
        if (body[field].length > 4096) return err(`${field} is too long.`);
        patch[field] = body[field];
      }
    }
    if (body.ttsProvider !== undefined) {
      if (!["openai", "gemini", "elevenlabs", "azure", "deepgram", "cartesia", "playht"].includes(String(body.ttsProvider))) return err("Choose a supported voice provider.");
      patch.ttsProvider = body.ttsProvider;
    }
    if (body.ttsModel !== undefined) patch.ttsModel = String(body.ttsModel).trim().slice(0, 120);
    if (body.ttsVoice !== undefined) patch.ttsVoice = String(body.ttsVoice).trim().slice(0, 160);
    if (body.fromNumber !== undefined) {
      const n = String(body.fromNumber).trim();
      if (n && !/^\+[1-9]\d{5,14}$/.test(n)) return err("Phone number must use international E.164 format, e.g. +14155550123.");
      patch.fromNumber = n;
    }
    if (body.llmProvider !== undefined) {
      if (!PROVIDERS.some(p => p.id === body.llmProvider)) return err("Choose one of the 11 supported AI providers.");
      patch.llmProvider = body.llmProvider as ProviderId;
    }
    if (body.llmModel !== undefined) patch.llmModel = String(body.llmModel).trim().slice(0, 120);
    if (body.language !== undefined) {
      const lang = String(body.language);
      if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(lang)) return err("Use a valid language tag such as en-US, hi-IN, or fr-FR.");
      patch.language = lang;
    }
    for (const f of ["inboundEnabled", "outboundEnabled", "approvalRequired"] as const) if (typeof body[f] === "boolean") patch[f] = body[f];
    if (body.dailyLimit !== undefined) {
      const limit = Number(body.dailyLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) return err("Daily call limit must be between 1 and 500.");
      patch.dailyLimit = limit;
    }
    const saved = await saveVoiceSettings(uid, patch as Partial<VoiceSettings>);
    await audit(uid, { kind: "voice_settings_saved", text: "Voice settings updated" });
    return NextResponse.json({ ok: true, settings: {
      openaiConnected: Boolean(saved.openaiKey),
      ttsConnected: { openai: Boolean(saved.openaiKey), gemini: Boolean(saved.geminiKey), elevenlabs: Boolean(saved.elevenLabsKey), azure: Boolean(saved.azureSpeechKey), deepgram: Boolean(saved.deepgramKey), cartesia: Boolean(saved.cartesiaKey), playht: Boolean(saved.playhtKey) },
      ttsProvider: saved.ttsProvider ?? "openai", ttsModel: saved.ttsModel ?? "gpt-4o-mini-tts", ttsVoice: saved.ttsVoice ?? "alloy",
      twilioConnected: Boolean(saved.twilioSid && saved.twilioToken),
      fromNumber: saved.fromNumber ?? "", llmProvider: saved.llmProvider ?? "openai", llmModel: saved.llmModel ?? "gpt-4o-mini",
      language: saved.language ?? "en-US", inboundEnabled: saved.inboundEnabled ?? false, outboundEnabled: saved.outboundEnabled ?? false,
      approvalRequired: saved.approvalRequired ?? true, dailyLimit: saved.dailyLimit ?? 50,
    } });
  } catch (e) { return err(voiceSafeError(e), requestStatus(e)); }
}
