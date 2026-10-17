// Server-only. Plan state, usage metering and Gumroad helpers.
// Firestore layout (written ONLY by the server, never by the browser):
//   users/{uid}/billing/plan   -> which plan the user paid for
//   users/{uid}/billing/usage  -> tokens + computer time inside the current window
//   billingIndex/{subscriptionId | saleId} -> uid (so later Gumroad events find the user)
//   billingUnclaimed/{saleId}  -> paid sales we could not tie to a user (check by hand)
//   billingEvents/*            -> small audit log
import { createHmac, timingSafeEqual } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { RequestError } from "@/lib/request";
import { fmtDuration, fmtTokens, nextPlan, planById, type PlanDef, type PlanId } from "@/lib/plans";

const db = () => getAdminDb();
const base = (uid: string) => db().collection("users").doc(uid).collection("billing");
const planRef = (uid: string) => base(uid).doc("plan");
const usageRef = (uid: string) => base(uid).doc("usage");

const DAY = 86_400_000;
const GRACE_MS = 3 * DAY; // late renewal payments do not cut access instantly
const MAX_JOB_MS = 130 * 60_000; // a computer job never runs longer than ~2h

export type PlanDoc = {
  plan?: PlanId;
  status?: "active" | "ended";
  cancelled?: boolean;
  renewsAt?: number;
  accessUntil?: number;
  subscriptionId?: string;
  saleId?: string;
  email?: string;
  updatedAt?: number;
};
type Open = { sandboxId: string; since: number; seen: number };
type UsageDoc = { windowStart?: number; tokens?: number; pcSeconds?: number; pcOpen?: Record<string, Open> };
type Norm = { windowStart: number; tokens: number; pcSeconds: number; pcOpen: Record<string, Open> };
type Ctx = { plan: PlanDef; n: Norm; now: number; patch: Record<string, unknown>; doc: PlanDoc | undefined };

export const estTokens = (chars: number) => Math.ceil(Math.max(0, chars) / 4);

// ---------------- which plan applies right now ----------------
export function effectivePlan(d?: PlanDoc | null, now = Date.now()): PlanId {
  if (!d || !d.plan || d.plan === "free") return "free";
  return d.status === "active" && Number(d.accessUntil || 0) > now ? d.plan : "free";
}

function norm(u: UsageDoc | undefined, p: PlanDef, now: number): Norm {
  const ms = p.windowHours * 3600_000;
  const ws = Number(u?.windowStart) || 0;
  if (!ws || now - ws >= ms) return { windowStart: now, tokens: 0, pcSeconds: 0, pcOpen: u?.pcOpen ?? {} };
  return { windowStart: ws, tokens: Number(u?.tokens) || 0, pcSeconds: Number(u?.pcSeconds) || 0, pcOpen: u?.pcOpen ?? {} };
}

function liveSeconds(open: Record<string, Open>, ws: number, now: number): number {
  let s = 0;
  for (const o of Object.values(open)) {
    const end = Math.min(now, o.since + MAX_JOB_MS);
    s += Math.max(0, (end - Math.max(o.since, ws)) / 1000);
  }
  return s;
}
const pcUsed = (c: Ctx) => c.n.pcSeconds + liveSeconds(c.n.pcOpen, c.n.windowStart, c.now);

async function tx<T>(uid: string, fn: (c: Ctx) => T): Promise<T> {
  return db().runTransaction(async (t) => {
    const [ps, us] = await Promise.all([t.get(planRef(uid)), t.get(usageRef(uid))]);
    const now = Date.now();
    const doc = ps.data() as PlanDoc | undefined;
    const plan = planById(effectivePlan(doc, now));
    const n = norm(us.data() as UsageDoc | undefined, plan, now);
    const c: Ctx = { plan, n, now, patch: {}, doc };
    const out = fn(c);
    t.set(usageRef(uid), { windowStart: n.windowStart, tokens: n.tokens, pcSeconds: n.pcSeconds, ...c.patch }, { merge: true });
    return out;
  });
}

/** Limit errors are shown to the user. Any other billing failure never blocks the product (fail open). */
async function failOpen<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof RequestError) throw e;
    return fallback;
  }
}

function limitError(what: string, c: Ctx) {
  const left = Math.max(60, (c.n.windowStart + c.plan.windowHours * 3600_000 - c.now) / 1000);
  const nx = nextPlan(c.plan.id);
  return new RequestError(
    `${what} limit reached on the ${c.plan.name} plan. It refreshes in ${fmtDuration(left)}.${nx ? ` Upgrade to ${nx.name} in Settings → Plans.` : ""}`,
    402
  );
}

// ---------------- tokens ----------------
export const assertTokens = (uid: string) =>
  failOpen(
    tx(uid, (c) => {
      if (c.plan.tokens !== null && c.n.tokens >= c.plan.tokens) throw limitError("AI token", c);
    }),
    undefined
  );

export const addTokens = (uid: string, tokens: number) =>
  failOpen(
    tx(uid, (c) => {
      c.n.tokens += Math.max(0, Math.round(tokens));
    }),
    undefined
  );

// ---------------- computer time ----------------
export const assertPcAllowed = (uid: string) =>
  failOpen(
    tx(uid, (c) => {
      if (c.plan.pcSeconds !== null && pcUsed(c) >= c.plan.pcSeconds) throw limitError("Computer agent time", c);
    }),
    undefined
  );

export const pcExhausted = (uid: string) =>
  failOpen(tx(uid, (c) => c.plan.pcSeconds !== null && pcUsed(c) >= c.plan.pcSeconds), false);

export const openPcJob = (uid: string, jobId: string, sandboxId: string) =>
  failOpen(
    tx(uid, (c) => {
      c.patch.pcOpen = { [jobId]: { sandboxId, since: c.now, seen: c.now } };
    }),
    undefined
  );

export const touchPcSeen = (uid: string, jobId: string) =>
  failOpen(
    tx(uid, (c) => {
      const o = c.n.pcOpen[jobId];
      if (o) c.patch.pcOpen = { [jobId]: { ...o, seen: c.now } };
    }),
    undefined
  );

/** Idempotent: closing a job twice adds its time only once. */
export const settlePcJob = (uid: string, jobId: string, endMs: number) =>
  failOpen(
    tx(uid, (c) => {
      const o = c.n.pcOpen[jobId];
      if (!o) return;
      const end = Math.min(endMs || c.now, o.since + MAX_JOB_MS);
      c.n.pcSeconds += Math.max(0, (end - Math.max(o.since, c.n.windowStart)) / 1000);
      c.patch.pcOpen = { [jobId]: (await_delete()) };
    }),
    undefined
  );

// small helper kept separate so the import stays at the top of the file
import { FieldValue } from "firebase-admin/firestore";
function await_delete() {
  return FieldValue.delete();
}

export const listOpenPcJobs = async (uid: string): Promise<Record<string, Open>> => {
  try {
    return ((await usageRef(uid).get()).data() as UsageDoc | undefined)?.pcOpen ?? {};
  } catch {
    return {};
  }
};

// ---------------- what the UI shows ----------------
export async function billingSummary(uid: string) {
  return tx(uid, (c) => ({
    plan: c.plan.id,
    status: c.doc?.status ?? "none",
    cancelled: Boolean(c.doc?.cancelled),
    renewsAt: c.doc?.renewsAt ?? null,
    windowHours: c.plan.windowHours,
    windowEndsAt: c.n.windowStart + c.plan.windowHours * 3600_000,
    tokens: { used: Math.round(c.n.tokens), limit: c.plan.tokens },
    pc: { usedSeconds: Math.round(pcUsed(c)), limitSeconds: c.plan.pcSeconds },
    label: `${fmtTokens(c.plan.tokens)} tokens`,
  }));
}

// ---------------- checkout signature (ties a payment to a user) ----------------
function secret() {
  const s = process.env.ROUTINE_RUNNER_SECRET;
  if (!s || s.length < 32) throw new Error("ROUTINE_RUNNER_SECRET must be set (32+ characters).");
  return s;
}
export const signCheckout = (uid: string, plan: string) =>
  createHmac("sha256", secret()).update(`checkout:${uid}:${plan}`).digest("base64url").slice(0, 32);

export function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export const verifyCheckout = (uid: string, plan: string, sig: string) =>
  Boolean(uid && plan && sig) && safeEq(sig, signCheckout(uid, plan));

// ---------------- Gumroad ----------------
/** GUMROAD_LINKS = {"pro":"https://you.gumroad.com/l/agv-pro","plus":"...","max":"...","max2x":"...","ultra":"..."} */
function links(): Record<string, string> {
  try {
    return JSON.parse(process.env.GUMROAD_LINKS || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
export const checkoutLink = (plan: string): string => links()[plan] ?? "";
const permalinkOf = (u: string) => {
  try {
    return new URL(u).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
};
export const planOfPermalink = (perma: string): PlanId | null => {
  const hit = Object.entries(links()).find(([, u]) => permalinkOf(u) === perma);
  return hit ? (hit[0] as PlanId) : null;
};

async function gr(path: string): Promise<any> {
  const tok = process.env.GUMROAD_ACCESS_TOKEN;
  if (!tok) throw new Error("GUMROAD_ACCESS_TOKEN is not set on the server.");
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`https://api.gumroad.com/v2${path}${sep}access_token=${encodeURIComponent(tok)}`, { signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) throw new Error(`Gumroad API: ${String(j?.message ?? r.status).slice(0, 160)}`);
  return j;
}
/** A ping is not signed, so every sale is confirmed again with Gumroad's own API before anyone gets a plan. */
export const fetchSale = async (id: string) => (await gr(`/sales/${encodeURIComponent(id)}`)).sale as Record<string, any>;
export const fetchSubscriber = async (id: string) => (await gr(`/subscribers/${encodeURIComponent(id)}`)).subscriber as Record<string, any>;

export async function logEvent(kind: string, data: Record<string, unknown>) {
  try {
    await db().collection("billingEvents").add({ at: Date.now(), kind, ...JSON.parse(JSON.stringify(data)) });
  } catch {
    /* the log is best effort */
  }
}

export async function activatePlan(
  uid: string,
  plan: PlanId,
  o: { subscriptionId?: string; saleId?: string; email?: string; periodMs: number; at: number }
) {
  const renewsAt = o.at + o.periodMs;
  const doc: PlanDoc = {
    plan, status: "active", cancelled: false, renewsAt, accessUntil: renewsAt + GRACE_MS,
    ...(o.subscriptionId ? { subscriptionId: o.subscriptionId } : {}),
    ...(o.saleId ? { saleId: o.saleId } : {}),
    ...(o.email ? { email: o.email } : {}),
    updatedAt: Date.now(),
  };
  await planRef(uid).set(doc, { merge: true });
  for (const k of [o.subscriptionId, o.saleId]) if (k) await db().collection("billingIndex").doc(k).set({ uid, plan, at: Date.now() });
  await logEvent("activated", { uid, plan, saleId: o.saleId, subscriptionId: o.subscriptionId });
}

export async function markCancelled(uid: string) {
  const cur = (await planRef(uid).get()).data() as PlanDoc | undefined;
  // paid period stays usable; no renewal will arrive, so access simply runs out
  await planRef(uid).set({ cancelled: true, accessUntil: cur?.renewsAt ?? Date.now(), updatedAt: Date.now() }, { merge: true });
  await logEvent("cancelled", { uid });
}

export async function endPlan(uid: string, why: string) {
  await planRef(uid).set({ status: "ended", accessUntil: 0, updatedAt: Date.now() }, { merge: true });
  await logEvent("ended", { uid, why });
}

export async function uidByKey(key: string): Promise<{ uid: string; plan: PlanId } | null> {
  if (!key) return null;
  const d = (await db().collection("billingIndex").doc(key).get()).data() as { uid?: string; plan?: PlanId } | undefined;
  return d?.uid ? { uid: d.uid, plan: (d.plan ?? "free") as PlanId } : null;
}

export async function saveUnclaimed(saleId: string, data: Record<string, unknown>) {
  await db().collection("billingUnclaimed").doc(saleId || String(Date.now())).set({ at: Date.now(), ...JSON.parse(JSON.stringify(data)) }, { merge: true });
}
