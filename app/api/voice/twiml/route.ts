import { getAdminDb } from "@/lib/firebase-admin";
import { getVoiceSettings, getResolvedVoiceSecrets, signVoiceToken, verifyVoiceToken, verifyTwilioSignature, appBaseUrl, gatherXml, sayTag, twimlResponse, voiceSafeError } from "@/lib/voice-server";
import { defaultChatId, openingLine, speechXml } from "@/lib/voice-calls";
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
    const settings = await getVoiceSettings(claims.uid);
    let callId: string;

    if (claims.purpose === "inbound") {
      if (!settings.inboundEnabled) return bye("This AI assistant is not accepting calls right now.");
      const from = String(form.get("From") || "").slice(0, 40);
      const to = String(form.get("To") || "").slice(0, 40);
      callId = callSid;
      await userRef.collection("voiceCalls").doc(callId).set({
        direction: "inbound", from, to, providerCallId: callSid, status: "in-progress", createdAt: Date.now(), updatedAt: Date.now(),
        chatId: await defaultChatId(claims.uid), history: [], transcript: [], followUps: [],
      }, { merge: true });
      await audit(claims.uid, { kind: "voice_inbound_call", text: `Inbound call ${from}` });
    } else {
      if (!claims.callId) return bye("Call session was not found.", 404);
      callId = claims.callId;
      const snap = await userRef.collection("voiceCalls").doc(callId).get();
      if (!snap.exists || (snap.data()?.providerCallId && snap.data()?.providerCallId !== callSid)) return bye("Call session was not found.", 404);
      await snap.ref.set({ status: "in-progress", answeredAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    }

    const base = appBaseUrl(req);
    const callToken = signVoiceToken({ uid: claims.uid, callId, purpose: "call", exp: Date.now() + 4 * 3600_000 });
    const action = `${base}/api/voice/turn?token=${encodeURIComponent(callToken)}`;
    const opening = await openingLine(claims.uid, callId);
    const inner = await speechXml(claims.uid, base, opening, settings);
    return twimlResponse(gatherXml(inner, settings.language ?? "en-US", action));
  } catch (e) {
    return bye(String(voiceSafeError(e)).replace(/[<&>"']/g, " "), 500);
  }
}