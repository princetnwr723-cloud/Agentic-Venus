import { getAdminDb } from "@/lib/firebase-admin";
import { getVoiceSettings, getResolvedVoiceSecrets, signVoiceToken, verifyVoiceToken, verifyTwilioSignature, appBaseUrl, gatherXml, sayTag, twimlResponse, voiceSafeError } from "@/lib/voice-server";
import { defaultChatId, openingLine, speechXml, watchInboundCall } from "@/lib/voice-calls";
import { resolveLanguage } from "@/lib/voice-local";
import { chatForNumber, type TeleSettings } from "@/lib/telephony";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 25;
const bye = (msg: string, status = 200) => twimlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${sayTag(msg, "en-US")}<Hangup/></Response>`, status);

export async function POST(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("token") || "";
    const claims = verifyVoiceToken(token);
    if (!claims || !["call", "inbound"].includes(claims.purpose)) return bye("Invalid voice session.", 403);
    const form = await req.formData();
    const secrets = await getResolvedVoiceSecrets(claims.uid);
    if (!secrets.twilioToken || !verifyTwilioSignature(req, secrets.twilioToken, form)) return bye("Webhook signature is invalid.", 403);
    const callSid = String(form.get("CallSid") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    if (!callSid) return bye("Call identifier missing.", 400);

    const userRef = getAdminDb().collection("users").doc(claims.uid);
    const settings = (await getVoiceSettings(claims.uid)) as TeleSettings;
    let callId: string;
    let chatId = "";
    let number = "";

    if (claims.purpose === "inbound") {
      if (!settings.inboundEnabled) return bye("This AI assistant is not accepting calls right now.");
      const from = String(form.get("From") || "").slice(0, 40);
      const to = String(form.get("To") || "").slice(0, 40);
      callId = callSid;
      number = from;
      // the number that was dialled decides which agent answers; a number nobody owns goes to the default agent
      chatId = chatForNumber(settings, to) || (await defaultChatId(claims.uid));
      await userRef.collection("voiceCalls").doc(callId).set({
        direction: "inbound", from, to, providerCallId: callSid, status: "in-progress", createdAt: Date.now(), updatedAt: Date.now(),
        chatId, history: [], transcript: [], followUps: [],
      }, { merge: true });
      await audit(claims.uid, { kind: "voice_inbound_call", chatId, text: `Inbound call ${from} to ${to}` });
      // so that the summary of this call reaches the chat when it ends (never blocks the call for long)
      await Promise.race([watchInboundCall(claims.uid, callId, callSid, req).catch(() => undefined), new Promise((r) => setTimeout(r, 2500))]);
    } else {
      if (!claims.callId) return bye("Call session was not found.", 404);
      callId = claims.callId;
      const snap = await userRef.collection("voiceCalls").doc(callId).get();
      if (!snap.exists || (snap.data()?.providerCallId && snap.data()?.providerCallId !== callSid)) return bye("Call session was not found.", 404);
      number = String(snap.data()?.to ?? "");
      chatId = String(snap.data()?.chatId ?? "");
      await snap.ref.set({ status: "in-progress", answeredAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    }

    // "auto" language follows the country of the number (any country can be called or can call)
    settings.language = resolveLanguage(settings.language, number);
    const base = appBaseUrl(req);
    const callToken = signVoiceToken({ uid: claims.uid, callId, purpose: "call", exp: Date.now() + 4 * 3600_000 });
    const action = `${base}/api/voice/turn?token=${encodeURIComponent(callToken)}`;
    const opening = await openingLine(claims.uid, callId);
    const inner = await speechXml(claims.uid, base, opening, settings, chatId);
    return twimlResponse(gatherXml(inner, settings.language ?? "en-US", action));
  } catch (e) {
    return bye(String(voiceSafeError(e)).replace(/[<&>"']/g, " "), 500);
  }
}
