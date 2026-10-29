import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  deleteField,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { compact, effectiveSchedule, firstRunAt, normalizePatch, type Routine } from "@/lib/routines-core";
import { safeTz, type Schedule } from "@/lib/schedule";

export type { Routine, NotifyPolicy, RoutineMode } from "@/lib/routines-core";

const routinesCol = (uid: string) => collection(db, "users", uid, "routines");
const routineDoc = (uid: string, id: string) => doc(db, "users", uid, "routines", id);

function browserTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

export async function listRoutinesForChat(uid: string, chatId: string): Promise<Routine[]> {
  const q = query(routinesCol(uid), where("chatId", "==", chatId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Routine, "id">) }));
}

export async function getRoutine(uid: string, id: string): Promise<Routine | null> {
  const s = await getDoc(routineDoc(uid, id));
  return s.exists() ? ({ id: s.id, ...(s.data() as Omit<Routine, "id">) }) : null;
}

/** The old four fields still work (an "every N minutes" routine); everything else is optional. */
export type NewRoutine = {
  chatId: string;
  name: string;
  instructions: string;
  everyMinutes: number;
  startAt: number;
} & Partial<Omit<Routine, "id" | "chatId" | "name" | "instructions" | "everyMinutes" | "nextRunAt" | "enabled">>;

export async function createRoutine(uid: string, init: NewRoutine): Promise<Routine> {
  const now = Date.now();
  const { chatId, name, instructions, everyMinutes, startAt, ...extra } = init;
  const start = Number.isFinite(startAt) ? startAt : now;
  const legacy = !extra.schedule; // old callers: "every N minutes", first run at the start time
  const tz = safeTz(extra.tz ?? browserTz());
  const p = normalizePatch(
    { ...extra, name, instructions, tz, schedule: extra.schedule ?? { kind: "every", minutes: everyMinutes, anchor: start > now ? start : now } },
    { tz, now }
  );
  if (p.error) throw new Error(p.error);
  const schedule = p.value.schedule as Schedule;
  const nextRunAt = firstRunAt(schedule, now, { startAt: start, runNow: legacy });
  if (nextRunAt === null) throw new Error("This schedule has no future run.");
  const data = { ...compact(p.value), chatId, tz, nextRunAt, enabled: true, runCount: 0 };
  const ref = await addDoc(routinesCol(uid), { ...data, createdAt: serverTimestamp() });
  return { id: ref.id, ...data } as unknown as Routine;
}

/** Edits any setting. A new schedule (or timezone) recalculates the next run. Returns the fresh routine. */
export async function updateRoutine(uid: string, id: string, raw: Record<string, unknown>): Promise<Routine | null> {
  const cur = await getRoutine(uid, id);
  if (!cur) throw new Error("Routine not found.");
  const now = Date.now();
  const tz = safeTz((raw.tz as string | undefined) ?? cur.tz ?? browserTz());
  const input: Record<string, unknown> = { ...raw };
  if (raw.tz !== undefined && raw.schedule === undefined) {
    const eff = effectiveSchedule(cur, now);
    if (eff.kind === "cron") input.schedule = { ...eff, tz }; // only the timezone changed: same wall-clock time, new zone
  }
  const p = normalizePatch(input, { tz, now });
  if (p.error) throw new Error(p.error);
  const patch: Record<string, unknown> = { ...p.value };
  if (p.value.schedule) {
    const n = firstRunAt(p.value.schedule as Schedule, now);
    if (n === null) throw new Error("This schedule has no future run.");
    patch.nextRunAt = n;
    patch.attempt = 0;
  }
  if (raw.hook === true && !cur.hookVersion) patch.hookVersion = 1;
  const write: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) write[k] = v === null ? deleteField() : v;
  if (Object.keys(write).length) await updateDoc(routineDoc(uid, id), write);
  return getRoutine(uid, id);
}

/** Switching on again recalculates the next run and clears a pause caused by repeated failures. */
export async function setRoutineEnabled(uid: string, id: string, enabled: boolean) {
  if (!enabled) { await updateDoc(routineDoc(uid, id), { enabled: false }); return; }
  const cur = await getRoutine(uid, id);
  if (!cur) return;
  const now = Date.now();
  const next = firstRunAt(effectiveSchedule(cur, now), now);
  if (next === null) return; // a one-time routine that already ran stays off
  await updateDoc(routineDoc(uid, id), { enabled: true, nextRunAt: next, attempt: 0, consecutiveFailures: 0, pausedReason: deleteField() });
}

export async function recordManualRun(uid: string, id: string, result: string) {
  await updateDoc(routineDoc(uid, id), { lastRunAt: Date.now(), lastResult: result.slice(0, 200) });
}

export async function deleteRoutine(uid: string, id: string) {
  await deleteDoc(routineDoc(uid, id));
}