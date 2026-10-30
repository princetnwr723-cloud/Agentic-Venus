// Script mode and voice mode of Venus Pro (pure functions, no server code).
// - detectScript: finds the SCRIPT the owner gave (after "script:", between quotes, or a long pasted text) and the instructions around it
// - scriptSeconds / splitScript / enforceScript: the length of the video follows the script; the narration is the script, word for word
// - voiceModeOf: "on" | "off" | "auto" (auto = the agent decides from the story whether a voice-over fits or music only)
import type { Scene, Storyboard } from "@/lib/venus-schema";

export type ScriptInfo = { script: string; instructions: string };

const MARKER = /(?:^|\n)[ \t]*(?:(?:the|my|this)[ \t]+)?(?:script|narration|voice[\s-]?over(?:[ \t]+(?:text|script))?|dialogue|voiceover[ \t]+script)[ \t]*(?:is|:|-|–|—)[ \t]*/i;
const LISTY = /(?:^|\n)[ \t]*(?:\d+[.)]|[-*•])[ \t]/g;

export const wordsOf = (t: string): string[] => t.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** The script the owner gave, or null when the brief is a normal brief. `forced` = the owner ticked "this is my script". */
export function detectScript(brief: string, forced?: boolean): ScriptInfo | null {
  if (forced === false) return null;
  const text = brief.trim();
  const m = MARKER.exec(text);
  if (m) {
    const rest = text.slice(m.index + m[0].length).trim();
    if (wordsOf(rest).length >= 12) return { instructions: text.slice(0, m.index).trim(), script: rest };
  }
  const q = /"""([\s\S]{60,}?)"""|“([\s\S]{80,}?)”|"([\s\S]{200,}?)"/.exec(text);
  if (q) {
    const inner = (q[1] ?? q[2] ?? q[3] ?? "").trim();
    if (wordsOf(inner).length >= 20) return { script: inner, instructions: text.replace(q[0], " ").replace(/\s+/g, " ").trim() };
  }
  if (forced === true) return { script: text, instructions: "" };
  const listy = (text.match(LISTY) ?? []).length >= 3 || /(?:^|\n)\s*(?:scenes?|style|look|rules?|regles|facts?|mood|palette)\s*[:(]/i.test(text);
  if (wordsOf(text).length >= 80 && !listy) return { script: text, instructions: "" };
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

/**
 * The narration of the scenes must be the script, word for word and in order. When the model followed that, nothing changes;
 * when it did not (it rewrote, skipped or added words), the sentences of the script are laid over the scenes by their length.
 */
export function enforceScript(sb: Storyboard, script: string): { sb: Storyboard; repaired: boolean } {
  const want = wordsOf(script);
  const got = wordsOf(sb.scenes.map((s) => String(s.narration ?? "")).join(" "));
  const same = lcs(want, got) / Math.max(want.length, got.length, 1);
  if (same >= 0.93) return { sb, repaired: false };
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
