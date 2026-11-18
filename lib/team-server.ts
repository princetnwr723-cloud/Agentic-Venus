// Dashboard team runs on the SERVER. The owner's browser only starts the goal: planning, the specialists' work, hand-offs between steps
// and the final report all happen here, so closing the tab changes nothing. Every step is one ordinary agent run (agent/worker.ts, the
// same loop that has leases, resume, budgets and approvals), and /api/agent/tick wakes this engine (see tickTeamRuns).
// The step list is mirrored into users/{uid}/teams/{chatId}.run, the document the Team panel already watches.
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { isPlaceholder, resolveValue, vaultDelete, vaultPut } from "@/lib/vault";
import { callProvider } from "@/lib/ai-providers-server";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { startRun, store } from "@/lib/agent/worker";
import { latchReason } from "@/lib/agent/latch-server";
import { isOwner } from "@/lib/owner";
import { notifyOwner } from "@/lib/channels";
import { byId, CATALOG, personaOf } from "@/lib/team-catalog";
import { clip, jobOutcome, nextActions, oneLine, parseJson, reportText, sanitizePlan, type JobStep } from "@/lib/business-core";
import type { TeamRunDoc } from "@/lib/steps";

const db = () => getAdminDb();
const jobs = () => db().collection("teamRuns");
const userDoc = (uid: string) => db().collection("users").doc(uid);
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const MAX_AGE_MS = 24 * 3600_000, MAX_TEAM_RUNS = 3;
const FALLBACK_MODEL: Partial<Record<ProviderId, string>> = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.models[0]]));

type TeamJob = {
  uid: string; runId: string; chatId: string; goal: string; steps: Array<JobStep & { name: string }>;
  status: "running" | "done" | "partial" | "failed" | "stopped";
  provider: string; model: string; keyRef: string; fallbacks: Array<{ provider: string; model: string; keyRef: string }>; tempKeys: string[];
  origin: string; createdAt: number; updatedAt: number; endedAt?: number;
};
const jobId = (uid: string, runId: string) => `${uid}_${runId}`;
const nameOf = (id: string) => byId(id)?.name ?? "Chief";

/** A reference to a key that can be stored in a run: an existing vault reference, or a private vault slot that is deleted when the team run ends. */
async function keyRefFor(uid: string, provider: string, raw: string, runId: string, temps: string[]): Promise<string> {
  if (isPlaceholder(raw)) return raw;
  const name = `team.tmp.${runId}.${provider}`;
  const ref = await vaultPut(uid, name, await resolveValue(uid, raw));
  temps.push(name);
  return ref;
}

async function loadChatModel(uid: string, chatId: string, runId: string) {
  const chat = (await userDoc(uid).collection("chats").doc(chatId).get()).data() as { provider?: ProviderId; model?: string } | undefined;
  if (!chat?.provider || !chat.model) throw Object.assign(new Error("Open the chat once and pick a model first."), { status: 400 });
  const keys = ((await userDoc(uid).get()).data() as { apiKeys?: Partial<Record<ProviderId, string>> } | undefined)?.apiKeys ?? {};
  if (!keys[chat.provider]) throw Object.assign(new Error(`No saved key for ${chat.provider}. Add it in Settings.`), { status: 400 });
  const temps: string[] = [];
  const keyRef = await keyRefFor(uid, chat.provider, keys[chat.provider] as string, runId, temps);
  const fallbacks: TeamJob["fallbacks"] = [];
  for (const p of (Object.keys(keys) as ProviderId[]).filter((x) => x !== chat.provider && keys[x] && FALLBACK_MODEL[x]).slice(0, 2)) {
    fallbacks.push({ provider: p, model: FALLBACK_MODEL[p] as string, keyRef: await keyRefFor(uid, p, keys[p] as string, runId, temps) });
  }
  return { provider: chat.provider, model: chat.model, keyRef, fallbacks, temps, plainKey: await resolveValue(uid, keys[chat.provider] as string) };
}

/** The planner: the chat's own model splits the goal into steps for the roster. Falls back to one step for the lead. */
async function plan(provider: ProviderId, model: string, apiKey: string, goal: string, roster: string[]): Promise<ReturnType<typeof sanitizePlan>> {
  const lines = roster.map((id) => byId(id)).filter(Boolean).map((m) => `${m!.id}: ${m!.name}, ${m!.title}. ${m!.skill}`).join("\n");
  try {
    const text = await callProvider({
      provider, apiKey, model, maxTokens: 1200,
      messages: [
        { role: "system", content: "You are Chief, the lead of an AI team. Split the goal into 1 to 5 steps. Give each step to the best teammate from the roster. A step may use the results of earlier steps (list their numbers, starting at 0, in \"after\"). Steps that do not depend on each other run in parallel. Answer with JSON only: {\"steps\":[{\"member\":\"<id>\",\"task\":\"<complete instructions>\",\"after\":[]}]}" },
        { role: "user", content: `ROSTER\n${lines}\n\nGOAL\n${clip(goal, 1500)}` },
      ],
    });
    return sanitizePlan(parseJson(text), goal, roster);
  } catch { return sanitizePlan(null, goal, roster); }
}

// ---------------------------------------------------------------- mirror into the Team panel's document
const toRunDoc = (j: TeamJob): TeamRunDoc => ({
  id: j.runId, goal: j.goal.slice(0, 400),
  status: j.status === "stopped" ? "failed" : j.status,
  steps: j.steps.map((s) => ({ i: s.i, member: s.member, name: s.name, task: s.task, after: s.after, status: s.status, ...(s.note ? { note: s.note } : {}), ...(s.startedAt ? { startedAt: s.startedAt } : {}), ...(s.endedAt ? { endedAt: s.endedAt } : {}) })),
  startedAt: j.createdAt, ...(j.endedAt ? { endedAt: j.endedAt } : {}), updatedAt: Date.now(),
});
async function mirror(j: TeamJob): Promise<void> {
  await userDoc(j.uid).collection("teams").doc(j.chatId).set({ run: clean(toRunDoc(j)) }, { merge: true }).catch(() => {});
}
async function mutate(id: string, fn: (j: TeamJob) => boolean): Promise<TeamJob | null> {
  const ref = jobs().doc(id);
  const out = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return null;
    const j = s.data() as TeamJob;
    if (!fn(j)) return null;
    j.updatedAt = Date.now();
    tx.set(ref, clean(j));
    return j;
  });
  if (out) await mirror(out);
  return out;
}
const say = (uid: string, chatId: string, text: string) =>
  userDoc(uid).collection("chats").doc(chatId).update({ messages: FieldValue.arrayUnion({ role: "assistant", content: text, at: Date.now() }) }).catch(() => {});

const stepTask = (j: TeamJob, i: number): string => {
  const s = j.steps[i], m = byId(s.member) ?? CATALOG[0];
  const deps = s.after.map((k, n) => `RESULT OF EARLIER STEP ${n + 1} (${j.steps[k].name}):\n${clip(j.steps[k].result ?? "", 1800)}`).join("\n\n");
  const tool = m.tool === "pc" ? "Real websites, lists, logins or downloads: use pc.run (the background computer)." : m.tool === "video" ? "A video: use the Venus video tools." : m.tool === "research" ? "Use web search and cite links." : "";
  return clip(`${personaOf(m)}\n\nTHE TEAM'S OVERALL GOAL\n${clip(j.goal, 600)}\n\nYOUR STEP (step ${i + 1})\n${clip(s.task, 1800)}\n${tool ? `\n${tool}\n` : ""}${deps ? `\n${deps}\n` : ""}\nRULES: Never invent facts, names or contact details. Anything that sends mail or posts is held for the owner's approval by the system, so just describe it. Finish with a short result for the team: what you did, links or file names, and a "Needs you" line if something is missing.`, 7800);
};

// ---------------------------------------------------------------- start / advance / stop
export async function launchTeamRun(uid: string, a: { chatId: string; goal: string; origin: string }): Promise<string> {
  const goal = String(a.goal ?? "").trim().slice(0, 2000);
  if (!goal) throw Object.assign(new Error("A goal is required."), { status: 400 });
  const running = (await jobs().where("uid", "==", uid).where("status", "==", "running").limit(MAX_TEAM_RUNS + 1).get()).size;
  if (running >= MAX_TEAM_RUNS) throw Object.assign(new Error(`${MAX_TEAM_RUNS} team runs are already working in the background. Wait for one to finish or stop it.`), { status: 429 });
  const l = await latchReason(uid);
  if (l) throw Object.assign(new Error(l.text), { status: 429 });
  const now = Date.now();
  const runId = now.toString(36) + Math.random().toString(36).slice(2, 5);
  const m = await loadChatModel(uid, a.chatId, runId);
  const team = (await userDoc(uid).collection("teams").doc(a.chatId).get()).data() as { members?: string[] } | undefined;
  const roster = Array.from(new Set(["chief", ...(team?.members ?? [])])).filter((id) => byId(id));
  const steps = await plan(m.provider, m.model, m.plainKey, goal, roster);
  const job: TeamJob = {
    uid, runId, chatId: a.chatId, goal, status: "running", provider: m.provider, model: m.model, keyRef: m.keyRef, fallbacks: m.fallbacks, tempKeys: m.temps, origin: a.origin, createdAt: now, updatedAt: now,
    steps: steps.map((p, i) => ({ i, member: p.member, name: nameOf(p.member), task: p.task, after: p.after, status: "queued" as const })),
  };
  await jobs().doc(jobId(uid, runId)).set(clean(job));
  await mirror(job);
  await say(uid, a.chatId, `👥 Team plan (${job.steps.length} step${job.steps.length > 1 ? "s" : ""}), running on the server — you can close the app:\n${job.steps.map((s, i) => `${i + 1}. **${s.name}**: ${oneLine(s.task, 150)}${s.after.length ? ` _(after step${s.after.length > 1 ? "s" : ""} ${s.after.map((k) => k + 1).join(", ")})_` : ""}`).join("\n")}`);
  await advanceTeamRun(jobId(uid, runId), a.origin);
  return runId;
}

async function finishStep(id: string, i: number, status: "done" | "failed", patch: { result?: string; note?: string }) {
  return mutate(id, (j) => {
    const s = j.steps[i];
    if (!s || s.status !== "running") return false;
    s.status = status; s.endedAt = Date.now();
    if (patch.result !== undefined) s.result = clip(patch.result, 6000);
    if (patch.note !== undefined) s.note = clip(patch.note, 400);
    return true;
  });
}

/** One pass over one run. Safe to call at any time and as often as you like (steps are claimed in a transaction). */
export async function advanceTeamRun(id: string, site: string): Promise<void> {
  const S = store();
  let j = (await jobs().doc(id).get()).data() as TeamJob | undefined;
  if (!j || j.status !== "running") return;
  const tooOld = Date.now() - j.createdAt > MAX_AGE_MS;

  // 1) steps whose agent run has ended
  for (const s of j.steps) {
    if (s.status !== "running" || !s.runId || s.runId === "pending") continue;
    if (tooOld) { await finishStep(id, s.i, "failed", { note: "Timed out after 24 hours." }); continue; }
    const r = await S.getRun(j.uid, s.runId).catch(() => null);
    if (!r) await finishStep(id, s.i, "failed", { note: "The background run could not be found." });
    else if (r.status === "done") await finishStep(id, s.i, "done", { result: String(r.result ?? "") });
    else if (r.status === "error" || r.status === "stopped") await finishStep(id, s.i, "failed", { note: r.error?.message || (r.status === "stopped" ? "Stopped." : "The agent stopped with an error.") });
    else if (r.status === "paused" && r.pending && !(s as { pendingNoted?: boolean }).pendingNoted) {
      const won = await mutate(id, (x) => { const y = x.steps[s.i] as JobStep & { name: string }; if (!y || y.pendingNoted) return false; y.pendingNoted = true; return true; });
      if (won) await say(j.uid, j.chatId, `⏸ **${s.name}** is waiting for you: ${oneLine(r.pending.summary || r.pending.question || r.pending.name, 220)}. Answer it in the task panel.`);
    }
  }

  // 2) what can move now
  j = (await jobs().doc(id).get()).data() as TeamJob;
  if (j.status !== "running") return;
  const act = nextActions(j.steps);
  for (const i of act.skip) await mutate(id, (x) => { const s = x.steps[i]; if (!s || s.status !== "queued") return false; s.status = "skipped"; s.note = "A step it depends on did not finish."; s.endedAt = Date.now(); return true; });
  if (act.start.length && !(await latchReason(j.uid))) {
    const cap = (await isOwner(j.uid)) ? 12 : 3;
    let active = (await S.listRuns(j.uid, 30)).filter((r) => r.status === "queued" || r.status === "running").length;
    for (const i of act.start) {
      if (active >= cap) break;
      const claimed = await mutate(id, (x) => { const s = x.steps[i]; if (!s || s.status !== "queued") return false; s.status = "running"; s.runId = "pending"; s.startedAt = Date.now(); return true; });
      if (!claimed) continue;
      active++;
      try {
        const runId = await startRun(claimed.uid, { chatId: claimed.chatId, task: stepTask(claimed, i), provider: claimed.provider as ProviderId, model: claimed.model, keyRef: claimed.keyRef, fallbacks: claimed.fallbacks, origin: claimed.origin || site, maxRounds: 40 });
        await mutate(id, (x) => { const s = x.steps[i]; if (!s) return false; s.runId = runId; return true; });
      } catch (e) { await finishStep(id, i, "failed", { note: `Could not start: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` }); }
    }
  }

  // 3) everything finished: one honest report, and the temporary keys are removed
  j = (await jobs().doc(id).get()).data() as TeamJob;
  if (j.status === "running" && jobOutcome(j.steps) !== "running") {
    const fin = await mutate(id, (x) => { if (x.status !== "running") return false; const o = jobOutcome(x.steps); if (o === "running") return false; x.status = o; x.endedAt = Date.now(); return true; });
    if (fin) {
      const text = reportText(fin.goal, fin.steps, nameOf);
      await say(fin.uid, fin.chatId, text);
      await notifyOwner(fin.uid, fin.chatId, text.slice(0, 1500)).catch(() => {});
      for (const t of fin.tempKeys ?? []) await vaultDelete(fin.uid, t).catch(() => {});
    }
  }
}

export async function stopTeamRun(uid: string, runId: string): Promise<boolean> {
  const id = jobId(uid, runId);
  const job = await mutate(id, (j) => {
    if (j.status !== "running") return false;
    j.status = "stopped"; j.endedAt = Date.now();
    for (const s of j.steps) if (s.status === "queued") { s.status = "skipped"; s.note = "Stopped by the owner."; s.endedAt = Date.now(); }
    return true;
  });
  if (!job) return false;
  const S = store();
  for (const s of job.steps) {
    if (s.status === "running" && s.runId && s.runId !== "pending") {
      const r = await S.getRun(uid, s.runId).catch(() => null);
      if (r?.status === "running") await S.patchRun(uid, s.runId, { stopRequested: true }).catch(() => {});
      else if (r && ["queued", "paused", "budget"].includes(r.status)) await S.release(uid, s.runId, { status: "stopped", endedAt: Date.now(), pending: null, reply: null }, null).catch(() => {});
      await mutate(id, (j) => { const x = j.steps[s.i]; if (x && x.status === "running") { x.status = "failed"; x.note = "Stopped by the owner."; x.endedAt = Date.now(); } return true; });
    }
  }
  for (const t of job.tempKeys ?? []) await vaultDelete(uid, t).catch(() => {});
  return true;
}

export async function tickTeamRuns(site: string, _now = Date.now()): Promise<{ checked: number }> {
  const s = await jobs().where("status", "==", "running").limit(20).get();
  for (const d of s.docs) await advanceTeamRun(d.id, site).catch((e) => console.error("team tick failed", e));
  return { checked: s.size };
}

