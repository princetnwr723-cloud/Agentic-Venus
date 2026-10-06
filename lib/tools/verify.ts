import { promises as dns } from "dns";
import { safeFetch } from "./net";
import type { Def } from "./plugins";

// Independent checks done by CODE, not by the model. Nothing here trusts what the agent claims.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "yahoo.in", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "protonmail.com", "aol.com", "live.com", "rediffmail.com"]);
const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "mail.tm", "maildrop.cc", "throwaway.email"]);
const GENERIC_LOCAL = /^(info|admin|support|sales|contact|hello|office|mail|enquiry|inquiry|help|team|noreply|no-reply|webmaster|service|hr|jobs|careers|billing|accounts|marketing)$/i;
const PARKED = /(this domain (is|may be) for sale|buy this domain|domain (is )?parked|parked (free|domain)|hugedomains|afternic|dan\.com\/buy|sedo\.com|domain expired|account suspended|default web site page|welcome to nginx|apache2 (ubuntu )?default page)/i;
const STOP = new Set(["pvt", "ltd", "llc", "inc", "limited", "private", "company", "corp", "corporation", "co", "the", "and", "of", "technologies", "technology", "solutions", "services", "group", "india", "global", "systems", "software", "consulting", "enterprises", "industries", "labs", "studio"]);

const s = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
const textOf = (h: string) =>
  h.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
const toks = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u0900-\u097f ]/g, " ").split(/\s+/).filter((w) => w.length > 1);
const distinct = (x: string) => { const t = toks(x); const d = t.filter((w) => !STOP.has(w)); return d.length ? d : t; };
const found = (needle: string, hay: string, ratio = 0.6) => {
  const d = distinct(needle);
  if (!d.length) return false;
  const hit = d.filter((w) => hay.includes(w)).length;
  return hit >= 1 && hit / d.length >= ratio;
};
const hostOf = (u: string) => {
  try { return new URL(/^https?:\/\//i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

type Page = { status: number; text: string; title: string; error?: string };
async function fetchPage(url: string, ms = 7000): Promise<Page> {
  try {
    const res = await safeFetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" } }, ms);
    const raw = (await res.text()).slice(0, 500_000);
    const isHtml = /<html|<body|<head|<!doctype/i.test(raw.slice(0, 2000)) || (res.headers.get("content-type") ?? "").includes("html");
    const title = textOf(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? "").toLowerCase();
    return { status: res.status, text: (isHtml ? textOf(raw) : raw).toLowerCase(), title };
  } catch (e) {
    return { status: 0, text: "", title: "", error: e instanceof Error ? e.message : "failed" };
  }
}

async function mailDomainOk(domain: string): Promise<{ ok: boolean; how: string }> {
  try { const mx = await withTimeout(dns.resolveMx(domain), 4000); if (mx.length) return { ok: true, how: "MX" }; } catch { /* try A */ }
  try { const a = await withTimeout(dns.resolve4(domain), 4000); if (a.length) return { ok: true, how: "A record only" }; } catch { /* none */ }
  return { ok: false, how: "none" };
}

async function pool<T, R>(items: T[], n: number, deadline: number, fn: (x: T, i: number) => Promise<R>): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      if (Date.now() > deadline) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// ---------------- leads ----------------
type Lead = { name: string; company: string; website: string; email: string; role: string; phone: string; source_url: string };
const pick = (x: any): Lead => ({
  name: s(x?.name), company: s(x?.company), website: s(x?.website), email: s(x?.email).toLowerCase(),
  role: s(x?.role), phone: s(x?.phone, 40), source_url: s(x?.source_url ?? x?.source, 400),
});
type LeadResult = { verdict: "verified" | "rejected"; confidence: "high" | "medium" | "low"; pass: string[]; fails: string[]; warn: string[] };

async function checkLead(l: Lead, requirePerson: boolean): Promise<LeadResult> {
  const pass: string[] = [], fails: string[] = [], warn: string[] = [];
  const reject = (why: string): LeadResult => ({ verdict: "rejected", confidence: "low", pass, fails: [why], warn });
  if (!l.company && !l.name) return reject("nothing to verify: give a company or a person name");

  const site = l.website ? (/^https?:\/\//i.test(l.website) ? l.website : "https://" + l.website) : "";
  const srcUrl = l.source_url && l.source_url !== site ? l.source_url : "";
  const [sp, src] = await Promise.all([site ? fetchPage(site) : Promise.resolve(null), srcUrl ? fetchPage(srcUrl) : Promise.resolve(null)]);

  let hay = "", readable = false, live = false;
  if (site && sp) {
    if (sp.status === 0) fails.push("website does not respond" + (sp.error ? " (" + sp.error.slice(0, 60) + ")" : ""));
    else if (sp.status >= 400 && ![401, 403, 429, 503].includes(sp.status)) fails.push("website error HTTP " + sp.status);
    else if (PARKED.test(sp.title + " " + sp.text.slice(0, 8000))) fails.push("website is parked / for sale / default page");
    else {
      live = true; pass.push("website is live");
      if (sp.status < 400) { readable = true; hay += " " + sp.title + " " + sp.text; } else warn.push("website blocks automated checks");
    }
  } else warn.push("no website given");

  if (srcUrl && src) {
    if (src.status === 0 || src.status >= 400) warn.push("source page could not be read");
    else { readable = true; hay += " " + src.title + " " + src.text; pass.push("source page is readable"); }
  } else if (!l.source_url) warn.push("no source_url given");

  let emailOk = false;
  if (l.email) {
    const m = /^([^\s@]+)@([^\s@]+\.[^\s@]{2,})$/.exec(l.email);
    if (!m) fails.push("invalid email address");
    else {
      const dom = m[2].toLowerCase();
      if (DISPOSABLE.has(dom)) fails.push("disposable email domain");
      else {
        const mx = await mailDomainOk(dom);
        if (!mx.ok) fails.push("email domain cannot receive mail (no MX/A record)");
        else { emailOk = true; pass.push("email domain accepts mail (" + mx.how + ")"); }
      }
      if (GENERIC_LOCAL.test(m[1])) warn.push("generic role address (info@, sales@ ...)");
      if (FREE_MAIL.has(dom)) warn.push("free-mail address, not a company mailbox");
      else { const wh = hostOf(l.website); if (wh && !(wh.endsWith(dom) || dom.endsWith(wh))) warn.push("email domain differs from the website domain"); }
    }
  }

  let evidence = false, strong = false;
  if (l.company) {
    if (readable && found(l.company, hay)) { pass.push("company name found on the page"); evidence = true; }
    else fails.push(readable ? "company name NOT found on the website/source page" : "company could not be confirmed (no readable page)");
  }
  if (l.name) {
    const phrase = toks(l.name).join(" ");
    if (readable && phrase && hay.includes(phrase)) { pass.push("person name found on the page"); evidence = true; strong = true; }
    else if (readable && found(l.name, hay, 1)) { pass.push("person name words found on the page"); evidence = true; }
    else if (requirePerson) fails.push("person NOT found on the cited page");
    else warn.push("person not confirmed on any readable page");
  }
  if (l.email && readable && hay.includes(l.email)) { pass.push("email address appears on the page"); strong = true; evidence = true; }
  if (l.phone && !/^[+\d][\d\s().-]{6,18}$/.test(l.phone)) warn.push("phone number looks malformed");

  if (!evidence && fails.length === 0) fails.push("no evidence on any readable page that this lead exists");
  if (!live && !emailOk && fails.length === 0) fails.push("neither a live website nor a mail-capable email domain");
  const ok = fails.length === 0;
  return { verdict: ok ? "verified" : "rejected", confidence: !ok ? "low" : strong && live ? "high" : "medium", pass, fails, warn };
}

const leadKey = (l: Lead) => l.email || hostOf(l.website) || (toks(l.company).join("") + toks(l.name).join(""));

// ---------------- facts / urls ----------------
function deriveTerms(claim: string): string[] {
  const nums = claim.match(/\d[\d,.]*%?/g) ?? [];
  const caps = claim.match(/\b[A-Z][a-zA-Z0-9&.-]{2,}\b/g) ?? [];
  return Array.from(new Set([...nums, ...caps].map((t) => t.toLowerCase().replace(/[.,]+$/, "")))).slice(0, 6);
}

export const VERIFY_TOOLS: Def[] = [
  {
    name: "verify.leads", risk: "read",
    params: 'items:[{name?,company?,website?,email?,role?,phone?,source_url?}] (max 12 per call), require_person?:boolean',
    description: "Independently VERIFY leads before delivering them: website live and not parked, company found on the page, email domain can receive mail, source page really contains the person/company. Returns verified/rejected per item with reasons. ALWAYS use this before delivering any lead or contact list.",
    run: async (a) => {
      const items = (Array.isArray(a.items) ? a.items : []).slice(0, 12).map(pick);
      if (!items.length) throw new Error("items must be a non-empty array (max 12 per call).");
      const requirePerson = a.require_person === true;
      const results = await pool(items, 4, Date.now() + 48_000, (l) => checkLead(l, requirePerson));

      const seen = new Map<string, number>();
      const rows = items.map((l, i) => {
        let r = results[i];
        if (!r) return { i, verdict: "unchecked", confidence: "low", pass: [], fails: ["ran out of time - send this item again"], warn: [], item: l };
        const k = leadKey(l);
        if (r.verdict === "verified" && k) {
          if (seen.has(k)) r = { ...r, verdict: "rejected", confidence: "low", fails: ["duplicate of item #" + seen.get(k)] };
          else seen.set(k, i);
        }
        return { i, ...r, item: l };
      });
      return JSON.stringify({
        checked: rows.filter((r) => r.verdict !== "unchecked").length,
        verified: rows.filter((r) => r.verdict === "verified").length,
        rejected: rows.filter((r) => r.verdict === "rejected").length,
        unchecked: rows.filter((r) => r.verdict === "unchecked").length,
        note: "Email check = syntax + domain can receive mail + printed on the page. A mailbox cannot be proven to exist without sending mail.",
        items: rows,
      });
    },
  },
  {
    name: "verify.facts", risk: "read",
    params: 'claims:[{claim, source_url, must_contain?:string[]}] (max 10)',
    description: "Check that important claims (numbers, names, prices, dates) really appear on the page you cite as the source.",
    run: async (a) => {
      const claims = (Array.isArray(a.claims) ? a.claims : []).slice(0, 10);
      if (!claims.length) throw new Error("claims must be a non-empty array.");
      const rows = await pool(claims, 4, Date.now() + 48_000, async (x: any, i) => {
        const claim = s(x?.claim, 400), url = s(x?.source_url, 400);
        const must = (Array.isArray(x?.must_contain) && x.must_contain.length ? x.must_contain.map((t: unknown) => s(t, 60)) : deriveTerms(claim)).map((t: string) => t.toLowerCase()).filter(Boolean).slice(0, 8);
        const p = await fetchPage(url, 8000);
        if (p.status === 0 || p.status >= 400) return { i, claim, verdict: "rejected", reason: "source page could not be read" + (p.status ? " (HTTP " + p.status + ")" : "") };
        const hit = must.filter((t: string) => p.text.includes(t)), miss = must.filter((t: string) => !p.text.includes(t));
        const ok = must.length > 0 && hit.length / must.length >= 0.75;
        return { i, claim, verdict: ok ? "verified" : "rejected", reason: ok ? hit.length + " of " + must.length + " key terms found on the source page" : must.length ? "missing on the source page: " + miss.join(", ") : "no key terms to check" };
      });
      return JSON.stringify({ items: rows.map((r, i) => r ?? { i, verdict: "unchecked", reason: "ran out of time - send again" }) });
    },
  },
  {
    name: "verify.urls", risk: "read", params: "urls:string[] (max 25)",
    description: "Check that links are live (not dead, not parked).",
    run: async (a) => {
      const urls = (Array.isArray(a.urls) ? a.urls : []).slice(0, 25).map((u: unknown) => s(u, 500));
      if (!urls.length) throw new Error("urls must be a non-empty array.");
      const rows = await pool(urls, 6, Date.now() + 48_000, async (u: string, i) => {
        const p = await fetchPage(/^https?:\/\//i.test(u) ? u : "https://" + u, 6000);
        const live = p.status > 0 && (p.status < 400 || [401, 403, 429, 503].includes(p.status));
        const parked = live && PARKED.test(p.title + " " + p.text.slice(0, 6000));
        return { i, url: u, verdict: live && !parked ? "verified" : "rejected", reason: !live ? (p.status ? "HTTP " + p.status : "does not respond") : parked ? "parked / for sale" : "live" };
      });
      return JSON.stringify({ items: rows.map((r, i) => r ?? { i, url: urls[i], verdict: "unchecked", reason: "ran out of time" }) });
    },
  },
];