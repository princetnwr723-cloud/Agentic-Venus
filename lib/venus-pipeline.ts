import { brainPrompt, loadBrain, reflect, type Brain } from "@/lib/brain";
import { getStudio, saveProject, saveStudio, type Stage, type VenusProject } from "@/lib/venus";
import { sanitizeStoryboard, sceneLayout, summarizeScene, totalFramesOf, type Scene, type Storyboard } from "@/lib/venus-schema";
import type { ProviderId } from "@/lib/providers";

export type PipelineEnv = {
  uid: string;
  token: () => Promise<string>;
  e2bKey: string;
  apiKeys: Partial<Record<ProviderId, string>>;
  pexels: boolean;
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
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Server returned ${res.status}: ${text.slice(0, 200) || "(empty response)"}` };
  }
}

export function parseSb(p: VenusProject): Storyboard | null {
  if (!p.storyboardJson) return null;
  try {
    return JSON.parse(p.storyboardJson) as Storyboard;
  } catch {
    return null;
  }
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
const withScene = (sb: Storyboard, i: number, s: Scene): Storyboard => ({
  ...sb,
  scenes: sb.scenes.map((x, j) => (j === i ? s : x)),
});

function fallbackScene(s: Scene): Scene {
  const text = String(s.headline ?? s.fallbackText ?? s.narration ?? "…").slice(0, 80);
  return {
    type: "kinetic",
    seconds: s.seconds,
    text,
    ...(s.narration ? { narration: s.narration } : {}),
    ...(s.voice ? { voice: s.voice } : {}),
    ...(s.transition ? { transition: s.transition } : {}),
    ...(s.camera ? { camera: s.camera } : {}),
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
  env: PipelineEnv,
  p: VenusProject,
  sb: Storyboard,
  index: number,
  extra: { previousCode?: string; error?: string; critique?: string } = {}
): Promise<string> {
  const scene = { ...sb.scenes[index] } as Record<string, unknown>;
  delete scene.code;
  const r = await aiCall(env, p, {
    kind: "scene-code",
    scene,
    palette: sb.palette,
    fonts: sb.fonts,
    aspect: aspectOf(sb),
    frames: sceneLayout(sb)[index]?.dur ?? 150,
    concept: sb.concept,
    ...extra,
  });
  if (!r.code) throw new Error(r.error || "The agent returned no code.");
  return r.code as string;
}

async function designAll(run: Run, sbIn: Storyboard): Promise<Storyboard> {
  let sb = sbIn;
  const todo = sb.scenes.map((s, i) => (s.type === "custom" && !s.code ? i : -1)).filter((i) => i >= 0);
  if (todo.length === 0) return sb;
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const i = queue.shift() as number;
      check(run);
      try {
        const code = await genCode(run.env, run.p, sb, i);
        sb = withScene(sb, i, { ...sb.scenes[i], code });
      } catch (e) {
        run.hooks.log(`⚠️ Scene ${i + 1}: design failed (${(e as Error).message.slice(0, 80)}). Using a clean fallback.`);
        sb = withScene(sb, i, fallbackScene(sb.scenes[i]));
      }
      done++;
      run.hooks.progress({ label: `Designing scenes ${done}/${todo.length}`, value: done / todo.length });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return sb;
}

async function prepareRepair(run: Run, sbIn: Storyboard): Promise<Storyboard> {
  let sb = sbIn;
  for (let attempt = 0; attempt < 3; attempt++) {
    check(run);
    const r = await studioCall(run.env, "prepare", { sandboxId: run.sid, projectId: run.p.id, storyboard: sb });
    const errors = (r.errors ?? []) as Array<{ index: number; message: string }>;
    if (errors.length === 0) return sb;
    run.hooks.log(`🛠️ ${errors.length} AI scene(s) have code problems — the agent is fixing them (attempt ${attempt + 1}/3).`);
    for (const e of errors) {
      try {
        const code = await genCode(run.env, run.p, sb, e.index, { previousCode: String(sb.scenes[e.index].code ?? ""), error: e.message });
        sb = withScene(sb, e.index, { ...sb.scenes[e.index], code });
      } catch {
        // retried on the next attempt
      }
    }
  }
  const r = await studioCall(run.env, "prepare", { sandboxId: run.sid, projectId: run.p.id, storyboard: sb });
  for (const e of (r.errors ?? []) as Array<{ index: number; message: string }>) {
    run.hooks.log(`⚠️ Scene ${e.index + 1} could not be fixed — replaced with a clean fallback scene.`);
    sb = withScene(sb, e.index, fallbackScene(sb.scenes[e.index]));
  }
  await studioCall(run.env, "prepare", { sandboxId: run.sid, projectId: run.p.id, storyboard: sb });
  return sb;
}

// ---------- Rendering ----------

export async function renderKind(
  run: Run,
  kind: "preview" | "final" | "scene",
  opts: { sceneIndex?: number } = {}
): Promise<string> {
  let sb = parseSb(run.p);
  if (!sb) throw new Error("No storyboard yet.");
  let repairs = 0;

  for (;;) {
    sb = await prepareRepair(run, sb);
    await upd(run, { storyboardJson: JSON.stringify(sb) });

    const layout = sceneLayout(sb);
    let total = totalFramesOf(sb);
    let frames: string | undefined;
    if (kind === "scene") {
      const L = layout[opts.sceneIndex ?? 0];
      frames = `${L.from}-${L.from + L.dur - 1}`;
      total = L.dur;
    }
    const scale = kind === "final" ? (run.p.quality === "1080p" ? 1.5 : 1) : 0.5;
    const label = kind === "scene" ? "Scene preview" : kind === "preview" ? "Preview render" : "Final render";
    const { jobId } = await studioCall(run.env, "render", { sandboxId: run.sid, projectId: run.p.id, kind, scale, frames });
    run.hooks.log(`🎞️ ${label} started.`);

    const t0 = Date.now();
    let failedLog = "";
    for (;;) {
      check(run);
      if (Date.now() - t0 > 50 * 60_000) throw new Error("Render is taking over 50 minutes — stopped.");
      await sleep(3500);
      const s = await studioCall(run.env, "progress", { sandboxId: run.sid, jobId, total });
      run.hooks.progress({ label, value: s.percent });
      if (s.done) {
        if (s.exitCode !== 0) failedLog = String(s.log);
        break;
      }
    }

    if (failedLog) {
      const m = new RegExp(`custom/${run.p.id}_([A-Za-z0-9]+)\\.tsx`).exec(failedLog);
      const idx = m ? sb.scenes.findIndex((s) => s.type === "custom" && s.id === m[1]) : -1;
      if (idx >= 0 && repairs < 3) {
        repairs++;
        run.hooks.log(`🛠️ Scene ${idx + 1} crashed while rendering — ${repairs <= 2 ? "the agent is rewriting it" : "using a fallback"}.`);
        if (repairs <= 2) {
          const code = await genCode(run.env, run.p, sb, idx, { previousCode: String(sb.scenes[idx].code ?? ""), error: failedLog.slice(-1200) });
          sb = withScene(sb, idx, { ...sb.scenes[idx], code });
        } else {
          sb = withScene(sb, idx, fallbackScene(sb.scenes[idx]));
        }
        continue;
      }
      throw new Error("Render failed:\n" + failedLog.slice(-700));
    }

    run.hooks.progress({ label: "Uploading", value: null });
    const up = await studioCall(run.env, "upload", { sandboxId: run.sid, projectId: run.p.id, kind });
    run.hooks.log(`☁️ ${label} uploaded (${Math.round(((up.bytes || 0) / 1024 / 1024) * 10) / 10} MB).`);
    if (kind === "preview") await upd(run, { previewPath: up.path });
    if (kind === "final") await upd(run, { finalPath: up.path });
    return up.path as string;
  }
}

export async function regenVoice(run: Run, sbIn: Storyboard, index: number): Promise<Storyboard> {
  const openaiKey = run.env.apiKeys.openai;
  const narration = String(sbIn.scenes[index].narration ?? "").trim();
  if (!openaiKey || !narration) return sbIn;
  const t = await studioCall(run.env, "tts", {
    sandboxId: run.sid, projectId: run.p.id, index, text: narration, openaiKey, voice: run.p.voiceName,
  });
  const s = sbIn.scenes[index];
  return withScene(sbIn, index, {
    ...s,
    voice: t.file,
    seconds: t.seconds ? Math.min(14, Math.max(Number(s.seconds), Math.round((t.seconds + 0.6) * 10) / 10)) : s.seconds,
  });
}

function isDark(sb: Storyboard): boolean {
  const bg = sb.palette?.bg1;
  if (bg && /^#[0-9a-fA-F]{6}$/.test(bg)) {
    const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  }
  return sb.theme !== "paper";
}

// ---------- The full pipeline ----------

export async function runPipeline(
  env: PipelineEnv,
  hooks: PipelineHooks,
  start: VenusProject,
  from: Stage
): Promise<VenusProject> {
  const run = newRun(env, hooks, start);
  const todo = (s: Stage) => STAGES.indexOf(from) <= STAGES.indexOf(s);
  const say = hooks.log;
  let brain: Brain = { memories: [], skills: [] };

  try {
    await upd(run, { status: "running", stage: "studio", error: undefined });
    say("🎬 Checking the Studio computer…");
    hooks.progress({ label: "Studio computer", value: null });
    await ensureStudio(run);
    brain = await loadBrain(env.uid).catch(() => brain);
    say("✅ Studio ready.");

    if (todo("script")) {
      check(run);
      await upd(run, { stage: "script" });
      say("✍️ The agent is writing the storyboard and art direction…");
      hooks.progress({ label: "Storyboard", value: null });
      const body = {
        kind: "storyboard", brief: run.p.brief, seconds: run.p.seconds, aspect: run.p.aspect, theme: run.p.theme,
        voice: run.p.voice && Boolean(env.apiKeys.openai), captions: run.p.captions, design: run.p.design ?? "ai",
        context: brainPrompt(brain, run.p.brief, { noSkills: true }),
      };
      let r = await aiCall(env, run.p, body).catch((e) => ({ error: (e as Error).message }));
      if (!r.storyboard) {
        say("First attempt failed — trying again…");
        r = await aiCall(env, run.p, body);
      }
      if (!r.storyboard) throw new Error(r.error || "Could not create the storyboard.");
      await upd(run, { storyboardJson: JSON.stringify(r.storyboard), title: r.storyboard.title || run.p.title });
      say(`📋 ${r.storyboard.scenes.length} scenes planned${r.storyboard.concept ? ` — ${r.storyboard.concept}` : ""}`);
    }

    if (todo("design")) {
      check(run);
      await upd(run, { stage: "design" });
      const sb = parseSb(run.p);
      if (sb && sb.scenes.some((s) => s.type === "custom" && !s.code)) {
        say("🎨 The motion designer is writing custom scenes…");
        const next = await designAll(run, sb);
        await upd(run, { storyboardJson: JSON.stringify(next) });
        say("🎨 Custom scenes written.");
      }
    }

    if (todo("assets")) {
      check(run);
      await upd(run, { stage: "assets" });
      const sb = parseSb(run.p);
      const idxs = (sb?.scenes ?? [])
        .map((s, i) => ((s.type === "image" && s.imageQuery) || (s.type === "footage" && s.footageQuery) ? i : -1))
        .filter((i) => i >= 0);
      if (sb && idxs.length > 0) {
        if (!env.pexels) {
          say("ℹ️ PEXELS_API_KEY is not set — photo/footage scenes use a gradient background.");
        } else {
          say("🖼️ Finding stock photos and footage…");
          let cur = sb;
          for (const [n, i] of idxs.entries()) {
            check(run);
            hooks.progress({ label: `Media ${n + 1}/${idxs.length}`, value: n / idxs.length });
            try {
              const a = await studioCall(env, "assets", { sandboxId: run.sid, projectId: run.p.id, storyboard: cur, index: i });
              if (a.image || a.video) {
                cur = withScene(cur, i, { ...cur.scenes[i], ...(a.image ? { image: a.image } : {}), ...(a.video ? { video: a.video } : {}) });
              } else {
                say(`ℹ️ No media found for scene ${i + 1}.`);
              }
            } catch (e) {
              if (String((e as Error).message) === "Stopped.") throw e;
              say(`ℹ️ Media for scene ${i + 1} skipped: ${(e as Error).message.slice(0, 100)}`);
            }
          }
          await upd(run, { storyboardJson: JSON.stringify(cur) });
        }
      }
    }

    if (todo("voice")) {
      check(run);
      await upd(run, { stage: "voice" });
      let sb = parseSb(run.p)!;
      if (run.p.voice) {
        if (!env.apiKeys.openai) {
          say("ℹ️ No OpenAI key — skipping the voiceover.");
        } else {
          for (let i = 0; i < sb.scenes.length; i++) {
            check(run);
            if (!String(sb.scenes[i].narration ?? "").trim()) continue;
            hooks.progress({ label: `Voiceover ${i + 1}/${sb.scenes.length}`, value: i / sb.scenes.length });
            sb = await regenVoice(run, sb, i);
          }
          await upd(run, { storyboardJson: JSON.stringify(sb) });
          const total = Math.round(totalFramesOf(sb) / 30);
          say(`🎙️ Voiceover ready. Video length ≈ ${total}s${total > 60 ? " (⚠️ over 60s — shorten the narration)" : ""}.`);
        }
      }
      if (run.p.music !== false) {
        try {
          hooks.progress({ label: "Music", value: null });
          const secs = Math.ceil(totalFramesOf(sb) / 30) + 2;
          const m = await studioCall(env, "music", { sandboxId: run.sid, projectId: run.p.id, seconds: secs, dark: isDark(sb) });
          sb = { ...sb, music: m.file as string };
          await upd(run, { storyboardJson: JSON.stringify(sb) });
          say("🎵 Ambient music bed added.");
        } catch (e) {
          if (String((e as Error).message) === "Stopped.") throw e;
          say("ℹ️ Music skipped: " + (e as Error).message.slice(0, 100));
        }
      }
    }

    if (todo("preview")) {
      check(run);
      await upd(run, { stage: "preview" });
      await renderKind(run, "preview");
    }

    if (todo("review") && run.p.review) {
      check(run);
      await upd(run, { stage: "review" });
      let sb = parseSb(run.p)!;
      const layout = sceneLayout(sb);
      const all = sb.scenes.map((_, i) => i);
      const chosen = all.length > 6 ? all.filter((_, k) => k % Math.ceil(all.length / 6) === 0).slice(0, 6) : all;
      const times = chosen.map((i) => Math.round(((layout[i].from + layout[i].dur / 2) / 30) * 100) / 100);
      say("🔍 The agent is reviewing frames of the preview…");
      hooks.progress({ label: "Quality check", value: null });
      try {
        const f = await studioCall(env, "frames", { sandboxId: run.sid, projectId: run.p.id, times });
        const r = await aiCall(env, run.p, {
          kind: "review",
          image: { mediaType: f.mediaType, data: f.image },
          tiles: chosen.map((i, k) => ({ tile: k + 1, index: i, type: sb.scenes[i].type, summary: summarizeScene(sb.scenes[i]).slice(0, 80) })),
        });
        const issues = ((r.issues ?? []) as Array<{ scene: number; problem: string; patch: Record<string, unknown> }>).filter(
          (x) => Number.isInteger(x.scene) && x.scene >= 0 && x.scene < sb.scenes.length
        );
        let changed = false;
        for (const x of issues) {
          const s = sb.scenes[x.scene];
          if (s.type === "custom") {
            say(`🛠️ Scene ${x.scene + 1}: ${x.problem} — redesigning.`);
            const code = await genCode(env, run.p, sb, x.scene, { previousCode: String(s.code ?? ""), critique: x.problem });
            sb = withScene(sb, x.scene, { ...s, code });
            changed = true;
          } else if (Object.keys(x.patch ?? {}).length > 0) {
            say(`🛠️ Scene ${x.scene + 1}: ${x.problem}`);
            sb = withScene(sb, x.scene, sanitizeStoryboard({ scenes: [{ ...s, ...x.patch }] }, { keepFiles: true }).scenes[0]);
            changed = true;
          }
        }
        if (changed) {
          await upd(run, { storyboardJson: JSON.stringify(sb) });
          await renderKind(run, "preview");
          say("✅ Fixes applied and the preview was rendered again.");
        } else {
          say("👍 Quality check passed — no major issues.");
        }
      } catch (e) {
        if (String((e as Error).message) === "Stopped.") throw e;
        say("ℹ️ Quality check skipped: " + (e as Error).message.slice(0, 120));
      }
    }

    if (todo("final")) {
      check(run);
      await upd(run, { stage: "final" });
      await renderKind(run, "final");
    }

    await upd(run, { stage: "done", status: "done" });
    hooks.progress(null);
    say("🎉 Your video is ready!");

    reflect(env.uid, { apiKeys: env.apiKeys, provider: run.p.provider, model: run.p.model }, brain, {
      task: `Make a video: ${run.p.brief}`,
      outcome: `Finished a ${run.p.seconds}s ${run.p.aspect} video "${run.p.title}" (${run.p.design ?? "ai"} design).`,
    })
      .then((l) => { if (l.length) say("🧠 Learned: " + l.join("; ")); })
      .catch(() => {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The pipeline failed.";
    say("⚠️ " + msg);
    await upd(run, { status: "error", error: msg });
    hooks.progress(null);
  }
  return run.p;
}