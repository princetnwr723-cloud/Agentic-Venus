import { http } from "./net";
import { eachItem, itemsOf, type Item } from "./batch";
import type { Def } from "./plugins";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** The model sometimes calls a field "email" instead of "to", "text" instead of "body": accept the common names. */
const pick = (it: Item, ...keys: string[]): unknown => {
  for (const k of keys) { const v = it[k]; if (v !== undefined && v !== null && String(v).trim() !== "") return v; }
  return undefined;
};

function recipients(v: unknown, label = "to"): string {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(/[,;]/);
  const list = raw
    .map((x) => (x && typeof x === "object" ? String((x as { email?: unknown; address?: unknown }).email ?? (x as { address?: unknown }).address ?? "") : String(x)))
    .map((x) => x.trim()).filter(Boolean);
  if (!list.length) throw new Error(`\`${label}\` is required.`);
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
const b64u = (str: string) => Buffer.from(str, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (d: string) => Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
const strip = (h: string) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

type Mime = { to: string; cc?: string; bcc?: string; subject: unknown; body: string; html: boolean; inReplyTo?: string; references?: string };
function mime(m: Mime): string {
  const body64 = (Buffer.from(m.body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
  return [
    `To: ${m.to}`,
    ...(m.cc ? [`Cc: ${m.cc}`] : []),
    ...(m.bcc ? [`Bcc: ${m.bcc}`] : []),
    `Subject: ${encSubject(m.subject)}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${oneLine(m.inReplyTo)}`, `References: ${oneLine(m.references || m.inReplyTo)}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: text/${m.html ? "html" : "plain"}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64", "", body64,
  ].join("\r\n");
}

/** One Gmail API call with retries for rate limits / temporary server errors and readable errors. */
async function gcall(access: string, path: string, init: { method?: string; body?: unknown } = {}) {
  let last: { status: number; json: any; text: string } | null = null;
  for (let i = 0; i < 4; i++) {
    const r = await http(`${API}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${access}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }, 25_000).catch((e) => ({ status: 0, json: null, text: e instanceof Error ? e.message : "network error" }));
    if (r.status > 0 && r.status < 400) return r;
    last = r;
    if (![0, 429, 500, 502, 503, 504].includes(r.status)) break;
    await sleep(700 * 2 ** i + Math.random() * 300);
  }
  const r = last as { status: number; json: any; text: string };
  const msg = s(r.json?.error?.message ?? r.text, 200);
  if (r.status === 401) throw new Error("Google login expired: tell the owner to press Reconnect for Google in Connectors.");
  if (r.status === 403) throw new Error(`Gmail refused (403): ${msg}. Either the gmail permission is missing (Reconnect Google in Connectors) or the Gmail API is not enabled / daily limit reached.`);
  if (r.status === 429) throw new Error("Gmail rate limit reached even after retries: wait a minute and send the rest again.");
  throw new Error(`Gmail ${r.status || "network"}: ${msg}`);
}

async function sendOne(access: string, it: Item, extra: { threadId?: string; inReplyTo?: string; references?: string } = {}): Promise<string> {
  const to = recipients(pick(it, "to", "email", "recipient", "address", "recipients"));
  const cc = pick(it, "cc") ? recipients(pick(it, "cc"), "cc") : "";
  const bcc = pick(it, "bcc") ? recipients(pick(it, "bcc"), "bcc") : "";
  const body = s(pick(it, "body", "text", "message", "content", "html_body"), 100_000);
  if (!body) throw new Error(`body is empty for ${to}.`);
  const html = it.html === true || /<(p|br|div|html|table|a|b|strong|ul|ol|li|h[1-6])\b/i.test(body);
  const raw = b64u(mime({ to, cc, bcc, subject: pick(it, "subject", "title") ?? "(no subject)", body, html, ...extra }));
  const r = await gcall(access, "/messages/send", { method: "POST", body: { raw, ...(extra.threadId ? { threadId: extra.threadId } : {}) } });
  return `${to} (id ${r.json?.id ?? "?"})`;
}

const hdr = (msg: any, name: string): string =>
  String((msg?.payload?.headers ?? []).find((h: { name: string }) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "");

function bodyOf(p: any): { text: string; html: string; files: string[] } {
  const acc = { text: "", html: "", files: [] as string[] };
  const walk = (x: any) => {
    if (!x) return;
    if (x.filename) acc.files.push(x.filename);
    const data = x.body?.data;
    if (data && !x.filename && x.mimeType === "text/plain") acc.text += fromB64u(data);
    else if (data && !x.filename && x.mimeType === "text/html") acc.html += fromB64u(data);
    for (const c of x.parts ?? []) walk(c);
  };
  walk(p);
  return acc;
}

const metaQ = "format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Reply-To";

export const GMAIL_TOOLS: Def[] = [
  {
    name: "gmail.send", risk: "write", params: "to:string (one or several, comma separated), subject:string, body:string, cc?:string, bcc?:string, html?:boolean",
    description: "Send ONE email from the owner's Gmail. Retries by itself on temporary errors and returns the Gmail message id as proof.",
    run: async (a, [access]) => `Email sent to ${await sendOne(access, a)}.`,
  },
  {
    name: "gmail.send_many", risk: "write", params: "items:[{to, subject, body, cc?}] (up to 30)",
    description: "Send SEVERAL separate emails from the owner's Gmail in ONE call. Every item has its own recipient, subject and body: personalise each one. The owner approves the whole batch once. Reports every success and failure, so you can resend only the failed ones.",
    run: async (a, [access]) => {
      const list = itemsOf(a.items, 30);
      const seen = new Set<string>();
      const unique = list.filter((it) => {
        const k = `${s(pick(it, "to", "email", "recipient", "address")).toLowerCase()}|${s(pick(it, "subject", "title"))}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return eachItem(unique, async (it) => `sent to ${await sendOne(access, it)}`, 50_000, 250);
    },
  },
  {
    name: "gmail.reply", risk: "write", params: "message_id:string (from gmail.search), body:string, reply_all?:boolean, html?:boolean",
    description: "Reply inside the SAME conversation thread of an existing email (keeps the thread, sets Re: and the reply headers).",
    run: async (a, [access]) => {
      const id = s(a.message_id ?? a.id, 80);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("message_id is required (get it from gmail.search).");
      const orig = (await gcall(access, `/messages/${id}?${metaQ}`)).json;
      const me = String((await gcall(access, "/profile")).json?.emailAddress ?? "").toLowerCase();
      const replyTo = hdr(orig, "Reply-To") || hdr(orig, "From");
      const subj = hdr(orig, "Subject");
      const ccList = a.reply_all === true
        ? [hdr(orig, "To"), hdr(orig, "Cc")].join(",").split(",").map((x) => x.trim()).filter((x) => x && !x.toLowerCase().includes(me) && !replyTo.includes(x)).join(", ")
        : "";
      const mid = hdr(orig, "Message-ID");
      const to = await sendOne(access, { to: replyTo, cc: ccList || undefined, subject: /^re:/i.test(subj) ? subj : `Re: ${subj}`, body: a.body, html: a.html }, {
        threadId: orig.threadId, inReplyTo: mid, references: [hdr(orig, "References"), mid].filter(Boolean).join(" "),
      });
      return `Replied in the thread to ${to}.`;
    },
  },
  {
    name: "gmail.draft", risk: "write", params: "to:string, subject:string, body:string, cc?:string, html?:boolean",
    description: "Save an email as a DRAFT in the owner's Gmail (nothing is sent). Use it when the owner wants to review before sending.",
    run: async (a, [access]) => {
      const to = recipients(pick(a, "to", "email", "recipient"));
      const body = s(pick(a, "body", "text", "message"), 100_000);
      if (!body) throw new Error("body is empty.");
      const html = a.html === true || /<(p|br|div|a|b|ul|li)\b/i.test(body);
      const raw = b64u(mime({ to, cc: a.cc ? recipients(a.cc, "cc") : "", subject: a.subject ?? "(no subject)", body, html }));
      const r = await gcall(access, "/drafts", { method: "POST", body: { message: { raw } } });
      return `Draft saved for ${to} (draft id ${r.json?.id ?? "?"}). Open Gmail → Drafts to review and send.`;
    },
  },
  {
    name: "gmail.search", risk: "read", params: "q:string (Gmail search syntax, e.g. 'is:unread from:ravi newer_than:7d'), max?:number (default 10, max 15)",
    description: "Search the owner's Gmail. Returns id, sender, subject, date and a snippet for each match.",
    run: async (a, [access]) => {
      const max = Math.min(15, Math.max(1, Math.floor(Number(a.max)) || 10));
      const l = (await gcall(access, `/messages?q=${encodeURIComponent(s(a.q ?? a.query, 300))}&maxResults=${max}`)).json;
      const ids: string[] = (l?.messages ?? []).map((m: { id: string }) => m.id);
      if (!ids.length) return "No emails matched.";
      const rows: string[] = [];
      for (let i = 0; i < ids.length; i += 5) {
        const got = await Promise.all(ids.slice(i, i + 5).map((id) => gcall(access, `/messages/${id}?${metaQ}`).then((r) => r.json).catch(() => null)));
        for (const m of got) if (m) rows.push(`id=${m.id} · ${hdr(m, "From").slice(0, 60)} · "${hdr(m, "Subject").slice(0, 80)}" · ${hdr(m, "Date").slice(0, 31)}\n   ${s(m.snippet, 140)}`);
      }
      return rows.join("\n");
    },
  },
  {
    name: "gmail.read", risk: "read", params: "id:string (from gmail.search)",
    description: "Read ONE email completely: headers, text and attachment names.",
    run: async (a, [access]) => {
      const id = s(a.id ?? a.message_id, 80);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("id is required (get it from gmail.search).");
      const m = (await gcall(access, `/messages/${id}?format=full`)).json;
      const b = bodyOf(m.payload);
      const text = b.text.trim() || strip(b.html);
      return `From: ${hdr(m, "From")}\nTo: ${hdr(m, "To")}\nSubject: ${hdr(m, "Subject")}\nDate: ${hdr(m, "Date")}\nThread: ${m.threadId}\n${b.files.length ? `Attachments: ${b.files.join(", ")}\n` : ""}\n${text.slice(0, 6000)}`;
    },
  },
];