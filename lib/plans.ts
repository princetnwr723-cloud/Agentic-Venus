// Single source of truth for plans. Safe to import from client AND server code.

export type PlanId = "free" | "pro" | "plus" | "max" | "max2x" | "ultra";

export type PlanDef = {
  id: PlanId;
  name: string;
  price: number; // USD per month
  tagline: string;
  badge?: string;
  tokens: number | null; // AI tokens per window (null = unlimited)
  pcSeconds: number | null; // computer-agent seconds per window (null = unlimited)
  windowHours: number; // how often the allowance refreshes
  earlyLevel: number; // 0 = none. Gate future features with hasEarly(plan, level)
  perks: string[];
};

const H = 3600;

export const PLANS: PlanDef[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    tagline: "Try the team. No card needed.",
    tokens: 100_000,
    pcSeconds: 1 * H,
    windowHours: 24,
    earlyLevel: 0,
    perks: [
      "100k AI tokens per day",
      "1 hour of computer agent per day",
      "Chat, memory and skills",
      "Bring your own AI keys",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 19,
    tagline: "Your first real teammate.",
    tokens: 250_000,
    pcSeconds: 2 * H,
    windowHours: 6,
    earlyLevel: 1,
    perks: [
      "250k AI tokens every 6 hours",
      "2 hours of computer agent every 6 hours",
      "Everything in Free",
      "Early access: small new features first",
    ],
  },
  {
    id: "plus",
    name: "Plus",
    price: 59,
    tagline: "Run a small team.",
    badge: "Most popular",
    tokens: 500_000,
    pcSeconds: 3 * H,
    windowHours: 6,
    earlyLevel: 2,
    perks: [
      "500k AI tokens every 6 hours",
      "3 hours of computer agent every 6 hours",
      "Everything in Pro",
      "Early access: beta features",
    ],
  },
  {
    id: "max",
    name: "Max",
    price: 100,
    tagline: "Work like a company.",
    tokens: 1_000_000,
    pcSeconds: 4 * H,
    windowHours: 6,
    earlyLevel: 3,
    perks: [
      "1M AI tokens every 6 hours",
      "4 hours of computer agent every 6 hours",
      "Everything in Plus",
      "Early access: new features and tools",
    ],
  },
  {
    id: "max2x",
    name: "Max 2x",
    price: 200,
    tagline: "Double the horsepower.",
    tokens: 2_000_000,
    pcSeconds: 6 * H, // a 6-hour window cannot hold more: this is "always on"
    windowHours: 6,
    earlyLevel: 4,
    perks: [
      "2M AI tokens every 6 hours",
      "Computer agent always on (6 of every 6 hours)",
      "Everything in Max",
      "Early access: new models as they ship",
    ],
  },
  {
    id: "ultra",
    name: "Ultra",
    price: 500,
    tagline: "No limits. First in line.",
    tokens: null,
    pcSeconds: null,
    windowHours: 6,
    earlyLevel: 5,
    perks: [
      "Unlimited AI tokens",
      "Unlimited computer agent time",
      "Everything in Max 2x",
      "Early access: AgenticVenus FOUNT, our upcoming agentic model (when it launches)",
    ],
  },
];

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
