import { getAdminDb } from "@/lib/firebase-admin";
import { getResolvedVoiceSecrets, verifyVoiceToken, verifyTwilioSignature, voiceSafeError } from "@/lib/voice-server";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  const claims = verifyVoiceToken(token);
  if (!claims || claims.purpose !== "status" || !claims.callId) return new Response("Forbidden", { status: 403 });
  try {
    const form = await req.formData();
    const secrets = await getResolvedVoiceSecrets(claims.uid);
    if (!secrets.twilioToken || !verifyTwilioSignature(req, secrets.twilioToken, form)) return new Response("Forbidden", { status: 403 });
    const callSid = String(form.get("CallSid") || "").slice(0, 80);
    const status = String(form.get("CallStatus") || "unknown").slice(0, 40);
    const duration = Math.max(0, Number(form.get("CallDuration") || 0));
    const ref = getAdminDb().collection("users").doc(claims.uid).collection("voiceCalls").doc(claims.callId);
    const snap = await ref.get();
    if (!snap.exists || (snap.data()?.providerCallId && callSid && snap.data()?.providerCallId !== callSid)) return new Response("Not found", { status: 404 });
    await ref.set({ status, durationSeconds: duration, updatedAt: Date.now(), ...(status === "completed" ? { completedAt: Date.now() } : {}) }, { merge: true });
    if (["completed", "busy", "failed", "no-answer", "canceled"].includes(status)) await audit(claims.uid, { kind: "voice_call_status", text: `Call ${claims.callId}: ${status}, ${duration}s` });
    return new Response("ok", { status: 200 });
  } catch (e) { return new Response(voiceSafeError(e), { status: 500 }); }
}
