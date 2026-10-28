export const SCENE_TYPES = [
  "title", "kinetic", "bullets", "stat", "bar-chart", "line-chart",
  "quote", "split", "timeline", "ranking", "image", "footage", "outro", "custom", "clip",
] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export const FONT_NAMES = ["inter", "montserrat", "poppins", "spacegrotesk", "playfair", "oswald"];
export const CAMERA_MOVES = ["push", "pull", "pan-left", "pan-right", "tilt-up", "tilt-down", "orbit", "handheld", "crash-zoom", "whip"];
export const AUDIO_MOODS = ["dark", "epic", "bright", "tech", "calm", "playful"] as const;

export const THEMES = [
  { id: "midnight", label: "Midnight", colors: ["#070b1f", "#5b8cff", "#a66bff"] },
  { id: "sunset", label: "Sunset", colors: ["#1a0b1f", "#ff7a45", "#ff4d8d"] },
  { id: "emerald", label: "Emerald", colors: ["#04150f", "#2de2a6", "#7ae0ff"] },
  { id: "gold", label: "Venus Gold", colors: ["#0a0a0b", "#e7b24d", "#ffd98a"] },
  { id: "paper", label: "Paper", colors: ["#f6f1e7", "#e5483a", "#1d3557"] },
  { id: "neon", label: "Neon", colors: ["#05040a", "#00f0ff", "#ff2ec4"] },
] as const;

export const TRANSITIONS = ["fade", "slide", "zoom", "wipe", "blur", "cut", "up", "iris", "flip"];

// Procedural backgrounds (drawn by src/backdrop.tsx on the studio computer). Nothing here is a fixed template:
// every video gets its own seed, so the same kind never looks the same twice.
export const BG_KINDS = [
  "mesh", "aurora", "grid", "halftone", "stripes", "rings", "waves", "noise", "spot", "blocks",
  "flow", "stars", "paper", "conic", "topo", "checker", "rays", "bokeh", "circuit", "glass", "scenery",
] as const;
export const CLIP_FILTERS = ["none", "warm", "cool", "mono", "noir", "vivid", "fade", "teal-orange", "vhs", "dream"];
export const CLIP_FITS = ["auto", "cover", "contain"];
export const GRADES = ["none", "warm", "cool", "noir", "vivid", "fade", "teal-orange", "dream"];
export const MAX_SECONDS_EDIT = 1200; // an edit of the user's own video (source up to 15 minutes) plus added graphics
export const MAX_SCENES = 450;

export type Aspect = "16:9" | "9:16" | "1:1";
export const ASPECTS: Record<Aspect, { width: number; height: number; label: string }> = {
  "16:9": { width: 1280, height: 720, label: "16:9 · YouTube" },
  "9:16": { width: 720, height: 1280, label: "9:16 · Reels / Shorts" },
  "1:1": { width: 720, height: 720, label: "1:1 · Square" },
};

export const MAX_SECONDS = 3600; // generated animation / motion graphics: up to one hour
export const OVERLAP = 12;

export type Scene = { type: SceneType; seconds: number; [k: string]: unknown };
export type SourceInfo = { path: string; name?: string; duration: number; width: number; height: number; hasAudio: boolean };
export type TranscriptSeg = { s: number; e: number; t: string };
export type Storyboard = {
  title: string; concept?: string; fps: number; width: number; height: number; theme: string;
  seed?: number; safe?: boolean; bg?: Record<string, unknown>; grade?: string; source?: SourceInfo; transcript?: TranscriptSeg[];
  palette?: Record<string, string>; fonts?: { display?: string; body?: string };
  audio?: { mood: string; bpm?: number };
  music?: string; sfx?: string; captions: boolean; scenes: Scene[];
};

const ALLOWED_IMPORTS = ["react", "remotion", "../kit", "../theme", "../ui"];
const MAX_CODE = 24000;

export function checkCode(code: string): string | null {
  if (!code || code.length < 40) return "The scene code is empty.";
  if (code.length > MAX_CODE) return "The scene code is too long (max ~300 lines).";
  if (!/export\s+default/.test(code)) return "Missing `export default` component.";
  for (const m of code.matchAll(/(?:from\s+|import\s+)["']([^"']+)["']/g)) {
    if (!ALLOWED_IMPORTS.includes(m[1])) return `Import "${m[1]}" is not allowed (only react, remotion, ../kit, ../theme, ../ui).`;
  }
  const bad = /(require\s*\(|import\s*\(|import\.meta|\beval\s*\(|new\s+Function|\bFunction\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|\bWorker\b|postMessage|process\.|child_process|document\.|window\.|\bglobalThis\b|\bReflect\.|__proto__|\.constructor\b|\[\s*["'`](?:fetch|constructor|eval|Function)["'`]\s*\]|localStorage|sessionStorage|indexedDB|Math\.random|Date\.now\s*\()/.exec(code);
  if (bad) return `Forbidden usage: ${bad[1]}. Use random("seed") from remotion instead of Math.random / Date.now.`;
  return null;
}

function clean(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim().slice(0, 1200);
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (depth >= 3) return undefined;
  if (Array.isArray(v)) return v.slice(0, 8).map((x) => clean(x, depth + 1)).filter((x) => x !== undefined);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 16)) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k)) continue;
      const c = clean(val, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}


const HEX = /^#[0-9a-fA-F]{6}$/;
const fin = (v: unknown, d: number, a: number, b: number) => {
  const n = Number(v);
  return Math.min(b, Math.max(a, Number.isFinite(n) ? n : d));
};

/** A background spec: { kind, colors?, intensity?, speed?, scale?, angle?, grain?, vignette?, seed? } or "none" (the scene paints its own). */
export function sanitizeBg(v: unknown): Record<string, unknown> | "none" | undefined {
  if (v === "none" || v === "own") return "none";
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if ((BG_KINDS as readonly string[]).includes(String(r.kind))) out.kind = String(r.kind);
  if (Array.isArray(r.colors)) {
    const cols = r.colors.map((c) => String(c).trim()).filter((c) => HEX.test(c)).slice(0, 5);
    if (cols.length) out.colors = cols;
  }
  if (typeof r.base === "string" && HEX.test(r.base.trim())) out.base = r.base.trim();
  if (r.intensity !== undefined) out.intensity = fin(r.intensity, 1, 0.2, 1.6);
  if (r.speed !== undefined) out.speed = fin(r.speed, 1, 0, 3);
  if (r.scale !== undefined) out.scale = fin(r.scale, 1, 0.4, 2.5);
  if (r.angle !== undefined) out.angle = fin(r.angle, 0, -360, 360);
  if (r.seed !== undefined) out.seed = Math.round(fin(r.seed, 1, 0, 999999));
  if (typeof r.grain === "boolean") out.grain = r.grain;
  if (r.vignette !== undefined) out.vignette = fin(r.vignette, 0.4, 0, 0.9);
  // scenery: a drawn world (see src/scenery.tsx)
  const pick = (v: unknown, list: string[]) => (list.includes(String(v)) ? String(v) : undefined);
  const biome = pick(r.biome, ["mountains", "valley", "desert", "forest", "sea", "plains", "snow", "city"]);
  const time = pick(r.time, ["dawn", "day", "sunset", "dusk", "night"]);
  const figure = pick(r.figure, ["rider", "horse", "army"]);
  const dir = pick(r.figDir, ["left", "right"]);
  if (biome) out.biome = biome;
  if (time) out.time = time;
  if (figure) out.figure = figure;
  if (dir) out.figDir = dir;
  for (const k of ["river", "fort", "trees", "birds", "mist", "sun", "stars"]) if (typeof r[k] === "boolean") out[k] = r[k];
  if (r.layers !== undefined) out.layers = Math.round(fin(r.layers, 5, 2, 7));
  if (r.drift !== undefined) out.drift = fin(r.drift, 1, 0, 4);
  if (r.figX !== undefined) out.figX = fin(r.figX, 0.42, 0, 1);
  if (r.figY !== undefined) out.figY = fin(r.figY, 0.8, 0.4, 1);
  if (r.figScale !== undefined) out.figScale = fin(r.figScale, 1, 0.4, 3);
  return Object.keys(out).length ? out : undefined;
}

const SRC_RE = /^p\/[A-Za-z0-9_-]+\/vid\/[A-Za-z0-9_.-]+$/;

export function sanitizeSource(v: unknown): SourceInfo | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const path = String(r.path ?? "");
  if (!SRC_RE.test(path)) return undefined;
  const duration = fin(r.duration, 0, 0, 36000);
  if (duration <= 0) return undefined;
  return {
    path, duration, width: Math.round(fin(r.width, 1280, 16, 8192)), height: Math.round(fin(r.height, 720, 16, 8192)),
    hasAudio: Boolean(r.hasAudio), name: typeof r.name === "string" ? r.name.slice(0, 80) : undefined,
  };
}

export function sanitizeTranscript(v: unknown): TranscriptSeg[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: TranscriptSeg[] = [];
  for (const x of v.slice(0, 700)) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const s = Number(o.s), e = Number(o.e), t = String(o.t ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s && t) out.push({ s: Math.round(s * 100) / 100, e: Math.round(e * 100) / 100, t });
  }
  return out.length ? out : undefined;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const FILE_RE = /^p\/[A-Za-z0-9_-]+\/(img|vo|vid)\/[A-Za-z0-9_.-]+$/;
const MUSIC_RE = /^p\/[A-Za-z0-9_-]+\/music\.mp3$/;
const SFX_RE = /^p\/[A-Za-z0-9_-]+\/sfx\.mp3$/;

export function sanitizeScene(raw: unknown, keepFiles: boolean): Scene {
  const rawObj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const code = typeof rawObj.code === "string" ? rawObj.code.slice(0, MAX_CODE) : undefined;
  const base = (clean({ ...rawObj, code: undefined }) as Record<string, unknown>) ?? {};
  const type = SCENE_TYPES.includes(base.type as SceneType) ? (base.type as SceneType) : "title";
  const seconds = Math.min(30, Math.max(1.5, Number(base.seconds) || 4));
  const out: Scene = { ...base, type, seconds };
  for (const k of ["voice", "image", "video"]) {
    if (!keepFiles || typeof out[k] !== "string" || !FILE_RE.test(String(out[k]))) delete out[k];
  }
  if (out.transition !== undefined && !TRANSITIONS.includes(String(out.transition))) delete out.transition;
  if (out.fontScale !== undefined) out.fontScale = Math.min(1.3, Math.max(0.5, Number(out.fontScale) || 1));
  if (out.camera !== undefined) {
    const list = (Array.isArray(out.camera) ? out.camera : [out.camera]).map(String).filter((c) => CAMERA_MOVES.includes(c)).slice(0, 3);
    if (list.length) out.camera = list; else delete out.camera;
  }
  if (out.sounds !== undefined) {
    const list = (Array.isArray(out.sounds) ? out.sounds : [])
      .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
      .filter((x): x is Record<string, unknown> => Boolean(x) && Number.isFinite(Number(x!.at)) && typeof x!.kind === "string")
      .map((x) => ({ at: Math.max(0, Math.min(14, Number(x.at))), kind: String(x.kind) }))
      .slice(0, 8);
    if (list.length) out.sounds = list; else delete out.sounds;
  }
  if (out.bg !== undefined) {
    const bg = sanitizeBg(out.bg);
    if (bg) out.bg = bg; else delete out.bg;
  }
  if (type === "clip") {
    const a = Math.max(0, Number(out.srcStart) || 0);
    const b = Math.max(a + 0.5, Number(out.srcEnd) || a + 4);
    const speed = fin(out.speed, 1, 0.25, 4);
    out.srcStart = Math.round(a * 100) / 100;
    out.srcEnd = Math.round(b * 100) / 100;
    out.speed = speed;
    out.volume = fin(out.volume, 1, 0, 1);
    out.seconds = Math.min(MAX_SECONDS_EDIT, Math.max(1.5, (b - a) / speed));
    if (!CLIP_FILTERS.includes(String(out.filter))) delete out.filter;
    if (!CLIP_FITS.includes(String(out.fit))) delete out.fit;
    if (out.zoom !== undefined) out.zoom = fin(out.zoom, 1, 1, 1.9);
    for (const k of ["focusX", "focusY", "focusX2", "focusY2"]) if (out[k] !== undefined) out[k] = fin(out[k], 0.5, 0, 1);
    if (Array.isArray(out.overlays)) {
      out.overlays = out.overlays
        .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>) : null))
        .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o!.text === "string")
        .map((o) => ({
          at: fin(o.at, 0, 0, 120), dur: fin(o.dur, 2.5, 0.6, 20), text: String(o.text).slice(0, 80),
          style: ["lower-third", "title", "stamp", "callout", "chip"].includes(String(o.style)) ? String(o.style) : "lower-third",
          ...(typeof o.sub === "string" ? { sub: o.sub.slice(0, 90) } : {}),
        }))
        .slice(0, 8);
    }
  }
  if (type === "custom") {
    out.id = String(base.id ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "c" + Date.now().toString(36).slice(-5);
    if (code) out.code = code;
  }
  return out;
}

export function sanitizeStoryboard(
  raw: unknown,
  opts: { aspect?: Aspect; theme?: string; captions?: boolean; maxSeconds?: number; keepFiles?: boolean; source?: SourceInfo; maxScenes?: number }
): Storyboard {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dims = opts.aspect ? ASPECTS[opts.aspect] : null;
  const width = dims?.width ?? (Number(r.width) || 1280);
  const height = dims?.height ?? (Number(r.height) || 720);
  const themeId = String(opts.theme ?? r.theme ?? "midnight");
  const theme = THEMES.some((t) => t.id === themeId) ? themeId : "midnight";

  const list = Array.isArray(r.scenes) ? r.scenes.slice(0, Math.min(MAX_SCENES, opts.maxScenes ?? (r.source || opts.source ? 200 : 24))) : [];
  let scenes = list.map((s) => sanitizeScene(s, Boolean(opts.keepFiles)));
  if (scenes.length === 0) scenes = [{ type: "title", seconds: 4, headline: String(r.title ?? "Untitled") }];

  const seen = new Set<string>();
  scenes = scenes.map((s, i) => {
    if (s.type !== "custom") return s;
    let id = String(s.id);
    if (seen.has(id)) id = id.slice(0, 9) + "x" + i;
    seen.add(id);
    return { ...s, id };
  });

  // ---- editing a real video: clips keep their source timing ----
  const source = sanitizeSource(r.source) ?? opts.source;
  const hasClip = scenes.some((s) => s.type === "clip");
  if (hasClip && !source) scenes = scenes.filter((s) => s.type !== "clip");
  if (scenes.length === 0) scenes = [{ type: "title", seconds: 4, headline: String(r.title ?? "Untitled") }];
  if (source) {
    scenes = scenes.map((s) => {
      if (s.type !== "clip") {
        // any other scene may show the source video inside its own design (custom scenes read p.video / p.srcStart)
        return s.useSource === true && opts.keepFiles ? { ...s, video: source.path } : s;
      }
      const end = Math.min(Number(s.srcEnd), source.duration - 0.05);
      const start = Math.min(Number(s.srcStart), Math.max(0, end - 0.5));
      const speed = Number(s.speed) || 1;
      return { ...s, srcStart: Math.round(start * 100) / 100, srcEnd: Math.round(end * 100) / 100, seconds: Math.max(1.5, (end - start) / speed), ...(opts.keepFiles ? { video: source.path } : {}) };
    });
  }

  const edit = scenes.some((s) => s.type === "clip");
  const max = edit ? Math.min(MAX_SECONDS_EDIT, opts.maxSeconds ?? MAX_SECONDS_EDIT) : Math.min(MAX_SECONDS, opts.maxSeconds ?? MAX_SECONDS);
  const total = scenes.reduce((a, s) => a + s.seconds, 0) - (OVERLAP / 30) * (scenes.length - 1);
  if (total > max && !edit) {
    const f = max / total;
    scenes = scenes.map((s) => ({ ...s, seconds: Math.max(1.5, Math.round(s.seconds * f * 10) / 10) }));
  } else if (total > max) {
    // never squeeze clips (that would break the sync with the source): keep scenes in order until the limit, trim the last one
    const kept: Scene[] = [];
    let acc = 0;
    for (const s of scenes) {
      const room = max - acc;
      if (room < 1.5) break;
      if (s.seconds <= room) { kept.push(s); acc += s.seconds - OVERLAP / 30; continue; }
      if (s.type === "clip") {
        const sp = Number(s.speed) || 1;
        kept.push({ ...s, srcEnd: Math.round((Number(s.srcStart) + room * sp) * 100) / 100, seconds: room });
      } else kept.push({ ...s, seconds: Math.max(1.5, room) });
      break;
    }
    scenes = kept.length ? kept : scenes.slice(0, 1);
  }
  if (edit) {
    // a clip that is followed by another scene plays a little longer underneath it, so the cut lands exactly on the chosen frame
    scenes = scenes.map((s, i) => {
      if (s.type !== "clip" || i === scenes.length - 1) return s;
      const sp = Number(s.speed) || 1;
      const room = source ? Math.max(0, source.duration - Number(s.srcEnd) - 0.05) : OVERLAP / 30;
      const extraSrc = Math.min(room, (OVERLAP / 30) * sp);
      return { ...s, seconds: Math.round((Number(s.seconds) + extraSrc / sp) * 1000) / 1000 };
    });
  }

  const palette: Record<string, string> = {};
  const rp = (r.palette && typeof r.palette === "object" ? r.palette : {}) as Record<string, unknown>;
  for (const k of ["bg1", "bg2", "accent", "accent2", "text", "muted"]) {
    const v = rp[k];
    if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim())) palette[k] = v.trim();
  }
  const rf = (r.fonts && typeof r.fonts === "object" ? r.fonts : {}) as Record<string, unknown>;
  const fonts: { display?: string; body?: string } = {};
  if (FONT_NAMES.includes(String(rf.display))) fonts.display = String(rf.display);
  if (FONT_NAMES.includes(String(rf.body))) fonts.body = String(rf.body);

  const ra = (r.audio && typeof r.audio === "object" ? r.audio : {}) as Record<string, unknown>;
  const audio = (AUDIO_MOODS as readonly string[]).includes(String(ra.mood))
    ? { mood: String(ra.mood), ...(Number(ra.bpm) >= 70 && Number(ra.bpm) <= 140 ? { bpm: Math.round(Number(ra.bpm)) } : {}) }
    : undefined;

  const seedIn = Number(r.seed);
  const bg = sanitizeBg(r.bg);
  const grade = GRADES.includes(String(r.grade)) && r.grade !== "none" ? String(r.grade) : undefined;
  const transcript = sanitizeTranscript(r.transcript);

  return {
    ...(Number.isFinite(seedIn) && seedIn > 0 ? { seed: Math.floor(seedIn) % 1000000 } : {}),
    ...(r.safe === true ? { safe: true } : {}),
    ...(bg && bg !== "none" ? { bg } : {}),
    ...(grade ? { grade } : {}),
    ...(source ? { source } : {}),
    ...(transcript ? { transcript } : {}),
    title: String(clean(r.title) ?? "Untitled").slice(0, 80),
    concept: typeof r.concept === "string" ? r.concept.slice(0, 600) : undefined,
    fps: 30, width, height, theme,
    ...(Object.keys(palette).length >= 4 ? { palette } : {}),
    ...(fonts.display || fonts.body ? { fonts } : {}),
    ...(audio ? { audio } : {}),
    ...(opts.keepFiles && typeof r.music === "string" && MUSIC_RE.test(r.music) ? { music: r.music } : {}),
    ...(opts.keepFiles && typeof r.sfx === "string" && SFX_RE.test(r.sfx) ? { sfx: r.sfx } : {}),
    captions: opts.captions ?? Boolean(r.captions),
    scenes,
  };
}

export function totalFramesOf(sb: Storyboard): number {
  let start = 0;
  let last = 60;
  for (const s of sb.scenes) {
    const dur = Math.max(36, Math.round((Number(s.seconds) || 4) * (sb.fps || 30)));
    last = start + dur;
    start = start + dur - OVERLAP;
  }
  return last;
}

export function sceneLayout(sb: Storyboard): Array<{ from: number; dur: number }> {
  let start = 0;
  return sb.scenes.map((s) => {
    const dur = Math.max(36, Math.round((Number(s.seconds) || 4) * (sb.fps || 30)));
    const from = start;
    start = from + dur - OVERLAP;
    return { from, dur };
  });
}

export function summarizeScene(s: Scene): string {
  for (const k of ["headline", "text", "label", "title", "brief"]) {
    if (typeof s[k] === "string" && s[k]) return String(s[k]);
  }
  return "";
}