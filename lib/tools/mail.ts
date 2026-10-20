// Server-only. ONE mail tool for every situation: it picks Gmail, Outlook, SMTP (app password) or Resend by itself,
// falls back to the next one when a sender fails, never sends the same mail twice in a row, VERIFIES the send and reports every result honestly.
import { createHash } from "crypto";
import type { Def } from "./plugins";
import { assertPublicHost, http } from "./net";
import { unpack } from "./catalog";
import { OAUTH_PROVIDERS } from "./oauth-catalog";
import { oauthAccess } from "./oauth-token";
import { sendOne as gmailSend } from "./gmail";
import { resolveConnectorsSafe } from "./connectors";
import { getAdminDb } from "@/lib/firebase-admin";
import type { ToolCtx } from "./types";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const AUTH = /\b(401|403|535|534|invalid_grant|unauthori[sz]ed|forbidden|expired|reconnect|EAUTH|permission|scope|invalid login)\b/i;
const RATE = /\b(429|rate|quota|too many|daily limit|try again later|450|451|452)\b/i;
const DUP_WINDOW_MS = 15 * 60_000; // identical mail to the same person within 15 minutes is treated as an accidental repeat

class InputError extends Error {}

type Item = Record<string, unknown>;
type Msg = { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; html: boolean };
type Prov = { id: string; label: string; send(m: Msg): Promise<string>; close?(): void };

const pick = (it: Item, ...keys: string[]): unknown => {
  for (const k of keys) { const v = it[k]; if (v !== undefined && v !== null && String(v).trim() !== "") return v; }
  return undefined;
};

function parseAddr(x: string): { name: string; email: string } {
  const m = /^(.*?)<([^<>]+)>\s*$/.exec(x.trim());
  return { email: (m ? m[2] : x).trim(), name: m ? m[1].trim().replace(/^["']|["']$/g, "") : "" };
}

function addrList(v: unknown, label: string, required: boolean): string[] {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(/[,;]/);
  const list = raw
    .map((x) => (x && typeof x === "object" ? s((x as { email?: unknown; address?: unknown }).email ?? (x as { address?: unknown }).address, 200) : s(x, 200)))
    .filter(Boolean);
  if (!list.length) { if (required) throw new InputError(`\`${label}\` is required.`); return []; }
  if (list.length > 20) throw new InputError("At most 20 recipients per email.");
  for (const x of list) if (/[\r\n]/.test(x) || !EMAIL.test(parseAddr(x).email)) throw new InputError(`Not a valid email address: ${x.slice(0, 60)}`);
  return list;
}

const fill = (t: string, vars: Item) => t.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k: string) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
const strip = (h: string) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

type Defaults = { subject?: string; body?: string; html?: boolean; vars?: Item };

function buildMsg(it: Item, d: Defaults = {}): Msg {
  const vars: Item = { ...(d.vars ?? {}), ...it };
  const subject = fill(s(pick(it, "subject", "title") ?? d.subject ?? "", 300), vars).replace(/[\r\n]+/g, " ").trim();
  const body = fill(s(pick(it, "body", "text", "message", "content") ?? d.body ?? "", 100_000), vars);
  if (/\{\{[^}]*\}\}/.test(subject + "\n" + body)) throw new InputError("Unfilled {{placeholder}} in subject or body: add that field to the item (nothing was sent).");
  if (!body) throw new InputError("body is empty.");
  return {
    to: addrList(pick(it, "to", "email", "recipient", "address", "recipients"), "to", true),
    cc: addrList(it.cc, "cc", false), bcc: addrList(it.bcc, "bcc", false),
    subject: subject || "(no subject)", body,
    html: it.html === true || d.html === true || /<(p|br|div|html|table|a|b|strong|ul|ol|li|h[1-6])\b/i.test(body),
  };
}

// ---------------- senders ----------------
async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  let last = { status: 0, json: null as any, text: "network error" };
  for (let i = 0; i < 3; i++) {
    last = await http(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }, 25_000)
      .catch((e) => ({ status: 0, json: null as any, text: e instanceof Error ? e.message : "network error" }));
    if (last.status > 0 && last.status < 400) return last;
    if (![0, 429, 500, 502, 503, 504].includes(last.status)) break;
    await sleep(600 * 2 ** i);
  }
  return last;
}

function smtpProv(raw: string): Prov | null {
  const [h, p, u, pw, f] = unpack(raw);
  const host = s(h, 200), user = s(u, 200), pass = String(pw ?? ""), port = Number(p) || 465;
  if (!host || !user || !pass) return null;
  const from = s(f, 200) || user;
  let tr: any = null;
  return {
    id: "smtp", label: `SMTP (${user})`,
    async send(m) {
      if (!tr) {
        await assertPublicHost(host);
        const nm: any = await import("nodemailer");
        const create = nm.createTransport ?? nm.default?.createTransport;
        tr = create({ host, port, secure: port === 465, requireTLS: port === 587, auth: { user, pass }, connectionTimeout: 12_000, greetingTimeout: 12_000, socketTimeout: 25_000 });
      }
      try {
        const info = await tr.sendMail({
          from, to: m.to.join(", "), ...(m.cc.length ? { cc: m.cc.join(", ") } : {}), ...(m.bcc.length ? { bcc: m.bcc.join(", ") } : {}),
          subject: m.subject, ...(m.html ? { html: m.body, text: strip(m.body) } : { text: m.body }),
        });
        const accepted: string[] = (info?.accepted ?? []).map((x: unknown) => String(x));
        const rejected: string[] = (info?.rejected ?? []).map((x: unknown) => String(x));
        if (!accepted.length) throw new Error(`the SMTP server accepted nobody${rejected.length ? " (rejected: " + rejected.join(", ") + ")" : ""}`);
        return `${accepted.join(", ")} (id ${s(info?.messageId, 60)})${rejected.length ? ` — rejected: ${rejected.join(", ")}` : ""}`;
      } catch (e: any) {
        throw new Error(`SMTP${e?.code ? " " + e.code : ""}: ${s(e?.message, 160)}${e?.code === "EAUTH" ? " (wrong username or app password)" : ""}`);
      }
    },
    close() { try { tr?.close?.(); } catch { /* ignore */ } },
  };
}

async function loadProviders(ctx: ToolCtx): Promise<{ provs: Prov[]; notes: string[]; off: string[] }> {
  const snap = await getAdminDb().collection("users").doc(ctx.uid).collection("chats").doc(ctx.chatId).get();
  const d = (snap.data() ?? {}) as { connectors?: Record<string, unknown>; connectorStatus?: Record<string, { account?: string }> };
  const stored: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.connectors ?? {})) if (typeof v === "string") stored[k] = v;
  const { connectors: c, broken } = await resolveConnectorsSafe(ctx.uid, stored);
  const provs: Prov[] = [];
  const notes: string[] = [];
  const off: string[] = [];

  if (c["oauth:google"]) {
    const gp = OAUTH_PROVIDERS.find((x) => x.id === "google")!;
    const acct = d.connectorStatus?.google?.account;
    let access = "";
    provs.push({
      id: "gmail", label: `Gmail${acct ? ` (${acct})` : ""}`,
      async send(m) {
        access ||= await oauthAccess(gp, c["oauth:google"], ctx);
        const res = await gmailSend(access, { to: m.to.join(", "), cc: m.cc.join(", ") || undefined, bcc: m.bcc.join(", ") || undefined, subject: m.subject, body: m.body, html: m.html });
        // PROOF: Gmail must give a message id, and that message must really sit in the Sent folder.
        const id = /\(id ([A-Za-z0-9_-]+)\)/.exec(res)?.[1];
        if (!id) throw new Error("Gmail returned no message id, so the email is NOT confirmed as sent");
        const v = await http(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=minimal`, { headers: { Authorization: `Bearer ${access}` } }, 15_000).catch(() => null);
        const labels: string[] = Array.isArray(v?.json?.labelIds) ? v!.json.labelIds : [];
        if (v && v.status < 400 && !labels.includes("SENT")) throw new Error("Gmail accepted the message but it is not in the Sent folder, so it is NOT confirmed as sent");
        return labels.includes("SENT") ? `${res} ✓ confirmed in Gmail Sent` : res;
      },
    });
  } else { off.push("Gmail"); if (broken.includes("oauth:google")) notes.push("Google login can't be read: press Reconnect for Google in Connectors."); }

  if (c["oauth:microsoft"]) {
    const mp = OAUTH_PROVIDERS.find((x) => x.id === "microsoft")!;
    const acct = d.connectorStatus?.microsoft?.account;
    let access = "";
    const rec = (l: string[]) => l.map((x) => { const a = parseAddr(x); return { emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) } }; });
    provs.push({
      id: "outlook", label: `Outlook${acct ? ` (${acct})` : ""}`,
      async send(m) {
        access ||= await oauthAccess(mp, c["oauth:microsoft"], ctx);
        const r = await postJson("https://graph.microsoft.com/v1.0/me/sendMail", { Authorization: `Bearer ${access}` }, {
          message: { subject: m.subject, body: { contentType: m.html ? "HTML" : "Text", content: m.body }, toRecipients: rec(m.to), ccRecipients: rec(m.cc), bccRecipients: rec(m.bcc) },
          saveToSentItems: true,
        });
        if (r.status >= 400 || r.status === 0) throw new Error(`Outlook ${r.status || "network"}: ${s(r.json?.error?.message ?? r.text, 160)}`);
        return `${m.to.join(", ")} (Outlook accepted it, HTTP ${r.status})`;
      },
    });
  } else { off.push("Outlook"); if (broken.includes("oauth:microsoft")) notes.push("Microsoft login can't be read: press Reconnect."); }

  if (c.smtp) {
    const sp = smtpProv(c.smtp);
    if (sp) provs.push(sp); else notes.push("SMTP settings are incomplete: re-enter host, port, username, app password and From in Connectors.");
  } else { off.push("SMTP"); if (broken.includes("smtp")) notes.push("SMTP login can't be read: connect it again."); }

  if (c.email) {
    const [key, from] = unpack(c.email);
    if (key && from) {
      provs.push({
        id: "resend", label: "Resend",
        async send(m) {
          const r = await postJson("https://api.resend.com/emails", { Authorization: `Bearer ${key}` }, {
            from, to: m.to, ...(m.cc.length ? { cc: m.cc } : {}), ...(m.bcc.length ? { bcc: m.bcc } : {}), subject: m.subject, ...(m.html ? { html: m.body } : { text: m.body }),
          });
          if (r.status >= 400 || r.status === 0) throw new Error(`Resend ${r.status || "network"}: ${s(r.json?.message ?? r.text, 160)}${r.status === 403 ? " (with onboarding@resend.dev it can only email your own address; verify a domain)" : ""}`);
          if (!r.json?.id) throw new Error("Resend returned no email id, so the email is NOT confirmed as sent");
          return `${m.to.join(", ")} (id ${s(r.json.id, 40)})`;
        },
      });
    }
  } else off.push("Resend");
  return { provs, notes, off };
}

const NOTHING =
  "No email sender is connected for this chat. Tell the owner the quickest fix: Connectors → \"Email (SMTP / App password)\" " +
  "(Gmail: create an app password at myaccount.google.com/apppasswords, host smtp.gmail.com, port 465). Other options: Connectors → Google / Microsoft (OAuth), or a Resend key.";

// ---------------- never send twice by accident ----------------
async function claim(uid: string, m: Msg): Promise<{ dup: boolean; release: () => Promise<void> }> {
  const key = createHash("sha1").update(`${m.to.join(",").toLowerCase()}|${m.subject}|${m.body}`).digest("hex").slice(0, 40);
  const ref = getAdminDb().collection("users").doc(uid).collection("mailSent").doc(key);
  const rec = { at: Date.now(), to: m.to.join(", ").slice(0, 200), subject: m.subject.slice(0, 120) };
  try { await ref.create(rec); }
  catch {
    const old = (await ref.get().catch(() => null))?.data() as { at?: number } | undefined;
    if (old?.at && Date.now() - old.at < DUP_WINDOW_MS) return { dup: true, release: async () => {} };
    await ref.set(rec).catch(() => {});
  }
  return { dup: false, release: async () => { await ref.delete().catch(() => {}); } };
}

type Outcome = { state: "sent" | "dup" | "failed"; text: string; via?: string; bad?: boolean };

async function deliver(m: Msg, ctx: ToolCtx, provs: Prov[], dead: Set<string>, force: boolean): Promise<Outcome> {
  const lock = force ? { dup: false, release: async () => {} } : await claim(ctx.uid, m);
  if (lock.dup) return { state: "dup", text: "NOT SENT AGAIN: the same mail to the same person was already sent in the last 15 minutes (skipped; use force:true to send again)" };
  const errs: string[] = [];
  for (const p of provs) {
    if (dead.has(p.id)) continue;
    try {
      const text = await p.send(m);
      // receipt for the owner: what was REALLY sent, to whom, through which sender
      void getAdminDb().collection("users").doc(ctx.uid).collection("mailLog")
        .add({ at: Date.now(), chatId: ctx.chatId, to: m.to.join(", ").slice(0, 200), subject: m.subject.slice(0, 120), via: p.label, receipt: text.slice(0, 160) })
        .catch(() => {});
      return { state: "sent", text, via: p.label };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "failed";
      errs.push(`${p.label}: ${msg.slice(0, 140)}`);
      if (AUTH.test(msg) || RATE.test(msg)) dead.add(p.id);
    }
  }
  await lock.release();
  return { state: "failed", text: errs.length ? errs.join(" | ") : "no working sender left for this call", bad: false };
}

const order = (provs: Prov[], via: string): Prov[] => {
  const v = via.toLowerCase();
  if (!v) return provs;
  const first = provs.filter((p) => p.id === v || p.label.toLowerCase().startsWith(v));
  return [...first, ...provs.filter((p) => !first.includes(p))];
};

// ---------------- tools ----------------
export const MAIL_TOOLS: Def[] = [
  {
    name: "mail.status", risk: "read", params: "",
    description: "Which email senders are connected for this chat (Gmail, Outlook, SMTP, Resend) and which problems exist. Call it when unsure before a big send.",
    run: async (_a, _c, ctx) => {
      if (!ctx) throw new Error("Only available from a chat.");
      const { provs, notes, off } = await loadProviders(ctx);
      provs.forEach((p) => p.close?.());
      if (!provs.length) return `MAIL NOT READY.\n${NOTHING}${notes.length ? "\nProblems: " + notes.join(" ") : ""}`;
      return `MAIL READY. Senders in order of use: ${provs.map((p) => p.label).join(" → ")}. If one fails the next is used automatically.${off.length ? `\nNot connected: ${off.join(", ")}.` : ""}${notes.length ? `\nProblems: ${notes.join(" ")}` : ""}`;
    },
  },
  {
    name: "mail.history", risk: "read", params: "limit?:number (default 10, max 30)",
    description: "PROOF of work: the emails this agent really sent (time, recipient, subject, which sender, receipt). Use it when the owner asks whether an email was really sent.",
    run: async (a, _c, ctx) => {
      if (!ctx) throw new Error("Only available from a chat.");
      const n = Math.min(30, Math.max(1, Math.floor(Number(a.limit)) || 10));
      const snap = await getAdminDb().collection("users").doc(ctx.uid).collection("mailLog").orderBy("at", "desc").limit(80).get();
      const rows = snap.docs.map((d) => d.data() as { at: number; chatId?: string; to: string; subject: string; via: string; receipt: string })
        .filter((x) => x.chatId === ctx.chatId).slice(0, n);
      return rows.length
        ? rows.map((x) => `${new Date(x.at).toISOString().slice(0, 16).replace("T", " ")} UTC · to ${x.to} · "${x.subject}" · via ${x.via} · ${x.receipt}`).join("\n")
        : "No email has been sent by this agent yet (nothing in the send log).";
    },
  },
  {
    name: "mail.send", risk: "write",
    params: "to:string (one or several, comma separated), subject:string, body:string, cc?:string, bcc?:string, html?:boolean, via?:gmail|outlook|smtp|resend, force?:boolean",
    description: "Send ONE email. Picks the connected sender by itself (Gmail, Outlook, SMTP, Resend), falls back to the next when one fails, VERIFIES the send and returns a receipt. This is the tool for ALL single emails. Only say the email was sent when the result starts with EMAIL SENT.",
    run: async (a, _c, ctx) => {
      if (!ctx) throw new Error("Only available from a chat.");
      const m = buildMsg(a);
      const { provs, notes } = await loadProviders(ctx);
      if (!provs.length) throw new Error(`EMAIL NOT SENT. ${NOTHING}${notes.length ? " " + notes.join(" ") : ""}`);
      try {
        const r = await deliver(m, ctx, order(provs, s(a.via, 12)), new Set(), a.force === true);
        if (r.state === "sent") return `EMAIL SENT to ${r.text} via ${r.via}.`;
        if (r.state === "dup") throw new Error(`EMAIL NOT SENT. ${r.text}`);
        throw new Error(`EMAIL NOT SENT. Every sender failed: ${r.text}${notes.length ? " · " + notes.join(" ") : ""}. Fix the cause (see messages) or ask the owner to reconnect/add a sender.`);
      } finally { provs.forEach((p) => p.close?.()); }
    },
  },
  {
    name: "mail.send_many", risk: "write",
    params: "items:[{to, subject?, body?, cc?, name?, ...any fields}] (up to 200), subject?:string and body?:string as TEMPLATES with {{name}} placeholders filled from each item, html?:boolean, vars?:object, via?:gmail|outlook|smtp|resend, force?:boolean",
    description:
      "Send MANY emails in ONE call (up to 200). Either write subject/body per item, or give ONE template (subject, body with {{name}}, {{company}} ...) and per-person fields in each item. " +
      "Senders are chosen and switched automatically, accidental repeats are skipped, every send is verified, and the report says exactly which succeeded, failed or were not reached. " +
      "If the report lists ✗ or … items, call it again with ONLY those items. If nothing was sent the call fails with NOTHING WAS SENT.",
    run: async (a, _c, ctx) => {
      if (!ctx) throw new Error("Only available from a chat.");
      const list = (Array.isArray(a.items) ? a.items : []).filter((x): x is Item => Boolean(x) && typeof x === "object" && !Array.isArray(x));
      if (!list.length) throw new Error("`items` must be a non-empty array of {to, ...}.");
      if (list.length > 200) throw new Error("At most 200 emails per call: split the list and call again for the rest.");
      const defaults: Defaults = { subject: s(a.subject, 300) || undefined, body: s(a.body, 100_000) || undefined, html: a.html === true, vars: a.vars && typeof a.vars === "object" ? (a.vars as Item) : undefined };
      const { provs: all, notes } = await loadProviders(ctx);
      if (!all.length) throw new Error(`NOTHING WAS SENT. ${NOTHING}${notes.length ? " " + notes.join(" ") : ""}`);
      const provs = order(all, s(a.via, 12));
      const force = a.force === true;
      const dead = new Set<string>();
      const t0 = Date.now();
      const BUDGET = 44_000;
      type Res = { state: "sent" | "dup" | "failed" | "pending"; to: string; text: string; via?: string; bad?: boolean };
      const res: Res[] = list.map((it) => ({ state: "pending", to: s(pick(it, "to", "email", "recipient", "address"), 80) || "?", text: "" }));
      let next = 0;
      const one = async (i: number) => {
        let m: Msg;
        try { m = buildMsg(list[i], defaults); }
        catch (e) { res[i] = { ...res[i], state: "failed", text: e instanceof Error ? e.message : "bad item", bad: true }; return; }
        const r = await deliver(m, ctx, provs, dead, force);
        res[i] = { state: r.state, to: m.to.join(", ").slice(0, 80), text: r.text, via: r.via };
      };
      try {
        await Promise.all(Array.from({ length: 3 }, async () => {
          for (;;) {
            const i = next++;
            if (i >= list.length) return;
            if (Date.now() - t0 > BUDGET) continue; // stays "pending": reported below
            await one(i);
            await sleep(120);
          }
        }));
        // one more pass for temporary failures while time is left
        for (let i = 0; i < res.length && Date.now() - t0 < BUDGET + 6000; i++) {
          if (res[i].state === "failed" && !res[i].bad && dead.size < provs.length) await one(i);
        }
      } finally { all.forEach((p) => p.close?.()); }

      const n = (st: string) => res.filter((r) => r.state === st).length;
      const via = new Map<string, number>();
      res.filter((r) => r.state === "sent").forEach((r) => via.set(r.via ?? "?", (via.get(r.via ?? "?") ?? 0) + 1));
      const lines: string[] = [];
      let shownOk = 0;
      res.forEach((r, i) => {
        if (r.state === "sent") { if (shownOk++ < 10) lines.push(`✓ #${i + 1} ${r.to} via ${r.via}`); }
        else if (r.state === "dup") lines.push(`↺ #${i + 1} ${r.to}: ${r.text}`);
        else if (r.state === "failed") lines.push(`✗ #${i + 1} ${r.to}: ${r.text.slice(0, 220)}`);
        else lines.push(`… #${i + 1} ${r.to}: not attempted (out of time)`);
      });
      if (n("sent") > 10) lines.splice(Math.min(10, lines.length), 0, `(… ${n("sent") - 10} more ✓ not listed)`);
      const todo = res.map((r, i) => (r.state === "failed" || r.state === "pending" ? i + 1 : 0)).filter(Boolean);
      const report = [
        `MAIL REPORT: ${n("sent")} sent, ${n("dup")} skipped (accidental repeat), ${n("failed")} failed, ${n("pending")} not attempted, of ${list.length}.`,
        via.size ? `Sent via: ${Array.from(via.entries()).map(([k, v]) => `${k} ×${v}`).join(", ")}.` : "",
        ...lines,
        todo.length
          ? `\nNOT DONE: items ${todo.slice(0, 60).map((x) => "#" + x).join(", ")}. Call mail.send_many again with ONLY these items (same template). Do not resend the ✓ ones. If a ✗ reason says the sender login/permission is bad, tell the owner exactly what to reconnect.`
          : "\nALL DONE: every email in this call was sent or already sent earlier.",
      ].filter(Boolean).join("\n");
      // nothing went out: this is a FAILURE, never a success
      if (n("sent") === 0 && n("dup") === 0) throw new Error(`NOTHING WAS SENT. ${report}${notes.length ? "\n" + notes.join(" ") : ""}`);
      return report;
    },
  },
];