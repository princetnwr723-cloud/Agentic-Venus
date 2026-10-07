import { randomBytes } from "crypto";
import { cut, http } from "./net";
import type { Def } from "./plugins";

// Free temporary mailboxes. Four providers with different hosting: if the server's network is blocked by one, the next is tried.
// Credential format: address::secret::provider   (provider: tm | gw | gm | 1s). Older credentials without a provider mean tm.
const HDR: Record<string, string> = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const members = (j: any): any[] => j?.["hydra:member"] ?? j?.member ?? (Array.isArray(j) ? j : []);
const strip = (s: string) => s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const snip = (r: { status: number; text: string }) => `HTTP ${r.status}${r.text ? " " + r.text.replace(/\s+/g, " ").slice(0, 90) : ""}`;

export type MailRow = { id: string; from: string; domain: string; subject: string; at: string; intro: string };
export type MailFull = MailRow & { body: string; codes: string[]; links: string[] };

export const domainOf = (addr: string) => (addr.split("@")[1] ?? "").toLowerCase().split(".").slice(-2).join(".") || "unknown";
const mk = (id: unknown, from: string, subject: string, at: string, intro: string): MailRow => ({ id: String(id), from, domain: domainOf(from), subject, at, intro: intro.slice(0, 160) });
export const inboxPair = (cred: string[]): [string, string] | null => (cred[0] && cred[0] !== "on" && cred[1] ? [cred[0], cred[1]] : null);

type Prov = {
  key: string;
  create(): Promise<{ address: string; secret: string }>;
  list(address: string, secret: string): Promise<MailRow[]>;
  read(address: string, secret: string, id: string): Promise<{ row: MailRow; body: string }>;
};

// mail.tm and mail.gw share one API
function hydra(key: string, base: string): Prov {
  const login = async (a: string, secret: string) => {
    const r = await http(`${base}/token`, { method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify({ address: a, password: secret }) });
    if (r.status >= 400 || !r.json?.token) throw new Error(`could not open the inbox (${snip(r)})`);
    return { ...HDR, Authorization: `Bearer ${r.json.token}` };
  };
  return {
    key,
    async create() {
      const d = await http(`${base}/domains?page=1`, { headers: HDR });
      const domain = members(d.json).find((x: any) => x?.domain && x?.isActive !== false)?.domain;
      if (!domain) throw new Error(`no domain (${snip(d)})`);
      const address = `agent.${randomBytes(5).toString("hex")}@${domain}`;
      const secret = randomBytes(18).toString("base64url");
      const c = await http(`${base}/accounts`, { method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify({ address, password: secret }) });
      if (c.status >= 400) throw new Error(`account refused (${snip(c)})`);
      return { address, secret };
    },
    async list(a, secret) {
      const h = await login(a, secret);
      const r = await http(`${base}/messages?page=1`, { headers: h });
      if (r.status >= 400) throw new Error(`inbox unavailable (${snip(r)})`);
      return members(r.json).map((m: any) => mk(m.id, m.from?.address ?? "?", m.subject ?? "", m.createdAt ?? "", String(m.intro ?? "")));
    },
    async read(a, secret, id) {
      const h = await login(a, secret);
      const r = await http(`${base}/messages/${id}`, { headers: h });
      if (r.status >= 400 || !r.json) throw new Error("message not found");
      const j = r.json;
      const body = String(j.text || strip(Array.isArray(j.html) ? j.html.join(" ") : String(j.html ?? "")));
      return { row: mk(j.id, j.from?.address ?? "?", j.subject ?? "", j.createdAt ?? "", String(j.intro ?? "")), body };
    },
  };
}

// Guerrilla Mail (session token, inbox lives about an hour)
const GM = "https://api.guerrillamail.com/ajax.php";
const iso = (t: unknown) => (t ? new Date(Number(t) * 1000).toISOString() : "");
const guerrilla: Prov = {
  key: "gm",
  async create() {
    const r = await http(`${GM}?f=get_email_address&lang=en&ip=127.0.0.1&agent=agenticvenus`, { headers: HDR });
    if (!r.json?.email_addr || !r.json?.sid_token) throw new Error(`no address (${snip(r)})`);
    return { address: String(r.json.email_addr), secret: String(r.json.sid_token) };
  },
  async list(_a, secret) {
    const r = await http(`${GM}?f=check_email&seq=0&sid_token=${encodeURIComponent(secret)}`, { headers: HDR });
    if (r.status >= 400 || !Array.isArray(r.json?.list)) throw new Error(`inbox unavailable (${snip(r)})`);
    return r.json.list.map((m: any) => mk(m.mail_id, m.mail_from ?? "?", m.mail_subject ?? "", iso(m.mail_timestamp), String(m.mail_excerpt ?? "")));
  },
  async read(_a, secret, id) {
    const r = await http(`${GM}?f=fetch_email&email_id=${encodeURIComponent(id)}&sid_token=${encodeURIComponent(secret)}`, { headers: HDR });
    const j = r.json;
    if (!j?.mail_id) throw new Error("message not found");
    return { row: mk(j.mail_id, j.mail_from ?? "?", j.mail_subject ?? "", iso(j.mail_timestamp), ""), body: strip(String(j.mail_body ?? "")) };
  },
};

// 1secmail (address only, no password)
const OS = "https://www.1secmail.com/api/v1/";
const parts = (a: string) => { const [l, d] = a.split("@"); return `login=${encodeURIComponent(l)}&domain=${encodeURIComponent(d ?? "")}`; };
const onesec: Prov = {
  key: "1s",
  async create() {
    const r = await http(`${OS}?action=genRandomMailbox&count=1`, { headers: HDR });
    const a = Array.isArray(r.json) ? String(r.json[0] ?? "") : "";
    if (!/^[^@\s]+@[^@\s]+$/.test(a)) throw new Error(`no address (${snip(r)})`);
    return { address: a, secret: "x" };
  },
  async list(a) {
    const r = await http(`${OS}?action=getMessages&${parts(a)}`, { headers: HDR });
    if (!Array.isArray(r.json)) throw new Error(`inbox unavailable (${snip(r)})`);
    return r.json.map((m: any) => mk(m.id, m.from ?? "?", m.subject ?? "", m.date ? String(m.date).replace(" ", "T") + "Z" : "", ""));
  },
  async read(a, _s, id) {
    const r = await http(`${OS}?action=readMessage&${parts(a)}&id=${encodeURIComponent(id)}`, { headers: HDR });
    const j = r.json;
    if (!j?.id) throw new Error("message not found");
    return { row: mk(j.id, j.from ?? "?", j.subject ?? "", j.date ? String(j.date).replace(" ", "T") + "Z" : "", ""), body: String(j.textBody || strip(String(j.htmlBody || j.body || ""))) };
  },
};

const PROVS: Prov[] = [hydra("tm", "https://api.mail.tm"), hydra("gw", "https://api.mail.gw"), guerrilla, onesec];
const provOf = (cred: string[]): Prov => {
  const k = cred[2] ?? "tm";
  const key = k.includes("mail.gw") ? "gw" : k.includes("mail.tm") ? "tm" : k;
  return PROVS.find((p) => p.key === key) ?? PROVS[0];
};

export async function createInbox(): Promise<{ address: string; secret: string; provider: string }> {
  const errors: string[] = [];
  for (const p of PROVS) {
    try { const c = await p.create(); return { ...c, provider: p.key }; }
    catch (e) { errors.push(`${p.key}: ${e instanceof Error ? e.message : "failed"}`); }
  }
  throw new Error("Could not create an inbox. " + errors.join(" | "));
}

export async function listMail(cred: string[], limit = 15): Promise<MailRow[]> {
  const p = inboxPair(cred);
  if (!p) throw new Error("The agent has no inbox yet — call identity.inbox first.");
  return (await provOf(cred).list(p[0], p[1])).slice(0, limit);
}

function extract(text: string) {
  const codes = new Set<string>();
  for (const l of text.split(/\n|[.!?]\s/)) {
    if (/code|otp|verif|pin|confirm|passcode/i.test(l)) for (const m of Array.from(l.matchAll(/\b\d{4,8}\b/g))) codes.add(m[0]);
  }
  const links = Array.from(new Set(text.match(/https?:\/\/[^\s<>")']+/g) ?? [])).slice(0, 8);
  return { codes: Array.from(codes).slice(0, 5), links };
}

export async function readMail(cred: string[], id: string): Promise<MailFull> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Bad message id.");
  const p = inboxPair(cred);
  if (!p) throw new Error("The agent has no inbox yet.");
  const { row, body } = await provOf(cred).read(p[0], p[1], id);
  return { ...row, body, ...extract(body) };
}

const line = (m: MailRow) => `id=${m.id} · from ${m.from} · "${m.subject}" · ${m.at}\n   ${m.intro}`;
const full = (m: MailFull) => `From: ${m.from}\nSubject: ${m.subject}\n\n${cut(m.body, 3500)}\n\nDETECTED CODES: ${m.codes.join(", ") || "none"}\nLINKS:\n${m.links.join("\n") || "none"}`;

export const IDENTITY_TOOLS: Def[] = [
  {
    name: "identity.inbox", params: "", risk: "read",
    description: "The agent's OWN email address (created on first use). Use it to sign up for services; never the user's real email.",
    run: async (_a, cred, ctx) => {
      const p = inboxPair(cred);
      if (p) return `Agent inbox: ${p[0]}`;
      if (!ctx) throw new Error("An inbox can't be created here.");
      const c = await createInbox();
      await ctx.save("identity", `${c.address}::${c.secret}::${c.provider}`);
      return `Created the agent's own inbox: ${c.address}. Free temporary mailbox: use it to sign up, then read mail with identity.wait_for_mail.`;
    },
  },
  {
    name: "identity.list_mail", params: "", risk: "read", description: "Latest messages in the agent's inbox.",
    run: async (_a, cred) => { const l = await listMail(cred, 10); return l.length ? l.map(line).join("\n") : "The inbox is empty."; },
  },
  {
    name: "identity.read_mail", params: "id:string", risk: "read", description: "Read one message; also returns detected verification codes and links.",
    run: async (a, cred) => full(await readMail(cred, String(a.id ?? ""))),
  },
  {
    name: "identity.wait_for_mail", params: "from_contains?:string, subject_contains?:string, timeout_s?:number", risk: "read",
    description: "Wait (up to 40s) for a new email, e.g. a verification mail after signing up. Returns it with codes and links.",
    run: async (a, cred) => {
      const from = String(a.from_contains ?? "").toLowerCase(), subj = String(a.subject_contains ?? "").toLowerCase();
      const since = Date.now() - 120_000;
      const deadline = Date.now() + Math.min(Math.max(Number(a.timeout_s) || 30, 5), 40) * 1000;
      for (;;) {
        const hit = (await listMail(cred, 10)).find((m) => {
          const t = Date.parse(m.at);
          return (isNaN(t) || t >= since) && (!from || m.from.toLowerCase().includes(from)) && (!subj || m.subject.toLowerCase().includes(subj));
        });
        if (hit) return full(await readMail(cred, hit.id));
        if (Date.now() >= deadline) return "No matching email arrived yet. Try again in a moment.";
        await new Promise((res) => setTimeout(res, 4000));
      }
    },
  },
];