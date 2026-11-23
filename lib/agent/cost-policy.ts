// How much ONE agent run may spend on AI calls before it stops and asks the owner to continue (see loop.ts latchFromCost).
// It used to be one number (3 dollars) for everybody. A Free user running on their own key should hit a small cap long before a
// runaway loop costs real money; paid plans get more room. PURE: no imports, tested with node --test.
//
// Money here is in micro-dollars (1_000_000 = 1 dollar), the same unit as budget.ts.

export const MICROS = 1_000_000;

/** Default cap per run, by plan. The owner of the deployment is never capped (worker.ts). */
export const PLAN_RUN_COST_MICROS: Record<string, number> = {
  free: 0.6 * MICROS,
  pro: 2.5 * MICROS,
  plus: 4 * MICROS,
  max: 8 * MICROS,
  max2x: 10 * MICROS,
  ultra: 15 * MICROS,
};
export const FALLBACK_RUN_COST_MICROS = 0.6 * MICROS; // an unknown plan is treated like Free, never like Ultra

type Env = Record<string, string | undefined>;

/**
 * The per-run cap for a plan.
 *   AGENT_RUN_COST_USD            one number for every non-owner plan (emergency / testing)
 *   AGENT_RUN_COST_USD_<PLAN>     one plan, e.g. AGENT_RUN_COST_USD_FREE=0.25
 */
export function runCostBase(planId: string, env: Env = (typeof process !== "undefined" ? process.env : {}) as Env): number {
  const id = String(planId || "").toLowerCase();
  const one = Number(env[`AGENT_RUN_COST_USD_${id.toUpperCase()}`]);
  if (Number.isFinite(one) && one > 0) return Math.round(one * MICROS);
  const all = Number(env.AGENT_RUN_COST_USD);
  if (Number.isFinite(all) && all > 0) return Math.round(all * MICROS);
  return PLAN_RUN_COST_MICROS[id] ?? FALLBACK_RUN_COST_MICROS;
}
