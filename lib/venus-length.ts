// Venus Pro: the LENGTH CONTRACT and the DOCUMENTARY detector (pure functions, no server code, no imports of values).
// - findLengthPlan: "15-20 minute" -> target 17.5 min, hard ceiling 20 min ("30 second demo" -> 30 s)
// - wordBudget / chapterBudgets: how many spoken words fit into a chapter, so the video ends where the owner asked
// - sceneSecondsFromWords: the length of a narrated scene follows what is SAID, not a guess of the model
// - lengthReport: the honest answer to "how long did it really become"
// - isDocumentary / isMusicOnly: which kind of video this is (a documentary always gets a voice-over)
import type { Scene, Storyboard } from "@/lib/venus-schema";

export type LengthPlan = { target: number; min: number; max: number; range: boolean };

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, ek: 1, two: 2, do: 2, three: 3, teen: 3, four: 4, char: 4, five: 5, panch: 5, paanch: 5, six: 6, chhe: 6, seven: 7, saat: 7, eight: 8, aath: 8, nine: 9, nau: 9, ten: 10, das: 10, fifteen: 15, pandrah: 15, twenty: 20, bees: 20, thirty: 30, tees: 30, forty: 40, fifty: 50, half: 0.5 };
const num = (s: string): number => (/^[\d.]+$/.test(s) ? Number(s) : WORDS[s] ?? NaN);
const NUM = "(\\d+(?:\\.\\d+)?|a|an|one|ek|two|do|three|teen|four|char|five|panch|paanch|six|seven|eight|nine|ten|das|fifteen|pandrah|twenty|bees|thirty|tees|forty|fifty|half)";
const UNIT = "(?:(hours?|hrs?|ghante|ghanta|घंटे|घंटा)|(minutes?|mins?|minat|मिनट)|(seconds?|secs?|सेकंड))(?![a-z])";
const mult = (u: { h?: string; m?: string; s?: string }) => (u.h ? 3600 : u.m ? 60 : 1);

/** Finds the length the owner asked for. A range ("15-20 minute", "15 se 20 minute", "15 to 20 min") gives a target in the middle and a hard ceiling at the upper end. */
export function findLengthPlan(text: string): LengthPlan | null {
  const t = String(text ?? "").toLowerCase();
  const range = new RegExp(NUM + "\\s*(?:-|–|—|to|se|aur|or|ya)\\s*" + NUM + "\\s*" + UNIT, "i").exec(t);
  if (range) {
    const a = num(range[1]);
    const b = num(range[2]);
    const m = mult({ h: range[3], m: range[4], s: range[5] });
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      const lo = Math.min(a, b) * m;
      const hi = Math.max(a, b) * m;
      if (hi >= 5 && hi <= 86400) return { target: Math.round((lo + hi) / 2), min: Math.round(lo), max: Math.round(hi), range: true };
    }
  }
  const one = new RegExp(NUM + "\\s*" + UNIT, "gi");
  let best = 0;
  for (const x of t.matchAll(one)) {
    const n = num(x[1]);
    if (!Number.isFinite(n)) continue;
    const secs = n * mult({ h: x[2], m: x[3], s: x[4] });
    if (secs >= 5 && secs <= 86400 && secs > best) best = secs;
  }
  if (!best) return null;
  best = Math.round(best);
  return { target: best, min: Math.round(best * 0.9), max: Math.round(best * 1.1), range: false };
}

const DEVANAGARI = /[\u0900-\u097F]/g;
export const isHindiText = (t: string): boolean => {
  const letters = String(t ?? "").match(/\p{L}/gu)?.length ?? 0;
  return letters > 0 && (String(t).match(DEVANAGARI)?.length ?? 0) / letters > 0.3;
};

/** Words per second of a calm documentary voice. */
export const wordsPerSecond = (hindi: boolean): number => (hindi ? 2.0 : 2.3);
export const countWords = (t: string): number => (String(t ?? "").trim().match(/[\p{L}\p{N}\p{M}'’-]+/gu) ?? []).length;

/** The number of words that fits into `seconds` of video (a part of the time is silence between the scenes). */
export function wordBudget(seconds: number, hindi: boolean): number {
  return Math.max(8, Math.round(seconds * wordsPerSecond(hindi) * 0.9));
}

/** Splits the total length into chapters that add up EXACTLY to the total (each at least `minEach` seconds when possible). */
export function chapterBudgets(total: number, weights: number[], minEach = 20): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 1));
  const sum = w.reduce((a, b) => a + b, 0);
  const floor = Math.min(minEach, Math.floor(total / n));
  let out = w.map((x) => Math.max(floor, Math.round((x / sum) * total)));
  let diff = total - out.reduce((a, b) => a + b, 0);
  for (let guard = 0; diff !== 0 && guard < 5000; guard++) {
    const i = guard % n;
    if (diff > 0) { out[i] += 1; diff -= 1; }
    else if (out[i] > floor) { out[i] -= 1; diff += 1; }
    else if (out.every((x) => x <= floor)) break;
  }
  return out;
}

export const narrationOf = (s: Scene): string => String((s as Record<string, unknown>).narration ?? "").trim();

/** How long a narrated scene must last: the words that are said, plus a short breath. */
export function sceneSecondsFromWords(narration: string, hindi: boolean): number {
  const w = countWords(narration);
  return Math.min(30, Math.max(3, Math.round((w / wordsPerSecond(hindi) + 0.6) * 10) / 10));
}

/** Seconds of a scene that were SPOKEN (voice recorded) or will be spoken (words). */
export function totalSecondsOf(sb: Pick<Storyboard, "scenes" | "fps">): number {
  const fps = sb.fps || 30;
  let start = 0;
  let last = 60;
  for (const s of sb.scenes) {
    const dur = Math.max(36, Math.round((Number(s.seconds) || 4) * fps));
    last = start + dur;
    start = start + dur - 12;
  }
  return sb.scenes.length ? last / fps : 2;
}

/** Makes every narrated scene as long as its words need (when a voice-over will speak them). Scenes without words are left alone. */
export function fitSecondsToWords(sb: Storyboard, hindi: boolean): Storyboard {
  return {
    ...sb,
    scenes: sb.scenes.map((s) => {
      const n = narrationOf(s);
      if (!n) return s;
      const need = sceneSecondsFromWords(n, hindi);
      // never shorter than the words need; never more than 3 seconds longer than needed (that would be silence)
      const cur = Number(s.seconds) || need;
      return { ...s, seconds: Math.round(Math.max(need, Math.min(cur, need + 3)) * 10) / 10 } as Scene;
    }),
  };
}

export type LengthReport = { seconds: number; words: number; ratio: number; status: "ok" | "short" | "long" };

export function lengthReport(sb: Storyboard, plan: { target: number; min?: number; max?: number }): LengthReport {
  const seconds = totalSecondsOf(sb);
  const words = sb.scenes.reduce((a, s) => a + countWords(narrationOf(s)), 0);
  const ratio = plan.target > 0 ? seconds / plan.target : 1;
  const max = plan.max ?? plan.target * 1.1;
  const min = plan.min ?? plan.target * 0.9;
  return { seconds, words, ratio, status: seconds > max * 1.02 ? "long" : seconds < min * 0.95 ? "short" : "ok" };
}

/** Last safety net: trims only the silent parts (scenes without a voice) until the video fits under `max`. */
export function trimSilent(sb: Storyboard, max: number): Storyboard {
  let cur = sb;
  for (let round = 0; round < 3 && totalSecondsOf(cur) > max; round++) {
    const over = totalSecondsOf(cur) - max;
    const silent = cur.scenes.map((s, i) => (!narrationOf(s) && !s.voice && s.type !== "clip" ? i : -1)).filter((i) => i >= 0);
    if (!silent.length) break;
    const room = silent.reduce((a, i) => a + Math.max(0, Number(cur.scenes[i].seconds) - 2.5), 0);
    if (room <= 0) break;
    const k = Math.min(1, over / room);
    cur = { ...cur, scenes: cur.scenes.map((s, i) => (silent.includes(i) ? ({ ...s, seconds: Math.round((Number(s.seconds) - (Number(s.seconds) - 2.5) * k) * 10) / 10 } as Scene) : s)) };
  }
  return cur;
}

// ---------------- what kind of video is it ----------------
const DOC_RE = /(documentar|dastavez|dastaavez|डॉक्यूमेंट|डॉक्यूमेन्ट|explainer|explained|deep[\s-]?dive|case study|history of|itihas|इतिहास|biograph|why (?:is|are|did|do|does|was)\b|how (?:did|does|do|is|are|was)\b|kaise|kyun|kyu\b|क्यों|कैसे|story of|rise of|fall of|the truth about|economy|economics|vlog essay|video essay)/i;
const MUSIC_ONLY_RE = /(music (?:video|only)|only music|visuali[sz]er|lyric|loop|abstract|mood (?:piece|reel)|screensaver|kinetic type reel|quote reel|teaser without|no (?:voice|narration)|without (?:a )?voice|silent|bina (?:awaaz|voice)|बिना आवाज)/i;

export const isDocumentary = (brief: string): boolean => DOC_RE.test(String(brief ?? ""));
export const isMusicOnly = (brief: string): boolean => MUSIC_ONLY_RE.test(String(brief ?? ""));