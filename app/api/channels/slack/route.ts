import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { findChat, runAfter, seen, sendSlack, verifyChannelToken } from "@/lib/channels";
import { handleInbound } from "@/lib/channel-agent";
import { resolveConnectorsSafe } from "@/lib/tools/connectors";
import { unpack } from "@/lib/tools/catalog";
import { actorFromSlack, parseLinkCommand, stripMention } from "@/lib/orgs-core";
import { consumeLinkCode, orgForChat } from "@/lib/orgs-server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ev = { type?: string; thread_ts?: string; channel?: string; channel_type?: string; user?: string; text?: string; bot_id?: string; subtype?: string };

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
  if (!ev || ev.bot_id || ev.subtype || !ev.text || !ev.channel || !ev.user) return NextResponse.json({ ok: true });
  const isDm = ev.type === "message" && ev.channel_type === "im";
  const isMention = ev.type === "app_mention";
  if (!isDm && !isMention) return NextResponse.json({ ok: true });

  // TEAM MODE: when this agent is the shared agent of a workspace, every linked member is served with THEIR OWN identity
  // (own conversation, own pending approvals, own role). Without a workspace only the owner is served, direct messages only, as before.
  const org = await orgForChat(uid, match.chatId).catch(() => null);
  if (!org && (!isDm || ev.user !== ownerId)) return NextResponse.json({ ok: true });
  if (j.event_id && (await seen(uid, `sl_${j.event_id}`))) return NextResponse.json({ ok: true });

  const channel = ev.channel;
  const say = (t: string) => sendSlack(bot, channel, t);
  const text = stripMention(ev.text);
  if (!text) return NextResponse.json({ ok: true });

  let actor: { uid: string; name: string; role: "owner" | "admin" | "member" | "viewer"; orgName: string } | undefined;
  if (org) {
    const known = actorFromSlack(org, ev.user, ownerId);
    if (!known) {
      const code = isDm ? parseLinkCommand(text) : null;
      if (code) {
        const done = await consumeLinkCode(code, ev.user, org.id).catch(() => null);
        runAfter(say(done ? `✅ Linked: you are ${done.name} in "${org.name}". Ask me anything.` : "That link code is wrong, expired or already used. Ask for a new one in the dashboard (Workspace → Link Slack)."));
      } else {
        runAfter(say(`I only work for members of "${org.name}". Open the dashboard → Workspace → "Link Slack", then send me: link <code>`));
      }
      return NextResponse.json({ ok: true });
    }
    actor = { ...known, orgName: org.name };
  }
  const from = org && actor && actor.uid !== org.ownerUid ? ev.user : ownerId; // the owner keeps their old conversation key
  runAfter(handleInbound({ uid, chatId: match.chatId, channel: "slack", from, text, reply: say, ...(actor ? { actor } : {}) }));
  return NextResponse.json({ ok: true });
}
