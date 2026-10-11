import { createHmac, timingSafeEqual } from "crypto";
import { waitUntil } from "@vercel/functions";
import { getAdminDb } from "@/lib/firebase-admin";
import { getResolvedVoiceSecrets } from "@/lib/voice-server";
import { resolveConnectorsSafe } from "@/lib/tools/connectors";
import { unpack } from "@/lib/tools/catalog";
import { assertPublicUrl, http } from "@/lib/tools/net";

export type ChannelKind = "telegram" | "twilio" | "slack";
export const WA_SANDBOX = "+14155238886";

const secret = () => {
  const s = process.env.ROUTINE_RUNNER_SECRET;
  if (!s || s.length < 32) throw new Error("ROUTINE_RUNNER_SECRET (32+ characters) is required.");
  return s;
};
const mac = (v: string) => createHmac("sha256", secret()).update(v).digest("base64url");

/** The webhook URL of a channel carries a signed token that says whose agent it belongs to. */
export function signChannelToken(uid: string, kind: ChannelKind) {
  const body = Buffer.from(JSON.stringify({ u: uid, k: kind })).toString("base64url");
  return `${body}.${mac("ch:" + body)}`;
}
export function verifyChannelToken(token: string, kind: ChannelKind): string | null {
  const [body, sig, extra] = String(token || "").split(".");
  if (!body || !sig || extra) return null;
  const a = Buffer.from(sig), b = Buffer.from(mac("ch:" + body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { u?: string; k?: string };
    return c.k === kind && typeof c.u === "string" ? c.u : null;
  } catch { return null; }
}
export const telegramSecret = (uid: string) => mac("tg:" + uid).slice(0, 48);

/** Keeps working after the HTTP answer was sent (Vercel waitUntil). */
export function runAfter(p: Promise<unknown>) {
  const w = p.catch(() => {});
  try { waitUntil(w); } catch { /* not on Vercel */ }
}

/** True when this message id was already handled (webhooks are retried). */
export async function seen(uid: string, key: string): Promise<boolean> {
  try {
    await getAdminDb().collection("users").doc(uid).collection("channelSeen").doc(key.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120))
      .create({ at: Date.now(), expireAt: new Date(Date.now() + 86_400_000) });
    return false;
  } catch { return true; }
}

export function chunk(text: string, n: number): string[] {
  const out: string[] = [];
  let t = text.trim();
  while (t.length > n) {
    let cut = t.lastIndexOf("\n", n);
    if (cut < n * 0.5) cut = n;
    out.push(t.slice(0, cut).trim());
    t = t.slice(cut).trim();
  }
  if (t) out.push(t);
  return out.length ? out : [""];
}

export const digits = (s: string) => String(s || "").replace(/\D/g, "");

/** The owner's chat that has this connector and passes `match` (the allowlist check: only the owner's own id/number). */
export async function findChat(uid: string, id: string, match: (cred: string[]) => boolean): Promise<{ chatId: string; cred: string[] } | null> {
  const snap = await getAdminDb().collection("users").doc(uid).collection("chats").get();
  for (const d of snap.docs) {
    const raw = (d.data() as { connectors?: Record<string, string> }).connectors?.[id];
    if (!raw) continue;
    const { connectors } = await resolveConnectorsSafe(uid, { [id]: raw });
    const v = connectors[id];
    if (!v) continue;
    const cred = unpack(v);
    if (match(cred)) return { chatId: d.id, cred };
  }
  return null;
}

/** Role and memory of one chat, as plain text for prompts. */
export async function brainText(uid: string, chatId: string): Promise<{ role: string; mem: string }> {
  const snap = await getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId).collection("brain").doc("memories").get();
  const items = ((snap.data() as { items?: Array<{ text: string; kind?: string }> } | undefined)?.items ?? []);
  return {
    role: items.find((i) => i.kind === "role")?.text ?? "",
    mem: items.filter((i) => i.kind !== "role").slice(-15).map((i) => `- ${i.text}`).join("\n"),
  };
}

// ---------------- senders ----------------
export async function sendTelegram(token: string, chat: string, text: string) {
  for (const part of chunk(text, 3800)) {
    const r = await http(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: part }) });
    if (r.status >= 400) throw new Error(`Telegram: ${String(r.json?.description ?? r.status)}`);
  }
}

export async function sendTwilioMessage(uid: string, to: string, from: string, text: string, whatsapp: boolean) {
  const s = await getResolvedVoiceSecrets(uid);
  if (!s.twilioSid || !s.twilioToken) throw new Error("Connect Twilio first (Voice & Calling page).");
  const fmt = (n: string) => (whatsapp ? `whatsapp:${n.replace(/^whatsapp:/, "")}` : n.replace(/^whatsapp:/, ""));
  for (const part of chunk(text, 1500)) {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(s.twilioSid)}/Messages.json`, {
      method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Basic ${Buffer.from(`${s.twilioSid}:${s.twilioToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: fmt(to), From: fmt(from), Body: part }),
    });
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))) as { message?: string };
      throw new Error(`Twilio: ${String(d.message ?? r.status)}`);
    }
  }
}

export async function sendSlack(bot: string, channel: string, text: string) {
  for (const part of chunk(text, 3500)) {
    const r = await http("https://slack.com/api/chat.postMessage", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bot}` }, body: JSON.stringify({ channel, text: part }) });
    if (!r.json?.ok) throw new Error(`Slack: ${String(r.json?.error ?? r.status)}`);
  }
}

export async function sendEmail(key: string, from: string, to: string, subject: string, text: string) {
  const r = await http("https://api.resend.com/emails", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ from, to: [to], subject: subject.slice(0, 200), text: text.slice(0, 40_000) }) });
  if (r.status >= 400) throw new Error(`Email: ${String(r.json?.message ?? r.status)}`);
}

/** Sends a message to the OWNER on every connected channel (or only the ones in `only`). */
export async function notifyOwner(uid: string, chatId: string, text: string, only?: string[]): Promise<{ sent: string[]; failed: string[] }> {
  const snap = await getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId).get();
  const stored = ((snap.data() as { connectors?: Record<string, string> } | undefined)?.connectors) ?? {};
  const { connectors: c } = await resolveConnectorsSafe(uid, stored);
  const want = (id: string) => Boolean(c[id]) && (!only?.length || only.includes(id));
  const tasks: Array<[string, () => Promise<void>]> = [];
  if (want("telegram")) { const [bot, chat] = unpack(c.telegram); tasks.push(["telegram", () => sendTelegram(bot, chat, text)]); }
  if (want("whatsapp")) { const [owner, from] = unpack(c.whatsapp); tasks.push(["whatsapp", () => sendTwilioMessage(uid, owner, from || WA_SANDBOX, text, true)]); }
  if (want("sms")) { const [owner, from] = unpack(c.sms); tasks.push(["sms", () => sendTwilioMessage(uid, owner, from, text, false)]); }
  if (want("slackbot")) { const [bot, , owner] = unpack(c.slackbot); tasks.push(["slackbot", () => sendSlack(bot, owner, text)]); }
  if (want("email")) { const [key, from, to] = unpack(c.email); tasks.push(["email", () => sendEmail(key, from, to, text.split("\n")[0].replace(/[*_#`]/g, "").slice(0, 120) || "Agent report", text)]); }
  if (want("webhook")) {
    tasks.push(["webhook", async () => {
      const u = assertPublicUrl(unpack(c.webhook)[0]);
      const discord = u.hostname.endsWith("discord.com") || u.hostname.endsWith("discordapp.com");
      if (!discord && u.hostname !== "hooks.slack.com") throw new Error("Only Slack or Discord webhooks.");
      const r = await http(u.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(discord ? { content: text.slice(0, 1900) } : { text: text.slice(0, 3000) }) });
      if (r.status >= 400) throw new Error(`webhook HTTP ${r.status}`);
    }]);
  }
  const sent: string[] = [], failed: string[] = [];
  for (const [id, fn] of tasks) {
    try { await fn(); sent.push(id); } catch (e) { failed.push(`${id}: ${e instanceof Error ? e.message : "failed"}`); }
  }
  return { sent, failed };
}