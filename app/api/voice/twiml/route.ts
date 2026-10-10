import { getAdminDb } from "@/lib/firebase-admin";
import { getVoiceSettings, getResolvedVoiceSecrets, signVoiceToken, verifyVoiceToken, verifyTwilioSignature, appBaseUrl, gatherXml, twimlResponse, voiceSafeError } from "@/lib/voice-server";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 15;
export async function POST(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("token") || "";
    const claims = verifyVoiceToken(token);
    if (!claims || !["call", "inbound"].includes(claims.purpose)) return twimlResponse("<?xml version=\"1.0\"?><Response><Say>Invalid voice session.</Say><Hangup/></Response>", 403);
    const form = await req.formData();
    const providerSecrets = await getResolvedVoiceSecrets(claims.uid);
    if (!providerSecrets.twilioToken || !verifyTwilioSignature(req, providerSecrets.twilioToken, form)) return twimlResponse("<?xml version=\"1.0\"?><Response><Say>Webhook signature is invalid.</Say><Hangup/></Response>", 403);
    const callSid = String(form.get("CallSid") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    if (!callSid) return twimlResponse("<?xml version=\"1.0\"?><Response><Say>Call identifier missing.</Say><Hangup/></Response>", 400);
    const db = getAdminDb();
    const userRef = db.collection("users").doc(claims.uid);
    const settings = await getVoiceSettings(claims.uid);
    if (claims.purpose === "inbound") {
      if (!settings.inboundEnabled) return twimlResponse("<?xml version=\"1.0\"?><Response><Say>This AI assistant is not accepting calls right now.</Say><Hangup/></Response>");
      const secrets = await getResolvedVoiceSecrets(claims.uid);
      if (!secrets.providerKey) return twimlResponse("<?xml version=\"1.0\"?><Response><Say>This AI assistant is not configured yet. Please try again later.</Say><Hangup/></Response>");
      const from = String(form.get("From") || "").slice(0, 40);
      const to = String(form.get("To") || "").slice(0, 40);
      await userRef.collection("voiceCalls").doc(callSid).set({ direction: "inbound", from, to, providerCallId: callSid, status: "in-progress", createdAt: Date.now(), updatedAt: Date.now(), provider: settings.llmProvider ?? "openai", model: settings.llmModel ?? "", history: [] }, { merge: true });
      await audit(claims.uid, { kind: "voice_inbound_call", text: `Inbound call ${from}` });
    } else {
      const snap = await userRef.collection("voiceCalls").doc(claims.callId).get();
      if (!snap.exists || snap.data()?.providerCallId && snap.data()?.providerCallId !== callSid) return twimlResponse("<?xml version=\"1.0\"?><Response><Say>Call session was not found.</Say><Hangup/></Response>", 404);
      await snap.ref.set({ status: "in-progress", answeredAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    }
    const callId = claims.purpose === "inbound" ? callSid : claims.callId!;
    const callToken = signVoiceToken({ uid: claims.uid, callId, purpose: "call", exp: Date.now() + 4 * 60 * 60_000 });
    const base = appBaseUrl(req);
    const action = `${base}/api/voice/turn?token=${encodeURIComponent(callToken)}`;
    const greeting = claims.purpose === "inbound" ? "Hello. You are speaking with the Agentic Venus AI assistant. How can I help you today?" : "Hello. This is the AI assistant you requested. How can I help you today?";
    return twimlResponse(gatherXml(greeting, settings.language ?? "en-US", action));
  } catch (e) {
    return twimlResponse(`<?xml version="1.0"?><Response><Say>${String(voiceSafeError(e)).replace(/[<&>\"']/g, " ")}</Say><Hangup/></Response>`, 500);
  }
}
