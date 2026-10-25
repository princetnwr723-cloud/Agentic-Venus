// Server-only storage for FOUNT. Everything lives in collections that only the Admin SDK touches
// (the client SDK is blocked by the default-deny Firestore rules, and nothing here is readable from the browser):
//   fount_consent/{uid}      { optIn, at }
//   fount_episodes/{id}      one scrubbed run per document (retention: see FOUNT_RETENTION_DAYS)
//   fount_playbooks/{id}     learned + curated playbooks (seed playbooks live in code, not here)
import { createHash } from "node:crypto";
import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { toolSequence, type Episode, type Example, type PersonalStat, type Status, type Verdict } from "./core";

export const enabled = (): boolean => process.env.FOUNT_ENABLED === "1";
export const holdoutPct = (): number => {
  const n = Number(process.env.FOUNT_HOLDOUT_PCT ?? 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(50, n)) : 10;
};
export const retentionDays = (): number => {
  const n = Number(process.env.FOUNT_RETENTION_DAYS ?? 60);
  return Number.isFinite(n) ? Math.max(7, Math.min(365, n)) : 60;
};
export const isAdmin = (uid: string): boolean =>
  String(process.env.FOUNT_ADMINS ?? "").split(",").map((x) => x.trim()).filter(Boolean).includes(uid);

/** One-way key for a user: the real uid is never written into an episode. */
export function userKey(uid: string): string {
  const salt = process.env.FOUNT_SALT || process.env.ROUTINE_RUNNER_SECRET || "fount";
  return createHash("sha256").update(`${salt}:${uid}`).digest("hex").slice(0, 24);
}

const db = () => getAdminDb();
const clean = <T extends Record<string, unknown>>(o: T): T => JSON.parse(JSON.stringify(o)) as T; // Firestore rejects undefined

// ---- consent

export async function getConsent(uid: string): Promise<boolean> {
  const d = await db().collection("fount_consent").doc(uid).get();
  return d.exists && d.data()?.optIn === true;
}
export async function setConsent(uid: string, optIn: boolean): Promise<void> {
  await db().collection("fount_consent").doc(uid).set({ optIn, at: Date.now() });
}

// ---- playbooks (learned + curated)

export async function listPlaybooks(): Promise<Example[]> {
  const snap = await db().collection("fount_playbooks").limit(2000).get();
  return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as Example);
}
export async function upsertPlaybook(ex: Example): Promise<void> {
  await db().collection("fount_playbooks").doc(ex.id).set(clean({ ...ex, updatedAt: Date.now() }), { merge: true });
}
export async function setPlaybookStatus(id: string, status: Status): Promise<boolean> {
  const ref = db().collection("fount_playbooks").doc(id);
  const d = await ref.get();
  if (!d.exists) return false;
  await ref.update({ status, updatedAt: Date.now() });
  return true;
}
/** Adds a real outcome to the playbooks that were in the prompt. Built-in seed ids simply do not exist here and are skipped. */
export async function bumpOutcome(ids: string[], verdict: Verdict): Promise<void> {
  if (verdict === "partial") return;
  await Promise.allSettled(
    ids.slice(0, 6).map((id) =>
      db().collection("fount_playbooks").doc(id).update({
        uses: FieldValue.increment(1),
        ...(verdict === "pass" ? { wins: FieldValue.increment(1) } : { fails: FieldValue.increment(1) }),
      })
    )
  );
}

// ---- episodes

export async function saveEpisode(ep: Episode & { counted: boolean }): Promise<void> {
  await db().collection("fount_episodes").doc(ep.id).set(clean(ep as unknown as Record<string, unknown>));
}
export async function getEpisode(id: string): Promise<(Episode & { counted?: boolean }) | null> {
  const d = await db().collection("fount_episodes").doc(id).get();
  return d.exists ? (d.data() as Episode & { counted?: boolean }) : null;
}
export async function patchEpisode(id: string, patch: Record<string, unknown>): Promise<void> {
  await db().collection("fount_episodes").doc(id).update(clean(patch));
}
export async function episodesSince(ms: number, limit = 5000): Promise<Episode[]> {
  const snap = await db().collection("fount_episodes").where("at", ">=", ms).orderBy("at", "desc").limit(limit).get();
  return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as Episode);
}

async function deleteWhere(field: string, op: "==" | "<", value: string | number, cap = 2000): Promise<number> {
  let total = 0;
  while (total < cap) {
    const snap = await db().collection("fount_episodes").where(field, op, value).limit(400).get();
    if (snap.empty) break;
    const batch = db().batch();
    snap.docs.forEach((d: QueryDocumentSnapshot) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < 400) break;
  }
  return total;
}
/** The owner's "delete my FOUNT data" button: saved runs AND the owner's personal playbooks. */
export async function forgetUser(uk: string): Promise<number> {
  let total = await deleteWhere("uk", "==", uk);
  const snap = await db().collection("fount_personal").where("uk", "==", uk).limit(200).get();
  if (!snap.empty) {
    const batch = db().batch();
    snap.docs.forEach((d: QueryDocumentSnapshot) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
  }
  return total;
}
/** Retention: old episodes are deleted by the nightly job. */
export const pruneOlderThan = (ms: number) => deleteWhere("at", "<", ms);

// ---- personal playbooks: one small document per owner and job type (tool names and counts only, never text)

const MAX_PERSONAL = 60;
export type PersonalDoc = PersonalStat & { uk: string; updatedAt: number };

export async function listPersonal(uk: string): Promise<PersonalDoc[]> {
  const snap = await db().collection("fount_personal").where("uk", "==", uk).limit(MAX_PERSONAL).get();
  return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as PersonalDoc);
}

/** Adds one settled run (pass or fail) to the owner's own record for this job type. */
export async function recordPersonal(uk: string, intent: string, tools: string[], toolErrors: string[], verdict: Verdict): Promise<void> {
  if (verdict === "partial" || !tools.length) return;
  const ref = db().collection("fount_personal").doc(`${uk}-${intent}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120));
  const d = await ref.get();
  if (!d.exists && (await listPersonal(uk)).length >= MAX_PERSONAL) return;
  const cur: PersonalDoc = d.exists
    ? (d.data() as PersonalDoc)
    : { uk, intent, lastPass: [], wins: 0, fails: 0, errs: {}, updatedAt: 0 };
  const errs = { ...cur.errs };
  for (const t of toolErrors.slice(0, 10)) errs[t] = (errs[t] ?? 0) + 1;
  await ref.set(clean({
    ...cur,
    wins: cur.wins + (verdict === "pass" ? 1 : 0),
    fails: cur.fails + (verdict === "fail" ? 1 : 0),
    lastPass: verdict === "pass" ? toolSequence(tools) : cur.lastPass,
    errs,
    updatedAt: Date.now(),
  }));
}

// ---- daily digest: what FOUNT learned each night (for the admin and for you to watch it grow)

export async function saveDigest(day: string, data: Record<string, unknown>): Promise<void> {
  await db().collection("fount_digest").doc(day).set(clean({ day, ...data }));
}
export async function listDigests(n = 14): Promise<Array<Record<string, unknown>>> {
  const snap = await db().collection("fount_digest").orderBy("day", "desc").limit(n).get();
  return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as Record<string, unknown>);
}