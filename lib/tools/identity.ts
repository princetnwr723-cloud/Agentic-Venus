import { randomBytes } from "crypto";
import { cut, http } from "./net";
import type { Def } from "./plugins";

// Free temporary mailboxes. mail.tm and mail.gw share one API: if one is down or blocks the server, the other is tried.
const PROVIDERS = ["https://api.mail.tm", "https://api.mail.gw"];
const HDR = { Accept: "application/ld+json, application/json", "User-Agent": "Mozilla/5.0 agenticvenus" };
const members = (j: any): any[] => j?.["hydra:member"] ?? j?.member ?? (Array.isArray(j) ? j : []);
const strip = (s: string) => s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// credential = address::password::provider-base  (older 2-part credentials mean mail.tm)
export const inboxPair = (cred: string[]): [string, string] | null => (cred[0] && cred[0] !== "on" && cred[1] ? [cred[0], cred[1]] : null);
const baseOf = (cred: string[]) => (PROVIDERS.includes(cred[2]) ? cred[2] : PROVIDERS[0]); // never trust an arbitrary base
export type MailRow = { id: string; from: string; domain: string; subject: string; at: string; intro: string };
export type MailFull = MailRow & { body: string; codes: string[]; links: string[] };

export const domainOf = (addr: string) => (addr.split("@")[1] ?? "").toLowerCase().split(".").slice(-2).join(".") || "unknown";
const row = (m: any): MailRow => ({ id: m.id, from: m.from?.address ?? "?", domain: domainOf(m.from?.address ?? ""), subject: m.subject ?? "", at: m.createdAt ?? "", intro: String(m.intro ?? "").slice(0, 160) });

export async function openInbox(cred: string[]): Promise<{ address: string; base: string; headers: Record<string, string> }> {
  const p = inboxPair(cred);
  if (!p) throw new Error("The agent has no inbox yet — call identity.inbox first.");
  const base = baseOf(cred);
  const r = await http(`${base}/token`, { method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify({ address: p[0], password: p[1] }) });
  if (r.status >= 400 || !r.json?.token) throw new Error(`Could not open the inbox (HTTP ${r.status}). It may have expired: create a new one from the agent's identity panel.`);
  return { address: p[0], base, headers: { ...HDR, Authorization: `Bearer ${r.json.token}` } };
}

export async function createInbox(): Promise<{ address: string; password: string; base: string }> {
  const errors: string[] = [];
  for (const base of PROVIDERS) {
    const host = new URL(base).hostname;
    try {
      const d = await http(`${base}/domains?page=1`, { headers: HDR });
      const domain = members(d.json).find((x: any) => x?.domain && x?.isActive !== false)?.domain;
      if (!domain) { errors.push(`${host}: no domain (HTTP ${d.status})`); continue; }
      const address = `agent.${randomBytes(5).toString("hex")}@${domain}`;
      const password = randomBytes(18).toString("base64url");
      const c = await http(`${base}/accounts`, { method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify({ address, password }) });
      if (c.status >= 400) { errors.push(`${host}: account HTTP ${c.status}`); continue; }
      return { address, password, base };
    } catch (e) {
      errors.push(`${host}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  throw new Error("Could not create an inbox. " + errors.join(" | "));
}

export async function listMail(cred: string[], limit = 15): Promise<MailRow[]> {
  const { base, headers } = await openInbox(cred);
  const r = await http(`${base}/messages?page=1`, { headers });
  return members(r.json).slice(0, limit).map(row);
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
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error("Bad message id.");
  const { base, headers } = await openInbox(cred);
  const r = await http(`${base}/messages/${id}`, { headers });
  if (r.status >= 400) throw new Error("Message not found.");
  const j = r.json;
  const body = String(j?.text || strip(Array.isArray(j?.html) ? j.html.join(" ") : String(j?.html ?? "")));
  return { ...row(j), body, ...extract(body) };
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
      await ctx.save("identity", `${c.address}::${c.password}::${c.base}`);
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
        const hit = (await listMail(cred, 10)).find((m) => Date.parse(m.at) >= since && (!from || m.from.toLowerCase().includes(from)) && (!subj || m.subject.toLowerCase().includes(subj)));
        if (hit) return full(await readMail(cred, hit.id));
        if (Date.now() >= deadline) return "No matching email arrived yet. Try again in a moment.";
        await new Promise((res) => setTimeout(res, 4000));
      }
    },
  },
];