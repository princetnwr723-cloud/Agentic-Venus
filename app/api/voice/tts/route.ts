import { getAdminDb } from "@/lib/firebase-admin";
import { verifyVoiceToken } from "@/lib/voice-server";

export const runtime = "nodejs";
export const maxDuration = 15;

// Twilio fetches the generated voice audio from here. The signed, short-lived token is the only key.
export async function GET(req: Request) {
  const claims = verifyVoiceToken(new URL(req.url).searchParams.get("token") || "");
  if (!claims || claims.purpose !== "tts" || !claims.callId) return new Response("Forbidden", { status: 403 });
  const snap = await getAdminDb().collection("users").doc(claims.uid).collection("voiceAudio").doc(claims.callId).get();
  const d = snap.data() as { b64?: string; mime?: string } | undefined;
  if (!d?.b64) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(d.b64, "base64"), { headers: { "Content-Type": d.mime || "audio/mpeg", "Cache-Control": "private, max-age=600" } });
}