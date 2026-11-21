// Venus Pro from Claude: Claude writes the storyboard (scenes) itself, so no model has to run on the server for the script/design
// steps. This file only checks and cleans what Claude sent. Pure: no server access.
import { ASPECTS, THEMES, checkCode, sanitizeStoryboard, type Aspect, type Storyboard } from "../venus-schema.ts";

export type VideoPlan = {
  title: string; aspect: Aspect; theme: string; seconds: number; captions: boolean; voice: boolean;
  quality: "720p" | "1080p"; storyboardJson: string; scenes: number; notes: string[];
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Returns the cleaned plan, or { error } that tells Claude exactly what to fix. */
export function planClaudeVideo(a: Record<string, unknown>): VideoPlan | { error: string } {
  const sbIn = typeof a.storyboard === "string" ? safeParse(a.storyboard) : a.storyboard;
  const raw: Record<string, unknown> = isObj(sbIn) ? sbIn : isObj(a) && Array.isArray(a.scenes) ? a : {};
  const scenesIn = Array.isArray(raw.scenes) ? raw.scenes : Array.isArray(a.scenes) ? a.scenes : null;
  if (!scenesIn || scenesIn.length === 0) return { error: "scenes is required: a list of scenes like [{type:'title',seconds:4,headline:'...'}, ...]." };
  if (scenesIn.length > 60) return { error: "At most 60 scenes per video." };

  const notes: string[] = [];
  const aspect: Aspect = (a.aspect as string) in ASPECTS ? (a.aspect as Aspect) : "16:9";
  const theme = THEMES.some((t) => t.id === a.theme) ? String(a.theme) : "midnight";
  const captions = a.captions !== false;

  // custom scenes: Claude may send Remotion code; checked here. Without code the scene becomes a clean title scene (no model on the server).
  const scenes = scenesIn.map((s, i) => {
    if (!isObj(s)) return { type: "title", seconds: 4, headline: "" };
    if (s.type !== "custom") return s;
    const code = typeof s.code === "string" ? s.code : "";
    if (code) {
      const bad = checkCode(code);
      if (bad) { notes.push(`Scene ${i + 1}: code refused (${bad}) - shown as a text scene.`); return { ...s, type: "title", code: undefined, headline: s.headline ?? s.fallbackText ?? "" }; }
      return s;
    }
    notes.push(`Scene ${i + 1}: custom scene without code - shown as a text scene. Send "code" (Remotion) or use library scene types.`);
    return { ...s, type: "title", headline: s.headline ?? s.fallbackText ?? "" };
  });

  const sb: Storyboard = sanitizeStoryboard({ ...raw, title: raw.title ?? a.title, scenes }, { aspect, theme, captions, keepFiles: false, maxScenes: 60 });
  const OVERLAP_S = 12 / 30;
  const seconds = Math.max(3, Math.round(sb.scenes.reduce((t, s) => t + s.seconds, 0) - OVERLAP_S * (sb.scenes.length - 1)));
  const title = String(a.title ?? sb.title ?? "Video").replace(/\s+/g, " ").trim().slice(0, 48) || "Video";
  return {
    title, aspect, theme, seconds, captions, voice: a.voice === true, quality: a.quality === "1080p" ? "1080p" : "720p",
    storyboardJson: JSON.stringify({ ...sb, title }), scenes: sb.scenes.length, notes,
  };
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }