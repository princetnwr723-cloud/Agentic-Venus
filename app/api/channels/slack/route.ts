import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { findChat, runAfter, seen, sendSlack, verifyChannelToken } from "@/lib/channels";
import { handleInbound } from "@/lib/channel-agent";
import { resolveConnectorsSafe } from "@/lib/tools/connectors";
import { unpack } from "@/lib/tools/catalog";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ev = { type?: string; channel?: string; channel_type?: string; user?: string; text?: string; bot_id?: string; subtype?: string };

function validSig(secret: string, ts: string, raw: string, sig: string) {
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const exp = Buffer.from("v0=" + createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex"));
  const got = Buffer.from(sig);
  return exp.length === got.length && timingSafeEqual(exp, got);
}

export async function POST(req: Request) {
  const uid = verifyChannelToken(new URL(req.url).searchParams.get("token") || "", "slack");
  if (!uid) return new Response("Forbidden", { status: 403 });
  const raw = await req.text();
  const ts = req.headers.get("x-slack-request-timestamp") || "";
  const sig = req.headers.get("x-slack-signature") || "";

  // The signing secret is saved in the connector: try every Slack connector this user has.
  const chats = await getAdminDb().collection("users").doc(uid).collection("chats").get();
  let match: { chatId: string; cred: string[] } | null = null;
  for (const d of chats.docs) {
    const v = (d.data() as { connectors?: Record<string, string> }).connectors?.slackbot;
    if (!v) continue;
    const { connectors } = await resolveConnectorsSafe(uid, { slackbot: v });
    const cred = unpack(connectors.slackbot ?? "");
    if (cred[1] && validSig(cred[1], ts, raw, sig)) { match = { chatId: d.id, cred }; break; }
  }
  if (!match) return new Response("Forbidden", { status: 403 });

  let j: { type?: string; challenge?: string; event_id?: string; event?: Ev } = {};
  try { j = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  if (j.type === "url_verification") return NextResponse.json({ challenge: j.challenge });

  const ev = j.event;
  const [bot, , ownerId] = match.cred;
  // Allowlist: only the owner's Slack member ID, direct messages only, never bots.
  if (!ev || ev.type !== "message" || ev.channel_type !== "im" || ev.bot_id || ev.subtype || ev.user !== ownerId || !ev.text || !ev.channel) return NextResponse.json({ ok: true });
  if (j.event_id && (await seen(uid, `sl_${j.event_id}`))) return NextResponse.json({ ok: true });

  const channel = ev.channel;
  runAfter(handleInbound({ uid, chatId: match.chatId, channel: "slack", from: ownerId, text: ev.text, reply: (t) => sendSlack(bot, channel, t) }));
  return NextResponse.json({ ok: true });
}