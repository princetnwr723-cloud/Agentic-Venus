import { brainPrompt, loadBrain, reflect, type Brain } from "@/lib/brain";
import { listChats } from "@/lib/chats";
import { acquire, releaseNow, touch } from "@/lib/computers";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { hydrateProject, saveProject, type Stage, type VenusProject } from "@/lib/venus";
import { sanitizeStoryboard, sceneLayout, summarizeScene, totalFramesOf, type Scene, type Storyboard } from "@/lib/venus-schema";
import { PART_FRAMES, parseUpload } from "@/lib/venus-jobs";
import type { ProviderId } from "@/lib/providers";

export type PipelineEnv = {
  uid: string; token: () => Promise<string>; e2bKey: string;
  apiKeys: Partial<Record<ProviderId, string>>; pexels: boolean; sandboxId?: string;
};
export type PipelineHooks = {
  log: (m: string) => void;
  progress: (p: { label: string; value: number | null } | null) => void;
  update: (p: VenusProject) => void;
  cancelled: () => boolean;
};
export type Run = { env: PipelineEnv; hooks: PipelineHooks; p: VenusProject; sid: string };

export const STAGES: Stage[] = ["studio", "ingest", "script", "design", "assets", "voice", "preview", "review", "final", "done"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A different look for every video (this is what stops all videos from looking the same).
const STYLES: Array<[string, string]> = [
  ["Editorial print", "oversized serif headlines, thin rules, asymmetrical grid, warm paper palette, slow confident motion, lots of whitespace"],
  ["Neo-brutalist pop", "thick black outlines, flat saturated colors, hard offset shadows, sticker-like shapes, bouncy stepped motion"],
  ["Glass & light", "frosted glass cards, soft glows, gradient meshes, shallow depth, slow parallax, rounded geometry"],
  ["Swiss data-journalism", "strict grid, monospaced numerals, charts as the hero, two colors only, precise linear motion, small-caps labels"],
  ["Retro-futurism", "CRT scanlines, neon vector grids, chrome gradients, wide letter-spacing, glitch cuts"],
  ["Kinetic type only", "typography IS the visual: giant words, masks, text-on-path, scale cuts, no icons"],
  ["Isometric blocks", "isometric cubes, stacked layers, construction-style build-ups, calm palette, snappy easing"],
  ["Hand-drawn doodle", "wobbly strokes drawn on, marker underlines, paper texture, playful easing"],
  ["Cinematic dark", "letterboxed look, vignette, light leaks, slow push moves, serif titles, restrained color"],
  ["Bold gradient social", "huge gradient headlines, quick whip transitions, high energy, vertical-friendly stacks"],
  ["Blueprint", "technical drawing lines on a flat colour, dimension marks, annotations, stepwise draw-on animation"],
  ["Paper cut-out", "layered paper shapes with soft shadows, stop-motion timing, tactile textures"],
  ["Memphis geometry", "confetti shapes, bold patterns, clashing but balanced colours, bouncy overshoot motion"],
  ["Mono ink", "black ink on off-white, huge contrast, brush strokes, one accent colour used once per scene"],
  ["Soft pastel 3D-ish", "rounded pastel objects with fake depth, gentle floating, calm pacing, friendly type"],
  ["Terminal minimal", "monospace type, a single accent, blinking cursors, hard cuts, no decoration"],
  ["Magazine collage", "cut-out blocks, overlapping text frames, tape and stamps, rotated elements, snappy staggered motion"],
  ["Cosmic gradient", "deep space tones, slow drifting particles, glowing lines, wide cinematic type"],
  ["Sports broadcast", "diagonal wipes, scoreboard-like data bars, condensed bold type, fast energetic motion"],
  ["Infographic flat", "flat icons built from shapes, clear data stories, rounded bars, friendly colour coding"],
  ["Noir film", "high-contrast black and white with one red accent, slow pans, big serif titles"],
  ["Playful sticker book", "stickers, scribbles, hand-lettered feel, quirky transitions, bright candy colours"],
];
// one extra creative rule per video, picked at random, so even the same style never repeats itself
const TWISTS = [
  "Build one recurring visual motif (a shape or object) that transforms from scene to scene.",
  "Use an unusual layout rule: everything is aligned to one diagonal.",
  "Use extreme scale contrast: one giant element and tiny supporting text in every scene.",
  "Change the background kind and colour field in every scene.",
  "Use only two accent colours but different backgrounds, and let the transitions be the personality.",
  "Tell the story as if it were a physical object being assembled piece by piece.",
  "Use a split-screen or multi-panel composition in at least a third of the scenes.",
  "Use text that moves along paths or is revealed by masks in at least half of the scenes.",
  "Alternate between very calm scenes and very energetic scenes.",
  "Use a strong horizontal rhythm: elements enter from alternating sides.",
];
const rndSeed = () => Math.floor(Math.random() * 999_000) + 1;

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
  if (typeof extra.sandboxId === "string") touch(extra.sandboxId, env.e2bKey);
  return data;
}

/** The AGENT's computer of the chat this video was started from (its downloads live there; the studio is a different machine). */
async function agentComputer(run: Run): Promise<string | null> {
  const chatId = run.p.chatId;
  if (!chatId) return null;
  try {
    const snap = await getDoc(doc(db, "users", run.env.uid, "chats", chatId));
    const id = (snap.data() as { computers?: Record<string, string> } | undefined)?.computers?.code;
    return id && id !== run.sid ? id : null;
  } catch { return null; }
}

async function pcCall(env: PipelineEnv, action: string, extra: Record<string, unknown>) {
  const res = await fetch("/api/code/ws", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await env.token()) },
    body: JSON.stringify({ action, uid: env.uid, e2bKey: env.e2bKey, ...extra }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error || "Computer request failed.");
  if (typeof extra.sandboxId === "string") touch(extra.sandboxId, env.e2bKey);
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
    method: "POST", headers: { "Content-Type": "application/json" },
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
const check = (run: Run) => { if (run.hooks.cancelled()) throw new Error("Stopped."); };

async function mediaCall(env: PipelineEnv, action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch("/api/venus/media", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await env.token()) },
    body: JSON.stringify({ action, uid: env.uid, ...extra }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error || "Media request failed.");
  return data;
}

/** Waits for a background job on the studio computer. `map` turns the job's own percent into the overall progress bar. */
async function waitJob(run: Run, jobId: string, label: string, total: number, maxMinutes: number, map?: (v: number | null) => number | null): Promise<{ ok: boolean; log: string }> {
  const t0 = Date.now();
  let lastLine = "";
  for (;;) {
    check(run);
    if (Date.now() - t0 > maxMinutes * 60_000) throw new Error(`${label} is taking over ${maxMinutes} minutes — stopped.`);
    await sleep(3500);
    const s = await studioCall(run.env, "progress", { sandboxId: run.sid, jobId, total });
    const pct = typeof s.percent === "number" ? s.percent : null;
    run.hooks.progress({ label, value: map ? map(pct) : pct });
    const line = String(s.log || "").split("\n").filter((l) => /^\[\d\/\d\]|^\[music\]/.test(l)).slice(-1)[0];
    if (line && line !== lastLine) { lastLine = line; run.hooks.log("⚙️ " + line.slice(0, 120)); }
    if (s.done) return { ok: s.exitCode === 0, log: String(s.log || "") };
  }
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

// ---------- Venus Pro has its OWN studio computer (switched off again when the work ends) ----------

async function resolvePc(run: Run): Promise<string> {
  if (run.env.sandboxId) return run.env.sandboxId;
  const chatId = run.p.chatId ?? (await listChats(run.env.uid))[0]?.id;
  if (!chatId) throw new Error("Create a chat first — Venus Pro gets its own studio computer under a chat.");
  if (run.p.chatId !== chatId) await upd(run, { chatId });
  return acquire({ uid: run.env.uid, e2bKey: run.env.e2bKey }, chatId, "studio");
}

export async function ensureStudio(run: Run) {
  const { env, hooks } = run;
  const sid = await resolvePc(run);
  const waitReady = async () => {
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
  try {
    const s = await studioCall(env, "status", { sandboxId: sid });
    if (s.state !== "ready") {
      hooks.log("Installing the video tools (Remotion, FFmpeg) on the studio computer — 5-8 minutes, once.");
      if (s.state !== "installing") await studioCall(env, "setup", { sandboxId: sid });
      await waitReady();
    }
  } catch (e) {
    if (String((e as Error).message).includes("SANDBOX_GONE")) throw new Error("The studio computer has expired. Run it again and a new one will be created.");
    throw e;
  }
  run.sid = sid;
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
  });
  if (!r.code) throw new Error(r.error || "The agent returned no code.");
  return r.code as string;
}

async function designAll(run: Run, sbIn: Storyboard): Promise<Storyboard> {
  let sb = sbIn;
  if (run.p.design === "library") {
    // library mode: no scene is written as code (a custom scene that the model added anyway becomes a clean library scene)
    return { ...sb, scenes: sb.scenes.map((s) => (s.type === "custom" ? fallbackScene(s) : s)) };
  }
  const todo = sb.scenes.map((s, i) => (s.type === "custom" && !s.code ? i : -1)).filter((i) => i >= 0);
  if (todo.length === 0) return sb;
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const i = queue.shift() as number;
      check(run);
      try {
        sb = withScene(sb, i, { ...sb.scenes[i], code: await genCode(run.env, run.p, sb, i) });
      } catch (e) {
        run.hooks.log(`⚠️ Scene ${i + 1}: design failed (${(e as Error).message.slice(0, 80)}). Using a clean fallback.`);
        sb = withScene(sb, i, fallbackScene(sb.scenes[i]));
      }
      done++;
      run.hooks.progress({ label: `Designing scenes ${done}/${todo.length}`, value: done / todo.length });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
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
        sb = withScene(sb, e.index, { ...sb.scenes[e.index], code: await genCode(run.env, run.p, sb, e.index, { previousCode: String(sb.scenes[e.index].code ?? ""), error: e.message }) });
      } catch { /* retried on the next attempt */ }
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

export async function renderKind(run: Run, kind: "preview" | "final" | "scene", opts: { sceneIndex?: number } = {}): Promise<string> {
  run.p = await hydrateProject(run.env.uid, run.p); // long videos keep the scene code in separate documents
  let sb = parseSb(run.p);
  if (!sb) throw new Error("No storyboard yet.");
  let repairs = 0;
  const tries = new Map<number, number>();
  const doneParts = new Set<number>();

  for (;;) {
    sb = await prepareRepair(run, sb);
    await upd(run, { storyboardJson: JSON.stringify(sb) });

    const layout = sceneLayout(sb);
    const totalAll = totalFramesOf(sb);
    const scale = kind === "final" ? (run.p.quality === "1080p" ? 1.5 : 1) : 0.5;
    const label = kind === "scene" ? "Scene preview" : kind === "preview" ? "Preview render" : "Final render";

    // a long video is rendered in parts (each one is its own job), then joined
    let ranges: Array<{ frames?: string; total: number }>;
    if (kind === "scene") {
      const L = layout[opts.sceneIndex ?? 0];
      ranges = [{ frames: `${L.from}-${L.from + L.dur - 1}`, total: L.dur }];
    } else if (totalAll > PART_FRAMES * 1.25) {
      const n = Math.ceil(totalAll / PART_FRAMES);
      ranges = Array.from({ length: n }, (_, k) => {
        const from = Math.floor((k * totalAll) / n);
        const to = Math.floor(((k + 1) * totalAll) / n) - 1;
        return { frames: `${from}-${to}`, total: to - from + 1 };
      });
    } else ranges = [{ total: totalAll }];
    const n = ranges.length;
    if (n > 1) run.hooks.log(`🎞️ ${label}: ${Math.round(totalAll / 30 / 60 * 10) / 10} minutes, rendered in ${n} parts.`);
    else run.hooks.log(`🎞️ ${label} started.`);

    let failedLog = "";
    let failedJob = "";
    for (let k = 0; k < n && !failedLog; k++) {
      if (doneParts.has(k)) continue;
      const lab = n > 1 ? `${label} (part ${k + 1}/${n})` : label;
      const { jobId } = await studioCall(run.env, "render", { sandboxId: run.sid, projectId: run.p.id, kind, scale, frames: ranges[k].frames, ...(n > 1 ? { part: k } : {}) });
      const res = await waitJob(run, jobId, lab, ranges[k].total, 45, (v) => (v === null ? null : (k + v) / n));
      if (res.ok) doneParts.add(k);
      else { failedLog = res.log; failedJob = jobId; }
    }

    if (failedLog) {
      // the real reason: the FIRST error of the whole log (the tail of a React stack trace says nothing) and the scene file that crashed
      const info = await studioCall(run.env, "joblog", { sandboxId: run.sid, projectId: run.p.id, jobId: failedJob }).catch(() => null);
      const first = String(info?.firstError ?? "").slice(0, 900);
      const fromTail = new RegExp(`custom/${run.p.id}_([A-Za-z0-9]+)\\.tsx`).exec(failedLog);
      const sceneId = (info?.sceneId as string | null) ?? (fromTail ? fromTail[1] : null);
      const idx = sceneId ? sb.scenes.findIndex((s) => s.type === "custom" && s.id === sceneId) : -1;
      const reason = (first || failedLog).slice(-1200);
      if (idx >= 0 && repairs < 14) {
        repairs++;
        const t = (tries.get(idx) ?? 0) + 1;
        tries.set(idx, t);
        run.hooks.log(`🛠️ Scene ${idx + 1} crashed while rendering — ${t <= 2 ? "the agent is rewriting it" : "using a fallback"}.`);
        sb = t <= 2
          ? withScene(sb, idx, { ...sb.scenes[idx], code: await genCode(run.env, run.p, sb, idx, { previousCode: String(sb.scenes[idx].code ?? ""), error: reason }) })
          : withScene(sb, idx, fallbackScene(sb.scenes[idx]));
        continue; // parts that already finished stay valid: only the scene's own part is rendered again
      }
      if (!sb.safe) {
        // the culprit is unknown: render once more in safe mode (plain cards instead of AI scenes and generated backgrounds) so the video always gets finished
        run.hooks.log(`⚠️ The render crashed (${(first.split("\n").find((l) => /error/i.test(l)) || "unknown error").slice(0, 140)}). Rendering again in safe mode so the video still gets finished.`);
        sb = { ...sb, safe: true };
        doneParts.clear();
        continue;
      }
      throw new Error("Render failed:\n" + (first || failedLog.slice(-700)));
    }

    if (n > 1) {
      run.hooks.progress({ label: "Joining the parts", value: null });
      const { jobId } = await studioCall(run.env, "concat", { sandboxId: run.sid, projectId: run.p.id, kind, parts: n });
      const j = await waitJob(run, jobId, "Joining the parts", 0, 30);
      if (!j.ok) throw new Error("Joining the parts failed:\n" + j.log.slice(-400));
    }

    run.hooks.progress({ label: "Uploading", value: null });
    const up = await studioCall(run.env, "upload", { sandboxId: run.sid, projectId: run.p.id, kind });
    const u = await waitJob(run, up.jobId, "Uploading", 0, 90);
    const info = parseUpload(u.log);
    if (!u.ok || info.code !== 200) {
      throw new Error(`Upload failed (HTTP ${info.code || "?"}). ${info.code === 413 ? "The video is larger than the storage limit of your Supabase plan: use 720p, a shorter video, or raise the file size limit in Supabase Storage settings." : info.detail}`);
    }
    run.hooks.log(`☁️ ${label} uploaded (${Math.round((info.bytes / 1024 / 1024) * 10) / 10} MB).`);
    if (kind === "preview") await upd(run, { previewPath: up.path });
    if (kind === "final") await upd(run, { finalPath: up.path });
    return up.path as string;
  }
}

async function ttsPatch(run: Run, sb: Storyboard, index: number): Promise<Partial<Scene> | null> {
  const narration = String(sb.scenes[index].narration ?? "").trim();
  if (!narration) return null;
  // the default voice name of old projects ("nova") is not a choice: the owner's voice system decides
  const legacy = ["nova", "alloy", "echo", "fable", "onyx", "shimmer", "system", ""];
  const t = await studioCall(run.env, "tts", { sandboxId: run.sid, projectId: run.p.id, index, text: narration, voice: legacy.includes(String(run.p.voiceName ?? "")) ? "system" : run.p.voiceName, chatId: run.p.chatId });
  const s = sb.scenes[index];
  return { voice: t.file, seconds: t.seconds ? Math.min(30, Math.max(Number(s.seconds), Math.round((t.seconds + 0.6) * 10) / 10)) : s.seconds };
}

/** Voice-over for one scene, spoken by the user's voice system (Settings -> Voice). */
export async function regenVoice(run: Run, sbIn: Storyboard, index: number): Promise<Storyboard> {
  const patch = await ttsPatch(run, sbIn, index);
  return patch ? withScene(sbIn, index, { ...sbIn.scenes[index], ...patch } as Scene) : sbIn;
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

export async function runPipeline(env: PipelineEnv, hooks: PipelineHooks, start: VenusProject, from: Stage): Promise<VenusProject> {
  const run = newRun(env, hooks, await hydrateProject(env.uid, start));
  const todo = (s: Stage) => STAGES.indexOf(from) <= STAGES.indexOf(s);
  const say = hooks.log;
  // memory and skills belong to the chat this video was ordered in (nothing is shared between chats)
  const scope = { uid: env.uid, chatId: start.chatId ?? "global" };
  let brain: Brain = { memories: [], skills: [] };

  try {
    await upd(run, { status: "running", stage: "studio", error: undefined });
    say("🎬 Checking the studio computer…");
    hooks.progress({ label: "Computer", value: null });
    await ensureStudio(run);
    brain = await loadBrain({ uid: env.uid, chatId: run.p.chatId ?? scope.chatId }).catch(() => brain);
    say("✅ Ready.");

    // ---- edit mode: take in the user's own video (download, convert, find shots / silences / speech, sample frames) ----
    if (run.p.mode === "edit" && todo("ingest")) {
      check(run);
      await upd(run, { stage: "ingest" });
      const src = run.p.source;
      if (!src) throw new Error("No video was given to edit.");
      say("📥 Taking in your video…");
      hooks.progress({ label: "Preparing your video", value: null });
      const st = await studioCall(env, "ingest-start", { sandboxId: run.sid, projectId: run.p.id, source: src });
      if (!st.speech) say("ℹ️ No OpenAI key found for reading the speech: the edit continues without captions or transcript.");
      const res = await waitJob(run, st.jobId, "Preparing your video", 0, 60);
      if (!res.ok) {
        const m = /ERR: ([^\n]+)/.exec(res.log);
        throw new Error(m ? m[1] : "Your video could not be prepared:\n" + res.log.slice(-400));
      }
      if (src.kind === "upload" && src.path) void mediaCall(env, "delete", { paths: [src.path] }).catch(() => {}); // the studio computer has its own copy now
      say("✅ Your video is ready for editing.");
    }

    if (todo("script")) {
      check(run);
      await upd(run, { stage: "script" });
      const aiOwn = true; // every video is designed by the agent
      // "add a voice-over" in the brief is enough (the chat only switched it on when an OpenAI key existed)
      const wantsVoice = run.p.voice || /(voice[\s-]?over|voiceover|narrat|dubb|awaaz|avaaz|आवाज|वॉइस|वॉयस)/i.test(run.p.brief);
      const voiceOn = wantsVoice ? Boolean((await mediaCall(env, "voice-status").catch(() => ({ ready: true }))).ready) : false;
      if (wantsVoice && !voiceOn) say("ℹ️ No voice provider is connected (Settings → Voice), so there will be no voice-over.");
      if (voiceOn !== run.p.voice) await upd(run, { voice: voiceOn });
      const style = STYLES[Math.floor(Math.random() * STYLES.length)];
      const twist = TWISTS[Math.floor(Math.random() * TWISTS.length)];
      const agentSid = run.p.mode === "edit" ? null : await agentComputer(run);
      const files = agentSid ? (((await pcCall(env, "listassets", { sandboxId: agentSid }).catch(() => ({ files: [] as string[] }))).files ?? []) as string[]) : [];
      const memory = brainPrompt(brain, run.p.brief, { noSkills: true });
      const assetsNote = files.length ? `\n\nAssets the computer already downloaded (use up to 6 by setting a scene's "assetFile" to the EXACT file name; images → type "image", videos → type "footage"): ${files.slice(0, 40).join(", ")}` : "";

      if (run.p.mode === "edit") {
        // ---------- the agent edits the user's own video ----------
        say("🎞️ The agent is watching your video and planning the edit…");
        hooks.progress({ label: "Planning the edit", value: null });
        const ing = await studioCall(env, "ingest-read", { sandboxId: run.sid, projectId: run.p.id });
        const an = ing.analysis as { duration: number; width: number; height: number; hasAudio: boolean; cuts: number[]; silences: Array<[number, number]>; transcript: Array<{ s: number; e: number; t: string }>; tiles: number[] };
        const srcAspect = an.height > an.width ? "9:16" : an.width === an.height ? "1:1" : "16:9";
        const aspect = run.p.matchSource ? srcAspect : run.p.aspect;
        if (aspect !== run.p.aspect) await upd(run, { aspect: aspect as VenusProject["aspect"] });
        const body = {
          kind: "edit-plan", brief: run.p.brief, seconds: run.p.seconds, keepAll: Boolean(run.p.keepAll), aspect, theme: run.p.theme,
          captions: run.p.captions && an.transcript.length > 0, music: run.p.music === true,
          facts: { duration: an.duration, width: an.width, height: an.height, fps: 30, hasAudio: an.hasAudio, cuts: an.cuts, silences: an.silences, transcript: an.transcript, tiles: an.tiles },
          source: ing.source, image: { mediaType: ing.mediaType, data: ing.image },
          context: memory + `\n\nA visual style for anything you ADD to this video (titles, graphics): ${style[0]} — ${style[1]}. ${twist}`,
        };
        let r = await aiCall(env, run.p, body).catch((e) => ({ error: (e as Error).message }));
        if (!r.storyboard) { say("First attempt failed — trying again…"); r = await aiCall(env, run.p, body); }
        if (!r.storyboard) throw new Error(r.error || "Could not plan the edit.");
        const sbNew = r.storyboard as Storyboard;
        sbNew.seed = rndSeed();
        sbNew.source = ing.source;
        if (body.captions && an.transcript.length) sbNew.transcript = an.transcript;
        sbNew.scenes = sbNew.scenes.map((x) => (x.type === "clip" || x.useSource === true ? { ...x, video: ing.source.path } : x));
        const clean = sanitizeStoryboard(sbNew, { aspect: aspect as VenusProject["aspect"], theme: run.p.theme, captions: Boolean(body.captions), keepFiles: true });
        const len = Math.round(totalFramesOf(clean) / 30);
        await upd(run, { storyboardJson: JSON.stringify(clean), title: clean.title || run.p.title, sourceInfo: ing.source, seconds: len });
        const nClips = clean.scenes.filter((x) => x.type === "clip").length;
        say(`📋 Edit planned: ${nClips} clips + ${clean.scenes.length - nClips} designed scenes, about ${len}s.`);
      } else if (run.p.seconds > 120) {
        // ---------- a long video (up to one hour): chapter plan first, then every chapter is written on its own ----------
        say(`✍️ Planning a ${Math.round(run.p.seconds / 6) / 10}-minute video in chapters…`);
        hooks.progress({ label: "Chapter plan", value: null });
        const ctx = memory + (aiOwn ? `\n\nOPTIONAL INSPIRATION (ignore it completely if the brief states a style or you have a better idea; the look must come from YOUR concept for this subject): ${style[0]} — ${style[1]}. Variation seed ${rndSeed()}.` : `\n\nVISUAL STYLE FOR THIS VIDEO: ${style[0]} — ${style[1]}. ${twist} Variation seed ${rndSeed()}.`) + assetsNote;
        const ob = { kind: "outline", brief: run.p.brief, seconds: run.p.seconds, aspect: run.p.aspect, theme: run.p.theme, voice: voiceOn, context: ctx };
        let o = await aiCall(env, run.p, ob).catch((e) => ({ error: (e as Error).message }));
        if (!o.chapters) { say("First attempt failed — trying again…"); o = await aiCall(env, run.p, ob); }
        if (!o.chapters) throw new Error(o.error || "Could not plan the chapters.");
        const chapters = o.chapters as Array<{ title: string; summary: string; seconds: number }>;
        const styleLock = o.style as Record<string, unknown>;
        const parts: Scene[][] = chapters.map(() => []);
        let done = 0;
        const queue = chapters.map((_, k) => k);
        const worker = async () => {
          while (queue.length) {
            const k = queue.shift() as number;
            check(run);
            const ch = chapters[k];
            const pb = {
              kind: "storyboard", brief: run.p.brief, seconds: ch.seconds, aspect: run.p.aspect, theme: run.p.theme, voice: voiceOn, captions: run.p.captions,
              design: "ai", context: memory + assetsNote, part: { index: k, total: chapters.length, title: ch.title, summary: ch.summary }, style: styleLock,
            };
            let r = await aiCall(env, run.p, pb).catch((e) => ({ error: (e as Error).message }));
            if (!r.storyboard) r = await aiCall(env, run.p, pb).catch((e) => ({ error: (e as Error).message }));
            const scenes = r.storyboard ? ((r.storyboard as Storyboard).scenes as Scene[]) : [{ type: "kinetic", seconds: Math.min(14, ch.seconds), text: ch.title.slice(0, 80) } as Scene];
            if (!r.storyboard) say(`⚠️ Chapter ${k + 1} could not be written — a title card is used instead.`);
            parts[k] = scenes.map((x) => (x.type === "custom" && !String(x.id).startsWith("p" + k) ? { ...x, id: ("p" + k + String(x.id)).slice(0, 20) } : x));
            done++;
            hooks.progress({ label: `Writing chapters ${done}/${chapters.length}`, value: done / chapters.length });
          }
        };
        await Promise.all([worker(), worker(), worker()]);
        const all = parts.flat();
        const total = chapters.reduce((a, c) => a + c.seconds, 0);
        const sbNew = sanitizeStoryboard({ ...styleLock, title: o.title, scenes: all }, { aspect: run.p.aspect, theme: run.p.theme, captions: run.p.captions, maxSeconds: Math.max(run.p.seconds, total) * 1.05, maxScenes: 450 });
        sbNew.seed = rndSeed();
        sbNew.concept = (aiOwn ? `${sbNew.concept ?? ""}` : `${style[0]} — ${style[1]}. ${twist} ${sbNew.concept ?? ""}`).slice(0, 600);
        if (aiOwn) sbNew.scenes = sbNew.scenes.map((x) => (x.type === "custom" && x.bg === undefined ? ({ ...x, bg: "none" } as Scene) : x)); // the scene paints its own world
        await upd(run, { storyboardJson: JSON.stringify(sbNew), title: sbNew.title || run.p.title });
        say(`📋 ${sbNew.scenes.length} scenes planned in ${chapters.length} chapters${aiOwn ? " (designed by the agent)" : ` (“${style[0]}” style)`}.`);
      } else {
        // ---------- a normal video ----------
        say("✍️ The agent is writing the storyboard and art direction…");
        hooks.progress({ label: "Storyboard", value: null });
        const context =
          memory +
          (aiOwn
            ? `\n\nOPTIONAL INSPIRATION (ignore it completely if the brief states a style or you have a better idea; the look must come from YOUR concept for this subject, and it must not look like a template video): ${style[0]} — ${style[1]}. Variation seed ${rndSeed()}.`
            : `\n\nVISUAL STYLE FOR THIS VIDEO (follow it closely; the result must look clearly different from typical template videos): ${style[0]} — ${style[1]}. ${twist} Variation seed ${rndSeed()}. Pick a palette that matches this style.`) +
          assetsNote;
        const body = {
          kind: "storyboard", brief: run.p.brief, seconds: Math.min(90, run.p.seconds), aspect: run.p.aspect, theme: run.p.theme,
          voice: voiceOn, captions: run.p.captions, design: "ai", context,
        };
        let r = await aiCall(env, run.p, body).catch((e) => ({ error: (e as Error).message }));
        if (!r.storyboard) { say("First attempt failed — trying again…"); r = await aiCall(env, run.p, body); }
        if (!r.storyboard) throw new Error(r.error || "Could not create the storyboard.");
        const sbNew = r.storyboard as Storyboard;
        sbNew.seed = rndSeed();
        sbNew.concept = (aiOwn ? `${sbNew.concept ?? ""} Give every scene its own composition; never reuse one layout.` : `${style[0]} — ${style[1]}. ${twist} ${sbNew.concept ?? ""} Give every scene its own composition; never reuse one layout.`).slice(0, 600);
        if (aiOwn) sbNew.scenes = sbNew.scenes.map((x) => (x.type === "custom" && x.bg === undefined ? ({ ...x, bg: "none" } as Scene) : x)); // the scene paints its own world
        await upd(run, { storyboardJson: JSON.stringify(sbNew), title: sbNew.title || run.p.title });
        say(`📋 ${sbNew.scenes.length} scenes planned${aiOwn ? " (designed by the agent)" : ` in the “${style[0]}” style`}.`);
      }
    }

    if (todo("design")) {
      check(run);
      await upd(run, { stage: "design" });
      const sb = parseSb(run.p);
      if (sb && sb.scenes.some((s) => s.type === "custom" && !s.code)) {
        say("🎨 The motion designer is writing custom scenes…");
        await upd(run, { storyboardJson: JSON.stringify(await designAll(run, sb)) });
        say("🎨 Custom scenes written.");
      }
    }

    if (todo("assets")) {
      check(run);
      await upd(run, { stage: "assets" });
      let cur = parseSb(run.p);
      if (cur) {
        // 1) files the agent downloaded on the computer
        for (let i = 0; i < cur.scenes.length; i++) {
          const name = String(cur.scenes[i].assetFile ?? "");
          if (!name) continue;
          check(run);
          const isVid = /\.(mp4|webm|mov|m4v)$/i.test(name);
          try {
            const fromSid = await agentComputer(run);
            if (!fromSid) throw new Error("the agent's computer was not found");
            const r = await studioCall(env, "pullasset", { sandboxId: run.sid, fromSandboxId: fromSid, projectId: run.p.id, name, kind: isVid ? "vid" : "img", index: i });
            cur = withScene(cur, i, { ...cur.scenes[i], type: isVid ? "footage" : "image", [isVid ? "video" : "image"]: r.path });
            say(`📎 Scene ${i + 1} uses ${name}`);
          } catch (e) {
            say(`ℹ️ Asset ${name} skipped: ${(e as Error).message.slice(0, 80)}`);
          }
        }
        // 2) stock media for scenes that only have a search query
        const idxs = cur.scenes
          .map((s, i) => (!s.image && !s.video && ((s.type === "image" && s.imageQuery) || (s.type === "footage" && s.footageQuery)) ? i : -1))
          .filter((i) => i >= 0);
        if (idxs.length > 0) {
          if (!env.pexels) say("ℹ️ PEXELS_API_KEY is not set — remaining photo/footage scenes use a gradient. (Tip: ask the agent in chat to download assets for you.)");
          else {
            say("🖼️ Finding stock photos and footage…");
            for (const [n, i] of idxs.entries()) {
              check(run);
              hooks.progress({ label: `Media ${n + 1}/${idxs.length}`, value: n / idxs.length });
              try {
                const one = { ...cur, scenes: cur.scenes.map((x, j) => (j === i ? x : ({ type: "title", seconds: 1.5 } as Scene))) };
                const a = await studioCall(env, "assets", { sandboxId: run.sid, projectId: run.p.id, storyboard: one, index: i });
                if (a.image || a.video) cur = withScene(cur, i, { ...cur.scenes[i], ...(a.image ? { image: a.image } : {}), ...(a.video ? { video: a.video } : {}) });
              } catch (e) {
                if (String((e as Error).message) === "Stopped.") throw e;
                say(`ℹ️ Media for scene ${i + 1} skipped: ${(e as Error).message.slice(0, 100)}`);
              }
            }
          }
        }
        await upd(run, { storyboardJson: JSON.stringify(cur) });
      }
    }

    if (todo("voice")) {
      check(run);
      await upd(run, { stage: "voice" });
      let sb = parseSb(run.p)!;
      if (run.p.voice) {
        const idxs = sb.scenes.map((x, i) => (String(x.narration ?? "").trim() && !x.voice ? i : -1)).filter((i) => i >= 0);
        if (idxs.length) {
          say(`🎙️ Recording the voice-over (${idxs.length} scenes) with your voice system…`);
          const queue = [...idxs];
          const patches = new Map<number, Partial<Scene>>();
          let n = 0;
          const worker = async () => {
            while (queue.length) {
              const i = queue.shift() as number;
              check(run);
              try {
                const pt = await ttsPatch(run, sb, i);
                if (pt) patches.set(i, pt);
              } catch (e) {
                if (String((e as Error).message) === "Stopped.") throw e;
                say(`⚠️ Voice-over of scene ${i + 1} failed: ${(e as Error).message.slice(0, 100)}`);
              }
              n++;
              hooks.progress({ label: `Voice-over ${n}/${idxs.length}`, value: n / idxs.length });
            }
          };
          await Promise.all([worker(), worker(), worker()]);
          sb = { ...sb, scenes: sb.scenes.map((x, i) => (patches.has(i) ? ({ ...x, ...patches.get(i) } as Scene) : x)) };
          await upd(run, { storyboardJson: JSON.stringify(sb) });
          say(`🎙️ Voice-over ready (${patches.size}/${idxs.length} scenes). Video length ≈ ${Math.round(totalFramesOf(sb) / 30)}s.`);
        }
      }
      const musicOn = run.p.mode === "edit" ? run.p.music === true : run.p.music !== false;
      if (musicOn && !sb.music) {
        try {
          const secs = Math.ceil(totalFramesOf(sb) / 30) + 2;
          hooks.progress({ label: "Music", value: null });
          if (secs <= 80) {
            await studioCall(env, "compose", { sandboxId: run.sid, projectId: run.p.id, seconds: secs }).catch(() => null); // the agent writes music + sound design as code
          }
          const m = await studioCall(env, "music", { sandboxId: run.sid, projectId: run.p.id, seconds: secs, dark: isDark(sb), skipCompose: true, job: secs > 80 });
          if (m.jobId) {
            say(`🎵 Composing ${Math.ceil(secs / 70)} music parts for a long video…`);
            const j = await waitJob(run, m.jobId as string, "Music", 0, 30);
            if (!j.ok) throw new Error("the music job failed: " + j.log.slice(-160));
          }
          sb = { ...sb, music: m.file as string };
          await upd(run, { storyboardJson: JSON.stringify(sb) });
          say("🎵 A new music track was composed for this video" + (m.note ? ` (${String(m.note).slice(0, 90)})` : "") + ".");
        } catch (e) {
          if (String((e as Error).message) === "Stopped.") throw e;
          say("ℹ️ Music skipped: " + (e as Error).message.slice(0, 100));
        }
      }
    }

    if (todo("preview")) { check(run); await upd(run, { stage: "preview" }); await renderKind(run, "preview"); }

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
          kind: "review", image: { mediaType: f.mediaType, data: f.image },
          tiles: chosen.map((i, k) => ({ tile: k + 1, index: i, type: sb.scenes[i].type, summary: summarizeScene(sb.scenes[i]).slice(0, 80) })),
        });
        const issues = ((r.issues ?? []) as Array<{ scene: number; problem: string; patch: Record<string, unknown> }>).filter((x) => Number.isInteger(x.scene) && x.scene >= 0 && x.scene < sb.scenes.length);
        let changed = false;
        for (const x of issues) {
          const s = sb.scenes[x.scene];
          if (s.type === "custom") {
            say(`🛠️ Scene ${x.scene + 1}: ${x.problem} — redesigning.`);
            sb = withScene(sb, x.scene, { ...s, code: await genCode(env, run.p, sb, x.scene, { previousCode: String(s.code ?? ""), critique: x.problem }) });
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
        } else say("👍 Quality check passed — no major issues.");
      } catch (e) {
        if (String((e as Error).message) === "Stopped.") throw e;
        say("ℹ️ Quality check skipped: " + (e as Error).message.slice(0, 120));
      }
    }

    if (todo("final")) { check(run); await upd(run, { stage: "final" }); await renderKind(run, "final"); }

    await upd(run, { stage: "done", status: "done" });
    hooks.progress(null);
    say("🎉 Your video is ready!");

    reflect({ uid: env.uid, chatId: run.p.chatId ?? scope.chatId }, { apiKeys: env.apiKeys, provider: run.p.provider, model: run.p.model }, brain, {
      task: `Make a video: ${run.p.brief}`,
      outcome: `Finished a ${run.p.seconds}s ${run.p.aspect} video "${run.p.title}" (AI design).`,
    }).then((l) => { if (l.length) say("🧠 Learned: " + l.join("; ")); }).catch(() => {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The pipeline failed.";
    say("⚠️ " + msg);
    await upd(run, { status: "error", error: msg });
    hooks.progress(null);
  }
  if (run.sid) void releaseNow(env.e2bKey, run.sid); // work is over → switch the studio computer off
  return run.p;
}
