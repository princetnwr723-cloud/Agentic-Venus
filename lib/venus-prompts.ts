import { ASPECTS, type Aspect } from "@/lib/venus-schema";

export function directorPrompt(o: {
  brief: string;
  seconds: number;
  aspect: Aspect;
  voice: boolean;
  captions: boolean;
  design: "ai" | "library";
}): string {
  const a = ASPECTS[o.aspect];
  return `You are the art director of "Venus Pro", an AI motion-graphics studio. Turn the brief into a storyboard for a ${o.seconds}-second video (${a.width}x${a.height}, ${o.aspect}). Reply with ONE JSON object only — no prose, no markdown fences.

STEP 1 — ART DIRECTION. Invent a visual identity that fits THIS topic (do not default to blue/purple unless the topic calls for it):
- "concept": one sentence describing the look and motion style.
- "palette": hex colors {"bg1","bg2","accent","accent2","text","muted"}. bg1/bg2 are dark (or both light) with strong contrast against "text".
- "fonts": {"display": one of inter|montserrat|poppins|spacegrotesk|playfair|oswald, "body": one of inter|poppins|spacegrotesk}.

STEP 2 — SCENES. Every scene accepts "seconds", "narration", "transition" (fade|slide|zoom|wipe|blur), "fontScale".
Library scene types:
 title {headline, subhead?} · kinetic {text, emphasis?: [words]} · bullets {headline, items: [3-5 short strings]} · stat {label, value: number, prefix?, suffix?, decimals?, caption?} · bar-chart {headline, data: [{label, value}] (2-6), unit?} · line-chart {headline, data: [{label, value}] (3-8)} · quote {text, author?} · split {headline?, left: {title, points}, right: {title, points}} · timeline {headline, steps: [{label, text}] (3-5)} · ranking {headline, items: [{title, note?}] (3-5)} · image {headline?, subhead?, imageQuery: "2-4 English words for a stock photo"} · outro {headline, subhead?, handle?}
${
  o.design === "ai"
    ? `Custom scene type (written as code by a motion designer after you): {"type":"custom","id":"c1","seconds":5,"brief":"<1-3 sentences: exactly what appears on screen and how it moves>","headline":"<short text the scene shows>","fallbackText":"<one short line used if the scene fails>"}.
AT LEAST HALF of the scenes (minimum 3) must be "custom", each with a clearly DIFFERENT visual idea (e.g. masked kinetic type, orbiting shapes, data drawn as SVG, morphing blobs, particle burst, split-screen reveal, glitch, ticker, radial progress, isometric blocks). Use library scenes only where they fit best (charts, quotes, lists). "id" values must be unique, letters/digits only.`
    : `Use ONLY the library scene types (no "custom").`
}

OUTPUT FORMAT:
{"title":"...","concept":"...","palette":{...},"fonts":{...},"scenes":[{"type":"title","seconds":4,"transition":"zoom","headline":"..."}, ...]}

RULES
- 6 to 12 scenes. Total of all "seconds" about ${o.seconds}, NEVER above ${o.seconds}. Each scene 3-9 seconds.
- First scene opens the video (title/kinetic/custom), last scene is "outro" or a closing custom scene.
- Never the same type twice in a row; vary transitions.
- On-screen text must be SHORT (headlines max 7 words) and in English unless the brief asks for another language.
- NEVER invent statistics, prices or facts. Use numbers only if they are in the brief or you are certain of them; otherwise use non-numeric scenes.
- ${
    o.voice
      ? 'Every scene needs a "narration" (natural spoken English, about 2 words per second of the scene). Narration and on-screen text must agree.'
      : 'Do not add "narration".'
  }

BRIEF:
${o.brief}`;
}

const SCENE_API = `You write ONE React (TSX) file that renders a single scene of a Remotion video.

HARD RULES
- First line: import React from "react";
- Allowed imports ONLY: "react", "remotion", "../kit", "../theme". Nothing else.
- Default export: export default function Scene({p, T, dur}: any). p = this scene's JSON (e.g. p.headline), T = theme {bg1,bg2,accent,accent2,text,muted,card,line,onAccent,dark,fd,fb} (fd/fb are the display/body font-family strings — use T.fd for headings, T.fb for body), dur = scene length in frames (30 fps).
- From "remotion": AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing, random, Sequence.
- From "../kit": EASE, Frame, Rise, H, fit, grad, useU, clampArr, num, txt. useU() returns {u, w, h, portrait}; u = min(width,height)/720 — size EVERYTHING with u so it works in 16:9, 9:16 and 1:1.
- Everything animates from useCurrentFrame() only. No CSS animations, no setTimeout, no Math.random (use random("seed")), no network, no external images/fonts/video. Use SVG, CSS gradients, shapes and text.
- Root element is <AbsoluteFill>. The video already draws the background, so keep your root transparent.
- Enter animation within the first ~16 frames; be settled by dur-14 (the video fades the scene out itself).
- Never throw: give every prop a default. Keep text inside the frame (use fit() and maxWidth). Max ~140 lines.
- Make it look PREMIUM: layered shapes, staggered springs, easing, depth, generous spacing. Avoid plain centered text.`;

const SCENE_EXAMPLE = `import React from "react";
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing} from "remotion";
import {useU} from "../kit";

export default function Scene({p, T, dur}: any) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {u, w, h} = useU();
  const words = String(p.headline || "Make it move").split(" ");
  const sweep = interpolate(frame, [10, 40], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic)});
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
      <svg width={w} height={h} style={{position: "absolute"}}>
        {[0, 1, 2, 3].map((i) => {
          const r = (140 + i * 70) * u;
          const a = frame * (0.6 + i * 0.25) * (i % 2 ? -1 : 1);
          return (
            <g key={i} transform={"rotate(" + a + " " + w / 2 + " " + h / 2 + ")"} opacity={0.18 + i * 0.1}>
              <circle cx={w / 2} cy={h / 2} r={r} fill="none" stroke={T.accent} strokeWidth={2 * u} strokeDasharray={12 * u + " " + 18 * u} />
              <circle cx={w / 2 + r} cy={h / 2} r={7 * u} fill={T.accent2} />
            </g>
          );
        })}
      </svg>
      <div style={{display: "flex", gap: 22 * u, flexWrap: "wrap", justifyContent: "center", maxWidth: "80%"}}>
        {words.map((word, i) => {
          const s = spring({frame: frame - (6 + i * 5), fps, config: {damping: 14, stiffness: 120}});
          return (
            <span key={i} style={{fontFamily: T.fd, fontWeight: 800, fontSize: 96 * u, color: i % 2 ? T.accent : T.text, display: "inline-block", opacity: s, transform: "translateY(" + (1 - s) * 60 * u + "px) rotate(" + (1 - s) * -6 + "deg)"}}>
              {word}
            </span>
          );
        })}
      </div>
      <div style={{position: "absolute", bottom: h * 0.28, width: 360 * u * sweep, height: 8 * u, borderRadius: 99, background: "linear-gradient(90deg, " + T.accent + ", " + T.accent2 + ")"}} />
    </AbsoluteFill>
  );
}`;

export function sceneCodePrompt(o: {
  scene: Record<string, unknown>;
  palette?: Record<string, string>;
  fonts?: { display?: string; body?: string };
  aspect: string;
  frames: number;
  concept?: string;
  previousCode?: string;
  error?: string;
  critique?: string;
}): string {
  const fix = o.previousCode
    ? `\n\nYOUR PREVIOUS CODE:\n${o.previousCode}\n\n${
        o.error ? `IT FAILED WITH THIS ERROR:\n${o.error}\nFix the cause.` : ""
      }${o.critique ? `A REVIEWER SAW THIS PROBLEM IN THE RENDERED FRAME:\n${o.critique}\nFix it.` : ""}`
    : "";
  return `${SCENE_API}

EXAMPLE OF THE EXPECTED STYLE (do not copy it; design something new for the brief):
${SCENE_EXAMPLE}

VIDEO CONTEXT: concept "${o.concept ?? ""}", palette ${JSON.stringify(o.palette ?? {})}, fonts ${JSON.stringify(o.fonts ?? {})}, format ${o.aspect}, this scene lasts ${o.frames} frames.
SCENE JSON (p):
${JSON.stringify(o.scene)}

Write the scene so it matches the "brief" in the JSON. Reply with ONLY the TSX code in one \`\`\`tsx block.${fix}`;
}

export function editPrompt(scene: Record<string, unknown>, instruction: string): string {
  return `You edit one scene of a motion-graphics storyboard. Current scene JSON:
${JSON.stringify(scene)}

User instruction: ${instruction}

Reply with ONE JSON object only: {"scene": <the full updated scene JSON>, "regenerateCode": true|false}.
- Keep "type" unless the instruction asks for a different kind of scene.
- Library scene types: title, kinetic, bullets, stat, bar-chart, line-chart, quote, split, timeline, ranking, image, outro. Keep their props valid.
- If the scene is "custom": update "brief" (what appears and how it moves) and set "regenerateCode": true when the VISUAL design must change; for text-only changes edit "headline" and set false.
- Keep text short. Never invent statistics.`;
}

export function reviewPrompt(
  tiles: Array<{ tile: number; index: number; type: string; summary: string }>
): string {
  const lines = tiles
    .map((t) => `Tile ${t.tile} (left to right, top to bottom) = scene index ${t.index}, type "${t.type}", text: "${t.summary}"`)
    .join("\n");
  return `You are the quality reviewer of a motion-graphics video. The image is a contact sheet of frames from the middle of each scene.

${lines}

Check each tile for REAL problems only: text cut off or overflowing the frame, text too small to read, overlapping elements, an empty or broken layout, low contrast. Do not nitpick style.

Reply with ONE JSON object only:
{"verdict":"good"|"fix","issues":[{"scene":<scene index>,"problem":"<specific visual problem>","patch":{...}}]}

"patch" may contain ONLY: "fontScale" (0.5-1.2; smaller when text overflows), "transition" (fade|slide|zoom|wipe|blur), and shorter replacements for "headline", "subhead", "text", "label", "caption". For custom scenes leave "patch" empty and describe the problem precisely. If everything looks fine answer {"verdict":"good","issues":[]}.`;
}