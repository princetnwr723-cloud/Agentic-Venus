// Run cost and the budget latch. Pure functions: the server keeps the numbers in Firestore (store.ts).
//   - every model call adds real token counts and an ESTIMATED cost (list prices, not a bill)
//   - when the provider or the plan says "no more", a latch is armed until the reset time: scheduled routines and new runs
//     SKIP (they stay due, nothing fails, nothing is lost) instead of failing again and again.
import type { Latch, Usage } from "./types.ts";
import type { Classified } from "./provider-errors.ts";

export const emptyUsage = (): Usage => ({ inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0 });
export const addUsage = (a: Usage, b: Usage): Usage => ({ inTok: a.inTok + b.inTok, outTok: a.outTok + b.outTok, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite });
export const totalTokensOf = (u: Usage) => u.inTok + u.outTok + u.cacheRead + u.cacheWrite;

// USD per million tokens: [pattern, input, output]. Rough list prices: an ESTIMATE.
const PRICES: Array<[RegExp, number, number]> = [
  [/opus/i, 15, 75], [/sonnet/i, 3, 15], [/haiku/i, 1, 5],
  [/gpt-?5.*mini|4o-?mini|o\d-?mini/i, 0.25, 2], [/gpt-?5/i, 1.25, 10], [/gpt-?4o/i, 2.5, 10], [/gpt-?4\.1/i, 2, 8], [/\bo[134]\b/i, 10, 40],
  [/gemini.*pro/i, 1.25, 10], [/gemini.*flash/i, 0.3, 2.5], [/flash/i, 0.1, 0.4],
  [/deepseek/i, 0.3, 1.1], [/grok/i, 3, 15], [/mistral.*large/i, 2, 6], [/mistral|mixtral/i, 0.4, 1.2], [/llama|groq/i, 0.6, 0.8],
];
const DEFAULT_PRICE: [number, number] = [1, 3];

/** Millionths of a dollar. Cached input is read at 10% and written at 125% of the input price. */
export function costMicros(model: string, u: Usage): number {
  const [pin, pout] = PRICES.find(([re]) => re.test(model))?.slice(1) as [number, number] ?? DEFAULT_PRICE;
  return Math.round(u.inTok * pin + u.outTok * pout + u.cacheRead * pin * 0.1 + u.cacheWrite * pin * 1.25);
}
export const formatUsd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`;

// ---------- latch ----------
const THIRTY_MIN = 30 * 60_000;
export const latchActive = (l: Latch | null | undefined, now: number): l is Latch => Boolean(l && l.until > now);

/** A latch from a provider error. Only errors that stay true for a while arm it. */
export function latchFromError(c: Classified, now: number): Latch | null {
  if (c.code === "usage_limit") return { kind: "provider", reason: c.message.slice(0, 200), armedAt: now, until: now + Math.max(c.retryAfterMs ?? 0, THIRTY_MIN) };
  if (c.code === "rate_limited" && (c.retryAfterMs ?? 0) >= 10 * 60_000) return { kind: "provider", reason: "The provider is rate limiting this key for a long time.", armedAt: now, until: now + (c.retryAfterMs ?? THIRTY_MIN) };
  return null;
}

export const latchFromPlan = (resetAt: number, now: number, reason: string): Latch => ({ kind: "plan", reason: reason.slice(0, 200), armedAt: now, until: Math.max(resetAt, now + 60_000) });
export const latchFromCost = (now: number, costMicrosNow: number, capMicros: number): Latch => ({ kind: "cost", armedAt: now, until: now + 3600_000, reason: `One run spent ${formatUsd(costMicrosNow)}, over the ${formatUsd(capMicros)} cap.` });

export const describeLatch = (l: Latch, now: number): string => {
  const mins = Math.max(1, Math.ceil((l.until - now) / 60_000));
  return `Paused until the limit resets (about ${mins >= 90 ? `${Math.round(mins / 60)} h` : `${mins} min`}): ${l.reason}`;
};

/** Window end of the plan's token window (same maths as billing-server). */
export const windowResetAt = (windowStart: number, windowHours: number) => windowStart + windowHours * 3600_000;

// ---------- reports ----------
export type RunRow = { id: string; status: string; model: string; createdAt: number; endedAt?: number; costMicros: number; usage: Usage; calls: number; rounds: number };
export type Report = {
  days: number; runs: number; done: number; failed: number; stopped: number; tokens: number; costMicros: number;
  byModel: Record<string, { runs: number; tokens: number; costMicros: number }>; byDay: Array<{ day: string; runs: number; costMicros: number }>;
  avgSeconds: number;
};

export function summarizeRuns(rows: RunRow[], now: number, days = 7): Report {
  const from = now - days * 86_400_000;
  const list = rows.filter((r) => r.createdAt >= from);
  const byModel: Report["byModel"] = {};
  const byDayMap = new Map<string, { runs: number; costMicros: number }>();
  let done = 0, failed = 0, stopped = 0, tokens = 0, cost = 0, secs = 0, timed = 0;
  for (const r of list) {
    if (r.status === "done") done++; else if (r.status === "stopped") stopped++; else if (r.status === "error" || r.status === "budget") failed++;
    const t = totalTokensOf(r.usage);
    tokens += t; cost += r.costMicros;
    const m = (byModel[r.model] ||= { runs: 0, tokens: 0, costMicros: 0 });
    m.runs++; m.tokens += t; m.costMicros += r.costMicros;
    const day = new Date(r.createdAt).toISOString().slice(0, 10);
    const d = byDayMap.get(day) ?? { runs: 0, costMicros: 0 };
    byDayMap.set(day, { runs: d.runs + 1, costMicros: d.costMicros + r.costMicros });
    if (r.endedAt) { secs += (r.endedAt - r.createdAt) / 1000; timed++; }
  }
  return {
    days, runs: list.length, done, failed, stopped, tokens, costMicros: cost, byModel,
    byDay: [...byDayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
    avgSeconds: timed ? Math.round(secs / timed) : 0,
  };
}

/** The model's context window in tokens. A good guess is enough: compaction starts at 75% of it (never above 150k). */
export function contextWindow(model: string): number {
  const m = model.toLowerCase();
  if (/gemini/.test(m)) return 1_000_000;
  if (/claude/.test(m)) return 200_000;
  if (/gpt-?5|gpt-?4\.1/.test(m)) return 400_000;
  if (/gpt-?4o|\bo[134]\b|llama|mistral|mixtral|grok/.test(m)) return 128_000;
  if (/deepseek/.test(m)) return 64_000;
  return 100_000;
}
