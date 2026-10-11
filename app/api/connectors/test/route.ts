import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { assertPublicUrl, http } from "@/lib/tools/net";
import { mcpList, McpAuthError } from "@/lib/tools/mcp-client";
import { unpack } from "@/lib/tools/catalog";
import { WA_SANDBOX, sendTelegram, signChannelToken, telegramSecret } from "@/lib/channels";
import { appBaseUrl, getResolvedVoiceSecrets } from "@/lib/voice-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const ok = (label?: string) => NextResponse.json({ ok: true, label });
const E164 = /^\+[1-9]\d{5,14}$/;

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const uid = String(body.uid);
    const t = String(body.token || "").trim();
    const k = String(body.kind || "");
    if (!t) return bad("Token is empty.");

    if (k === "github") {
      const r = await http("https://api.github.com/user", { headers: { Authorization: `Bearer ${t}`, "User-Agent": "agenticvenus", Accept: "application/vnd.github+json" } });
      return r.status < 400 ? ok(r.json?.login) : bad(r.json?.message || "GitHub rejected this token.");
    }
    if (k === "vercel") {
      const r = await http("https://api.vercel.com/v2/user", { headers: { Authorization: `Bearer ${t}` } });
      return r.status < 400 ? ok(r.json?.user?.username || r.json?.user?.email) : bad(r.json?.error?.message || "Vercel rejected this token.");
    }
    if (k === "notion") {
      const r = await http("https://api.notion.com/v1/users/me", { headers: { Authorization: `Bearer ${t}`, "Notion-Version": "2022-06-28" } });
      return r.status < 400 ? ok(r.json?.name || "Notion integration") : bad(r.json?.message || "Notion rejected this token.");
    }

    if (k === "telegram") {
      const [bot, chat] = unpack(t);
      if (!bot || !chat) return bad("Enter both the bot token and your chat id.");
      const me = await http(`https://api.telegram.org/bot${bot}/getMe`);
      if (!me.json?.ok) return bad(me.json?.description || "Telegram rejected this bot token.");
      let base: string;
      try { base = appBaseUrl(req); } catch (e) { return bad(e instanceof Error ? e.message : "Set NEXT_PUBLIC_APP_URL in Vercel."); }
      // Telegram will now send every message to the agent (only your chat id is answered).
      const hook = await http(`https://api.telegram.org/bot${bot}/setWebhook`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `${base}/api/channels/telegram?token=${encodeURIComponent(signChannelToken(uid, "telegram"))}`, secret_token: telegramSecret(uid), allowed_updates: ["message"] }),
      });
      if (!hook.json?.ok) return bad(`Could not register the webhook: ${hook.json?.description || "unknown error"}`);
      try { await sendTelegram(bot, chat, "✅ Connected. You can now talk to your agent here."); }
      catch { return bad("The bot token works, but it cannot message that chat id. Open the bot in Telegram, press Start, and check the id (@userinfobot)."); }
      return ok("@" + me.json.result?.username + " · message the bot to talk to your agent");
    }

    if (k === "whatsapp" || k === "sms") {
      const [owner, from] = unpack(t);
      if (!E164.test(owner || "")) return bad("Your number must look like +919876543210.");
      if (!E164.test(from || "")) return bad("The Twilio number must look like +14155238886.");
      const s = await getResolvedVoiceSecrets(uid);
      if (!s.twilioSid || !s.twilioToken) return bad("Connect Twilio first on the Voice & Calling page (one paste).");
      const url = `${appBaseUrl(req)}/api/channels/twilio?token=${encodeURIComponent(signChannelToken(uid, "twilio"))}`;
      return ok(k === "whatsapp"
        ? `Saved. In Twilio Console → Messaging → WhatsApp sandbox settings, set "When a message comes in" to: ${url} (POST). First send "join <your-code>" from your WhatsApp to ${from === WA_SANDBOX ? "+1 415 523 8886" : from}.`
        : `Saved. SMS replies work when your Twilio number's "A message comes in" webhook is: ${url} (POST). Connecting Twilio on the Voice page sets it automatically.`);
    }

    if (k === "slackbot") {
      const [bot, signing, owner] = unpack(t);
      if (!bot || !signing || !owner) return bad("Enter the bot token, signing secret and your Slack member ID.");
      const r = await http("https://slack.com/api/auth.test", { method: "POST", headers: { Authorization: `Bearer ${bot}` } });
      if (!r.json?.ok) return bad(`Slack rejected the bot token: ${r.json?.error || r.status}`);
      const url = `${appBaseUrl(req)}/api/channels/slack?token=${encodeURIComponent(signChannelToken(uid, "slack"))}`;
      return ok(`Saved. In your Slack app → Event Subscriptions, set the Request URL to: ${url} and subscribe to the bot event message.im.`);
    }

    if (k === "email") {
      const [key, from, to] = unpack(t);
      if (!key || !from || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to || "")) return bad("Enter the Resend key, the From address and your email.");
      const r = await http("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
      // A send-only (restricted) key is rejected by this check but is valid for sending.
      if (r.status === 401 && r.json?.name !== "restricted_api_key") return bad("Resend rejected this key.");
      return ok("Saved. Reports will be emailed to " + to);
    }

    if (k === "webhook") {
      const u = assertPublicUrl(unpack(t)[0]);
      const good = u.hostname === "hooks.slack.com" || u.hostname.endsWith("discord.com") || u.hostname.endsWith("discordapp.com");
      return good ? ok("webhook URL looks right (nothing was sent)") : bad("Use a Slack or Discord webhook URL.");
    }
    if (k === "identity") return ok("temporary inbox is created on first use");

    if (k.startsWith("mcp:")) {
      let cfg: { url?: string; auth?: string } = {};
      try { cfg = JSON.parse(t); } catch { return bad("Bad MCP settings."); }
      if (!cfg.url) return bad("MCP URL is missing.");
      try {
        const tools = await mcpList(cfg.url, cfg.auth);
        return ok(`${tools.length} tool${tools.length === 1 ? "" : "s"} found`);
      } catch (e) {
        if (e instanceof McpAuthError) return NextResponse.json({ ok: false, needsOAuth: true, resourceMetadata: e.resourceMetadata, error: "This service needs you to sign in." });
        throw e;
      }
    }
    if (k.startsWith("api:")) {
      let cfg: { baseUrl?: string; header?: string; value?: string } = {};
      try { cfg = JSON.parse(t); } catch { return bad("Bad API settings."); }
      const u = assertPublicUrl(cfg.baseUrl ?? "");
      const r = await http(u.toString(), { headers: cfg.header && cfg.value ? { [cfg.header]: cfg.value } : {} });
      return r.status < 500 ? ok(`reachable (HTTP ${r.status})`) : bad(`The server answered HTTP ${r.status}.`);
    }
    return bad("Unknown connector.");
  } catch (err) {
    return bad(err instanceof Error ? err.message : "Test failed.", requestStatus(err));
  }
}