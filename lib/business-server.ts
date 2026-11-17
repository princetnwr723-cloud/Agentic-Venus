// Venus Business Hub, background side. A goal that needs the Cloud PC, Venus Code, Venus Pro, mail or routines is run as SERVER agents
// (lib/agent/worker.ts): they keep working when the app is closed. This file only moves the plan forward: it starts the steps that are
// ready, collects the finished ones, posts the team's messages and writes the report. It makes no model call of its own.
// Who calls it: the browser while the Hub is open (every few seconds) and the scheduler through /api/agent/tick (every 5 minutes).
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { isOwner } from "@/lib/owner";
import { latchReason } from "@/lib/agent/latch-server";
import { startRun, store } from "@/lib/agent/worker";
import type { ProviderId } from "@/lib/providers";
import {
  BIZ_TEAM, cleanPatch, clip, emptyProfile, jobOutcome, jobRun, memberById, nextActions, oneLine, reportText, sanitizePlan, stepTask,
  type BizProfile, type JobStep, type Msg,
} from "@/lib/business-core";

export type Job = {
  uid: string; runId: string; chatId: string; goal: string; profile: BizProfile; steps: JobStep[];
  status: "running" | "done" | "partial" | "failed" | "stopped";
  provider: string; model: string; keyRef: string; fallbacks: Array<{ provider: string; model: string; keyRef: string }>;
  origin: string; createdAt: number; updatedAt: number; endedAt?: number;
};
type NewMsg = Omit<Msg, "id" | "at">;

const MAX_JOBS = 2;
const MAX_JOB_AGE_MS = 24 * 3600_000;
const jobs = () => getAdminDb().collection("bizJobs");
const bgRef = (uid: string) => getAdminDb().collection("users").doc(uid).collection("teams").doc("biz-bg");
const jobId = (uid: string, runId: string) => `${uid}_${runId}`;
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const mid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nameOf = (id: string) => memberById(id)?.name ?? id;

/** Messages for the Hub chat. arrayUnion is atomic, so parallel steps never lose each other's messages. */
async function addMsgs(uid: string, msgs: NewMsg[]): Promise<void> {
  if (!msgs.length) return;
  const base = Date.now();
  const rows = msgs.map((m, i) => clean({ ...m, id: mid(), at: base + i }));
  await bgRef(uid).set({ msgs: FieldValue.arrayUnion(...rows), updatedAt: base }, { merge: true });
}

async function syncRun(uid: string, id: string): Promise<void> {
  const s = await jobs().doc(id).get();
  if (!s.exists) return;
  const job = s.data() as Job;
  await bgRef(uid).set({ run: clean(jobRun({ runId: job.runId, goal: job.goal, steps: job.steps, createdAt: job.createdAt, endedAt: job.endedAt })), updatedAt: Date.now() }, { merge: true });
}

/** Read, change and write one job in a transaction. `fn` returns false to change nothing: this is how only ONE caller wins a step. */
async function mutate(id: string, fn: (job: Job) => boolean): Promise<Job | null> {
  const ref = jobs().doc(id);
  return getAdminDb().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return null;
    const job = s.data() as Job;
    if (!fn(job)) return null;
    job.updatedAt = Date.now();
    tx.set(ref, clean(job));
    return job;
  });
}

const finishStep = (id: string, i: number, status: "done" | "failed", patch: { result?: string; note?: string }) =>
  mutate(id, (job) => {
    const s = job.steps[i];
    if (!s || s.status !== "running") return false;
    s.status = status;
    s.endedAt = Date.now();
    if (patch.result !== undefined) s.result = clip(patch.result, 6000);
    if (patch.note !== undefined) s.note = clip(patch.note, 400);
    return true;
  });

async function announce(job: Job, i: number): Promise<void> {
  const s = job.steps[i];
  const m = memberById(s.member);
  if (s.status !== "done") {
    await addMsgs(job.uid, [{ kind: "agent", from: s.member, to: "chief", tag: "note", text: `⚠️ I could not finish step ${i + 1}: ${s.note || "unknown reason"}` }]);
    return;
  }
  const out: NewMsg[] = [{ kind: "agent", from: s.member, to: "chief", tag: m?.drafts ? "draft" : "result", text: clip(s.result || "Done. The agent gave no text result: see the Business Hub chat in your dashboard.", 3000) }];
  for (let j = i + 1; j < job.steps.length; j++) {
    if (!job.steps[j].after.includes(i) || job.steps[j].member === s.member) continue;
    out.push({ kind: "agent", from: s.member, to: job.steps[j].member, tag: "handoff", text: `Handing my result to ${nameOf(job.steps[j].member)} for step ${j + 1}: ${oneLine(s.result ?? "", 200)}` });
  }
  await addMsgs(job.uid, out);
}

async function startStep(id: string, job: Job, i: number, site: string): Promise<void> {
  const step = job.steps[i];
  const m = memberById(step.member) ?? BIZ_TEAM[0];
  const results = step.after.map((k) => ({ name: nameOf(job.steps[k].member), text: job.steps[k].result ?? "" }));
  try {
    const runId = await startRun(job.uid, {
      chatId: job.chatId, task: stepTask(m, step, { goal: job.goal, profile: job.profile, results }),
      provider: job.provider as ProviderId, model: job.model, keyRef: job.keyRef, fallbacks: job.fallbacks, origin: job.origin || site, maxRounds: 40,
    });
    await mutate(id, (jb) => { const x = jb.steps[i]; if (!x) return false; x.runId = runId; return true; });
    await addMsgs(job.uid, [{ kind: "agent", from: "chief", to: m.id, tag: "task", text: `Step ${i + 1}: ${step.task}` }]);
  } catch (e) {
    const j = await finishStep(id, i, "failed", { note: `Could not start: ${e instanceof Error ? e.message : "unknown error"}` });
    if (j) await announce(j, i);
  }
}

/** One pass over one job. Safe to call at any time, from anywhere, as often as you like. */
export async function advanceJob(id: string, site: string): Promise<void> {
  const ref = jobs().doc(id);
  let snap = await ref.get();
  if (!snap.exists) return;
  let job = snap.data() as Job;
  if (job.status !== "running") return;
  const S = store();

  // 1) steps whose agent run has ended (or is waiting for the owner)
  const tooOld = Date.now() - job.createdAt > MAX_JOB_AGE_MS;
  for (const s of job.steps) {
    if (s.status !== "running" || !s.runId || s.runId === "pending") continue;
    if (tooOld) { const j = await finishStep(id, s.i, "failed", { note: "Timed out after 24 hours." }); if (j) await announce(j, s.i); continue; }
    const r = await S.getRun(job.uid, s.runId).catch(() => null);
    if (!r) { const j = await finishStep(id, s.i, "failed", { note: "The background run could not be found." }); if (j) await announce(j, s.i); continue; }
    if (r.status === "done") { const j = await finishStep(id, s.i, "done", { result: String(r.result ?? "") }); if (j) await announce(j, s.i); }
    else if (r.status === "error" || r.status === "stopped") { const j = await finishStep(id, s.i, "failed", { note: r.error?.message || (r.status === "stopped" ? "Stopped." : "The agent stopped with an error.") }); if (j) await announce(j, s.i); }
    else if (r.pending && !s.pendingNoted) {
      const won = await mutate(id, (jb) => { const x = jb.steps[s.i]; if (!x || x.pendingNoted) return false; x.pendingNoted = true; return true; });
      if (won) await addMsgs(job.uid, [{ kind: "agent", from: s.member, to: "you", tag: "note", text: `⏸ I am waiting for you: ${oneLine(r.pending.summary || r.pending.question || r.pending.name, 220)}. Open the **Business Hub** chat in your [dashboard](/dashboard) and answer the card. The team continues right after.` }]);
    }
  }

  // 2) what can move now
  snap = await ref.get();
  job = snap.data() as Job;
  if (job.status !== "running") return;
  const act = nextActions(job.steps);
  for (const i of act.skip) {
    const j = await mutate(id, (jb) => { const x = jb.steps[i]; if (!x || x.status !== "queued") return false; x.status = "skipped"; x.note = "A step this one depends on did not finish, so it was not started."; x.endedAt = Date.now(); return true; });
    if (j) await addMsgs(job.uid, [{ kind: "agent", from: job.steps[i].member, to: "chief", tag: "note", text: `Step ${i + 1} on hold: a step it depends on did not finish, so I did not work with missing inputs.` }]);
  }
  if (act.start.length && !(await latchReason(job.uid))) {
    const cap = (await isOwner(job.uid)) ? 12 : 3;
    let active = (await S.listRuns(job.uid, 30)).filter((r) => r.status === "queued" || r.status === "running").length;
    for (const i of act.start) {
      if (active >= cap) break; // the agent limit of the account: this step waits for the next pass
      const claimed = await mutate(id, (jb) => { const x = jb.steps[i]; if (!x || x.status !== "queued") return false; x.status = "running"; x.runId = "pending"; x.startedAt = Date.now(); return true; });
      if (!claimed) continue;
      active++;
      await startStep(id, claimed, i, site);
    }
  }

  // 3) everything finished: one honest report
  snap = await ref.get();
  job = snap.data() as Job;
  if (job.status === "running" && jobOutcome(job.steps) !== "running") {
    const fin = await mutate(id, (jb) => {
      if (jb.status !== "running") return false;
      const out = jobOutcome(jb.steps);
      if (out === "running") return false;
      jb.status = out;
      jb.endedAt = Date.now();
      return true;
    });
    if (fin) {
      await addMsgs(fin.uid, [{ kind: "agent", from: "chief", to: "you", tag: "report", text: reportText(fin.goal, fin.steps, nameOf) }]);
      await trimFeed(fin.uid);
    }
  }
  await syncRun(job.uid, id);
}

/** Keeps the Hub's server feed small (a Firestore document is limited to 1 MB). */
async function trimFeed(uid: string): Promise<void> {
  await getAdminDb().runTransaction(async (tx) => {
    const s = await tx.get(bgRef(uid));
    const msgs = ((s.data() as { msgs?: Msg[] } | undefined)?.msgs ?? []);
    if (msgs.length > 80) tx.set(bgRef(uid), { msgs: msgs.slice(-60) }, { merge: true });
  });
}

export async function launchJob(uid: string, a: {
  chatId: string; goal: string; steps: unknown; profile: unknown; provider: string; model: string; keyRef: string;
  fallbacks: Array<{ provider: string; model: string; keyRef: string }>; origin: string;
}): Promise<string> {
  const running = (await jobs().where("uid", "==", uid).where("status", "==", "running").limit(MAX_JOBS + 1).get()).size;
  if (running >= MAX_JOBS) throw Object.assign(new Error(`${MAX_JOBS} team jobs are already working in the background. Wait for one to finish or stop it.`), { status: 429 });
  const goal = String(a.goal ?? "").trim().slice(0, 2000);
  if (!goal) throw Object.assign(new Error("A goal is required."), { status: 400 });
  const plan = sanitizePlan({ steps: a.steps }, goal, BIZ_TEAM.map((m) => m.id));
  const now = Date.now();
  const runId = now.toString(36) + Math.random().toString(36).slice(2, 6);
  const id = jobId(uid, runId);
  const job: Job = {
    uid, runId, chatId: a.chatId, goal, profile: { ...emptyProfile(), ...cleanPatch(a.profile) },
    steps: plan.map((p, i) => ({ i, member: p.member, task: p.task, after: p.after, status: "queued" as const })),
    status: "running", provider: a.provider, model: a.model, keyRef: a.keyRef, fallbacks: a.fallbacks.slice(0, 3), origin: a.origin, createdAt: now, updatedAt: now,
  };
  await jobs().doc(id).set(clean(job));
  await addMsgs(uid, [{
    kind: "agent", from: "chief", to: "team", tag: "plan",
    text: `**Background plan** (${job.steps.length} step${job.steps.length > 1 ? "s" : ""}). This runs on the server: you can close the app.\n\n${job.steps.map((s, i) => `${i + 1}. **${nameOf(s.member)}**: ${oneLine(s.task, 160)}${s.after.length ? ` _(after step ${s.after.map((k) => k + 1).join(", ")})_` : " _(starts now)_"}`).join("\n")}`,
  }]);
  await syncRun(uid, id);
  await advanceJob(id, a.origin);
  return runId;
}

export async function stopJob(uid: string, runId: string): Promise<boolean> {
  const id = jobId(uid, runId);
  const S = store();
  const job = await mutate(id, (jb) => {
    if (jb.status !== "running") return false;
    const now = Date.now();
    for (const s of jb.steps) {
      if (s.status === "queued") { s.status = "skipped"; s.note = "Stopped by you."; s.endedAt = now; }
      else if (s.status === "running") { s.status = "failed"; s.note = "Stopped by you."; s.endedAt = now; }
    }
    jb.status = "stopped";
    jb.endedAt = now;
    return true;
  });
  if (!job) return false;
  for (const s of job.steps) {
    if (!s.runId || s.runId === "pending") continue;
    const r = await S.getRun(uid, s.runId).catch(() => null);
    if (!r) continue;
    if (r.status === "running") await S.patchRun(uid, s.runId, { stopRequested: true }).catch(() => {});
    else if (r.status === "queued" || r.status === "paused" || r.status === "budget") await S.release(uid, s.runId, { status: "stopped", endedAt: Date.now(), pending: null, reply: null }, null).catch(() => {});
  }
  await addMsgs(uid, [{ kind: "system", text: "The background team run was stopped." }]);
  await syncRun(uid, id);
  return true;
}

export async function advanceForUser(uid: string, site: string): Promise<number> {
  const s = await jobs().where("uid", "==", uid).where("status", "==", "running").limit(MAX_JOBS + 1).get();
  for (const d of s.docs) await advanceJob(d.id, site).catch((e) => console.error("business advance failed", e));
  return s.size;
}

/** Called by the scheduler: every running job, whether or not the owner has the app open. */
export async function tickBusiness(site: string, _now = Date.now()): Promise<{ checked: number }> {
  const s = await jobs().where("status", "==", "running").limit(20).get();
  for (const d of s.docs) await advanceJob(d.id, site).catch((e) => console.error("business tick failed", e));
  return { checked: s.size };
}
