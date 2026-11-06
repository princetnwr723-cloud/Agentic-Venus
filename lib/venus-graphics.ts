// Motion-graphics GUARANTEE for "edit my video" (pure functions, no server code, no imports except types).
//
// Why this file exists: when the owner asks for motion graphics / "edit it your way", the edit plan is written by a language model.
// The length rule was enforced in code, but the graphics rule was only a sentence in the prompt, so a model that wrote
// "clip, clip, clip, ..." produced a plain cut-down video and nobody noticed. Now the plan is MEASURED (graphicsReport), the model is
// asked again when it is short (venus-pipeline.ts), and whatever is still missing is added here by code, from the owner's own
// words (the transcript) and the plan's title only: nothing is invented.
import type { Scene, Storyboard, TranscriptSeg } from "@/lib/venus-schema";

const OVERLAP_S = 12 / 30; // scenes overlap by 12 frames at 30 fps (see OVERLAP in venus-schema.ts)

export type GraphicsNeeds = { designed: number; overlayClips: number };
export type GraphicsReport = { designed: number; overlayClips: number; clips: number; seconds: number };

const secondsOf = (scenes: Scene[]): number =>
  scenes.reduce((a, s) => a + (Number(s.seconds) || 0), 0) - OVERLAP_S * Math.max(0, scenes.length - 1);

/** What the edit contains right now: designed scenes (everything that is not a clip) and clips that carry a title / overlay. */
export function graphicsReport(sb: Pick<Storyboard, "scenes">): GraphicsReport {
  let designed = 0;
  let overlayClips = 0;
  let clips = 0;
  for (const s of sb.scenes) {
    if (s.type === "clip") {
      clips++;
      if ((Array.isArray(s.overlays) && s.overlays.length > 0) || (typeof s.headline === "string" && s.headline.trim())) overlayClips++;
    } else designed++;
  }
  return { designed, overlayClips, clips, seconds: Math.max(0, secondsOf(sb.scenes)) };
}

/** The minimum for "the full treatment": one designed scene per ~45 s (at least 3) and a title / overlay on about a third of the clips. */
export function graphicsNeeds(seconds: number, clips: number): GraphicsNeeds {
  return {
    designed: Math.max(3, Math.floor(Math.max(0, seconds) / 45)),
    overlayClips: Math.min(clips, Math.max(2, Math.ceil(clips / 3))),
  };
}

export const graphicsMissing = (r: GraphicsReport, n: GraphicsNeeds): boolean => r.designed < n.designed || r.overlayClips < n.overlayClips;

const trimEnd = (t: string) => t.replace(/[\s,;:.\-–—!?]+$/g, "");
function phrase(text: string, max = 6): string {
  const words = String(text ?? "").replace(/["“”…]/g, "").split(/\s+/).filter(Boolean).slice(0, max);
  return trimEnd(words.join(" ")).slice(0, 60);
}

/** The longest spoken line that overlaps a stretch of the source video (null when nobody speaks there). */
function spokenIn(transcript: TranscriptSeg[], a: number, b: number): TranscriptSeg | null {
  let best: TranscriptSeg | null = null;
  let bestWords = 2; // at least 3 words, otherwise it is not worth a title
  for (const seg of transcript) {
    if (seg.e <= a || seg.s >= b) continue;
    const n = String(seg.t).split(/\s+/).filter(Boolean).length;
    if (n > bestWords) { best = seg; bestWords = n; }
  }
  return best;
}

const clipLen = (s: Scene) => Math.max(0, (Number(s.srcEnd) - Number(s.srcStart)) / (Number(s.speed) || 1));
const pickEvenly = <T,>(items: T[], count: number): T[] => {
  if (count <= 0 || items.length === 0) return [];
  if (count >= items.length) return items.slice();
  const out: T[] = [];
  const step = items.length / count;
  for (let i = 0; i < count; i++) out.push(items[Math.min(items.length - 1, Math.floor(i * step + step / 2))]);
  return out;
};

export type AddedGraphics = { sb: Storyboard; addedScenes: number; addedOverlays: number; gradeSet: boolean };

/**
 * Adds what is missing so that the edit has real motion graphics, using only the owner's own words and the plan's title:
 * a title card at the start, kinetic chapter cards between the clips, an end card, and titles / call-outs on the clips.
 * Nothing is added when the plan already has enough (the agent's own design is never replaced).
 */
export function addMotionGraphics(sb: Storyboard, opts: { transcript?: TranscriptSeg[]; creative?: boolean } = {}): AddedGraphics {
  const transcript = Array.isArray(opts.transcript) && opts.transcript.length ? opts.transcript : Array.isArray(sb.transcript) ? sb.transcript : [];
  const rep = graphicsReport(sb);
  const need = graphicsNeeds(rep.seconds, rep.clips);
  const scenes: Scene[] = sb.scenes.map((s) => ({ ...s }));
  let addedOverlays = 0;
  let addedScenes = 0;

  // 1) titles and call-outs ON the clips (they do not change the length)
  const wantOverlays = Math.max(0, need.overlayClips - rep.overlayClips);
  if (wantOverlays > 0) {
    const eligible = scenes
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.type === "clip" && !(Array.isArray(s.overlays) && s.overlays.length) && !String(s.headline ?? "").trim() && clipLen(s) >= 3);
    const styles = ["lower-third", "callout", "chip"];
    pickEvenly(eligible, wantOverlays).forEach(({ s, i }, k) => {
      const len = clipLen(s);
      const seg = spokenIn(transcript, Number(s.srcStart), Number(s.srcEnd));
      const text = seg ? phrase(seg.t) : "";
      const sp = Number(s.speed) || 1;
      const at = Math.max(0.4, Math.min(len - 2, seg ? (Math.max(seg.s, Number(s.srcStart)) - Number(s.srcStart)) / sp : 0.4));
      const dur = Math.max(1.2, Math.min(3.2, len - at - 0.4));
      const o = text
        ? { at: Math.round(at * 10) / 10, dur: Math.round(dur * 10) / 10, text, style: styles[k % styles.length] }
        : { at: 0.4, dur: Math.round(Math.min(2.4, Math.max(1.2, len - 0.8)) * 10) / 10, text: "Part " + (k + 1), style: "chip" };
      scenes[i] = { ...s, overlays: [o] };
      addedOverlays++;
    });
  }

  // 2) designed scenes between the clips: a title card first, an end card last, chapter cards in between
  let want = Math.max(0, need.designed - rep.designed);
  const inserts = new Map<number, Scene[]>();
  const titleOf = () => {
    const t = String(sb.title ?? "").trim();
    if (t && !/^untitled$/i.test(t)) return t.slice(0, 60);
    const first = transcript.find((x) => String(x.t).split(/\s+/).length >= 3);
    return first ? phrase(first.t, 7) : "";
  };
  const heading = titleOf();
  const startsWithClip = scenes[0]?.type === "clip";
  const endsWithClip = scenes[scenes.length - 1]?.type === "clip";
  let appendEnd: Scene | null = null;
  if (want > 0 && startsWithClip && heading) {
    inserts.set(0, [{ type: "title", seconds: 2.6, headline: heading, subhead: "", transition: "zoom" }]);
    want--;
    addedScenes++;
  }
  if (want > 0 && endsWithClip && heading && scenes.length > 1) {
    appendEnd = { type: "outro", seconds: 3, headline: heading, subhead: "", transition: "fade" };
    want--;
    addedScenes++;
  }
  if (want > 0) {
    const gaps = scenes.map((s, i) => ({ s, i })).filter(({ s, i }) => i >= 2 && s.type === "clip" && scenes[i - 1].type === "clip");
    const moves = ["wipe", "slide", "up", "iris"];
    pickEvenly(gaps, Math.min(want, 10)).forEach(({ s, i }, k) => {
      const seg = spokenIn(transcript, Number(s.srcStart), Number(s.srcEnd));
      const text = seg ? phrase(seg.t, 7) : "Part " + (k + 2);
      const list = inserts.get(i) ?? [];
      list.push({ type: "kinetic", seconds: 2.4, text, transition: moves[k % moves.length] });
      inserts.set(i, list);
      addedScenes++;
    });
  }

  let out: Scene[] = [];
  scenes.forEach((s, i) => {
    const before = inserts.get(i);
    if (before) out.push(...before);
    out.push(s);
  });
  if (appendEnd) {
    // the last clip now has a scene after it: let it play a little longer underneath, like every other clip that is followed by a scene
    const li = out.length - 1;
    const last = out[li];
    if (last.type === "clip" && sb.source) {
      const sp = Number(last.speed) || 1;
      const room = Math.max(0, sb.source.duration - Number(last.srcEnd) - 0.05);
      const extraSrc = Math.min(room, OVERLAP_S * sp);
      out[li] = { ...last, seconds: Math.round((Number(last.seconds) + extraSrc / sp) * 1000) / 1000 };
    }
    out.push(appendEnd);
  }
  if (addedScenes === 0 && addedOverlays === 0) out = scenes;

  const gradeSet = Boolean(opts.creative) && !sb.grade && (addedScenes > 0 || addedOverlays > 0);
  return { sb: { ...sb, scenes: out, ...(gradeSet ? { grade: "teal-orange" } : {}) }, addedScenes, addedOverlays, gradeSet };
}