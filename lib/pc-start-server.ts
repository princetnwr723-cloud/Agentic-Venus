// Starts computer-agent (browser) tasks WITHOUT the website: from a chat app, a mission or a routine.
// A task goes into users/{uid}/pcQueue. advancePcQueue() walks it forward: make or wake the computer -> one-time setup -> start the
// background job. Everything is safe to call again and again (the watcher does, every few seconds).
import { waitUntil } from "@vercel/functions";
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider, type ChatMsg } from "@/lib/ai-providers-server";
import { loadAgent } from "@/lib/voice-calls";
import { resolveValue } from "@/lib/vault";
import { connect, createSandbox, GONE_PREFIX } from "@/lib/e2b-server";
import { codeState, startCodeSetup } from "@/lib/code-server";
import { BusyError, runnerStatus, stopRunner } from "@/lib/runner-server";
import { startPcJob } from "@/lib/pc-runner-server";
import { assertPcAllowed, openPcJob } from "@/lib/billing-server";
import { contractPrompt, extractContract, NO_CONTRACT } from "@/lib/contract";
import { appBaseUrl } from "@/lib/voice-server";
import { notifyOwner } from "@/lib/channels";
import { cronSecret } from "@/lib/cron-auth";

type DocRef = FirebaseFirestore.DocumentReference;
type Q = {
  chatId: string; task: string; status: "queued" | "setup" | "started" | "failed" | "cancelled";
  createdAt: number; updatedAt: number; jobId?: string; error?: string; setupTries?: number; told?: string;
};
const ACTIVE = ["queued", "setup"];
const SETUP_TIMEOUT_MS = 25 * 60_000;
const userRef = (uid: string) => getAdminDb().collection("users").doc(uid);
const queue = (uid: string) => userRef(uid).collection("pcQueue");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

async function e2bKeyOf(uid: string): Promise<string> {
  const raw = ((await userRef(uid).get()).data() as { e2bKey?: string } | undefined)?.e2bKey;
  if (!raw) throw new Error("E2B key saved nahi hai (Settings me add karo).");
  return resolveValue(uid, raw);
}

// ---------------- the watcher (keeps following jobs while nobody has the site open) ----------------

/** Calls /api/runner/watch in a separate function call, so one chain of 50-second slices can follow a job for hours. */
export function kickWatcher(uid: string, round = 0) {
  const secret = cronSecret();
  if (!secret) return;
  let base: string;
  try { base = appBaseUrl(); } catch { return; }
  const p = fetch(`${base}/api/runner/watch`, {
    method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ uid, round }), signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
  try { waitUntil(p); } catch { /* not on Vercel */ }
}

/** Only one watcher per user at a time. */
export async function takeWatchLease(uid: string, ms = 58_000): Promise<boolean> {
  const ref = userRef(uid).collection("pcWatch").doc("lease");
  try {
    return await getAdminDb().runTransaction(async (tx) => {
      const until = ((await tx.get(ref)).data() as { until?: number } | undefined)?.until ?? 0;
      if (until > Date.now()) return false;
      tx.set(ref, { until: Date.now() + ms });
      return true;
    });
  } catch { return false; }
}
export async function releaseWatchLease(uid: string) {
  await userRef(uid).collection("pcWatch").doc("lease").set({ until: 0 }).catch(() => {});
}

export async function activeQueueCount(uid: string): Promise<number> {
  return (await queue(uid).where("status", "in", ACTIVE).get()).size;
}

// ---------------- queue ----------------

export async function queuePcTask(uid: string, chatId: string, task: string): Promise<string> {
  const t = String(task ?? "").trim().slice(0, 6000);
  if (t.length < 10) throw new Error("Task bahut chhota hai: kya karna hai, kis site pe, kya result chahiye — poori detail likho.");
  const waiting = (await queue(uid).where("status", "in", ACTIVE).get()).docs.filter((d) => (d.data() as Q).chatId === chatId);
  if (waiting.length >= 3) throw new Error("Is agent ke 3 computer tasks pehle se line me hain. Unke khatam hone ka wait karo ya /stop bhejo.");
  const ref = queue(uid).doc();
  const now = Date.now();
  const q: Q = { chatId, task: t, status: "queued", createdAt: now, updatedAt: now };
  await ref.set(q);
  kickWatcher(uid);
  return ref.id;
}

async function advanceOne(uid: string, ref: DocRef, q: Q) {
  const say = async (key: string, text: string) => {
    if (q.told === key) return;
    q.told = key;
    await ref.update({ told: key }).catch(() => {});
    await notifyOwner(uid, q.chatId, text).catch(() => null);
  };
  const fail = async (msg: string) => {
    await ref.update({ status: "failed", error: msg.slice(0, 300), updatedAt: Date.now() });
    await notifyOwner(uid, q.chatId, `⚠️ Computer task start nahi ho paya: ${msg}`).catch(() => null);
  };
  try {
    if (Date.now() - q.createdAt > SETUP_TIMEOUT_MS) return fail("Computer taiyaar hone me bahut der lagi (25 minute). Dobara bhejo.");
    const e2bKey = await e2bKeyOf(uid);
    const chatRef = userRef(uid).collection("chats").doc(q.chatId);
    const chat = ((await chatRef.get()).data() ?? {}) as { pcSandboxId?: string | null };

    let sandboxId = chat.pcSandboxId || "";
    let sb: Awaited<ReturnType<typeof connect>> | null = null;
    if (sandboxId) {
      try { sb = await connect(e2bKey, sandboxId); } // resumes a paused computer
      catch (e) { if (!(e instanceof Error) || !e.message.startsWith(GONE_PREFIX)) throw e; sandboxId = ""; }
    }
    if (!sb) {
      await say("create", "🖥️ Naya computer bana raha hoon…");
      sandboxId = (await createSandbox(e2bKey)).sandboxId;
      sb = await connect(e2bKey, sandboxId);
      await chatRef.update({ pcSandboxId: sandboxId, pcPaused: false, pcActiveAt: Date.now() });
    } else {
      await chatRef.update({ pcPaused: false, pcActiveAt: Date.now() }).catch(() => {});
    }

    const st = await codeState(sb);
    if (st.state === "failed") {
      if ((q.setupTries ?? 0) >= 2) return fail("Computer setup fail hua: " + clip(st.log.slice(-200), 200));
      q.setupTries = (q.setupTries ?? 0) + 1;
      await ref.update({ setupTries: q.setupTries, status: "setup", updatedAt: Date.now() });
      await startCodeSetup(sb); // the setup script is safe to run again
      return;
    }
    if (st.state === "none" || st.state === "installing") {
      if (st.state === "none") await startCodeSetup(sb);
      await ref.update({ status: "setup", updatedAt: Date.now() });
      await say("setup", "⚙️ Computer pehli baar setup ho raha hai (kuch minute, sirf ek baar). Phir kaam apne aap shuru ho jayega.");
      return;
    }

    // ready: start the background job
    await assertPcAllowed(uid); // plan limit: throws a clear message when the plan's computer time is used up
    const agent = await loadAgent(uid, q.chatId);
    const llm = async (system: string, prompt: string) =>
      callProvider({
        provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 700,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }] as ChatMsg[],
      });
    const contract = await extractContract(llm, q.task).catch(() => NO_CONTRACT);
    let jobId: string;
    try {
      const r = await startPcJob(sb, {
        uid, chatId: q.chatId, task: q.task + contractPrompt(contract), provider: agent.provider, model: agent.model, apiKey: agent.apiKey,
        appUrl: appBaseUrl(), proof: true,
        contract: contract.kind === "list" ? contract : undefined,
        maxSteps: contract.kind === "list" ? Math.min(200, 70 + contract.quota) : undefined,
      });
      jobId = r.jobId;
    } catch (e) {
      if (e instanceof BusyError) { await say("busy", "⏳ Computer par pehle se ek kaam chal raha hai. Ye task line me hai, uske baad shuru hoga."); return; }
      throw e;
    }
    await openPcJob(uid, jobId, sandboxId);
    // hb: 0 = "nobody has the website open": the tick/watcher owns this job and reports to your chat apps.
    await userRef(uid).collection("pcJobs").doc(q.chatId).set({ running: true, task: q.task.slice(0, 300), startedAt: Date.now(), via: "channel", job: { id: jobId, sandboxId, offset: 0, hb: 0 } });
    await ref.update({ status: "started", jobId, updatedAt: Date.now() });
    await notifyOwner(uid, q.chatId, `🚀 Computer par kaam shuru: ${clip(q.task, 140)}\n\nWebsite band ho tab bhi chalega. Sawal ya approval aaye to yahin milega. /status se haal, /stop se rok sakte ho.`).catch(() => null);
  } catch (e) {
    await fail(e instanceof Error ? e.message : "Unknown error.");
  }
}

/** Walks every waiting task of this user one step forward. */
export async function advancePcQueue(uid: string) {
  const snap = await queue(uid).where("status", "in", ACTIVE).get();
  const rows = snap.docs.map((d) => ({ ref: d.ref, q: d.data() as Q })).sort((a, b) => a.q.createdAt - b.q.createdAt).slice(0, 3);
  for (const x of rows) await advanceOne(uid, x.ref, x.q);
}

// ---------------- status / stop (used by /jobs, /status, /stop and the pc.* tools) ----------------

export async function pcStatusText(uid: string, chatId: string): Promise<string> {
  const lines: string[] = [];
  const waiting = (await queue(uid).where("status", "in", ACTIVE).get()).docs.map((d) => d.data() as Q).filter((q) => q.chatId === chatId);
  for (const q of waiting) lines.push(`⏳ Line me (${q.status === "setup" ? "computer setup" : "shuru hone wala"}): ${clip(q.task, 100)}`);

  const j = (await userRef(uid).collection("pcJobs").doc(chatId).get()).data() as { running?: boolean; task?: string; job?: { id: string; sandboxId: string } } | undefined;
  if (j?.running && j.job) {
    try {
      const sb = await connect(await e2bKeyOf(uid), j.job.sandboxId);
      const s = await runnerStatus(sb, j.job.id, 0);
      const last = s.events.filter((e) => e.k !== "done").slice(-4).map((e) => "• " + clip(String(e.text), 140));
      lines.push(`🖥️ ${s.state.status === "running" ? "Chal raha hai" : s.state.status}: ${clip(j.task ?? "", 100)}\nStep ${s.state.step ?? "?"}${last.length ? "\n" + last.join("\n") : ""}`);
    } catch { lines.push(`🖥️ Task chal raha tha (${clip(j.task ?? "", 100)}), par computer se abhi baat nahi ho pa rahi.`); }
  }
  return lines.length ? lines.join("\n\n") : "Abhi koi computer task nahi chal raha.";
}

export async function stopPcTask(uid: string, chatId: string): Promise<string> {
  let n = 0;
  for (const d of (await queue(uid).where("status", "in", ACTIVE).get()).docs) {
    if ((d.data() as Q).chatId === chatId) { await d.ref.update({ status: "cancelled", updatedAt: Date.now() }); n++; }
  }
  const j = (await userRef(uid).collection("pcJobs").doc(chatId).get()).data() as { running?: boolean; job?: { id: string; sandboxId: string } } | undefined;
  if (j?.running && j.job) {
    try {
      const sb = await connect(await e2bKeyOf(uid), j.job.sandboxId);
      await stopRunner(sb, j.job.id);
      return "🛑 Task ko rok diya. Jo ho paya uski report thodi der me yahin aayegi.";
    } catch (e) { return `Task ko rokne me dikkat: ${e instanceof Error ? e.message : "unknown"}`; }
  }
  return n ? `🛑 Line ke ${n} task cancel kar diye.` : "Rokne ke liye koi computer task nahi mila.";
}