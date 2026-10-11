import { digits, findChat, runAfter, seen, sendTwilioMessage, verifyChannelToken, WA_SANDBOX } from "@/lib/channels";
import { handleInbound } from "@/lib/channel-agent";
import { getResolvedVoiceSecrets, twimlResponse, verifyTwilioSignature } from "@/lib/voice-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const empty = (status = 200) => twimlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, status);

export async function POST(req: Request) {
  const uid = verifyChannelToken(new URL(req.url).searchParams.get("token") || "", "twilio");
  if (!uid) return empty(403);
  const form = await req.formData();
  const secrets = await getResolvedVoiceSecrets(uid);
  if (!secrets.twilioToken || !verifyTwilioSignature(req, secrets.twilioToken, form)) return empty(403);

  const from = String(form.get("From") || "");
  const to = String(form.get("To") || "");
  const body = String(form.get("Body") || "").trim();
  const sid = String(form.get("MessageSid") || form.get("SmsSid") || "");
  if (!body || !from) return empty();
  const whatsapp = from.startsWith("whatsapp:");
  const num = from.replace(/^whatsapp:/, "");

  // Allowlist: only the owner's own number is answered. Everyone else is ignored silently.
  const owner = await findChat(uid, whatsapp ? "whatsapp" : "sms", (cred) => digits(cred[0]) === digits(num));
  if (!owner) return empty();
  if (sid && (await seen(uid, `tw_${sid}`))) return empty();

  const mine = to.replace(/^whatsapp:/, "") || (whatsapp ? owner.cred[1] || WA_SANDBOX : owner.cred[1]);
  runAfter(handleInbound({ uid, chatId: owner.chatId, channel: whatsapp ? "whatsapp" : "sms", from: num, text: body, reply: (t) => sendTwilioMessage(uid, num, mine, t, whatsapp) }));
  return empty();
}