import { http } from "./net";
import { eachItem, itemsOf, type Item } from "./batch";
import type { Def } from "./plugins";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const MAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function recipients(v: unknown): string {
  const list = (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,;]/)).map((x) => x.trim()).filter(Boolean);
  if (!list.length) throw new Error("`to` is required.");
  if (list.length > 20) throw new Error("At most 20 recipients per email.");
  for (const x of list) {
    const addr = /<([^<>]+)>\s*$/.exec(x)?.[1] ?? x;
    if (!MAIL.test(addr) || /[\r\n]/.test(x)) throw new Error(`Not a valid email address: ${x.slice(0, 60)}`);
  }
  return list.join(", ");
}

const encSubject = (v: unknown) => {
  const t = s(v, 200).replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, "utf8").toString("base64")}?=`;
};

function mime(m: { to: string; cc: string; subject: unknown; body: string; html: boolean }): string {
  const body64 = (Buffer.from(m.body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
  return [
    `To: ${m.to}`, ...(m.cc ? [`Cc: ${m.cc}`] : []), `Subject: ${encSubject(m.subject)}`, "MIME-Version: 1.0",
    `Content-Type: text/${m.html ? "html" : "plain"}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", body64,
  ].join("\r\n");
}

async function sendOne(access: string, it: Item): Promise<string> {
  const to = recipients(it.to);
  const cc = it.cc ? recipients(it.cc) : "";
  const body = s(it.body ?? it.text, 100_000);
  if (!body) throw new Error("body is empty.");
  const raw = Buffer.from(mime({ to, cc, subject: it.subject, body, html: it.html === true }), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await http("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw }),
  }, 20_000);
  if (r.status >= 400) {
    throw new Error(`Gmail ${r.status}: ${s(r.json?.error?.message ?? r.text, 160)}${r.status === 403 ? " (the Google connection needs the gmail.send permission: press Reconnect in Connectors)" : ""}`);
  }
  return to;
}

export const GMAIL_TOOLS: Def[] = [
  {
    name: "gmail.send", risk: "write", params: "to:string (one or several, comma separated), subject:string, body:string, cc?:string, html?:boolean",
    description: "Send ONE email from the owner's Gmail.",
    run: async (a, [access]) => `Email sent to ${await sendOne(access, a)}.`,
  },
  {
    name: "gmail.send_many", risk: "write", params: "items:[{to, subject, body, cc?}] (up to 30)",
    description: "Send SEVERAL separate emails from the owner's Gmail in ONE call. Every item has its own recipient, subject and body: personalise each one. The owner approves the whole batch once. Use this instead of calling gmail.send again and again.",
    run: async (a, [access]) => {
      const list = itemsOf(a.items, 30);
      const seen = new Set<string>();
      const unique = list.filter((it) => { const k = `${s(it.to).toLowerCase()}|${s(it.subject)}`; if (seen.has(k)) return false; seen.add(k); return true; });
      return eachItem(unique, async (it) => `sent to ${await sendOne(access, it)}`);
    },
  },
];
