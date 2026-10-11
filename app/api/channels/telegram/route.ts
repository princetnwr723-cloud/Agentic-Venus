import { NextResponse } from "next/server";
import { digits, findChat, runAfter, seen, sendTelegram, telegramSecret, verifyChannelToken } from "@/lib/channels";
import { handleInbound } from "@/lib/channel-agent";

export const runtime = "nodejs";
export const maxDuration = 60;

type Update = { update_id?: number; message?: { text?: string; chat?: { id?: number | string; type?: string }; from?: { is_bot?: boolean } }; edited_message?: unknown };

export async function POST(req: Request) {
  const uid = verifyChannelToken(new URL(req.url).searchParams.get("token") || "", "telegram");
  if (!uid) return new Response("Forbidden", { status: 403 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== telegramSecret(uid)) return new Response("Forbidden", { status: 403 });
  const u = (await req.json().catch(() => ({}))) as Update;
  const text = u.message?.text?.trim();
  const tgChat = u.message?.chat?.id !== undefined ? String(u.message.chat.id) : "";
  if (!text || !tgChat || u.message?.chat?.type !== "private" || u.message?.from?.is_bot) return NextResponse.json({ ok: true });

  // Allowlist: only the chat id saved in the connector may command the agent.
  const owner = await findChat(uid, "telegram", (cred) => digits(cred[1]) === digits(tgChat));
  if (!owner) return NextResponse.json({ ok: true });
  if (u.update_id !== undefined && (await seen(uid, `tg_${u.update_id}`))) return NextResponse.json({ ok: true });

  const bot = owner.cred[0];
  runAfter(handleInbound({ uid, chatId: owner.chatId, channel: "telegram", from: tgChat, text, reply: (t) => sendTelegram(bot, tgChat, t) }));
  return NextResponse.json({ ok: true });
}