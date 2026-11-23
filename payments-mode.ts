// Payments launch switch. PURE (no imports): used by app/api/vpassword/route.ts and tested with node --test.
//
//   VENUS_PAYMENTS_MODE = off   -> the agent can not ask for any payment (cards stay saved, nothing is released)
//                         beta  -> DEFAULT. Every payment still needs YOUR approval in the app (that is always true), and in beta
//                                  a card must also be tied to one site, must have a per-payment limit, and no payment may be
//                                  bigger than VENUS_BETA_MAX_PAYMENT (default 1000 units of the card's currency).
//                         on    -> the normal rules only (site or "any site", limits optional)
//
// The agent never sees the card, a payment is approved by a signed-in human, and each approval is single-use and amount-bound.
// These rules only make the first weeks of a public launch safer. Real virtual cards (a card number made for one purchase) are the
// next step and need a card-issuing provider, so they are not part of this file.

export type PaymentsMode = "off" | "beta" | "on";
type Env = Record<string, string | undefined>;

export function paymentsMode(env: Env = (typeof process !== "undefined" ? process.env : {}) as Env): PaymentsMode {
  const v = String(env.VENUS_PAYMENTS_MODE ?? "").trim().toLowerCase();
  return v === "off" || v === "on" ? v : "beta";
}

export function betaMaxPayment(env: Env = (typeof process !== "undefined" ? process.env : {}) as Env): number {
  const n = Number(env.VENUS_BETA_MAX_PAYMENT);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

export const PAYMENTS_OFF_TEXT = "Payments by the agent are switched off on this server for now. Nothing was asked of the owner and no card was used.";

/** Checked when the agent asks for a payment. Returns an error text, or "" when the request may go on to the owner for approval. */
export function paymentRequestProblem(amount: number, env?: Env): string {
  const mode = paymentsMode(env);
  if (mode === "off") return PAYMENTS_OFF_TEXT;
  if (mode === "beta") {
    const max = betaMaxPayment(env);
    if (!(amount > 0)) return "The payment amount is missing.";
    if (amount > max) return `During the beta a single payment can be at most ${max}. This one is ${amount}. Nothing was asked of the owner.`;
  }
  return "";
}

export type CardDraft = { site: string; anySite: boolean; limit: number };

/** Checked when a card is saved. Returns an error text, or "" when it is fine. In beta a card needs a site and a per-payment limit (a missing limit is filled in by `cardLimitFor`). */
export function cardSaveProblem(c: CardDraft, env?: Env): string {
  if (paymentsMode(env) !== "beta") return "";
  if (c.anySite || !c.site) return "During the beta a card must be tied to one site (for example amazon.in). “Any site” is switched off.";
  const max = betaMaxPayment(env);
  if (c.limit > max) return `During the beta the per-payment limit can be at most ${max}.`;
  return "";
}

/** The per-payment limit to store: the owner's own number, or the beta maximum when none was given. */
export function cardLimitFor(limit: number, env?: Env): number {
  if (paymentsMode(env) !== "beta") return limit;
  return limit > 0 ? limit : betaMaxPayment(env);
}
