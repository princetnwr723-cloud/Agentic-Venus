// Runs in the BROWSER. The mailbox services can block the server's network; your own connection usually is not blocked.
const BASES = { tm: "https://api.mail.tm", gw: "https://api.mail.gw" } as const;
export type BrowserInbox = { address: string; secret: string; provider: "tm" | "gw" };

const members = (j: any): any[] => j?.["hydra:member"] ?? j?.member ?? (Array.isArray(j) ? j : []);
const rnd = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b) => b.toString(16).padStart(2, "0")).join("");
const strip = (s: string) => s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const domainOf = (a: string) => (a.split("@")[1] ?? "").toLowerCase().split(".").slice(-2).join(".") || "unknown";

async function j(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}

export async function browserCreate(): Promise<BrowserInbox> {
  const errs: string[] = [];
  for (const p of ["tm", "gw"] as const) {
    try {
      const d = await j(`${BASES[p]}/domains?page=1`);
      const domain = members(d.json).find((x: any) => x?.domain)?.domain;
      if (!domain) { errs.push(`${p}: no domain (HTTP ${d.status})`); continue; }
      const address = `agent.${rnd(5)}@${domain}`, secret = rnd(18);
      const c = await j(`${BASES[p]}/accounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, password: secret }) });
      if (c.status >= 400) { errs.push(`${p}: account HTTP ${c.status}`); continue; }
      return { address, secret, provider: p };
    } catch (e) { errs.push(`${p}: ${e instanceof Error ? e.message : "blocked"}`); }
  }
  throw new Error(errs.join(" | "));
}

export async function browserOverview(b: BrowserInbox) {
  const base = BASES[b.provider];
  const t = await j(`${base}/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: b.address, password: b.secret }) });
  if (!t.json?.token) throw new Error(`could not open the inbox (HTTP ${t.status})`);
  const h = { Authorization: `Bearer ${t.json.token}` };
  const list = members((await j(`${base}/messages?page=1`, { headers: h })).json).slice(0, 12);
  const mails = await Promise.all(list.map(async (m: any) => {
    const r = (await j(`${base}/messages/${m.id}`, { headers: h })).json ?? m;
    const body = String(r.text || strip(Array.isArray(r.html) ? r.html.join(" ") : String(r.html ?? "")));
    const codes = new Set<string>();
    for (const l of body.split(/\n|[.!?]\s/)) if (/code|otp|verif|pin|confirm|passcode/i.test(l)) for (const x of Array.from(l.matchAll(/\b\d{4,8}\b/g))) codes.add(x[0]);
    const from = String(r.from?.address ?? m.from?.address ?? "?");
    return {
      id: String(r.id ?? m.id), from, domain: domainOf(from), subject: String(r.subject ?? ""), at: String(r.createdAt ?? ""), intro: String(r.intro ?? "").slice(0, 160),
      body: body.slice(0, 3000), codes: Array.from(codes).slice(0, 5), links: Array.from(new Set(body.match(/https?:\/\/[^\s<>")']+/g) ?? [])).slice(0, 8),
    };
  }));
  const map = new Map<string, { domain: string; mails: number; lastAt: string; lastSubject: string; codes: string[]; used: boolean }>();
  for (const m of mails) {
    const s = map.get(m.domain) ?? { domain: m.domain, mails: 0, lastAt: "", lastSubject: "", codes: [], used: false };
    s.mails++;
    if (!s.lastAt || m.at > s.lastAt) { s.lastAt = m.at; s.lastSubject = m.subject; }
    s.codes.push(...m.codes);
    map.set(m.domain, s);
  }
  return { mails, services: Array.from(map.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt)) };
}