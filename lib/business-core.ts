// Venus Business Hub: the pure part (types, team catalog, cleaning and checking of model output).
// No imports on purpose: the unit tests load this file directly, and nothing here touches the network or the database.
import type { AvatarColor } from "./bots";

export type BizProfile = {
  name: string; category: string; offer: string; customers: string; location: string; website: string;
  languages: string; hours: string; policies: string; goals: string; tone: string; contact: string;
};
export type ProfileKey = keyof BizProfile;

export const PROFILE_FIELDS: Array<{ key: ProfileKey; label: string; hint: string; long?: boolean }> = [
  { key: "name", label: "Business name", hint: "Sharma Dental Clinic" },
  { key: "category", label: "Business type", hint: "Dental clinic, online store, coaching…" },
  { key: "offer", label: "What you sell or do", hint: "Services or products, in a few lines", long: true },
  { key: "customers", label: "Ideal customers", hint: "Who buys from you?", long: true },
  { key: "location", label: "City / area served", hint: "Jaipur, India — or online worldwide" },
  { key: "website", label: "Website", hint: "https://…" },
  { key: "languages", label: "Languages", hint: "Hindi, English…" },
  { key: "hours", label: "Working hours", hint: "Mon–Sat, 10am–7pm" },
  { key: "policies", label: "Pricing & policies", hint: "Prices, refunds, delivery, booking rules", long: true },
  { key: "goals", label: "Goals right now", hint: "More leads, fewer no-shows…", long: true },
  { key: "tone", label: "Brand tone", hint: "Friendly, premium, formal…" },
  { key: "contact", label: "Public contact", hint: "Phone / email customers may use" },
];
export const PROFILE_KEYS = PROFILE_FIELDS.map((f) => f.key);
export const emptyProfile = (): BizProfile => ({
  name: "", category: "", offer: "", customers: "", location: "", website: "", languages: "", hours: "", policies: "", goals: "", tone: "", contact: "",
});

export type Lead = { name: string; why: string; website?: string; contact?: string; source?: string };

export type BizTool = "think" | "research" | "leads";
export type BizMember = { id: string; name: string; title: string; color: AvatarColor; tool: BizTool; skill: string; drafts?: boolean };

export const BIZ_TEAM: BizMember[] = [
  { id: "chief", name: "Chief", title: "Team lead", color: "amber", tool: "think", skill: "Understands the business, splits goals into steps, hands work to the right teammate and reports back in one clear message." },
  { id: "scout", name: "Scout", title: "Leads finder", color: "teal", tool: "leads", skill: "Searches the web for companies and people that fit the ideal customer and lists each one with its source link." },
  { id: "lens", name: "Lens", title: "Market & competitor analyst", color: "sky", tool: "research", skill: "Researches the market, competitors, prices and demand and writes findings with source links." },
  { id: "closer", name: "Closer", title: "Outreach writer", color: "coral", tool: "think", drafts: true, skill: "Writes short, personal first messages, follow-ups and proposals. Drafts only: nothing is sent without the owner's OK." },
  { id: "care", name: "Care", title: "Customer support", color: "sage", tool: "think", drafts: true, skill: "Writes accurate, friendly replies and FAQs from the business details, and says so when an answer is not known." },
  { id: "quill", name: "Quill", title: "Content & social", color: "violet", tool: "think", drafts: true, skill: "Plans content calendars and writes posts, captions and page copy in the brand tone." },
  { id: "spark", name: "Spark", title: "Campaigns & ads", color: "teal", tool: "think", drafts: true, skill: "Designs campaigns with audience, message, channels, budget split and success numbers, and writes ad variations." },
  { id: "ledger", name: "Ledger", title: "Pricing & offers", color: "amber", tool: "think", skill: "Reviews prices, margins and offers and suggests packages and discounts with clear assumptions." },
  { id: "atlas", name: "Atlas", title: "Operations", color: "violet", tool: "think", skill: "Turns work into checklists, SOPs, schedules and follow-up routines the business can repeat." },
  { id: "lingo", name: "Lingo", title: "Translator", color: "sky", tool: "think", drafts: true, skill: "Translates and localises messages and pages naturally, keeping tone and meaning." },
];
export const memberById = (id: unknown): BizMember | undefined => BIZ_TEAM.find((m) => m.id === id);
export const DEFAULT_ROSTER = ["chief", "scout", "closer", "lens", "care", "quill"];

export type Msg = {
  id: string; at: number;
  kind: "user" | "agent" | "system";
  /** member id of the sender (agent messages) */
  from?: string;
  /** member id, "you" or "team" */
  to?: string;
  tag?: "task" | "handoff" | "plan" | "result" | "draft" | "report" | "note";
  text: string;
  leads?: Lead[];
  approved?: boolean;
};
export type StepStatus = "queued" | "running" | "done" | "failed" | "skipped";
export type RunStep = { i: number; member: string; task: string; after: number[]; status: StepStatus; note?: string };
export type BizRun = { id: string; goal: string; status: "planning" | "running" | "done" | "partial" | "failed"; steps: RunStep[]; startedAt: number; endedAt?: number };
export type BizDoc = { profile: BizProfile; team: string[]; msgs: Msg[]; working: Record<string, string>; leads: Lead[]; run?: BizRun; updatedAt: number };
export type PlanStep = { member: string; task: string; after: number[] };

// ---------- small text helpers ----------

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + "…" : s);
export const oneLine = (s: string, n: number) => clip(String(s ?? "").replace(/\s+/g, " ").trim(), n);

/** The first {...} block of a model reply, parsed. Models often wrap JSON in prose or code fences. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseJson(reply: string): any {
  const a = reply.indexOf("{"), b = reply.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(reply.slice(a, b + 1)); } catch { return null; }
}

export function safeHref(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  if (!s || s.length > 300) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".") ? u.toString() : undefined;
  } catch { return undefined; }
}

// ---------- profile ----------

/** Only known fields, only text, trimmed and short: whatever the model returned. */
export function cleanPatch(raw: unknown): Partial<BizProfile> {
  const out: Partial<BizProfile> = {};
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  for (const k of PROFILE_KEYS) {
    const v = o[k];
    if (typeof v === "string" || typeof v === "number") {
      const t = String(v).replace(/\s+/g, " ").trim().slice(0, 600);
      if (t) out[k] = t;
    } else if (Array.isArray(v)) {
      const t = v.filter((x) => typeof x === "string" || typeof x === "number").map(String).join(", ").trim().slice(0, 600);
      if (t) out[k] = t;
    }
  }
  return out;
}

/** The new profile plus the labels of the fields that really changed. */
export function applyPatch(profile: BizProfile, patch: Partial<BizProfile>): { next: BizProfile; changed: string[] } {
  const next: BizProfile = { ...profile };
  const changed: string[] = [];
  for (const f of PROFILE_FIELDS) {
    const v = patch[f.key];
    if (typeof v === "string" && v && v !== profile[f.key]) { next[f.key] = v; changed.push(f.label); }
  }
  return { next, changed };
}

export const isReady = (p: BizProfile) => p.name.trim().length >= 2 && p.offer.trim().length >= 3;
export const completeness = (p: BizProfile) => Math.round((PROFILE_KEYS.filter((k) => p[k].trim()).length / PROFILE_KEYS.length) * 100);

export function profileText(p: BizProfile): string {
  const lines = PROFILE_FIELDS.filter((f) => p[f.key].trim()).map((f) => `${f.label}: ${p[f.key]}`);
  return lines.length ? lines.join("\n") : "(nothing known about the business yet)";
}

export const persona = (m: BizMember, p: BizProfile) =>
  `You are ${m.name}, ${m.title} on the AI team of this business, inside the Venus Business Hub. ${m.skill}\n\nTHE BUSINESS\n${profileText(p)}\n\n` +
  `Write in the language the owner writes in. Be direct, concrete and professional. Never invent facts, names, prices, results or contact details: if something is unknown, say so in a short "Needs you" line.`;

// ---------- team and plan ----------

/** Ids from the model's JSON, only real ones. Chief is always first; too few members falls back to a sensible default team. */
export function sanitizeRoster(raw: unknown): string[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { members?: unknown }).members) ? (raw as { members: unknown[] }).members : [];
  const ids = Array.from(new Set(list.map((x) => String(x).trim().toLowerCase()))).filter((x) => Boolean(memberById(x)) && x !== "chief");
  const team = ["chief", ...ids].slice(0, 7);
  return team.length >= 4 ? team : [...DEFAULT_ROSTER];
}

/** Steps from the model's JSON. Indexes are never shifted (an empty task becomes the goal), and "after" only points backwards. */
export function sanitizePlan(raw: unknown, goal: string, teamIds: string[]): PlanStep[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { steps?: unknown }).steps) ? (raw as { steps: unknown[] }).steps : [];
  const steps: PlanStep[] = list.slice(0, 5).map((s, i) => {
    const o = (s && typeof s === "object" ? s : {}) as { member?: unknown; task?: unknown; after?: unknown };
    const member = teamIds.includes(String(o.member)) ? String(o.member) : "chief";
    const task = String(o.task ?? "").trim().slice(0, 1800) || goal;
    const after = (Array.isArray(o.after) ? o.after : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < i);
    return { member, task, after: Array.from(new Set(after)) };
  });
  return steps.length ? steps : [{ member: "chief", task: goal, after: [] }];
}

// ---------- leads: only what the search results really contain ----------

const bare = (v: string) => v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
export const inText = (source: string, value: string) => {
  const v = bare(value);
  return v.length >= 3 && source.toLowerCase().includes(v);
};

/** Keeps a lead only when its name (or website) really appears in the text it came from, and drops any link or contact that does not. */
export function validateLeads(raw: unknown, source: string): Lead[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { leads?: unknown }).leads) ? (raw as { leads: unknown[] }).leads : [];
  const out: Lead[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = oneLine(String(o.name ?? ""), 100);
    if (name.length < 2) continue;
    const website = safeHref(o.website);
    const site = website && inText(source, website) ? website : undefined;
    if (!inText(source, name) && !site) continue;
    const contact = oneLine(String(o.contact ?? ""), 120);
    const src = safeHref(o.source);
    const lead: Lead = { name, why: oneLine(String(o.why ?? ""), 200) };
    if (site) lead.website = site;
    if (contact && inText(source, contact)) lead.contact = contact;
    if (src && inText(source, src)) lead.source = src;
    if (!out.some((x) => x.name.toLowerCase() === name.toLowerCase())) out.push(lead);
    if (out.length >= 10) break;
  }
  return out;
}

export function mergeLeads(existing: Lead[], incoming: Lead[]): Lead[] {
  const seen = new Set(existing.map((l) => l.name.toLowerCase()));
  const add = incoming.filter((l) => !seen.has(l.name.toLowerCase()));
  return [...existing, ...add].slice(-80);
}

const csvCell = (v: string | undefined) => {
  let s = String(v ?? "").replace(/[\r\n]+/g, " ");
  if (/^[=+\-@]/.test(s)) s = "'" + s; // a spreadsheet must never run a cell as a formula
  return `"${s.replace(/"/g, '""')}"`;
};
export const leadsCsv = (leads: Lead[]) =>
  ["Name,Why it fits,Website,Contact,Source", ...leads.map((l) => [l.name, l.why, l.website, l.contact, l.source].map(csvCell).join(","))].join("\n");
