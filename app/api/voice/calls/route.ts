import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import { audit } from "@/lib/audit";
import { getResolvedVoiceSecrets, appBaseUrl, signVoiceToken, voiceSafeError } from "@/lib/voice-server";
import { readBody, requestStatus } from "@/lib/request";
import { getVoiceSettings } from "@/lib/voice-server";

export const runtime = "nodejs";
export const maxDuration = 30;
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
export async function GET(req: Request) {
  try {
    const auth = await authFromRequest(req);
    if (auth.job) return fail("Background jobs cannot view call history.", 403);
    const snap = await getAdminDb().collection("users").doc(auth.uid).collection("voiceCalls").orderBy("createdAt", "desc").limit(50).get();
    const calls = snap.docs.map(d => {
      const x = d.data();
      return { id: d.id, direction: x.direction, to: x.to ?? "", from: x.from ?? "", status: x.status ?? "unknown", createdAt: x.createdAt ?? 0, durationSeconds: x.durationSeconds ?? 0, provider: x.provider ?? "", estimatedCost: x.estimatedCost ?? null };
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todaySnap = await getAdminDb().collection("users").doc(auth.uid).collection("voiceCalls").where("createdAt", ">=", today.getTime()).get();
    return NextResponse.json({ calls, todayCount: todaySnap.size });
  } catch (e) { return fail(voiceSafeError(e), requestStatus(e, 401)); }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 8 * 1024 });
    const uid = body.uid as string;
    const to = String(body.to || "").trim();
    if (!/^\+[1-9]\d{5,14}$/.test(to)) return fail("Enter the destination number in international E.164 format, e.g. +14155550123.");
    const s = await getResolvedVoiceSecrets(uid);
    const settings = s.settings;
    if (!settings.outboundEnabled) return fail("Enable outgoing calls in Voice & Calling settings first.");
    if (settings.approvalRequired !== false && body.approved !== true) return fail("Confirm the outbound call before starting it.", 403);
    if (!s.twilioSid || !s.twilioToken || !settings.fromNumber) return fail("Connect Twilio and set your verified caller ID first.");
    if (!s.providerKey) return fail(`Add an API key for the selected ${settings.llmProvider ?? "OpenAI"} AI provider before placing a call.`);
    const base = appBaseUrl(req);
    const db = getAdminDb();
    const callsRef = db.collection("users").doc(uid).collection("voiceCalls");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const countSnap = await callsRef.where("createdAt", ">=", today.getTime()).get();
    const limit = settings.dailyLimit ?? 50;
    const outboundToday = countSnap.docs.filter(d => d.data().direction === "outbound").length;
    if (outboundToday >= limit) return fail(`Daily outbound call limit reached (${limit}).`, 429);
    const callId = randomUUID().replace(/-/g, "");
    const now = Date.now();
    const callToken = signVoiceToken({ uid, callId, purpose: "call", exp: now + 4 * 60 * 60_000 });
    const statusToken = signVoiceToken({ uid, callId, purpose: "status", exp: now + 24 * 60 * 60_000 });
    await callsRef.doc(callId).set({ direction: "outbound", to, from: settings.fromNumber, status: "queued", createdAt: now, updatedAt: now, provider: settings.llmProvider ?? "openai", model: settings.llmModel ?? "", history: [], approved: true });
    const form = new URLSearchParams({
      To: to,
      From: settings.fromNumber,
      Url: `${base}/api/voice/twiml?token=${encodeURIComponent(callToken)}`,
      Method: "POST",
      StatusCallback: `${base}/api/voice/status?token=${encodeURIComponent(statusToken)}`,
      StatusCallbackMethod: "POST",
    });
    for (const event of ["initiated", "ringing", "answered", "completed"]) form.append("StatusCallbackEvent", event);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(s.twilioSid)}/Calls.json`, {
      method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${s.twilioSid}:${s.twilioToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form,
      signal: AbortSignal.timeout(20000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.sid) {
      await callsRef.doc(callId).set({ status: "failed", failure: String(data.message || `Twilio returned HTTP ${r.status}`).slice(0, 240), updatedAt: Date.now() }, { merge: true });
      return fail(String(data.message || `Twilio could not start the call (HTTP ${r.status}).`), r.status === 401 ? 400 : 502);
    }
    await callsRef.doc(callId).set({ providerCallId: data.sid, status: data.status || "queued", updatedAt: Date.now() }, { merge: true });
    await audit(uid, { kind: "voice_call_started", text: `Outbound call ${to}; provider ${data.sid}` });
    return NextResponse.json({ ok: true, call: { id: callId, providerCallId: data.sid, status: data.status || "queued", to } }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(voiceSafeError(e), requestStatus(e)); }
}
