// All documentation data lives in lib/docs-*.ts, so you can edit text, ratings and sections without touching the UI.
// Rule for this documentation: describe what the product DOES. Never name the internal services it runs on.
import { SECTIONS_A } from "@/lib/docs-sections-a";
import { SECTIONS_B } from "@/lib/docs-sections-b";
import { SECTIONS_C } from "@/lib/docs-sections-c";

export const PRODUCT = {
  name: "AgenticVenus",
  tagline: "Agent Works: AI that does the work.",
  intro:
    "AgenticVenus gives you AI teammates with their own computer, their own phone line and their own memory. They research, build, create, call, write and follow up while you are away, and they come back only when a decision needs you. The goal is simple: take real work off human hands.",
};

export type IconKey =
  | "monitor" | "code" | "film" | "users" | "brain" | "plug" | "key" | "phone"
  | "rocket" | "clock" | "shield" | "check" | "message" | "git" | "sparkles" | "layers" | "map" | "book" | "tag";

export type Tag = "Now" | "Beta" | "Soon" | "Planned";
export type Widget = "ratings" | "plans";

/** One documentation section. Only `t` is required. */
export type Sec = {
  t: string;                 // title
  kw?: string;               // extra search words
  p?: string;                // paragraph. **bold** and `code` are supported
  pts?: string[];            // bullet list
  steps?: string[];          // numbered list
  code?: string;             // code / example block
  codeLabel?: string;
  note?: string;             // info callout
  warn?: string;             // warning callout
  table?: string[][];        // first row = header
  tag?: Tag;
  widget?: Widget;
};

export type Group = { id: string; title: string; blurb: string; icon: IconKey; items: Sec[] };

export const GROUPS: Group[] = [...SECTIONS_A, ...SECTIONS_B, ...SECTIONS_C];

export const TOTAL_SECTIONS = GROUPS.reduce((n, g) => n + g.items.length, 0);

export const AGENTS = ["AgenticVenus", "OpenClaw", "Hermes Agent", "Grok-based bots", "OpenAI agents"] as const;

// scores are 0-10 per agent, in the same order as AGENTS. They are indicative and subjective.
export const RATINGS: Array<{ dim: string; why: string; scores: number[] }> = [
  { dim: "Own visible computer", why: "Desktop + browser + terminal you can watch and take over", scores: [8, 6, 6, 2, 7] },
  { dim: "Model freedom", why: "Bring your own keys, switch providers, fallback chain", scores: [9, 8, 9, 2, 2] },
  { dim: "Verified results", why: "Independent checks before a result is delivered", scores: [8, 5, 5, 3, 5] },
  { dim: "Secret handling", why: "Encrypted vault, approvals, agent never sees passwords", scores: [8, 6, 6, 7, 8] },
  { dim: "Memory & self-improvement", why: "Remembers, learns skills, fixes failing skills", scores: [7, 7, 9, 5, 6] },
  { dim: "Chat channels", why: "Telegram, WhatsApp, SMS, Slack, and more", scores: [6, 9, 8, 5, 6] },
  { dim: "Team / multi-agent", why: "Planner + specialists working in parallel", scores: [8, 6, 6, 3, 5] },
  { dim: "Phone calls", why: "Own number, voice, live owner notes, summaries", scores: [8, 4, 4, 1, 2] },
  { dim: "Setup ease (non-dev)", why: "How fast a non-technical person gets going", scores: [6, 5, 5, 9, 9] },
  { dim: "Maturity & community", why: "Age, users, docs, ecosystem", scores: [3, 9, 7, 7, 10] },
  { dim: "Self-host / data control", why: "Run it yourself, own your data", scores: [7, 10, 10, 1, 1] },
];

export type Cell = "yes" | "part" | "no";
export const MATRIX: Array<{ row: string; v: Cell[] }> = [
  { row: "Visible desktop computer", v: ["yes", "part", "part", "no", "part"] },
  { row: "Bring-your-own model keys", v: ["yes", "yes", "yes", "no", "no"] },
  { row: "Keeps working with the tab closed", v: ["yes", "yes", "yes", "part", "part"] },
  { row: "Independent result verification", v: ["yes", "no", "no", "no", "part"] },
  { row: "Encrypted vault + approvals", v: ["yes", "part", "part", "part", "yes"] },
  { row: "Self-improving skills", v: ["yes", "part", "yes", "no", "no"] },
  { row: "Chat apps (Telegram / WhatsApp / Slack)", v: ["yes", "yes", "yes", "part", "part"] },
  { row: "Phone calls with voice", v: ["yes", "part", "part", "no", "no"] },
  { row: "Built-in video studio", v: ["yes", "no", "no", "no", "no"] },
  { row: "Built-in coding workspace", v: ["yes", "part", "part", "no", "part"] },
  { row: "Built-in maps and lead tools", v: ["yes", "no", "no", "no", "no"] },
  { row: "Multi-specialist team", v: ["yes", "part", "part", "no", "part"] },
  { row: "Self-hostable", v: ["yes", "yes", "yes", "no", "no"] },
];
