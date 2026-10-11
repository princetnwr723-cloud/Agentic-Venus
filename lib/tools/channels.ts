import type { Def } from "./plugins";
import { WA_SANDBOX, notifyOwner, sendEmail, sendSlack, sendTwilioMessage } from "@/lib/channels";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const need = <T,>(ctx: T | undefined): T => { if (!ctx) throw new Error("This tool only works from a chat."); return ctx; };

// The key of each entry must equal the tool-name prefix (whatsapp.send -> "whatsapp").
export const CHANNEL_TOOLS: Record<string, Def[]> = {
  whatsapp: [{
    name: "whatsapp.send", risk: "write", params: "text:string, to?:+E164 number (default: the owner)",
    description: "Send a WhatsApp message (via Twilio). Without `to` it goes to the owner.",
    run: async (a, [owner, from], ctx) => {
      const c = need(ctx);
      const to = s(a.to, 30) || owner;
      await sendTwilioMessage(c.uid, to, from || WA_SANDBOX, s(a.text), true);
      return `WhatsApp sent to ${to}.`;
    },
  }],
  sms: [{
    name: "sms.send", risk: "write", params: "text:string, to?:+E164 number (default: the owner)",
    description: "Send an SMS (via Twilio). Without `to` it goes to the owner.",
    run: async (a, [owner, from], ctx) => {
      const c = need(ctx);
      const to = s(a.to, 30) || owner;
      await sendTwilioMessage(c.uid, to, from, s(a.text), false);
      return `SMS sent to ${to}.`;
    },
  }],
  slackbot: [{
    name: "slackbot.send", risk: "write", params: "text:string, channel?:string (default: DM to the owner)",
    description: "Send a Slack message as the bot.",
    run: async (a, [bot, , owner]) => { await sendSlack(bot, s(a.channel, 60) || owner, s(a.text)); return "Slack message sent."; },
  }],
  email: [{
    name: "email.send", risk: "write", params: "to:string, subject:string, body:string",
    description: "Send an email (via Resend).",
    run: async (a, [key, from]) => {
      const to = s(a.to, 200);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("`to` must be an email address.");
      await sendEmail(key, from, to, s(a.subject, 200) || "Message", s(a.body, 40_000));
      return `Email sent to ${to}.`;
    },
  }],
};

export const NOTIFY_TOOLS: Def[] = [{
  name: "notify.send", risk: "read", params: "text:string, channels?:string[] (telegram, whatsapp, sms, slackbot, email, webhook; default: all connected)",
  description: "Message the OWNER on their connected channels (chat apps / email). Only the owner can receive it.",
  run: async (a, _cred, ctx) => {
    const c = need(ctx);
    const only = Array.isArray(a.channels) ? a.channels.map((x) => String(x)).slice(0, 6) : undefined;
    const r = await notifyOwner(c.uid, c.chatId, s(a.text, 6000), only);
    if (!r.sent.length) throw new Error(r.failed.length ? r.failed.join("; ") : "No messaging channel is connected for this chat (Connectors → Telegram / WhatsApp / Email).");
    return `Sent via ${r.sent.join(", ")}.${r.failed.length ? ` Failed: ${r.failed.join("; ")}` : ""}`;
  },
}];