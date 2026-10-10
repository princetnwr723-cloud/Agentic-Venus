import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider, type ChatMsg } from "@/lib/ai-providers-server";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import { getVoiceSettings, getResolvedVoiceSecrets, verifyVoiceToken, verifyTwilioSignature, appBaseUrl, gatherXml, twimlResponse, voiceSafeError } from "@/lib/voice-server";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 25;
export async function POST(req: Request) {
  let uid = "";
  try {
    const token = new URL(req.url).searchParams.get("token") || "";
    const claims = verifyVoiceToken(token);
    if (!claims || claims.purpose !== "call" || !claims.callId) return twimlResponse("<?xml version=\"1.0\"?><Response><Say>Invalid session.</Say><Hangup/></Response>", 403);
    uid = claims.uid;
    const form = await req.formData();
    const webhookSecrets = await getResolvedVoiceSecrets(uid);
    if (!webhookSecrets.twilioToken || !verifyTwilioSignature(req, webhookSecrets.twilioToken, form)) return twimlResponse("<?xml version=\"1.0\"?><Response><Say>Webhook signature is invalid.</Say><Hangup/></Response>", 403);
    const speech = String(form.get("SpeechResult") || "").trim().slice(0, 2000);
    const callSid = String(form.get("CallSid") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    const userRef = getAdminDb().collection("users").doc(uid);
    const callRef = userRef.collection("voiceCalls").doc(claims.callId);
    const callSnap = await callRef.get();
    if (!callSnap.exists || (callSid && callSnap.data()?.providerCallId && callSnap.data()?.providerCallId !== callSid)) return twimlResponse("<?xml version=\"1.0\"?><Response><Say>Call session not found.</Say><Hangup/></Response>", 404);
    const call = callSnap.data() ?? {};
    const settings = await getVoiceSettings(uid);
    const language = settings.language ?? "en-US";
    const base = appBaseUrl(req);
    const nextAction = `${base}/api/voice/turn?token=${encodeURIComponent(token)}`;
    if (!speech) return twimlResponse(gatherXml("Sorry, I did not catch that. Please say that again.", language, nextAction));
    const provider = (settings.llmProvider ?? "openai") as ProviderId;
    if (!PROVIDERS.some(p => p.id === provider)) return twimlResponse(gatherXml("The selected AI provider is not supported. Please contact the account owner.", language, nextAction));
    const voiceSecrets = await getResolvedVoiceSecrets(uid);
    const apiKey = voiceSecrets.providerKey;
    if (!apiKey) return twimlResponse(gatherXml(`The ${providerMeta(provider).label} API key is not connected. Please configure it in Agentic Venus settings.`, language, nextAction));
    const model = (settings.llmModel || providerMeta(provider).models[0] || "").slice(0, 120);
    const history = (Array.isArray(call.history) ? call.history : []).slice(-8) as { role: "user" | "assistant"; content: string }[];
    const messages: ChatMsg[] = [
      { role: "system", content: `You are Agentic-Venus, a concise and helpful phone voice assistant. Speak naturally in the language associated with ${language}. Keep replies short and easy to hear over a phone. Do not claim you performed actions unless tools/results confirm them. For external actions, ask for confirmation when needed. This phone call does not grant permission to make additional calls or spend money.` },
      ...history,
      { role: "user", content: speech },
    ];
    const answer = (await callProvider({ provider, apiKey, model, messages, maxTokens: 500 })).trim().slice(0, 1600) || "Sorry, I could not prepare a response.";
    const nextHistory = [...history, { role: "user" as const, content: speech }, { role: "assistant" as const, content: answer }].slice(-10);
    await callRef.set({ history: nextHistory, lastSpeechAt: Date.now(), updatedAt: Date.now(), lastProvider: provider, lastModel: model }, { merge: true });
    await audit(uid, { kind: "voice_turn", text: `Call ${claims.callId}: ${provider} handled a speech turn` });
    return twimlResponse(gatherXml(answer, language, nextAction));
  } catch (e) {
    const token = new URL(req.url).searchParams.get("token") || "";
    const claims = verifyVoiceToken(token);
    const voiceSettings = claims ? await getVoiceSettings(claims.uid).catch(() => null) : null;
    const language = voiceSettings?.language || "en-US";
    const base = (() => { try { return appBaseUrl(req); } catch { return new URL(req.url).origin; } })();
    const action = `${base}/api/voice/turn?token=${encodeURIComponent(token)}`;
    return twimlResponse(gatherXml("Sorry, the voice assistant had a temporary problem. Please try again.", language, action), 200);
  }
}
