export const SCENE_TYPES = [
  "title", "kinetic", "bullets", "stat", "bar-chart", "line-chart",
  "quote", "split", "timeline", "ranking", "image", "footage", "outro", "custom",
] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export const FONT_NAMES = ["inter", "montserrat", "poppins", "spacegrotesk", "playfair", "oswald"];
export const CAMERA_MOVES = ["push", "pull", "pan-left", "pan-right", "tilt-up", "tilt-down", "orbit", "handheld", "crash-zoom", "whip"];

export const THEMES = [
  { id: "midnight", label: "Midnight", colors: ["#070b1f", "#5b8cff", "#a66bff"] },
  { id: "sunset", label: "Sunset", colors: ["#1a0b1f", "#ff7a45", "#ff4d8d"] },
  { id: "emerald", label: "Emerald", colors: ["#04150f", "#2de2a6", "#7ae0ff"] },
  { id: "gold", label: "Venus Gold", colors: ["#0a0a0b", "#e7b24d", "#ffd98a"] },
  { id: "paper", label: "Paper", colors: ["#f6f1e7", "#e5483a", "#1d3557"] },
  { id: "neon", label: "Neon", colors: ["#05040a", "#00f0ff", "#ff2ec4"] },
] as const;

export const TRANSITIONS = ["fade", "slide", "zoom", "wipe", "blur"];

export type Aspect = "16:9" | "9:16" | "1:1";
export const ASPECTS: Record<Aspect, { width: number; height: number; label: string }> = {
  "16:9": { width: 1280, height: 720, label: "16:9 · YouTube" },
  "9:16": { width: 720, height: 1280, label: "9:16 · Reels / Shorts" },
  "1:1": { width: 720, height: 720, label: "1:1 · Square" },
};

export const MAX_SECONDS = 60;
export const OVERLAP = 12;

export type Scene = { type: SceneType; seconds: number; [k: string]: unknown };
export type Storyboard = {
  title: string; concept?: string; fps: number; width: number; height: number; theme: string;
  palette?: Record<string, string>; fonts?: { display?: string; body?: string };
  music?: string; captions: boolean; scenes: Scene[];
};

const ALLOWED_IMPORTS = ["react", "remotion", "../kit", "../theme"];

export function checkCode(code: string): string | null {
  if (!code || code.length < 40) return "The scene code is empty.";
  if (code.length > 12000) return "The scene code is too long (max ~140 lines).";
  if (!/export\s+default/.test(code)) return "Missing `export default` component.";
  for (const m of code.matchAll(/(?:from\s+|import\s+)["']([^"']+)["']/g)) {
    if (!ALLOWED_IMPORTS.includes(m[1])) return `Import "${m[1]}" is not allowed (only react, remotion, ../kit, ../theme).`;
  }
  const bad = /(require\s*\(|import\s*\(|\beval\s*\(|new\s+Function|\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.|child_process|document\.|window\.|localStorage|Math\.random)/.exec(code);
  if (bad) return `Forbidden usage: ${bad[1]}. Use random("seed") from remotion instead of Math.random.`;
  return null;
}

function clean(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim().slice(0, 400);
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

const FILE_RE = /^p\/[A-Za-z0-9_-]+\/(img|vo|vid)\/[A-Za-z0-9_.-]+$/;
const MUSIC_RE = /^p\/[A-Za-z0-9_-]+\/music\.mp3$/;

export function sanitizeScene(raw: unknown, keepFiles: boolean): Scene {
  const rawObj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const code = typeof rawObj.code === "string" ? rawObj.code.slice(0, 12000) : undefined;
  const base = (clean({ ...rawObj, code: undefined }) as Record<string, unknown>) ?? {};
  const type = SCENE_TYPES.includes(base.type as SceneType) ? (base.type as SceneType) : "title";
  const seconds = Math.min(14, Math.max(2.5, Number(base.seconds) || 4));
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
  if (type === "custom") {
    out.id = String(base.id ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "c" + Date.now().toString(36).slice(-5);
    if (code) out.code = code;
  }
  return out;
}

export function sanitizeStoryboard(
  raw: unknown,
  opts: { aspect?: Aspect; theme?: string; captions?: boolean; maxSeconds?: number; keepFiles?: boolean }
): Storyboard {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dims = opts.aspect ? ASPECTS[opts.aspect] : null;
  const width = dims?.width ?? (Number(r.width) || 1280);
  const height = dims?.height ?? (Number(r.height) || 720);
  const themeId = String(opts.theme ?? r.theme ?? "midnight");
  const theme = THEMES.some((t) => t.id === themeId) ? themeId : "midnight";

  const list = Array.isArray(r.scenes) ? r.scenes.slice(0, 14) : [];
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

  const max = Math.min(MAX_SECONDS, opts.maxSeconds ?? MAX_SECONDS);
  const total = scenes.reduce((a, s) => a + s.seconds, 0) - (OVERLAP / 30) * (scenes.length - 1);
  if (total > max) {
    const f = max / total;
    scenes = scenes.map((s) => ({ ...s, seconds: Math.max(2.5, Math.round(s.seconds * f * 10) / 10) }));
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

  return {
    title: String(clean(r.title) ?? "Untitled").slice(0, 80),
    concept: typeof r.concept === "string" ? r.concept.slice(0, 300) : undefined,
    fps: 30, width, height, theme,
    ...(Object.keys(palette).length >= 4 ? { palette } : {}),
    ...(fonts.display || fonts.body ? { fonts } : {}),
    ...(opts.keepFiles && typeof r.music === "string" && MUSIC_RE.test(r.music) ? { music: r.music } : {}),
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