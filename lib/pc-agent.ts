import { deleteField, doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Recipe, RecipeStep } from "@/lib/recipes";
import type { ProviderId } from "@/lib/providers";

export type PcEnv = { uid: string; token: () => Promise<string>; e2bKey: string };
export type HealCtx = { recipe: Recipe; keep: RecipeStep[]; session: unknown; snapshot: string; url: string };
export type PcOutcome = { status: string; summary: string; recipe: RecipeStep[] | null; proof: string | null };
export type PcPending = { id: string; kind: string; site?: string; question?: string; options?: string[]; message?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const pcJobRef = (uid: string, chatId: string) => doc(db, "users", uid, "pcJobs", chatId);

async function post(env: PcEnv, url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await env.token()) },
    body: JSON.stringify({ uid: env.uid, e2bKey: env.e2bKey, ...body }),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { error: `Server returned ${res.status}: ${text.slice(0, 160) || "(empty)"}` }; }
  if (!res.ok) throw new Error(data?.error || "Request failed.");
  return data;
}

/** The background agent needs Node + git etc. on the computer: same one-time setup Venus Code uses. */
export async function ensureNode(env: PcEnv, sandboxId: string, onLine: (l: string) => void) {
  const s = await post(env, "/api/code/ws", { action: "status", sandboxId });
  if (s.state === "ready") return;
  if (s.state !== "installing") {
    onLine("⚙️ First time on this computer: installing tools (a few minutes, once)…");
    await post(env, "/api/code/ws", { action: "setup", sandboxId });
  }
  for (let i = 0; i < 160; i++) {
    await sleep(5000);
    const t = await post(env, "/api/code/ws", { action: "status", sandboxId });
    if (t.state === "ready") return;
    if (t.state === "failed") throw new Error("Computer setup failed:\n" + String(t.log).slice(-400));
  }
  throw new Error("Computer setup timed out.");
}

export async function startPcJob(env: PcEnv, a: {
  sandboxId: string; chatId: string; task: string; provider: ProviderId; model: string; apiKey: string; context?: string; heal?: HealCtx;
}): Promise<string> {
  const r = await post(env, "/api/runner", {
    action: "pcstart", sandboxId: a.sandboxId, chatId: a.chatId, task: a.task, provider: a.provider, model: a.model, apiKey: a.apiKey,
    context: a.context, appUrl: window.location.origin, proof: true,
    ...(a.heal ? { session: a.heal.session, healSnapshot: a.heal.snapshot, startUrl: a.heal.url } : {}),
  });
  const jobId = String(r.jobId);
  await setDoc(pcJobRef(env.uid, a.chatId), { running: true, task: a.task.slice(0, 300), startedAt: Date.now(), job: { id: jobId, sandboxId: a.sandboxId, offset: 0, hb: Date.now() } });
  return jobId;
}

/** Follows a running job while this tab is open. If the tab closes, the job keeps going and /api/runner/tick finishes it. */
export async function followPcJob(a: {
  env: PcEnv; chatId: string; sandboxId: string; jobId: string;
  onStep: (line: string) => void; onAsk: (p: PcPending) => Promise<Record<string, unknown>>; cancelled: () => boolean;
}): Promise<PcOutcome> {
  const { env, sandboxId, jobId } = a;
  let offset = 0, fails = 0, lastAsk = "", stopSent = false;
  const beat = () => void setDoc(pcJobRef(env.uid, a.chatId), { running: true, job: { id: jobId, sandboxId, offset, hb: Date.now() } }, { merge: true }).catch(() => {});
  const hb = setInterval(beat, 8000);
  const pump = (events: Array<{ k: string; text: string }>) => { for (const e of events) if (e.k === "step" || e.k === "info" || e.k === "error") a.onStep(e.text); };

  try {
    for (;;) {
      await sleep(2500);
      if (a.cancelled() && !stopSent) { stopSent = true; await post(env, "/api/runner", { action: "stop", sandboxId, jobId }).catch(() => {}); }
      let st: any;
      try { st = await post(env, "/api/runner", { action: "status", sandboxId, jobId, offset }); fails = 0; }
      catch (e) { if (++fails >= 25) throw e; continue; }
      pump(st.events ?? []);
      offset = st.next ?? offset;

      const p = st.state?.pending as PcPending | undefined;
      if (p && p.id !== lastAsk) {
        lastAsk = p.id;
        const reply = await a.onAsk(p);
        await post(env, "/api/runner", { action: "answer", sandboxId, jobId, qid: p.id, reply }).catch(() => {});
        continue;
      }
      const s = st.state;
      if (s?.status && s.status !== "running") {
        for (let i = 0; i < 4; i++) {
          const m = await post(env, "/api/runner", { action: "status", sandboxId, jobId, offset });
          pump(m.events ?? []);
          offset = m.next ?? offset;
          if ((m.events ?? []).length < 300) break;
        }
        await setDoc(pcJobRef(env.uid, a.chatId), { running: false, job: deleteField() }, { merge: true }).catch(() => {});
        return { status: String(s.status), summary: String(s.summary || ""), recipe: (s.recipe as RecipeStep[] | null) ?? null, proof: (s.proof as string | null) ?? null };
      }
    }
  } finally {
    clearInterval(hb);
  }
}

export async function proofUrl(env: PcEnv, path: string): Promise<string> {
  const d = await post(env, "/api/venus/media", { action: "url", path });
  return String(d.url ?? "");
}
