// Server-only. The owner pastes a bot token in the chat; the agent sets the whole account up (check, webhook, save).
import { sendTelegram, signChannelToken, telegramSecret } from "@/lib/channels";
import { appBaseUrl } from "@/lib/voice-server";
import { http } from "./net";
import type { Def } from "./plugins";
import type { ToolCtx } from "./types";

const s = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n);
const need = (ctx?: ToolCtx): ToolCtx => { if (!ctx) throw new Error("Bots can only be set up from a chat."); return ctx; };
const reqOf = (ctx: ToolCtx) => (ctx.baseUrl ? new Request(ctx.baseUrl) : undefined);

export const BOT_TOOLS: Def[] = [
  {
    name: "bot.telegram", risk: "write", params: "token:string (bot token from @BotFather), chat?:string (the owner's numeric chat id; if missing it is found from the last message the owner sent to the bot)",
    description: "Set up a Telegram bot as a channel for this owner: checks the token, finds the owner's chat id, registers the webhook and saves everything. After this the owner can chat with the agent in Telegram and gets reports there. Use it the moment the owner pastes a Telegram bot token. Tell the owner they can delete the message that contained the token.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const token = s(a.token, 200).replace(/^bot/i, "");
      if (!/^\d{5,12}:[\w-]{30,60}$/.test(token)) throw new Error("That does not look like a Telegram bot token (it looks like 123456789:ABC...). Get one from @BotFather.");
      const api = (m: string, q = "") => `https://api.telegram.org/bot${token}/${m}${q}`;
      const me = await http(api("getMe"));
      if (!me.json?.ok) throw new Error(me.json?.description || "Telegram rejected this bot token.");
      const username = String(me.json.result?.username ?? "your bot");

      let chat = s(a.chat, 24).replace(/[^\d-]/g, "");
      if (!chat) {
        // getUpdates does not work while a webhook is set: it is removed first and set again below
        await http(api("deleteWebhook"), { method: "POST" }).catch(() => undefined);
        const up = await http(api("getUpdates", "?limit=30&timeout=0"));
        const msgs = ((up.json?.result ?? []) as Array<{ message?: { chat?: { id?: number; type?: string } } }>).map((u) => u.message).filter((m) => m?.chat?.type === "private");
        chat = String(msgs[msgs.length - 1]?.chat?.id ?? "");
        if (!chat) return `✅ The token is valid: @${username}. One more step: open @${username} in Telegram, press Start and send any message. Then tell me "done" and I will finish the setup (or give me your numeric chat id).`;
      }

      let base: string;
      try { base = appBaseUrl(reqOf(c)); } catch (e) { throw new Error(e instanceof Error ? e.message : "NEXT_PUBLIC_APP_URL is not set in Vercel."); }
      const hook = await http(api("setWebhook"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `${base}/api/channels/telegram?token=${encodeURIComponent(signChannelToken(c.uid, "telegram"))}`, secret_token: telegramSecret(c.uid), allowed_updates: ["message"] }),
      });
      if (!hook.json?.ok) throw new Error(`Could not register the webhook: ${hook.json?.description || "unknown error"}`);
      try { await sendTelegram(token, chat, "✅ Connected. You can now talk to your agent here."); }
      catch { throw new Error(`The token works, but @${username} cannot message chat ${chat}. Open the bot in Telegram, press Start, and check the id.`); }
      await c.save("telegram", `${token}::${chat}`);
      return `✅ Telegram is connected: @${username}. Only chat id ${chat} can command the agent. The token is stored encrypted: the owner can delete the message that contained it.`;
    },
  },
  {
    name: "bot.slack", risk: "write", params: "token:string (Slack bot token xoxb-...), signing_secret:string, owner_id:string (the owner's Slack member ID, like U0123ABC)",
    description: "Set up a Slack bot as a channel: checks the bot token, saves it, and returns the Request URL the owner must paste into the Slack app (Event Subscriptions, event message.im).",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const bot = s(a.token, 200), signing = s(a.signing_secret, 120), owner = s(a.owner_id, 30);
      if (!bot || !signing || !owner) throw new Error("I need the bot token, the signing secret and the owner's Slack member ID.");
      const r = await http("https://slack.com/api/auth.test", { method: "POST", headers: { Authorization: `Bearer ${bot}` } });
      if (!r.json?.ok) throw new Error(`Slack rejected the bot token: ${r.json?.error || r.status}`);
      let base: string;
      try { base = appBaseUrl(reqOf(c)); } catch (e) { throw new Error(e instanceof Error ? e.message : "NEXT_PUBLIC_APP_URL is not set in Vercel."); }
      await c.save("slackbot", `${bot}::${signing}::${owner}`);
      return `✅ Slack bot saved (${String(r.json.team ?? "workspace")}). Last step for the owner: in the Slack app → Event Subscriptions, set the Request URL to ${base}/api/channels/slack?token=${encodeURIComponent(signChannelToken(c.uid, "slack"))} and subscribe to the bot event message.im.`;
    },
  },
];
