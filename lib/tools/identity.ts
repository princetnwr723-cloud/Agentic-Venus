import { randomBytes } from "crypto";
import { cut, http } from "./net";
import type { Def } from "./plugins";

// Free temporary mailbox API (mail.tm). If the provider ever changes its API, only this file changes.
const BASE = "https://api.mail.tm";
const members = (j: any): any[] => j?.["hydra:member"] ?? j?.member ?? (Array.isArray(j) ? j : []);
const strip = (s: string) => s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const pair = (cred: string[]): [string, string] | null => (cred[0] && cred[0] !== "on" && cred[1] ? [cred[0], cred[1]] : null);

async function login(cred: string[]): Promise<{ address: string; headers: Record<string, string> }> {
  const p = pair(cred);
  if (!p) throw new Error("The agent has no inbox yet — call identity.inbox first.");
  const r = await http(`${BASE}/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: p[0], password: p[1] }) });
  if (r.status >= 400 || !r.json?.token) throw new Error("Could not open the inbox (it may have expired). Disconnect and enable Agent email again.");
  return { address: p[0], headers: { Authorization: `Bearer ${r.json.token}` } };
}

const line = (m: any) => `id=${m.id} · from ${m.from?.address ?? "?"} · "${m.subject ?? ""}" · ${m.createdAt ?? ""}\n   ${String(m.intro ?? "").slice(0, 140)}`;

function extract(text: string) {
  const codes = new Set<string>();
  for (const l of text.split(/\n|[.!?]\s/)) {
    if (/code|otp|verif|pin|confirm|passcode/i.test(l)) for (const m of Array.from(l.matchAll(/\b\d{4,8}\b/g))) codes.add(m[0]);
  }
  const links = Array.from(new Set(text.match(/https?:\/\/[^\s<>")']+/g) ?? [])).slice(0, 8);
  return { codes: Array.from(codes).slice(0, 5), links };
}

async function readOne(h: Record<string, string>, id: string): Promise<string> {
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error("Bad message id.");
  const r = await http(`${BASE}/messages/${id}`, { headers: h });
  if (r.status >= 400) throw new Error("Message not found.");
  const j = r.json;
  const body = String(j?.text || strip(Array.isArray(j?.html) ? j.html.join(" ") : String(j?.html ?? "")));
  const { codes, links } = extract(body);
  return `From: ${j?.from?.address}\nSubject: ${j?.subject}\n\n${cut(body, 3500)}\n\nDETECTED CODES: ${codes.join(", ") || "none"}\nLINKS:\n${links.join("\n") || "none"}`;
}

export const IDENTITY_TOOLS: Def[] = [
  {
    name: "identity.inbox", params: "", risk: "read",
    description: "The agent's OWN email address (created on first use). Use it to sign up for services; never the user's real email.",
    run: async (_a, cred, ctx) => {
      const p = pair(cred);
      if (p) return `Agent inbox: ${p[0]}`;
      if (!ctx) throw new Error("An inbox can't be created here.");
      const d = await http(`${BASE}/domains`);
      const domain = members(d.json)[0]?.domain;
      if (!domain) throw new Error("The mailbox service has no domain available right now.");
      const address = `agent.${randomBytes(5).toString("hex")}@${domain}`;
      const password = randomBytes(18).toString("base64url");
      const c = await http(`${BASE}/accounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, password }) });
      if (c.status >= 400) throw new Error(`Could not create the inbox (HTTP ${c.status}).`);
      await ctx.save("identity", `${address}::${password}`);
      return `Created the agent's own inbox: ${address}. Free temporary mailbox: use it to sign up, then read mail with identity.wait_for_mail.`;
    },
  },
  {
    name: "identity.list_mail", params: "", risk: "read", description: "Latest messages in the agent's inbox.",
    run: async (_a, cred) => {
      const { headers } = await login(cred);
      const r = await http(`${BASE}/messages?page=1`, { headers });
      const list = members(r.json).slice(0, 10);
      return list.length ? list.map(line).join("\n") : "The inbox is empty.";
    },
  },
  {
    name: "identity.read_mail", params: "id:string", risk: "read", description: "Read one message; also returns detected verification codes and links.",
    run: async (a, cred) => readOne((await login(cred)).headers, String(a.id ?? "")),
  },
  {
    name: "identity.wait_for_mail", params: "from_contains?:string, subject_contains?:string, timeout_s?:number", risk: "read",
    description: "Wait (up to 40s) for a new email, e.g. a verification mail after signing up. Returns it with codes and links.",
    run: async (a, cred) => {
      const { headers } = await login(cred);
      const from = String(a.from_contains ?? "").toLowerCase(), subj = String(a.subject_contains ?? "").toLowerCase();
      const since = Date.now() - 120_000;
      const deadline = Date.now() + Math.min(Math.max(Number(a.timeout_s) || 30, 5), 40) * 1000;
      for (;;) {
        const r = await http(`${BASE}/messages?page=1`, { headers });
        const hit = members(r.json).find((m: any) =>
          Date.parse(m.createdAt) >= since &&
          (!from || String(m.from?.address ?? "").toLowerCase().includes(from)) &&
          (!subj || String(m.subject ?? "").toLowerCase().includes(subj)));
        if (hit) return readOne(headers, hit.id);
        if (Date.now() >= deadline) return "No matching email arrived yet. Try again in a moment.";
        await new Promise((res) => setTimeout(res, 4000));
      }
    },
  },
];
