// Single source of truth for plans. Safe to import from client AND server code.
//
// Limits are written as multipliers ("x") of the Free plan, not as fixed numbers:
//   Free 1x -> Pro 10x Free -> Plus 3x Pro -> Max 10x Plus -> Max 2x is 2x Max -> Ultra is 20x Max 2x.
// To change every limit at once, edit BASE below. To change a step of the ladder, edit its "x" in STEPS.

export type PlanId = "free" | "pro" | "plus" | "max" | "max2x" | "ultra";

export type PlanDef = {
  id: PlanId;
  name: string;
  price: number; // USD per month
  tagline: string;
  badge?: string;
  mult: number; // how many times the Free plan's allowance this plan gets (Pro = 10, Plus = 30, ...)
  rel: string; // the hint shown to people: "1x", "10x Free", "3x Pro", ...
  tokens: number | null; // AI tokens per window, used for metering only (UI shows percentages). null = unlimited
  pcSeconds: number | null; // computer-agent seconds per window (null = unlimited)
  alwaysOn: boolean; // the computer-agent allowance covers the whole window
  windowHours: number; // every plan refreshes on the same window, like Claude Free (5 hours)
  videosPerDay: number; // Venus Pro: finished videos per rolling 24 hours
  sitesPerDay: number; // Venus Code: websites / projects built per rolling 24 hours
  earlyLevel: number; // 0 = none. Gate future features with hasEarly(plan, level)
  perks: string[];
};

/** Claude Free has no fixed message count: it is a session limit that resets every 5 hours. Same here. */
export const WINDOW_HOURS = 5;

/** What the Free plan (1x) gets. Every other plan is a multiple of this. */
const BASE = {
  tokens: 100_000, // AI tokens per window (metering only)
  pcSeconds: 12 * 60, // computer-agent time per window
  videos: 1, // Venus Pro videos per day
  sites: 1, // Venus Code websites per day
};

type Step = {
  id: PlanId;
  name: string;
  price: number;
  tagline: string;
  badge?: string;
  x: number; // times the plan BEFORE it (ignored for Free)
  early: number;
  earlyText?: string;
};

const STEPS: Step[] = [
  { id: "free", name: "Free", price: 0, tagline: "Try the team. No card needed.", x: 1, early: 0 },
  { id: "pro", name: "Pro", price: 19, tagline: "Your first real teammate.", x: 10, early: 1, earlyText: "Early access: small new features first" },
  { id: "plus", name: "Plus", price: 59, tagline: "Run a small team.", badge: "Most popular", x: 3, early: 2, earlyText: "Early access: beta features" },
  { id: "max", name: "Max", price: 100, tagline: "Work like a company.", x: 10, early: 3, earlyText: "Early access: new features and tools" },
  { id: "max2x", name: "Max 2x", price: 200, tagline: "Double the horsepower.", x: 2, early: 4, earlyText: "Early access: new models as they ship" },
  {
    id: "ultra", name: "Ultra", price: 500, tagline: "The biggest limits. First in line.", x: 20, early: 5,
    earlyText: "Early access: AgenticVenus FOUNT, our upcoming agentic model (when it launches)",
  },
];

const num = (n: number) => n.toLocaleString("en-US");
/** 30 -> "30x" */
export const fmtMult = (n: number) => `${num(n)}x`;
const plural = (n: number, one: string) => `${num(n)} ${one}${n === 1 ? "" : "s"}`;

export const PLANS: PlanDef[] = STEPS.reduce<PlanDef[]>((list, s, i) => {
  const prev = i > 0 ? STEPS[i - 1] : null;
  const mult = prev ? list[i - 1].mult * s.x : 1;
  const rel = prev ? `${fmtMult(s.x)} ${prev.name}` : "1x";
  const windowSeconds = WINDOW_HOURS * 3600;
  const wantedPc = BASE.pcSeconds * mult;
  const alwaysOn = wantedPc >= windowSeconds;
  const videosPerDay = BASE.videos * mult;
  const sitesPerDay = BASE.sites * mult;

  const perks = [
    prev ? (prev.id === "free" ? `${rel} usage limits` : `${rel} usage limits (${fmtMult(mult)} Free)`) : `1x usage, refreshes every ${WINDOW_HOURS} hours`,
    alwaysOn ? "Computer agent: always on" : `Computer agent time: ${fmtMult(mult)} Free`,
    `${plural(videosPerDay, "video")} per day with Venus Pro`,
    `${plural(sitesPerDay, "website")} per day with Venus Code`,
    prev ? `Everything in ${prev.name}` : "Chat, memory and skills",
    ...(prev ? [] : ["Bring your own AI keys"]),
    ...(s.earlyText ? [s.earlyText] : []),
  ];

  list.push({
    id: s.id,
    name: s.name,
    price: s.price,
    tagline: s.tagline,
    ...(s.badge ? { badge: s.badge } : {}),
    mult,
    rel,
    tokens: BASE.tokens * mult,
    pcSeconds: Math.min(wantedPc, windowSeconds),
    alwaysOn,
    windowHours: WINDOW_HOURS,
    videosPerDay,
    sitesPerDay,
    earlyLevel: s.early,
    perks,
  });
  return list;
}, []);

export const planById = (id: string): PlanDef => PLANS.find((p) => p.id === id) ?? PLANS[0];
export const isPaid = (id: string) => PLANS.some((p) => p.id === id && p.price > 0);
export const fullName = (p: PlanDef) => `AgenticVenus ${p.name}`;
export const nextPlan = (id: PlanId): PlanDef | null => {
  const i = PLANS.findIndex((p) => p.id === id);
  return i >= 0 && i < PLANS.length - 1 ? PLANS[i + 1] : null;
};

/** Gate a future feature: hasEarly(plan, 3) = Max and above. */
export const hasEarly = (id: PlanId, level: number) => planById(id).earlyLevel >= level;

export const fmtTokens = (n: number | null) =>
  n === null ? "Unlimited" : n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`;

export function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "Unlimited";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  const h = Math.round((seconds / 3600) * 10) / 10;
  return `${h} hour${h === 1 ? "" : "s"}`;
}