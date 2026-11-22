// The real wiring of server-side Venus Pro runs (Next + Firebase Admin + E2B). The logic lives in venus-run.ts and is tested there.
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveValue } from "@/lib/vault";
import { signJob } from "@/lib/job-token";
import { notifyOwner, runAfter } from "@/lib/channels";
import { connect, createSandbox, GONE_PREFIX, pauseSandbox } from "@/lib/e2b-server";
import { supabaseConfigured } from "@/lib/supabase-server";
import type { DbLike } from "@/lib/agent/store";
import type { VenusProject } from "@/lib/venus";
import { createVenusStore, DEFAULT_TIMING, planVenusTick, runVenusSlice, type Raw, type VenusRunDoc, type VenusStore } from "@/lib/venus-run";
import { seededRandom } from "@/lib/venus-journal";

let cached: VenusStore | null = null;
export const venusStore = (): VenusStore => (cached ??= createVenusStore(getAdminDb() as unknown as DbLike));

const userDoc = (uid: string) => getAdminDb().collection("users").doc(uid);
const chatRef = (uid: string, chatId: string) => userDoc(uid).collection("chats").doc(chatId);
const projectRef = (uid: string, pid: string) => userDoc(uid).collection("venusProjects").doc(pid);
/** job ids of Venus runs start with "vpro": only those tokens are accepted by the Venus / studio routes */
export const jobIdOf = (pid: string) => ("vpro" + pid.toLowerCase().replace(/[^a-z0-9]/g, "")).slice(0, 24);

// ---------------------------------------------------------------- projects (the Admin twin of lib/venus.ts: same documents)
const CHUNK_BYTES = 600_000, SPLIT_ABOVE = 500_000;
type Sb = { scenes?: Array<Record<string, unknown>> };

async function readCodes(uid: string, pid: string, chunks: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < chunks; i++) {
    const s = await projectRef(uid, pid).collection("code").doc("c" + i).get().catch(() => null);
    const d = s && s.exists ? (s.data() as { codes?: Record<string, string> }) : null;
    if (d?.codes) Object.assign(out, d.codes);
  }
  return out;
}
export async function loadProjectServer(uid: string, pid: string): Promise<VenusProject | null> {
  const s = await projectRef(uid, pid).get();
  return s.exists ? hydrateServer(uid, s.data() as VenusProject) : null;
}
export async function hydrateServer(uid: string, p: VenusProject): Promise<VenusProject> {
  if (!p.codeChunks || !p.storyboardJson) return p;
  try {
    const sb = JSON.parse(p.storyboardJson) as Sb;
    if (!(sb.scenes ?? []).some((s) => s.type === "custom" && !s.code)) return p;
    const codes = await readCodes(uid, p.id, p.codeChunks);
    for (const s of sb.scenes ?? []) if (s.type === "custom" && !s.code && typeof s.id === "string" && codes[s.id]) s.code = codes[s.id];
    return { ...p, storyboardJson: JSON.stringify(sb) };
  } catch { return p; }
}
export async function saveProjectServer(uid: string, p: VenusProject): Promise<void> {
  const clean = JSON.parse(JSON.stringify(p)) as VenusProject;
  if (clean.storyboardJson && clean.storyboardJson.length > SPLIT_ABOVE) {
    try {
      const sb = JSON.parse(clean.storyboardJson) as Sb;
      const fresh: Record<string, string> = {};
      for (const s of sb.scenes ?? []) if (s.type === "custom" && typeof s.code === "string" && s.code) { fresh[String(s.id)] = s.code; delete s.code; }
      if (Object.keys(fresh).length) {
        const ids = new Set((sb.scenes ?? []).map((s) => String(s.id)));
        const old = clean.codeChunks ? await readCodes(uid, clean.id, clean.codeChunks) : {};
        const all: Record<string, string> = {};
        for (const [k, v] of Object.entries({ ...old, ...fresh })) if (ids.has(k)) all[k] = v;
        const chunks: Array<Record<string, string>> = [];
        let cur: Record<string, string> = {}, size = 0;
        for (const [k, v] of Object.entries(all)) {
          if (size + v.length > CHUNK_BYTES && Object.keys(cur).length) { chunks.push(cur); cur = {}; size = 0; }
          cur[k] = v; size += v.length + 40;
        }
        if (Object.keys(cur).length) chunks.push(cur);
        for (let i = 0; i < chunks.length; i++) await projectRef(uid, clean.id).collection("code").doc("c" + i).set({ codes: chunks[i] });
        for (let i = chunks.length; i < (clean.codeChunks ?? 0); i++) await projectRef(uid, clean.id).collection("code").doc("c" + i).delete().catch(() => {});
        clean.codeChunks = chunks.length;
      }
      clean.storyboardJson = JSON.stringify(sb);
    } catch { /* saved as it is */ }
  }
  await projectRef(uid, clean.id).set(clean);
}

// ---------------------------------------------------------------- the studio computer
async function e2bKeyOf(uid: string): Promise<{ placeholder: string; real: string }> {
  const raw = String(((await userDoc(uid).get()).data() as { e2bKey?: string } | undefined)?.e2bKey ?? "");
  if (!raw) throw new Error("Venus Pro needs an E2B key. Add it under API keys first.");
  return { placeholder: raw, real: await resolveValue(uid, raw) };
}
async function acquireStudio(uid: string, chatId: string, slot: string): Promise<string> {
  const { real } = await e2bKeyOf(uid);
  const existing = ((await chatRef(uid, chatId).get()).data() as { computers?: Record<string, string> } | undefined)?.computers?.[slot];
  if (existing) {
    try { await connect(real, existing); return existing; } // wakes a paused computer
    catch (e) { if (!String((e as Error).message).includes(GONE_PREFIX)) throw e; }
  }
  const created = await createSandbox(real);
  await chatRef(uid, chatId).update({ ["computers." + slot]: created.sandboxId }).catch(() => {});
  return created.sandboxId;
}
export async function releaseStudioOf(uid: string, chatId: string | undefined): Promise<void> {
  if (!chatId) return;
  try {
    const id = ((await chatRef(uid, chatId).get()).data() as { computers?: Record<string, string> } | undefined)?.computers?.studio;
    if (id) await pauseSandbox((await e2bKeyOf(uid)).real, id);
  } catch { /* it pauses itself when idle */ }
}

// ---------------------------------------------------------------- start / kick / stop
/** How many slices may call each other in one chain. A longer chain of self-calls makes Vercel answer 508 INFINITE_LOOP_DETECTED. */
const MAX_CHAIN = 3;

/**
 * Starts the next slice of a video. `depth` is the length of the chain of self-calls so far (0 = a fresh request from the browser or the scheduler).
 * When the chain is long enough it stops here and wakes the run for the scheduler tick (/api/agent/tick), which starts a fresh chain.
 */
export function kickVenus(uid: string, pid: string, chatId: string | undefined, origin: string, depth = 0): void {
  if (depth >= MAX_CHAIN) {
    runAfter(venusStore().setQueue(uid, pid, Date.now() + 5_000));
    return;
  }
  let token: string;
  try { token = signJob(uid, chatId || "venus", jobIdOf(pid), 2 * 3600_000); } catch { return; }
  runAfter(fetch(`${origin}/api/venus/run/step`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ pid, depth }) }));
}

export class VenusStartError extends Error { status: number; constructor(m: string, status = 400) { super(m); this.status = status; } }

/** Starts a video in the background. `project` is the prepared project (brief, length, look ...); the run owns it from here. */
export async function startVenusRun(uid: string, project: VenusProject, o: { origin: string; source: "chat" | "agent" | "routine"; quiet?: boolean; claudeDriven?: boolean }): Promise<string> {
  const S = venusStore();
  if (!supabaseConfigured()) throw new VenusStartError("Venus Pro needs Supabase for video storage. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy.");
  const u = (await userDoc(uid).get()).data() as { apiKeys?: Record<string, string>; e2bKey?: string } | undefined;
  if (!u?.e2bKey) throw new VenusStartError("Venus Pro needs an E2B key. Add it under API keys first.");
  // claudeDriven (MCP): Claude wrote the storyboard, so the script and design steps are skipped and no server model or key is needed
  if (!o.claudeDriven && !u.apiKeys?.[project.provider]) throw new VenusStartError("No API key is saved for this chat's model.");
  if (!project.chatId) throw new VenusStartError("A background video belongs to a chat.");
  const mine = (await S.listRuns(uid, 12)).filter((r) => r.chatId === project.chatId && (r.status === "queued" || r.status === "running"));
  if (mine.length >= 1) throw new VenusStartError("Venus Pro is already making a video in this chat. Wait for it to finish, or stop it.", 429);
  const now = Date.now();
  const first = o.claudeDriven ? "design" : "studio";
  const p: VenusProject = { ...project, status: "running", stage: first, error: undefined, updatedAt: now, server: true };
  await saveProjectServer(uid, p);
  const doc: VenusRunDoc = {
    id: p.id, chatId: project.chatId, title: p.title, status: "queued", stage: first, createdAt: now, updatedAt: now, lease: null, slices: 0, origin: o.origin,
    label: "Starting…", value: null, source: o.source, ...(o.quiet ? { quiet: true } : {}),
  };
  await S.createRun(uid, doc);
  await S.setQueue(uid, p.id, now + DEFAULT_TIMING.hardMs + 60_000);
  kickVenus(uid, p.id, project.chatId, o.origin);
  return p.id;
}

export async function stopVenusRun(uid: string, pid: string): Promise<void> {
  const S = venusStore();
  const run = await S.getRun(uid, pid);
  if (!run) return;
  if (run.status === "running") { await S.patchRun(uid, pid, { stopRequested: true }); return; }
  if (run.status === "queued") {
    await S.release(uid, pid, { status: "stopped", endedAt: Date.now(), stopRequested: false }, null);
    await projectRef(uid, pid).update({ status: "error", error: "Stopped.", updatedAt: Date.now() }).catch(() => {});
    await releaseStudioOf(uid, run.chatId);
  }
}

// ---------------------------------------------------------------- one slice
export async function runSliceServer(uid: string, pid: string, o: { origin: string; depth?: number }): Promise<{ status: string }> {
  const S = venusStore();
  const first = await S.getRun(uid, pid);
  if (!first) return { status: "gone" };
  const chatId = first.chatId;
  const u = ((await userDoc(uid).get()).data() ?? {}) as { apiKeys?: Record<string, string>; e2bKey?: string };
  const token = signJob(uid, chatId || "venus", jobIdOf(pid), 2 * 3600_000);

  const raw: Raw = async (path, body, timeoutMs) => {
    const res = await fetch(`${o.origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { error: `Server returned ${res.status}: ${text.slice(0, 200) || "(empty response)"}` }; }
    return { ok: res.ok, status: res.status, data };
  };

  // the browser code of the pipeline is loaded only now (it is big and only a slice needs it)
  const { runPipeline } = await import("@/lib/venus-pipeline");

  return runVenusSlice({
    S, uid, pid, owner: Math.random().toString(36).slice(2, 10), now: Date.now, raw,
    pipeline: runPipeline,
    loadProject: () => loadProjectServer(uid, pid),
    saveProject: (p) => saveProjectServer(uid, p),
    makeRand: seededRandom,
    makeEnv: (parts, project) => ({
      uid, token: async () => "", e2bKey: String(u.e2bKey ?? ""), apiKeys: (u.apiKeys ?? {}) as any, pexels: Boolean(process.env.PEXELS_API_KEY),
      io: {
        api: parts.api,
        saveProject: parts.saveProject,
        hydrateProject: hydrateServer,
        beat: async () => {},
        agentComputer: async (_u, cid) => ((await chatRef(uid, cid).get()).data() as { computers?: Record<string, string> } | undefined)?.computers?.code ?? null,
        firstChatId: async () => chatId,
        acquire: (_env, cid, slot) => acquireStudio(uid, cid || project.chatId || chatId, slot),
        release: async () => { /* the studio computer is switched off when the run ends (see finish) */ },
        touch: () => {},
        loadBrain: async () => ({ memories: [], skills: [] }),
        noReflect: true,
        rand: parts.rand,
      },
    }),
    io: {
      postToChat: async (text, at) => { await chatRef(uid, chatId).update({ messages: FieldValue.arrayUnion({ role: "assistant", content: text, at }) }).catch(() => {}); },
      notify: (text) => runAfter(notifyOwner(uid, chatId, text)),
      kick: () => kickVenus(uid, pid, chatId, o.origin, (o.depth ?? 0) + 1),
      downloadUrl: async (path) => {
        const r = await raw("/api/venus/media", { action: "url", uid, path, download: "venus-video.mp4" }, 15_000);
        return r.ok ? String(r.data?.url ?? "") : "";
      },
      link: `${o.origin}/dashboard`,
    },
  }).then(async (r) => {
    // the pipeline releases the studio computer itself only through io.release (a no-op here): switch it off when the run has ended
    if (r.status === "done" || r.status === "error" || r.status === "stopped") await releaseStudioOf(uid, chatId);
    return r;
  });
}

// ---------------------------------------------------------------- the scheduler (called by /api/agent/tick)
export async function tickVenus(origin: string, now = Date.now()): Promise<{ checked: number; resumed: number; posted: number }> {
  const S = venusStore();
  const out = { checked: 0, resumed: 0, posted: 0 };
  for (const q of await S.dueQueue(now, 15)) {
    out.checked++;
    const run = await S.getRun(q.uid, q.id);
    const plan = planVenusTick(run, now);
    if (plan.do === "clear") { await S.clearQueue(q.id); continue; }
    if (plan.do === "wait") { await S.setQueue(q.uid, q.id, plan.at); continue; }
    if (plan.do === "post" && run) {
      const p = await loadProjectServer(q.uid, q.id).catch(() => null);
      if (p) {
        const url = run.finalPath ? await runDownloadUrl(q.uid, origin, run.chatId, q.id, run.finalPath) : "";
        const { endMessage } = await import("@/lib/venus-run");
        await chatRef(q.uid, run.chatId).update({ messages: FieldValue.arrayUnion({ role: "assistant", content: endMessage(p, true, url), at: now }) }).catch(() => {});
        await S.patchRun(q.uid, q.id, { postedAt: now });
        out.posted++;
      }
      await S.clearQueue(q.id);
      continue;
    }
    if (run) { await S.setQueue(q.uid, q.id, now + 90_000); kickVenus(q.uid, q.id, run.chatId, run.origin || origin); out.resumed++; }
  }
  return out;
}
async function runDownloadUrl(uid: string, origin: string, chatId: string, pid: string, path: string): Promise<string> {
  try {
    const token = signJob(uid, chatId || "venus", jobIdOf(pid), 600_000);
    const res = await fetch(`${origin}/api/venus/media`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "url", uid, path, download: "venus-video.mp4" }), signal: AbortSignal.timeout(15_000) });
    return res.ok ? String(((await res.json()) as { url?: string }).url ?? "") : "";
  } catch { return ""; }
}
