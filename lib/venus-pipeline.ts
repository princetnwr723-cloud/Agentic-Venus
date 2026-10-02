import { brainPrompt, loadBrain, reflect } from "@/lib/brain";
import { getStudio, saveProject, saveStudio, type Stage, type VenusProject } from "@/lib/venus";
import { sanitizeStoryboard, sceneLayout, summarizeScene, totalFramesOf, type Scene, type Storyboard } from "@/lib/venus-schema";
import type { ProviderId } from "@/lib/providers";

export type PipelineEnv = {
  uid: string; token: () => Promise<string>; e2bKey: string;
  apiKeys: Partial<Record<ProviderId, string>>; pexels: boolean;
};
export type PipelineHooks = {
  log: (m: string) => void;
  progress: (p: { label: string; value: number | null } | null) => void;
  update: (p: VenusProject) => void;
  cancelled: () => boolean;
};
export type Run = { env: PipelineEnv; hooks: PipelineHooks; p: VenusProject; sid: string };

export const STAGES: Stage[] = ["studio", "script", "design", "assets", "voice", "preview", "review", "final", "done"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: `Server returned ${res.status}: ${text.slice(0, 200) || "(empty response)"}` }; }
}

export function parseSb(p: VenusProject): Storyboard | null {
  if (!p.storyboardJson) return null;
  try { return JSON.parse(p.storyboardJson) as Storyboard; } catch { return null; }
}

export async function studioCall(env: PipelineEnv, action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch("/api/venus/studio", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await env.token()) },
    body: JSON.stringify({ action, uid: env.uid, e2bKey: env.e2bKey, ...extra }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error || "Studio request failed.");
  return data;
}

export async function signedUrl(env: PipelineEnv, path: string, download?: string): Promise<string> {
  const res = await fetch("/api/venus/media", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await env.token()) },
    body: JSON.stringify({ action: "url", uid: env.uid, path, download }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error || "Could not get the video link.");
  return data.url as string;
}

async function aiCall(env: PipelineEnv, p: VenusProject, body: Record<string, unknown>) {
  const apiKey = env.apiKeys[p.provider];
  if (!apiKey) throw new Error("No API key saved for the selected model's provider.");
  const res = await fetch("/api/venus/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: p.provider, apiKey, model: p.model, ...body }),
  });
  const data = await readJson(res);
  if (!res.ok && !data.storyboard) throw new Error(data?.error || "AI request failed.");
  return data;
}

export function newRun(env: PipelineEnv, hooks: PipelineHooks, p: VenusProject): Run {
  return { env, hooks, p, sid: "" };
}

async function upd(run: Run, patch: Partial<VenusProject>) {
  run.p = { ...run.p, ...patch, updatedAt: Date.now() };
  run.hooks.update(run.p);
  await saveProject(run.env.uid, run.p).catch(() => {});
}

function check(run: Run) {
  if (run.hooks.cancelled()) throw new Error("Stopped.");
}

const aspectOf = (sb: Storyboard) => (sb.height > sb.width ? "9:16" : sb.width === sb.height ? "1:1" : "16:9");
const withScene = (sb: Storyboard, i: number, s: Scene): Storyboard => ({ ...sb, scenes: sb.scenes.map((x, j) => (j === i ? s : x)) });

function fallbackScene(s: Scene): Scene {
  const text = String(s.headline ?? s.fallbackText ?? s.narration ?? "…").slice(0, 80);
  return {
    type: "kinetic", seconds: s.seconds, text,
    ...(s.narration ? { narration: s.narration } : {}), ...(s.voice ? { voice: s.voice } : {}),
    ...(s.transition ? { transition: s.transition } : {}), ...(s.camera ? { camera: s.camera } : {}),
  };
}

// ---------- Studio computer ----------

export async function ensureStudio(run: Run) {
  const { env, hooks } = run;
  let id = (await getStudio(env.uid))?.sandboxId ?? null;

  const waitReady = async (sid: string) => {
    for (let i = 0; i < 220; i++) {
      check(run);
      await sleep(5000);
      const s = await studioCall(env, "status", { sandboxId: sid });
      const last = String(s.log || "").split("\n").filter(Boolean).slice(-1)[0];
      if (last) hooks.log("⚙️ " + last.slice(0, 120));
      if (s.state === "ready") return;
      if (s.state === "failed") throw new Error("Studio install failed:\n" + String(s.log).slice(-600));
    }
    throw new Error("Studio setup is taking too long (timeout).");
  };

  if (id) {
    try {
      const s = await studioCall(env, "status", { sandboxId: id });
      if (s.state !== "ready") {
        if (s.state !== "installing") {
          hooks.log("Updating the Studio template…");
          await studioCall(env, "setup", { sandboxId: id });
        }
        await waitReady(id);
      }
      run.sid = id;
      return;
    } catch (e) {
      if (!String((e as Error).message).includes("SANDBOX_GONE")) throw e;
      id = null;
    }
  }
  hooks.log("Creating a new Studio computer — the first setup takes 5-8 minutes (Node, Remotion, Chrome).");
  const c = await studioCall(env, "create");
  id = c.sandboxId as string;
  await saveStudio(env.uid, { sandboxId: id });
  await studioCall(env, "setup", { sandboxId: id });
  await waitReady(id);
  run.sid = id;
}

// ---------- AI-written scenes ----------

export async function genCode(
  env: PipelineEnv, p: VenusProject, sb: Storyboard, index: number,
  extra: { previousCode?: string; error?: string; critique?: string } = {}
): Promise<string> {
  const scene = { ...sb.scenes[index] } as Record<string, unknown>;
  delete scene.code;
  const r = await aiCall(env, p, {
    kind: "scene-code", scene, palette: sb.palette, fonts: sb.fonts, aspect: aspectOf(sb),
    frames: sceneLayout(sb)[index]?.dur ?? 150, concept: sb.concept, ...extra,