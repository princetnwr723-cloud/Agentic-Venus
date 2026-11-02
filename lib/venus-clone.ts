// Video templates for Venus Pro (pure functions, no server code: the browser and the server both use this file).
// A TEMPLATE is the look, the pacing and the story structure of a real video, saved once. A new video about something else
// is then made "in the same way": same art direction, same rhythm, same beats, with the new content in the slots.
export type TemplateBeat = {
  role: string; seconds: number; visual: string; motion: string; text: string; transition: string; camera: string; narration: string;
};

export type VideoTemplate = {
  id: string; name: string; category: string; summary: string; createdAt: number;
  aspect: "16:9" | "9:16" | "1:1"; seconds: number; pace: "slow" | "medium" | "fast";
  palette: { bg: string; fg: string; accent: string; accent2: string };
  fonts: { display: string; body: string };
  look: string; typography: string; motion: string; transitions: string[]; camera: string; graphics: string;
  sound: { music: string; voice: string; captions: string };
  structure: TemplateBeat[]; slots: string[]; howTo: string;
  sourceName?: string; sourceSeconds?: number;
};

/** What the list shows (the full template is fetched when it is used). */
export type TemplateListItem = { id: string; name: string; category: string; summary: string; seconds: number; aspect: string; createdAt: number; sourceName?: string };

export const TEMPLATE_CATEGORIES = ["launch", "promo", "ad", "explainer", "tutorial", "testimonial", "trailer", "intro", "reel", "demo", "announcement", "recap", "other"] as const;

const str = (v: unknown, n: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const num = (v: unknown, lo: number, hi: number, d: number): number => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
};
const hex = (v: unknown, d: string): string => (/^#[0-9a-fA-F]{6}$/.test(String(v ?? "").trim()) ? String(v).trim().toLowerCase() : d);
const list = (v: unknown, n: number, each: number): string[] => (Array.isArray(v) ? v : []).map((x) => str(x, each)).filter(Boolean).slice(0, n);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "template";

export function categoryOf(text: string): string {
  const t = String(text ?? "").toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ["launch", /\b(launch|product launch|release|unveil|introducing|going live)\b/], ["trailer", /\btrailer|teaser\b/], ["ad", /\b(ad|ads|advert|advertisement|commercial)\b/],
    ["promo", /\b(promo|promotion|sale|offer|discount)\b/], ["explainer", /\b(explainer|explain|how it works|animated explainer)\b/], ["tutorial", /\b(tutorial|how[- ]to|walkthrough|guide)\b/],
    ["testimonial", /\b(testimonial|review|customer story|case study)\b/], ["demo", /\b(demo|product demo|screen recording)\b/], ["intro", /\b(intro|opener|logo reveal|channel intro)\b/],
    ["announcement", /\b(announcement|announcing|news|update)\b/], ["recap", /\b(recap|highlights|year in review|wrap)\b/], ["reel", /\b(reel|reels|shorts?|tiktok)\b/],
  ];
  return rules.find(([, re]) => re.test(t))?.[0] ?? "other";
}

/** Turns the model's answer into a safe, complete template. Never throws: missing parts get sensible defaults. */
export function sanitizeTemplate(raw: unknown, meta: { name?: string; category?: string; aspect?: string; sourceName?: string; sourceSeconds?: number; id?: string; createdAt?: number } = {}): VideoTemplate {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const name = str(meta.name || r.name, 60) || "Untitled template";
  const category = str(meta.category || r.category, 20).toLowerCase() || categoryOf(`${name} ${r.summary ?? ""}`);
  const aspectRaw = String(meta.aspect || r.aspect || "16:9");
  const aspect = (["16:9", "9:16", "1:1"].includes(aspectRaw) ? aspectRaw : "16:9") as VideoTemplate["aspect"];
  const beats: TemplateBeat[] = (Array.isArray(r.structure) ? r.structure : []).slice(0, 40).map((b: any) => ({
    role: str(b?.role, 30) || "scene", seconds: Math.round(num(b?.seconds, 0.8, 60, 3) * 10) / 10,
    visual: str(b?.visual, 260), motion: str(b?.motion, 200), text: str(b?.text, 140), transition: str(b?.transition, 40) || "cut", camera: str(b?.camera, 100), narration: str(b?.narration, 160),
  }));
  const total = beats.reduce((a, b) => a + b.seconds, 0);
  const seconds = Math.round(total > 0 ? total : num(r.seconds, 8, 3600, 30));
  const pace = (["slow", "medium", "fast"].includes(String(r.pace)) ? String(r.pace) : beats.length && seconds / beats.length < 2.6 ? "fast" : seconds / Math.max(1, beats.length) > 5 ? "slow" : "medium") as VideoTemplate["pace"];
  const p = (r.palette ?? {}) as Record<string, unknown>;
  const f = (r.fonts ?? {}) as Record<string, unknown>;
  const s = (r.sound ?? {}) as Record<string, unknown>;
  return {
    id: meta.id || `t_${slug(name)}_${Date.now().toString(36)}`.slice(0, 60),
    name, category, summary: str(r.summary, 400), createdAt: meta.createdAt || Date.now(), aspect, seconds, pace,
    palette: { bg: hex(p.bg, "#0b0b12"), fg: hex(p.fg, "#ffffff"), accent: hex(p.accent, "#6c5ce7"), accent2: hex(p.accent2, "#00cec9") },
    fonts: { display: str(f.display, 80) || "bold geometric sans", body: str(f.body, 80) || "clean sans" },
    look: str(r.look, 700), typography: str(r.typography, 400), motion: str(r.motion, 500), transitions: list(r.transitions, 8, 60),
    camera: str(r.camera, 300), graphics: str(r.graphics, 400),
    sound: { music: str(s.music, 160), voice: str(s.voice, 160), captions: str(s.captions, 160) },
    structure: beats, slots: list(r.slots, 16, 50), howTo: str(r.howTo, 900),
    ...(meta.sourceName ? { sourceName: str(meta.sourceName, 100) } : {}), ...(meta.sourceSeconds ? { sourceSeconds: Math.round(meta.sourceSeconds) } : {}),
  };
}

/** The block that is added to the director's prompt: it overrides the director's own taste, the brief only fills the content. */
export function templateContext(t: VideoTemplate, o: { seconds?: number } = {}): string {
  const target = o.seconds && o.seconds > 0 ? o.seconds : t.seconds;
  const k = t.seconds > 0 ? target / t.seconds : 1;
  const beats = t.structure.map((b, i) => `${i + 1}. [${b.role}] ${Math.max(1, Math.round(b.seconds * k * 10) / 10)}s · ${b.visual}${b.motion ? " · motion: " + b.motion : ""}${b.text ? " · text: " + b.text : ""}${b.narration ? " · voice: " + b.narration : ""} · into next: ${b.transition}${b.camera ? " · camera: " + b.camera : ""}`).join("\n");
  return [
    `VIDEO TEMPLATE TO CLONE: "${t.name}" (${t.category}). This was extracted from a real video the owner likes. The new video must LOOK, MOVE, PACE and be STRUCTURED like it, with the owner's NEW content (the brief) in the slots. These instructions override your own style choices. Never copy brand names, logos or exact words of the original.`,
    t.summary ? `SUMMARY: ${t.summary}` : "",
    `ART DIRECTION: palette bg ${t.palette.bg}, text ${t.palette.fg}, accent ${t.palette.accent}, accent2 ${t.palette.accent2}. Fonts: display = ${t.fonts.display}; body = ${t.fonts.body}. Use exactly this palette in "palette" (bg1=${t.palette.bg}, bg2 = a slightly different shade of it, accent=${t.palette.accent}, accent2=${t.palette.accent2}, text=${t.palette.fg}).`,
    `LOOK: ${t.look}`, t.typography ? `TYPOGRAPHY: ${t.typography}` : "", t.motion ? `MOTION LANGUAGE: ${t.motion}` : "",
    t.transitions.length ? `TRANSITIONS USED: ${t.transitions.join(", ")}` : "", t.camera ? `CAMERA: ${t.camera}` : "", t.graphics ? `GRAPHICS: ${t.graphics}` : "",
    `PACE: ${t.pace}. SOUND: music ${t.sound.music || "fitting"}; voice ${t.sound.voice || "none"}; captions ${t.sound.captions || "none"}.`,
    `STORY STRUCTURE (follow this order; one scene per beat, or two for a long beat; keep each beat's role, rhythm and kind of visual; total about ${Math.round(target)} seconds):\n${beats}`,
    t.slots.length ? `SLOTS to fill from the brief: ${t.slots.join(", ")}. If a slot has no content in the brief, drop that beat's text instead of inventing facts.` : "",
    t.howTo ? `HOW TO ADAPT: ${t.howTo}` : "",
  ].filter(Boolean).join("\n").slice(0, 6500);
}

/** The skill saved next to the template, so the agent of the chat knows it exists and how to use it. */
export function templateSkill(t: VideoTemplate): { name: string; description: string; instructions: string; files: Record<string, string> } {
  const beats = t.structure.map((b, i) => `${i + 1}. ${b.role} (${b.seconds}s): ${b.visual}`).join("\n");
  return {
    name: `video-template: ${t.name}`.slice(0, 80),
    description: `How to make a ${t.category} video in the style of "${t.name}" (saved Venus Pro template ${t.id}). Use when the owner asks for a ${t.category} video or says "like ${t.name}".`,
    instructions: [
      `# ${t.name}: ${t.category} video template`,
      t.summary,
      `## When to use`, `The owner wants a ${t.category} video (or says "make it like ${t.name}", "same style", "from my template").`,
      `## How`,
      `1. Collect the details for the slots: ${t.slots.length ? t.slots.join(", ") : "product name, tagline, key features, call to action, website"}. Ask ONCE for anything essential that is missing. Never invent facts, prices or numbers.`,
      `2. Start Venus Pro with a brief that contains those details and the marker [template:${t.id}], for example [[VENUS: Launch video for <product>. Tagline: ... Features: ... Call to action: ... Length 30 seconds. [template:${t.id}]]]. Venus Pro clones the template by itself (look, pace, structure, sound): you do not describe the style.`,
      `3. Default length about ${t.seconds}s, format ${t.aspect}. The owner can ask for another length or format.`,
      `## Structure of the template`, beats,
      `The full template data is in references/template.json.`,
    ].filter(Boolean).join("\n"),
    files: { "references/template.json": JSON.stringify(t) },
  };
}

// ---------------- choosing a template for a request ----------------
export const NEW_FROM_SCRATCH = /\b(from scratch|brand new|naya video|new animation|without (?:my|the|a) video|no template|bina template|animation instead)\b/i;
/** A video is attached and the owner wants it studied / saved as a template / cloned. */
export const TEMPLATE_INTENT = /\b(templates?|templet|clone|cloning|same style|copy (?:the )?style|reverse[- ]engineer|analy[sz]e|analy[sz]is|study this|style (?:save|copy)|save (?:this|the|it)(?: video)?(?: as)?(?: a)?(?: style| skill)?)\b|template save|template bana|skill (?:bana|save)/i;

/** True when the owner wants the attached video STUDIED (saved as a template). "Edit this video, use my template" is an edit, not an analysis. */
export function wantsTemplateFromVideo(text: string): boolean {
  if (!TEMPLATE_INTENT.test(text)) return false;
  const edit = /\b(edit|cut|trim|shorten|crop|enhance|remove|captions?|subtitles?|add music|reel)\b/i.test(text);
  const study = /\b(save|analy[sz]e|analy[sz]is|study|clone this|extract|reverse|learn)\b/i.test(text);
  return !edit || study;
}

export const stripTemplateMarker = (brief: string): string => String(brief ?? "").replace(/\[\s*template\s*:\s*[\w-]+\s*\]/gi, "").replace(/\s+\n/g, "\n").trim();

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9\u0900-\u097f]+/).filter((w) => w.length > 2);

/** The template the owner means: an explicit marker, a template name in the words, or the kind of video asked for ("launch video"). */
export function pickTemplate<T extends { id: string; name: string; category: string; summary?: string; createdAt?: number }>(brief: string, all: T[]): T | null {
  if (!all.length || NEW_FROM_SCRATCH.test(brief)) return null;
  const marked = /\[\s*template\s*:\s*([\w-]+)\s*\]/i.exec(brief)?.[1];
  if (marked) { const hit = all.find((t) => t.id === marked); if (hit) return hit; }
  const lower = brief.toLowerCase();
  const named = all.filter((t) => t.name.length >= 4 && lower.includes(t.name.toLowerCase()));
  if (named.length) return named.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
  const bw = new Set(words(brief));
  const scored = all.map((t) => {
    const cat = bw.has(t.category.toLowerCase()) ? 3 : 0;
    const nameHits = words(t.name).filter((w) => bw.has(w)).length;
    return { t, score: cat + nameHits };
  }).filter((x) => x.score >= 3 || (x.score >= 2 && /\btemplate\b/i.test(brief)));
  scored.sort((a, b) => b.score - a.score || (b.t.createdAt ?? 0) - (a.t.createdAt ?? 0));
  return scored[0]?.t ?? null;
}
