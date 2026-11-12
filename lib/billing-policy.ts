// What happens when the billing database itself fails (not when a user is over a limit).
//   gate  = a check BEFORE work starts (token check, computer-time check, daily video/site allowance).
//           If we cannot read the usage, we cannot know the user is within the limit, so we say "try again" (503). FAIL CLOSED.
//   meter = a write AFTER work already happened (add tokens, close a computer job).
//           The work cannot be undone, so it is retried; if it still fails the loss is written to an audit list, never silent.
// Limit errors (402, any RequestError) always pass through untouched.
// BILLING_FAIL_OPEN=true brings the old behaviour back (gates let work through) - an emergency switch, not a default.

/** Thrown by a gate when billing cannot be read. status 503 so every route answers "try again", not a limit message. */
export class BillingUnavailable extends Error {
  readonly status = 503;
  constructor(message = "Billing is temporarily unavailable, so this could not be started. Please try again in a moment.") { super(message); this.name = "BillingUnavailable"; }
}

export type Mode = "gate" | "meter";
export type Lost = { kind: string; uid: string; error: string; at: number; detail?: unknown };

export type GuardOpts<T> = {
  mode: Mode;
  /** value returned when a meter or an emergency-open gate gives up */
  fallback: T;
  /** which operation, for the audit row */
  kind: string;
  uid: string;
  detail?: unknown;
  failOpen?: boolean;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  onLost?: (l: Lost) => Promise<unknown> | unknown;
  /** build the error a closed gate throws (billing-server passes a RequestError so routes treat it like every other request error) */
  unavailable?: () => Error;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const envFailOpen = (env: Record<string, string | undefined> = process.env) => /^(1|true|yes)$/i.test(String(env.BILLING_FAIL_OPEN ?? ""));
/** A user-facing limit / request error (RequestError, status 4xx): never retried, never swallowed. */
const isLimit = (e: unknown) => {
  if (!(e instanceof Error)) return false;
  if (e.name === "RequestError") return true;
  const st = (e as unknown as { status?: unknown }).status;
  return typeof st === "number" && st >= 400 && st < 500;
};

export async function guarded<T>(run: () => Promise<T>, o: GuardOpts<T>): Promise<T> {
  const retries = o.retries ?? (o.mode === "gate" ? 1 : 2);
  const sleep = o.sleep ?? wait;
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try { return await run(); }
    catch (e) {
      if (isLimit(e)) throw e;
      last = e;
      if (i < retries) await sleep(150 * 2 ** i);
    }
  }
  const msg = last instanceof Error ? last.message : String(last);
  if (o.mode === "gate") {
    if (o.failOpen) return o.fallback;
    throw o.unavailable ? o.unavailable() : new BillingUnavailable();
  }
  try { await o.onLost?.({ kind: o.kind, uid: o.uid, error: msg.slice(0, 300), at: Date.now(), detail: o.detail }); } catch { /* the audit row is best effort */ }
  return o.fallback;
}
