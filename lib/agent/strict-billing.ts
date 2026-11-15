// Token metering for agent runs that FAILS CLOSED. The old path (billing-server.ts) lets everything through when Firestore
// has a hiccup and counts tokens only after the answer (chars / 4). Here:
//   reserve  -> before every model call, in ONE transaction: refuse when the window is used up (plan_limit + reset time)
//   settle   -> after the call: replace the estimate with the real token count from the provider
// If the billing database itself cannot be reached the call is refused too (set AGENT_BILLING_FAIL_OPEN=true to allow it).
// The OWNER of the deployment (lib/owner.ts) is never metered or refused: pass `unlimited` and it is asked first.
// It reads and writes the same documents as billing-server.ts: users/{uid}/billing/usage { windowStart, tokens }.
import type { DbLike } from "./store.ts";

export type PlanLimits = { tokens: number | null; windowHours: number; name: string };
export type PlanResolver = (planDoc: unknown, now: number) => PlanLimits;

export class PlanLimitError extends Error {
  readonly code = "plan_limit";
  readonly status = 402;
  readonly resetAt: number;
  constructor(message: string, resetAt: number) { super(message); this.name = "PlanLimitError"; this.resetAt = resetAt; }
}
export class BillingUnavailableError extends Error {
  readonly code = "billing_unavailable";
  readonly status = 503;
  constructor() { super("The usage meter is not reachable right now, so the run was not started. Try again in a minute."); this.name = "BillingUnavailableError"; }
}

const fmt = (ms: number) => { const m = Math.max(1, Math.ceil(ms / 60_000)); return m >= 90 ? `${Math.round(m / 60)} h` : `${m} min`; };

export function createStrictBilling(db: DbLike, plan: PlanResolver, failOpen = false, unlimited?: (uid: string) => Promise<boolean>) {
  const free = async (uid: string): Promise<boolean> => { try { return unlimited ? await unlimited(uid) : false; } catch { return false; } };
  const base = (uid: string) => db.collection("users").doc(uid).collection("billing");

  async function adjust(uid: string, delta: (used: number, lim: PlanLimits, now: number) => { add: number; refuse?: string }): Promise<void> {
    const now = Date.now();
    try {
      await db.runTransaction(async (tx) => {
        const pRef = base(uid).doc("plan"), uRef = base(uid).doc("usage");
        const [ps, us] = await Promise.all([tx.get(pRef), tx.get(uRef)]);
        const lim = plan(ps.exists ? ps.data() : undefined, now);
        const u = (us.exists ? us.data() : {}) as { windowStart?: number; tokens?: number };
        const ms = lim.windowHours * 3600_000;
        const rolled = !u.windowStart || now - u.windowStart >= ms;
        const windowStart = rolled ? now : (u.windowStart as number);
        const used = rolled ? 0 : Number(u.tokens) || 0;
        const out = delta(used, lim, now);
        if (out.refuse) throw new PlanLimitError(`${out.refuse} It refreshes in ${fmt(windowStart + ms - now)}.`, windowStart + ms);
        tx.set(uRef, { windowStart, tokens: Math.max(0, Math.round(used + out.add)) }, { merge: true });
      });
    } catch (e) {
      if (e instanceof PlanLimitError) throw e;
      if (failOpen) return;
      throw new BillingUnavailableError();
    }
  }

  return {
    reserve: async (uid: string, est: number): Promise<void> => {
      if (await free(uid)) return;
      await adjust(uid, (used, lim) => (lim.tokens !== null && used + est > lim.tokens ? { add: 0, refuse: `AI token limit reached on the ${lim.name} plan.` } : { add: est }));
    },
    settle: async (uid: string, reserved: number, actual: number): Promise<void> => {
      if (await free(uid)) return;
      await adjust(uid, () => ({ add: actual - reserved })).catch(() => {});
    },
  };
}
