import { NextResponse } from "next/server";
import { digits, findChat, runAfter, seen, sendTelegram, telegramSecret, verifyChannelToken } from "@/lib/channels";
import { handleInbound } from "@/lib/channel-agent";
import { http } from "@/lib/tools/net";

export const runtime = "nodejs";
export const maxDuration = 60;

type Msg = { message_id?: number; text?: string; chat?: { id?: number | string; type?: string }; from?: { is_bot?: boolean } };
type Update = {
  update_id?: number; message?: Msg; edited_message?: unknown;
  callback_query?: { id?: string; data?: string; from?: { is_bot?: boolean }; message?: Msg };
};
// the only button payloads the bot itself creates: ap:<payId> dn:<payId> an:<option> sk
const CB = /^(ap|dn|an|sk)(:[A-Za-z0-9_-]{1,60})?$/;

const tg = (bot: string, method: string, body: Record<string, unknown>) =>
  http(`https://api.telegram.org/bot${bot}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);

export async function POST(req: Request) {
  const uid = verifyChannelToken(new URL(req.url).searchParams.get("token") || "", "telegram");
  if (!uid) return new Response("Forbidden", { status: 403 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== telegramSecret(uid)) return new Response("Forbidden", { status: 403 });
  const u = (await req.json().catch(() => ({}))) as Update;

  const cq = u.callback_query;
  const m = cq ? cq.message : u.message;
  const text = cq ? (cq.data && CB.test(cq.data) ? `@cb ${cq.data}` : "") : u.message?.text?.trim();
  const tgChat = m?.chat?.id !== undefined ? String(m.chat.id) : "";
  const fromBot = cq ? cq.from?.is_bot : m?.from?.is_bot;
  if (!text || !tgChat || m?.chat?.type !== "private" || fromBot) return NextResponse.json({ ok: true });

  // Allowlist: only the chat id saved in the connector may command the agent.
  const owner = await findChat(uid, "telegram", (cred) => digits(cred[1]) === digits(tgChat));
  if (!owner) return NextResponse.json({ ok: true });
  const dedupe = cq ? `tgcb_${cq.id}` : u.update_id !== undefined ? `tg_${u.update_id}` : "";
  if (dedupe && (await seen(uid, dedupe))) return NextResponse.json({ ok: true });

  const bot = owner.cred[0];
  if (cq?.id) runAfter(tg(bot, "answerCallbackQuery", { callback_query_id: cq.id })); // stops the button's spinner
  const messageId = !cq ? m?.message_id : undefined;
  runAfter(handleInbound({
    uid, chatId: owner.chatId, channel: "telegram", from: tgChat, text,
    reply: (t) => sendTelegram(bot, tgChat, t),
    // PINs are deleted from the chat again (a bot may delete messages in a private chat)
    wipe: messageId ? async () => { await tg(bot, "deleteMessage", { chat_id: tgChat, message_id: messageId }); } : undefined,
  }));
  return NextResponse.json({ ok: true });
}