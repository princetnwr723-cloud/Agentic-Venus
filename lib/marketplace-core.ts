// Pure marketplace logic. No server or browser imports, so it runs in the browser, on the server and in tests.
// A "listing" is DATA (text and settings), never code: nothing in the marketplace can run anything on its own.

export type ListingKind = "skill" | "agent" | "automation";
export type ToolKind = "pc" | "code" | "video" | "research" | "think" | "email";
export type SkillSpec = { name: string; description: string; instructions: string };
export type Field = { key: string; label: string; placeholder: string };
export type Sched = { kind: "cron"; expr: string } | { kind: "every"; minutes: number };
export type RoutineSpec = {
  instructions: string;
  schedule: Sched;
  mode: "auto" | "lite" | "agent";
  toChat: boolean;
  allowWrites: boolean;
  notify: "always" | "changes" | "smart";
};
export type Listing = {
  id: string;
  kind: ListingKind;
  name: string;
  tagline: string;
  category: string;
  tags: string[];
  author: string;
  official: boolean;
  color?: string;
  skill?: SkillSpec;
  agent?: { role: string; tool: ToolKind; skills: SkillSpec[] };
  routine?: RoutineSpec;
  needs?: string[];
  fields?: Field[];
  installs?: number;
  createdAt?: number;
};
export type PublishValue = Pick<Listing, "kind" | "name" | "tagline" | "category" | "tags" | "skill" | "agent" | "routine" | "needs" | "fields">;

export const KIND_LABEL: Record<ListingKind, string> = { skill: "Skill", agent: "Agent", automation: "Automation" };
export const TOOLS: ToolKind[] = ["pc", "code", "video", "research", "think", "email"];
export const TOOL_TEXT: Record<ToolKind, string> = {
  pc: "Uses this account's Computer (browser and apps): it can open sites, click and type.",
  code: "Uses Venus Code: it can read and write files in a code workspace.",
  video: "Uses Venus Pro: it can create video and media.",
  research: "Searches the web and reads pages.",
  think: "Writing and analysis only. It uses no tools.",
  email: "Prepares email drafts. Sending needs a connected mail account.",
};

/** Connector ids match lib/tools/oauth-catalog.ts. A chat is "connected" when chat.connectors["oauth:<id>"] is set. */
export const CONNECTORS: Record<string, string> = {
  google: "Google Workspace", microsoft: "Microsoft 365", slack: "Slack", github_oauth: "GitHub", notion_oauth: "Notion",
  linear: "Linear", dropbox: "Dropbox", hubspot: "HubSpot", asana: "Asana", zoom: "Zoom", figma: "Figma", webflow: "Webflow",
  shopify: "Shopify", youtube: "YouTube", x: "X (Twitter)", linkedin: "LinkedIn", meta: "Facebook + Instagram", threads: "Threads",
  tiktok: "TikTok", pinterest: "Pinterest", reddit: "Reddit",
};
export const connectorLabel = (id: string) => CONNECTORS[id] ?? id;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CRON_RE = /^[\d*/,-]+( [\d*/,\-A-Za-z]+){4}$/;
const FIELD_RE = /\{\{([a-z][a-z0-9_]{0,19})\}\}/g;

export function scheduleText(s: Sched): string {
  if (s.kind === "every") {
    const m = s.minutes;
    if (m % 1440 === 0) return `every ${m / 1440} day${m === 1440 ? "" : "s"}`;
    if (m % 60 === 0) return `every ${m / 60} hour${m === 60 ? "" : "s"}`;
    return `every ${m} minutes`;
  }
  const [mi, h, dom, mon, dow] = s.expr.trim().split(/\s+/);
  if (/^\d+$/.test(mi) && /^\d+$/.test(h) && dom === "*" && mon === "*") {
    const t = `${h.padStart(2, "0")}:${mi.padStart(2, "0")}`;
    if (dow === "*") return `every day at ${t}`;
    if (dow === "1-5") return `on weekdays at ${t}`;
    if (/^[0-6]$/.test(dow)) return `every ${DOW[Number(dow)]} at ${t}`;
  }
  return `on the schedule "${s.expr}"`;
}

/** What installing this listing lets it do, in plain words. Shown BEFORE install, for every listing. */
export function permsOf(l: Listing): string[] {
  if (l.kind === "skill") return ["Adds written instructions only. It has no tools, no network and no account access of its own."];
  if (l.kind === "agent") {
    const n = l.agent?.skills.length ?? 0;
    return [
      TOOL_TEXT[l.agent?.tool ?? "think"],
      `Creates a NEW agent chat with its own role${n ? ` and ${n} skill${n === 1 ? "" : "s"}` : ""}. Your other chats are not touched.`,
    ];
  }
  const r = l.routine;
  if (!r) return [];
  const out = [
    `Runs ${scheduleText(r.schedule)} (your time zone).`,
    r.mode === "lite" ? "Web research only." : r.mode === "agent" ? "Runs with full agent tools." : "Picks the lightest mode that can do the job.",
    r.allowWrites ? "May write or send (create, edit, post) through your connected accounts." : "Read-only: it cannot write, send or post anything.",
  ];
  if (l.needs?.length) out.push(`Needs these accounts connected in the chat: ${l.needs.map(connectorLabel).join(", ")}.`);
  return out;
}

// ---------- templates ({{topic}} placeholders in automations) ----------
export const extractFields = (text: string): string[] => [...new Set([...text.matchAll(FIELD_RE)].map((m) => m[1]))];
export const humanize = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const fillTemplate = (text: string, values: Record<string, string>): string => text.replace(FIELD_RE, (_m, k: string) => String(values[k] ?? "").trim());
export const missingFields = (fields: Field[], values: Record<string, string>): string[] =>
  fields.filter((f) => !String(values[f.key] ?? "").trim()).map((f) => f.label);

// ---------- search and filter ----------
export type Filter = { q?: string; kind?: ListingKind | "all"; category?: string; source?: "all" | "official" | "community" };

export function filterListings(list: Listing[], f: Filter): Listing[] {
  const tokens = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const scored: Array<{ l: Listing; s: number }> = [];
  for (const l of list) {
    if (f.kind && f.kind !== "all" && l.kind !== f.kind) continue;
    if (f.category && f.category !== "all" && l.category !== f.category) continue;
    if (f.source === "official" && !l.official) continue;
    if (f.source === "community" && l.official) continue;
    let s = 0;
    let all = true;
    const name = l.name.toLowerCase(), tag = l.tags.join(" ").toLowerCase(), line = l.tagline.toLowerCase(), cat = l.category.toLowerCase();
    for (const t of tokens) {
      const h = (name.includes(t) ? 5 : 0) + (tag.includes(t) ? 3 : 0) + (line.includes(t) ? 2 : 0) + (cat.includes(t) ? 2 : 0);
      if (!h) { all = false; break; }
      s += h;
    }
    if (all) scored.push({ l, s });
  }
  return scored.sort((a, b) => b.s - a.s || Number(b.l.official) - Number(a.l.official) || (b.l.installs ?? 0) - (a.l.installs ?? 0) || a.l.name.localeCompare(b.l.name)).map((x) => x.l);
}

export const categoriesOf = (list: Listing[]): string[] => [...new Set(list.map((l) => l.category))].sort();

// ---------- publishing: every user-made listing passes through here (on the server) ----------
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, max);
const oneLine = (v: unknown, max: number) => clean(v, max).replace(/\s+/g, " ");
const bad = (error: string) => ({ ok: false as const, error });

export function validatePublish(raw: unknown): { ok: true; value: PublishValue } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const kind = r.kind as ListingKind;
  if (!["skill", "agent", "automation"].includes(kind)) return bad("Choose what you are sharing: a skill, an agent or an automation.");
  const name = oneLine(r.name, 60);
  if (name.length < 3) return bad("Give it a name (at least 3 characters).");
  const tagline = oneLine(r.tagline, 160);
  if (tagline.length < 10) return bad("Write a one-line description (at least 10 characters).");
  const category = oneLine(r.category, 24) || "Other";
  const tags = Array.isArray(r.tags) ? [...new Set<string>(r.tags.map((t: unknown) => oneLine(t, 24).toLowerCase()).filter(Boolean))].slice(0, 6) : [];
  const base = { kind, name, tagline, category, tags };

  if (kind === "skill") {
    const instructions = clean(r.skill?.instructions, 8000);
    if (instructions.length < 40) return bad("A skill needs real instructions (at least 40 characters).");
    return { ok: true, value: { ...base, skill: { name, description: tagline, instructions } } };
  }

  if (kind === "agent") {
    const role = oneLine(r.agent?.role, 400);
    if (role.length < 20) return bad("Describe the agent's role (at least 20 characters), for example: You are a calm support lead who ...");
    const tool: ToolKind = TOOLS.includes(r.agent?.tool) ? r.agent.tool : "think";
    const skills: SkillSpec[] = (Array.isArray(r.agent?.skills) ? r.agent.skills : []).slice(0, 4).map((s: any) => {
      const n = oneLine(s?.name, 60);
      return { name: n, description: oneLine(s?.description, 160) || n, instructions: clean(s?.instructions, 6000) };
    }).filter((s: SkillSpec) => s.name.length >= 3 && s.instructions.length >= 40);
    return { ok: true, value: { ...base, agent: { role, tool, skills } } };
  }

  const instructions = clean(r.routine?.instructions, 4000);
  if (instructions.length < 20) return bad("An automation needs instructions (at least 20 characters).");
  const s = r.routine?.schedule;
  let schedule: Sched;
  if (s?.kind === "every") {
    const minutes = Math.round(Number(s.minutes));
    if (!(minutes >= 60 && minutes <= 43200)) return bad("Shared automations must run at most once an hour and at least once a month.");
    schedule = { kind: "every", minutes };
  } else {
    const expr = oneLine(s?.expr, 60);
    if (!CRON_RE.test(expr)) return bad('The schedule must be a 5-field cron expression, for example "0 9 * * 1-5".');
    schedule = { kind: "cron", expr };
  }
  const keys = extractFields(instructions);
  if (keys.length > 4) return bad("Use at most 4 {{placeholders}} in an automation.");
  const given: any[] = Array.isArray(r.fields) ? r.fields : [];
  const fields: Field[] = keys.map((k) => {
    const g = given.find((x) => x?.key === k);
    return { key: k, label: oneLine(g?.label, 40) || humanize(k), placeholder: oneLine(g?.placeholder, 80) };
  });
  const needs = (Array.isArray(r.needs) ? r.needs : []).filter((x: unknown) => typeof x === "string" && x in CONNECTORS).slice(0, 6) as string[];
  const routine: RoutineSpec = {
    instructions,
    schedule,
    mode: ["auto", "lite", "agent"].includes(r.routine?.mode) ? r.routine.mode : "auto",
    toChat: r.routine?.toChat !== false,
    allowWrites: r.routine?.allowWrites === true,
    notify: ["always", "changes", "smart"].includes(r.routine?.notify) ? r.routine.notify : "always",
  };
  return { ok: true, value: { ...base, routine, needs, fields } };
}

/** All the text of a listing, for the secret and injection scans. */
export function textOf(l: Pick<Listing, "name" | "tagline" | "skill" | "agent" | "routine">): string {
  return [l.name, l.tagline, l.skill?.instructions, l.agent?.role, ...(l.agent?.skills ?? []).map((s) => s.instructions), l.routine?.instructions]
    .filter(Boolean).join("\n\n");
}
