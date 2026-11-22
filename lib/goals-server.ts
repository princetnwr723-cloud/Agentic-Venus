// Server-only. Venus Goals: storage, work sessions ("pulses"), verification and the scheduler hook.
//
// How a goal moves:
//   goal.set  -> a goal document is saved (users/{uid}/goals/{id}) and the first work session starts at once.
//   a pulse   -> ONE background mission (lib/mission.ts) with the goal's state as its instructions. It is tagged as a
//                routine-style run, so the mission engine stays quiet (no chat post, no phone call): the goal engine
//                reads the mission's result itself and tells the owner only what is worth telling.
//   tick      -> every few minutes (agent/tick): finished pulses are settled, due goals start their next pulse.
//   settle    -> the report is applied (a milestone closes only with proof), a finish claim is checked by a second
//                model call (fail-closed), status / next time are decided, and the owner gets a short digest.
import { getAdminDb } from "@/lib/firebase-admin";
import { startMission, stopMission } from "@/lib/mission";
import { loadAgent } from "@/lib/voice-calls";
import { callProvider, type ChatMsg } from "@/lib/ai-providers-server";
import { verifyResult } from "@/lib/critic";
import { notifyOwner } from "@/lib/channels";
import { audit } from "@/lib/audit";
import { dayKey } from "@/lib/schedule";
import {
  MAX_ACTIVE_GOALS, PULSE_APPROVAL_MS, PULSE_STALE_MS,
  applyUpdate, buildPulseGoalText, clip, failPulse, needsVerification, newGoal, parseUpdate, patchGoal, pulseDue, pushLog, settlePulseResult, verifyInput,
  type Goal, type GoalUpdate, type Pulse, type Settled, type Verdict,
} from "@/lib/goals-core";

const MIN = 60_000;
const db = () => getAdminDb();
const col = (uid: string) => db().collection("users").doc(uid).collection("goals");
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const withId = (id: string, d: unknown) => ({ ...(d as Goal), id }) as Goal;

// ---------------- reading ----------------
export async function getGoal(uid: string, id: string): Promise<Goal | null> {
  const s = await col(uid).doc(String(id || "-")).get();
  return s.exists ? withId(s.id, s.data()) : null;
}

export async function listGoals(uid: string, limit = 20): Promise<Goal[]> {
  const snap = await col(uid).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => withId(d.id, d.data()));
}

/** True while a work session of a goal of this chat is running. Used to keep a session from creating or changing goals. */
export async function pulseRunningForChat(uid: string, chatId: string): Promise<boolean> {
  const snap = await col(uid).where("chatId", "==", chatId).get();
  const now = Date.now();
  return snap.docs.some((d) => {
    const g = d.data() as Goal;
    return Boolean(g.pulse) && g.status === "active" && now - g.pulse!.startedAt < PULSE_STALE_MS;
  });
}

// ---------------- telling the owner ----------------
async function postToChat(uid: string, chatId: string, content: string) {
  const ref = db().collection("users").doc(uid).collection("chats").doc(chatId);
  const s = await ref.get();
  if (!s.exists) return;
  const data = s.data() as { messages?: unknown[] };
  const prior = Array.isArray(data.messages) ? data.messages : [];
  await ref.update({ messages: [...prior, { role: "assistant", content, at: Date.now() }] });
}

async function tell(uid: string, chatId: string, text: string) {
  if (!text) return;
  await postToChat(uid, chatId, text).catch(() => {});
  await notifyOwner(uid, chatId, text).catch(() => {});
}

// ---------------- creating and steering ----------------
export async function createGoal(uid: string, chatId: string, a: Record<string, unknown>): Promise<Goal> {
  const made = newGoal(a, chatId, Date.now());
  if ("error" in made) throw new Error(made.error);
  const open = await col(uid).where("status", "in", ["active", "needs_owner", "paused"]).get();
  if (open.size >= MAX_ACTIVE_GOALS) throw new Error(`You already have ${open.size} open goals (the limit is ${MAX_ACTIVE_GOALS}). Finish, pause or cancel one first.`);
  const ref = col(uid).doc();
  await ref.set(clean(made.goal));
  await audit(uid, { kind: "goal_set", chatId, text: `${ref.id}: ${clip(made.goal.title, 120)} (every ${Math.round(made.goal.cadenceMinutes / 60)}h, ${made.goal.autonomy})` });
  return withId(ref.id, made.goal);
}

/** The owner changes the goal, answers its question, or adds a note. Returns what changed. */
export async function updateGoal(uid: string, id: string, a: Record<string, unknown>): Promise<{ goal: Goal; changes: string[]; resumed: boolean }> {
  const ref = col(uid).doc(id);
  const out = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new Error("Goal not found. Use goal.list to see the ids.");
    const r = patchGoal(s.data() as Goal, a, Date.now());
    if ("error" in r) throw new Error(r.error);
    tx.set(ref, clean(r.goal));
    return r;
  });
  await audit(uid, { kind: "goal_update", text: `${id}: ${out.changes.join(", ")}` });
  return { goal: withId(id, out.goal), changes: out.changes, resumed: out.resumed };
}

export async function stopGoal(uid: string, id: string, mode: "pause" | "cancel"): Promise<Goal> {
  const ref = col(uid).doc(id);
  const s = await ref.get();
  if (!s.exists) throw new Error("Goal not found. Use goal.list to see the ids.");
  const g = s.data() as Goal;
  if (g.status === "achieved" || g.status === "cancelled" || g.status === "failed") throw new Error(`This goal is already ${g.status}.`);
  if (g.pulse?.missionId) await stopMission(uid, g.pulse.missionId).catch(() => {});
  const status = mode === "cancel" ? "cancelled" : "paused";
  const now = Date.now();
  await ref.update(clean({ status, pulse: null, updatedAt: now, log: pushLog(g.log, [{ kind: "status", text: mode === "cancel" ? "Cancelled by the owner." : "Paused by the owner." }], now) }));
  await audit(uid, { kind: "goal_stop", text: `${id}: ${mode}` });
  return withId(id, { ...g, status, pulse: null });
}

// ---------------- work sessions ----------------
/**
 * Starts one work session if the rules allow it. The claim happens inside a transaction, so two overlapping ticks
 * (or a tick and the owner) can never start two sessions for the same goal.
 */
export async function startPulse(uid: string, id: string, reason: string, manual = false): Promise<{ started: boolean; why: string; missionId?: string }> {
  const ref = col(uid).doc(id);
  const now = Date.now();
  const claim = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return { ok: false as const, why: "Goal not found." };
    const g = s.data() as Goal;
    const d = pulseDue(g, now, manual);
    if (!d.due) return { ok: false as const, why: d.why };
    const today = dayKey(now, g.tz);
    const pulse: Pulse = { id: "p" + now.toString(36), missionId: "", startedAt: now, reason: reason || d.why };
    tx.update(ref, clean({ pulse, pulses: g.pulses + 1, lastPulseAt: now, dayKey: today, dayPulses: (g.dayKey === today ? g.dayPulses : 0) + 1, updatedAt: now }));
    return { ok: true as const, g: { ...g, pulses: g.pulses + 1, pulse }, pulse };
  });
  if (!claim.ok) return { started: false, why: claim.why };
  const { g, pulse } = claim;
  try {
    const m = await startMission(uid, {
      chatId: g.chatId,
      goal: buildPulseGoalText(g, now, pulse.reason),
      maxCalls: g.limits.maxCalls,
      allowWrites: g.autonomy === "auto",
      notify: [],
      maxSteps: g.limits.maxSteps,
      callOwner: false,
      // the routine tag keeps the mission engine quiet and stops the session from starting missions or routines;
      // "goal:<id>" matches no routine, so nothing is delivered twice
      routine: { id: `goal:${id}`, runId: pulse.id },
    });
    const consumed = g.ownerNotes;
    await db().runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return;
      const cur = s.data() as Goal;
      tx.update(ref, clean({ "pulse.missionId": m.id, ownerNotes: (cur.ownerNotes ?? []).filter((n) => !consumed.includes(n)) }));
    });
    await audit(uid, { kind: "goal_pulse", chatId: g.chatId, text: `${id} session ${g.pulses}: ${clip(pulse.reason, 80)}` });
    return { started: true, why: pulse.reason, missionId: m.id };
  } catch (e) {
    await applySettled(uid, id, pulse.id, failPulse(g, e instanceof Error ? e.message : "could not start the session", Date.now()));
    return { started: false, why: e instanceof Error ? e.message : "could not start the session" };
  }
}

/** Writes the outcome of a session, but only if that session is still the goal's current one (an owner stop wins). */
async function applySettled(uid: string, id: string, pulseId: string, s: Settled): Promise<boolean> {
  const ref = col(uid).doc(id);
  const now = Date.now();
  const written = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const cur = snap.data() as Goal;
    if (!cur.pulse || cur.pulse.id !== pulseId) return null;
    const g = s.goal;
    tx.update(ref, clean({
      milestones: g.milestones, progress: g.progress, pace: g.pace, status: g.status, nextAction: g.nextAction,
      lessons: g.lessons, blockers: g.blockers, replan: g.replan, pulse: null, stalls: g.stalls, errors: g.errors,
      lastProgressAt: g.lastProgressAt, nextPulseAt: g.nextPulseAt, updatedAt: now,
      ...(g.verifiedAt ? { verifiedAt: g.verifiedAt } : {}),
      ...(g.result ? { result: g.result } : {}),
      log: pushLog(cur.log, s.events, now),
    }));
    return cur;
  });
  if (!written) return false;
  if (s.achieved) await audit(uid, { kind: "goal_achieved", chatId: written.chatId, text: `${id}: ${clip(written.title, 120)}` });
  if (s.notify) await tell(uid, written.chatId, s.message);
  return true;
}

async function verify(g: Goal, u: GoalUpdate, uid: string): Promise<Verdict> {
  try {
    const agent = await loadAgent(uid, g.chatId);
    const llm = (system: string, prompt: string) =>
      callProvider({ provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 400, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] as ChatMsg[] });
    return await verifyResult(llm, verifyInput(g, u));
  } catch {
    return { verdict: "partial", reason: "The checker was unavailable, so the finish was not confirmed." };
  }
}

/** If the goal's running session has finished, applies its result. Safe to call any time (the tools call it before showing a goal). */
export async function settleIfFinished(uid: string, id: string): Promise<"none" | "running" | "settled" | "released"> {
  const snap = await col(uid).doc(id).get();
  if (!snap.exists) return "none";
  const g = withId(id, snap.data());
  if (!g.pulse) return "none";
  const now = Date.now();
  const pulse = g.pulse;
  const release = async (why: string) => ((await applySettled(uid, id, pulse.id, failPulse(g, why, now))) ? "released" as const : "none" as const);

  if (!pulse.missionId) return now - pulse.startedAt > 5 * MIN ? release("the session never started") : "running";
  const ms = await db().collection("users").doc(uid).collection("missions").doc(pulse.missionId).get();
  if (!ms.exists) return release("the session's mission disappeared");
  const m = ms.data() as { status: string; result?: string };

  if (["running", "waiting_call", "needs_approval"].includes(m.status)) {
    const limit = m.status === "needs_approval" ? PULSE_APPROVAL_MS : PULSE_STALE_MS;
    if (now - pulse.startedAt <= limit) return "running";
    await stopMission(uid, pulse.missionId).catch(() => {});
    return release(m.status === "needs_approval" ? "an approval waited more than a day" : "the session ran too long");
  }
  if (m.status === "stopped") {
    // the owner stopped the mission by hand: not a failure and not a stall; try again on the normal cadence
    const s: Settled = { goal: { ...g, pulse: null, nextPulseAt: now + g.cadenceMinutes * MIN }, events: [{ kind: "status", text: "The work session was stopped by the owner." }], message: "", notify: false, achieved: false, question: "" };
    return (await applySettled(uid, id, pulse.id, s)) ? "settled" : "none";
  }
  const u = parseUpdate(String(m.result ?? ""));
  // a session that ran out of steps may still have reported progress; without a report it counts as a failure
  if (m.status === "error" && !u) return release(String(m.result ?? "").split("\n")[0] || "the session failed");
  // the checker must see the proofs of THIS report too, so the report is applied to a copy first
  const after = u ? applyUpdate(g, u, now).goal : g;
  const verdict = u && needsVerification(after, u) ? await verify(after, u, uid) : null;
  const settled = settlePulseResult(g, u, verdict, now);
  return (await applySettled(uid, id, pulse.id, settled)) ? "settled" : "none";
}

// ---------------- the scheduler ----------------
/** Called from agent/tick every few minutes. */
export async function tickGoals(_site: string, now: number): Promise<{ checked: number; started: number; settled: number; released: number; needsOwner: number }> {
  const out = { checked: 0, started: 0, settled: 0, released: 0, needsOwner: 0 };
  const t0 = Date.now();
  let docs: Array<{ uid: string; id: string; g: Goal }> = [];
  try {
    // Needs the same kind of collection-group index as missions. If it is missing, the error message holds a link that creates it.
    const snap = await db().collectionGroup("goals").where("status", "==", "active").limit(200).get();
    docs = snap.docs.flatMap((d) => {
      const uid = d.ref.parent.parent?.id;
      return uid ? [{ uid, id: d.id, g: withId(d.id, d.data()) }] : [];
    });
  } catch (e) {
    console.error("goals tick: " + (e instanceof Error ? e.message : String(e)));
    return out;
  }
  // running sessions first (settle them), then the due ones
  docs.sort((a, b) => Number(Boolean(b.g.pulse)) - Number(Boolean(a.g.pulse)));
  for (const { uid, id, g } of docs.slice(0, 40)) {
    if (Date.now() - t0 > 40_000) break;
    out.checked++;
    try {
      if (g.pulse) {
        const r = await settleIfFinished(uid, id);
        if (r === "settled") out.settled++;
        else if (r === "released") out.released++;
        continue;
      }
      if (g.deadline && now > g.deadline) {
        const ref = col(uid).doc(id);
        const q = `The deadline (${new Date(g.deadline).toISOString().slice(0, 10)}) has passed with ${g.progress}% done. Extend it, change the finish line, or close the goal?`;
        await ref.update(clean({ status: "needs_owner", blockers: [q], updatedAt: now, log: pushLog(g.log, [{ kind: "status", text: "Deadline passed: waiting for the owner." }], now) }));
        await tell(uid, g.chatId, `🎯 ${g.title}\n⏰ ${q}\nAnswer here in the chat.`);
        out.needsOwner++;
        continue;
      }
      if (out.started < 8 && pulseDue(g, now).due) {
        const r = await startPulse(uid, id, "");
        if (r.started) out.started++;
      }
    } catch (e) {
      console.error(`goals tick ${id}: ` + (e instanceof Error ? e.message : String(e)));
    }
  }
  return out;
}
