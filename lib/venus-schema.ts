export const SCENE_TYPES = [
  "title", "kinetic", "bullets", "stat", "bar-chart", "line-chart",
  "quote", "split", "timeline", "ranking", "image", "outro",
] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

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
  title: string;
  fps: number;
  width: number;
  height: number;
  theme: string;
  captions: boolean;
  scenes: Scene[];
};

function clean(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim().slice(0, 240);
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (depth >= 3) return undefined;
  if (Array.isArray(v)) {
    return v
      .slice(0, 8)
      .map((x) => clean(x, depth + 1))
      .filter((x) => x !== undefined);
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 14)) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k)) continue;
      const c = clean(val, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

const FILE_RE = /^p\/[A-Za-z0-9_-]+\/(img|vo)\/[A-Za-z0-9_.-]+$/;

export function sanitizeScene(raw: unknown, keepFiles: boolean): Scene {
  const base = (clean(raw) as Record<string, unknown>) ?? {};
  const type = SCENE_TYPES.includes(base.type as SceneType) ? (base.type as SceneType) : "title";
  const seconds = Math.min(14, Math.max(2.5, Number(base.seconds) || 4));
  const out: Scene = { ...base, type, seconds };
  for (const k of ["voice", "image"]) {
    if (!keepFiles || typeof out[k] !== "string" || !FILE_RE.test(String(out[k]))) delete out[k];
  }
  if (out.transition !== undefined && !TRANSITIONS.includes(String(out.transition))) delete out.transition;
  if (out.fontScale !== undefined) out.fontScale = Math.min(1.3, Math.max(0.5, Number(out.fontScale) || 1));
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
  if (scenes.length === 0) {
    scenes = [{ type: "title", seconds: 4, headline: String(r.title ?? "Untitled") }];
  }

  const max = Math.min(MAX_SECONDS, opts.maxSeconds ?? MAX_SECONDS);
  const total = () => scenes.reduce((a, s) => a + s.seconds, 0) - (OVERLAP / 30) * (scenes.length - 1);
  const t = total();
  if (t > max) {
    const f = max / t;
    scenes = scenes.map((s) => ({ ...s, seconds: Math.max(2.5, Math.round(s.seconds * f * 10) / 10) }));
  }

  return {
    title: String(clean(r.title) ?? "Untitled").slice(0, 80),
    fps: 30,
    width,
    height,
    theme,
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
  for (const k of ["headline", "text", "label", "title"]) {
    if (typeof s[k] === "string" && s[k]) return String(s[k]);
  }
  return "";
}