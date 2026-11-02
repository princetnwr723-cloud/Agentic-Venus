// Script mode and voice mode of Venus Pro (pure functions, no server code).
// - detectScript: finds the SCRIPT the owner gave (after "script:", between quotes, or a long pasted text) and the instructions around it
// - splitDirections / spokenOnly: what is SPOKEN is separated from what is only an instruction (scene notes, [music], (pause), "Visual: ...")
// - scriptSeconds / splitScript / enforceScript: the length of the video follows the script; the narration is the script, word for word
// - voiceModeOf: "on" | "off" | "auto" (auto = the agent decides from the story whether a voice-over fits or music only)
import type { Scene, Storyboard } from "@/lib/venus-schema";
export type ScriptInfo = { script: string; instructions: string };
const MARKER = /(?:^|\n)[ \t]*(?:(?:the|my|this)[ \t]+)?(?:script|narration|voice[\s-]?over(?:[ \t]+(?:text|script))?|dialogue|voiceover[ \t]+script)[ \t]*(?:is|:|-|–|—)[ \t]*/i;
const LISTY = /(?:^|\n)[ \t]*(?:\d+[.)]|[-*•])[ \t]/g;
export const wordsOf = (t: string): string[] => t.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ").split(/\s+/).filter(Boolean);
const DIRECTION_KEYS =
  "scenes?|shots?|दृश्य|सीन|शॉट|संगीत|म्यूजिक|विजुअल|विज़ुअल|निर्देश|visuals?|video|on[- ]?screen|screen|b[- ]?roll|footage|camera|cut(?:[ \\t]+to)?|transitions?|music|sound(?:[ \\t]*effects?)?|sfx|fx|audio|bgm|background|animations?|graphics?|text(?:[ \\t]+on[ \\t]+screen)?|captions?|titles?|lower[- ]third|notes?|directions?|instructions?|style|mood|tone|colou?rs?|palette|fonts?|duration|length|aspect|format|timing|fade|zoom|pan|overlay|logo|images?|clips?|assets?|pacing|speed|emotion|delivery|effects?";
const DIRECTION_LINE = new RegExp(`^(?:${DIRECTION_KEYS})(?:[ \\t]+[\\w#/.&-]+){0,2}[ \\t]*[:：]`, "i");
const SCENE_HEAD = /^(?:scene|shot|part|chapter|act|segment|slide|दृश्य|सीन|शॉट|भाग|अध्याय)[ \t]*#?[\d०-९]+/i;
// a direction in the MIDDLE of a line ("... set up. Visual: phone mockup. Try it today"): it runs to the end of its sentence
const INLINE_DIRECTION = /(^|[.!?।]\s+)(?:visuals?|music|sfx|sound effects?|camera|b[- ]?roll|on[- ]?screen(?: text)?|transition|scene[ \t]*\d*|shot[ \t]*\d*|दृश्य|संगीत)[ \t]*[:：][^.!?।\n]*[.!?।]?/gi;
const SPEAKER = /^(?:narrator|narration|voice[\s-]?over|voiceover|v\.?o\.?|speaker(?:[ \t]*\d+)?|host|presenter|anchor)[ \t]*[:：][ \t]*/i;
const SECTION = /^(?:hook|intro(?:duction)?|outro|conclusion|cta|call to action|opening|closing|ending|body)[ \t]*[:：][ \t]*/i;
const STAMP = /^[(\[]?\d{1,2}:\d{2}(?::\d{2})?(?:[ \t]*[-–—][ \t]*\d{1,2}:\d{2}(?::\d{2})?)?[)\]]?[ \t]*[-–—:]?[ \t]*/;
const CUE = /^\s*(?:pause|beat|music|sfx|sound|visual|scene|cut|fade|zoom|pan|camera|b[- ]?roll|on[- ]?screen|text|graphic|animation|transition|whisper(?:s|ing)?|laugh(?:s|ing)?|sigh(?:s|ing)?|smil(?:e|es|ing)|excited|slowly|softly|quickly|dramatic|emphasis|voice|vo|v\.o\.|sound effect|\d+\s*s(?:ec(?:onds?)?)?)\b/i;
export function splitDirections(text: string): { spoken: string; directions: string[] } {
  const directions: string[] = [];
  const keep: string[] = [];
  const note = (d: string) => { const t = d.replace(/\s+/g, " ").trim(); if (t && directions.length < 40) directions.push(t.slice(0, 200)); };
  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) { keep.push(""); continue; }
    if (/^[-=_*~]{3,}$/.test(line)) continue;
    if (/^#{1,6}\s/.test(line)) { note(line.replace(/^#+\s*/, "")); continue; }
    const bare = line.replace(/^[\s>*_\-•·]+/, "").replace(/^\d+[.)]\s+/, "").replace(/\*\*|__/g, "").trim();
    if (DIRECTION_LINE.test(bare)) { note(bare); continue; }
    if (SCENE_HEAD.test(bare) && wordsOf(bare).length <= 14) { note(bare); continue; }
    let t = bare;
    t = t.replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1");
    t = t.replace(/\[[^\]\n]{0,240}\]/g, (m) => { note(m); return " "; });
    t = t.replace(/\{[^}\n]{0,240}\}/g, (m) => { note(m); return " "; });
    t = t.replace(/<[^>\n]{0,200}>/g, (m) => { note(m); return " "; });
    t = t.replace(/\(([^)\n]{0,200})\)/g, (m, inner: string) => (CUE.test(inner) ? (note(m), " ") : m));
    t = t.replace(/\s+/g, " ").trim(); // a removed [cue] must not leave a space in front of "Narrator:"
    t = t.replace(STAMP, "").replace(SPEAKER, "").replace(SECTION, "");
    t = t.replace(INLINE_DIRECTION, (m, lead: string) => { note(m.slice(lead.length)); return lead; });
    t = t.replace(/`+/g, "").replace(/\s+/g, " ").trim();
    if (/\p{L}/u.test(t)) keep.push(t);
  }
  const spoken = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { spoken: wordsOf(spoken).length >= 3 ? spoken : "", directions };
}
export const spokenOnly = (t: string): string => splitDirections(t).spoken;
const joinInstr = (a: string, d: string[]) => [a, ...d].filter(Boolean).join(" ").slice(0, 3000);
export function detectScript(brief: string, forced?: boolean): ScriptInfo | null {
  if (forced === false) return null;
  const text = brief.trim();
  const m = MARKER.exec(text);
  if (m) {
    const rest = text.slice(m.index + m[0].length).trim();
    const c = splitDirections(rest);
    if (wordsOf(c.spoken).length >= 12) return { instructions: joinInstr(text.slice(0, m.index).trim(), c.directions), script: c.spoken };
  }
  const q = /"""([\s\S]{60,}?)"""|“([\s\S]{80,}?)”|"([\s\S]{200,}?)"/.exec(text);
  if (q) {
    const inner = (q[1] ?? q[2] ?? q[3] ?? "").trim();
    const c = splitDirections(inner);
    if (wordsOf(c.spoken).length >= 20) return { script: c.spoken, instructions: joinInstr(text.replace(q[0], " ").replace(/\s+/g, " ").trim(), c.directions) };
  }
  if (forced === true) {
    const c = splitDirections(text);
    return c.spoken ? { script: c.spoken, instructions: joinInstr("", c.directions) } : { script: text, instructions: "" };
  }
  const listy = (text.match(LISTY) ?? []).length >= 3 || /(?:^|\n)\s*(?:scenes?|style|look|rules?|regles|facts?|mood|palette)\s*[:(]/i.test(text);
  if (wordsOf(text).length >= 80 && !listy) {
    const c = splitDirections(text);
    return wordsOf(c.spoken).length >= 20 ? { script: c.spoken, instructions: joinInstr("", c.directions) } : { script: text, instructions: "" };
  }
  return null;
}

const devanagariShare = (t: string) => {
  const letters = t.match(/\p{L}/gu)?.length ?? 0;
  return letters ? (t.match(/[\u0900-\u097F]/g)?.length ?? 0) / letters : 0;
};

/** How long the video must be to speak the whole script (a calm voice says about 2.4 English or 2.1 Hindi words a second) plus a short intro and outro. */
export function scriptSeconds(script: string): number {
  const rate = devanagariShare(script) > 0.3 ? 2.1 : 2.4;
  return Math.ceil(wordsOf(script).length / rate + 4);
}

export function splitSentences(script: string): string[] {
  const parts = script.replace(/\r/g, "").split(/(?<=[.!?।…])\s+|\n{2,}/u).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (wordsOf(p).length <= 45) { out.push(p); continue; }
    let cur = "";
    for (const piece of p.split(/(?<=[,;:—])\s+/u)) {
      if (cur && wordsOf(cur + " " + piece).length > 30) { out.push(cur); cur = piece; } else cur = cur ? cur + " " + piece : piece;
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Cuts a long script into parts of about `target` words, at sentence ends. */
export function splitScript(script: string, target = 130): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const s of splitSentences(script)) {
    const w = wordsOf(s).length;
    if (n >= target && cur.length) { out.push(cur.join(" ")); cur = []; n = 0; }
    cur.push(s); n += w;
  }
  if (cur.length) out.push(cur.join(" "));
  return out.length ? out : [script];
}

function lcs(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** The narration of every scene keeps only spoken words: a direction the model copied into a narration is removed here. */
function cleanScenes(sb: Storyboard): Storyboard {
  let changed = false;
  const scenes = sb.scenes.map((s) => {
    const n = (s as Record<string, unknown>).narration;
    if (typeof n !== "string" || !n) return s;
    const c = spokenOnly(n);
    if (c === n) return s;
    changed = true;
    const { narration, ...rest } = s as Record<string, unknown>;
    void narration;
    return (c ? { ...rest, narration: c } : rest) as Scene;
  });
  return changed ? { ...sb, scenes } : sb;
}

/**
 * The narration of the scenes must be the script, word for word and in order. When the model followed that, nothing changes;
 * when it did not (it rewrote, skipped or added words), the sentences of the script are laid over the scenes by their length.
 * Directions never reach the voice: the script and every narration are cleaned first.
 */
export function enforceScript(sbIn: Storyboard, scriptRaw: string): { sb: Storyboard; repaired: boolean } {
  const script = spokenOnly(scriptRaw) || scriptRaw;
  const sb = cleanScenes(sbIn);
  const want = wordsOf(script);
  const got = wordsOf(sb.scenes.map((s) => String(s.narration ?? "")).join(" "));
  const same = lcs(want, got) / Math.max(want.length, got.length, 1);
  if (same >= 0.93) return { sb, repaired: sb !== sbIn };
  const sentences = splitSentences(script);
  const total = sentences.reduce((a, s) => a + wordsOf(s).length, 0) || 1;
  const weight = sb.scenes.map((s) => Math.max(1.5, Number(s.seconds) || 3));
  const wsum = weight.reduce((a, b) => a + b, 0);
  const given: string[][] = sb.scenes.map(() => []);
  let si = 0;
  let spoken = 0;
  let acc = 0;
  sb.scenes.forEach((_, i) => {
    acc += (weight[i] / wsum) * total;
    while (si < sentences.length && (spoken < acc - 0.5 * wordsOf(sentences[si]).length || i === sb.scenes.length - 1)) {
      given[i].push(sentences[si]); spoken += wordsOf(sentences[si]).length; si++;
    }
  });
  const scenes: Scene[] = sb.scenes.map((s, i) => {
    const { narration, ...rest } = s as Record<string, unknown>;
    void narration;
    return (given[i].length ? { ...rest, narration: given[i].join(" ") } : rest) as Scene;
  });
  return { sb: { ...sb, scenes }, repaired: true };
}

const ON_RE = /(voice[\s-]?over|voiceover|narrat|dubb|commentary|awaaz|avaaz|आवाज|वॉइस|वॉयस)/i;
const OFF_RE = /(no voice|without (?:a )?voice|voice[\s-]?less|silent|music only|only music|no narration|bina (?:awaaz|voice)|बिना आवाज)/i;

/** on = always a voice-over; off = never; auto = the agent decides from the story (a better model decides better). */
export function voiceModeOf(p: { brief: string; voice?: boolean; voiceMode?: "auto" | "on" | "off"; origin?: string }, script: ScriptInfo | null): "on" | "off" | "auto" {
  if (script) return "on";
  if (p.voiceMode) return p.voiceMode;
  if (OFF_RE.test(p.brief)) return "off";
  if (ON_RE.test(p.brief)) return "on";
  if (p.origin !== "chat" && p.voice === true) return "on"; // a ticked box of the form; the chat only switched it on when an OpenAI key existed
  return "auto";
}
