import { ASPECTS, type Aspect } from "@/lib/venus-schema";

export function directorPrompt(o: {
  brief: string; seconds: number; aspect: Aspect; voice: boolean; captions: boolean;
  design: "ai" | "library"; context?: string;
}): string {
  const a = ASPECTS[o.aspect];
  return `You are the art director of "Venus Pro", an AI motion-graphics studio. Turn the brief into a storyboard for a ${o.seconds}-second video (${a.width}x${a.height}, ${o.aspect}). Reply with ONE JSON object only — no prose, no markdown fences.

STEP 1 — ART DIRECTION. Invent a visual identity that fits THIS topic (do not default to blue/purple unless it fits). If the user's memory below describes a brand (name, colors, fonts, handle), USE it.
- "concept": one sentence describing the look and motion style.
- "palette": generate a topic-specific six-color palette {"bg1","bg2","accent","accent2","text","muted"}; strong contrast between text and background. Do not use a preset theme palette or repeat the same palette for unrelated briefs. Select colors from the subject, emotional tone, brand context, and intended audience. Use light backgrounds when appropriate; dark is not mandatory.
- "fonts": {"display": inter|montserrat|poppins|spacegrotesk|playfair|oswald, "body": inter|poppins|spacegrotesk}. Choose typography to match the subject rather than defaulting to the same pair every time.

STEP 2 — SCENES. Every scene accepts "seconds", "narration", "transition" (fade|slide|zoom|wipe|blur), "fontScale" and "camera" — a virtual camera move or up to 3 stacked: push, pull, pan-left, pan-right, tilt-up, tilt-down, orbit, handheld, crash-zoom, whip. Use camera moves like a cinematographer: push on key statements, handheld on footage, crash-zoom for emphasis, whip to open an energetic scene. Not every scene needs one.
Library scene types:
 title {headline, subhead?} · kinetic {text, emphasis?: [words]} · bullets {headline, items: [3-5 short strings]} · stat {label, value: number, prefix?, suffix?, decimals?, caption?} · bar-chart {headline, data: [{label, value}] (2-6), unit?} · line-chart {headline, data: [{label, value}] (3-8)} · quote {text, author?} · split {headline?, left: {title, points}, right: {title, points}} · timeline {headline, steps: [{label, text}] (3-5)} · ranking {headline, items: [{title, note?}] (3-5)} · image {headline?, subhead?, imageQuery: "2-4 English words"} · footage {headline?, subhead?, footageQuery: "2-4 English words for REAL stock video b-roll"} · outro {headline, subhead?, handle?}
ADAPTIVE VISUAL DIRECTOR — DECIDE THE BEST WAY TO MAKE THIS VIDEO:
Think like a senior documentary director, motion designer, editor, cinematographer and fact-checker. The goal is the strongest video for this exact brief—not maximizing images, maximizing code, or following a fixed template. Make a deliberate visual-treatment decision for every story beat before returning the storyboard.

1) Select the best visual language per beat:
- "footage" for real-world motion that benefits from authenticity: a place, person, activity, process, nature, city, product in use, crowd, travel, or cinematic b-roll. Give a precise footageQuery describing subject + action + shot/framing + environment; avoid vague one-word searches.
- "image" for a specific real still that provides recognition, evidence, historical context, a product/detail, map/photo, texture, or emotional grounding. Give a precise imageQuery. Treat a still as a living shot with an intentional camera move (push/pull/pan/parallax-style framing where supported), crop, and timed graphic treatment—not as a static slide.
- "custom" for ideas that are clearer or more beautiful when designed: diagrams, charts, comparisons, data, abstract concepts, UI, timelines, maps that can be drawn, kinetic typography, labels, callouts, icons, transitions, explainers and visual metaphors. Generate original React/TSX Remotion code; use SVG/vector shapes, masks, gradients, particles, layered depth and frame-driven animation where useful.
- Mix these modes when the story benefits. A single video may be footage-led, image-led, fully code-generated, or a thoughtful hybrid. Never impose a fixed ratio or a fixed style.

2) IMAGES MUST BE EXPLAINED, NOT JUST DISPLAYED:
When a real image/footage scene needs explanation, add designed motion graphics that clarify the actual subject: restrained labels, animated arrows/callouts, dates, location tags, map pins, comparison markers, diagram overlays, counters, highlighted regions, captions, chart overlays, or a kinetic headline. Use only overlays that add meaning; don't clutter every shot. If the renderer cannot composite overlays over a media scene directly, create an adjacent custom scene that annotates/explains the same visual, or use a separate custom overlay scene in the sequence. Do not pretend a generic gradient is real footage.

3) VISUAL EDITORIAL DECISIONS:
- Open with the strongest visual hook in the first 1-2 seconds; make each cut advance the story.
- Choose scene count, duration, cut rhythm, transitions, camera movement, composition, text density, palette and sound cues from the topic, platform, aspect ratio, duration and emotional arc. Fast facts can cut quickly; serious/emotional material can breathe. Never add scenes just to hit a count.
- Use a topic-specific palette and typography system, with contrast suitable for the media and captions. The palette is a starting point, not a mandate to paint every frame with gradients.
- Alternate wide/medium/detail shots and graphic layouts when appropriate. Avoid repeated centered-title-on-gradient compositions, generic stock montages, irrelevant b-roll, unnecessary zooms, and repeating the same visual grammar back-to-back.
- Keep text concise and readable on mobile. Important claims, numbers and locations should be visually emphasized. Do not invent statistics or imply an asset proves something it does not.
- Respect asset rights and provider terms. Prefer relevant, context-appropriate media; never use an unrelated stock result merely to fill a slot.

4) ASSET AND FAILURE POLICY:
- For type "image", include imageQuery. For type "footage", include footageQuery. Use specific English search phrases, normally 3-8 words.
- Venus Pro's existing asset pipeline downloads selected media to the E2B Studio computer. Never attempt network requests from generated scene code.
- If a download/provider fails, preserve the story beat using a designed custom-code scene or a graphic explanation; do not leave a blank, gradient-only, or placeholder scene. The fallback should be a deliberate visual alternative, not a fake photograph.
- Custom scenes must be real Remotion-ready React/TSX designs. Give each custom scene a unique letters/digits-only id, a precise 1-3 sentence brief, headline and fallbackText.
- For a scene that combines a real image with explanatory graphics, specify the exact overlay treatment in the brief (what is highlighted, where labels go, how each element animates, and when it appears). If direct compositing isn't supported by the current scene renderer, split the treatment into an adjacent custom scene rather than assuming the overlay magically renders.

5) DYNAMIC STORYBOARD:
Choose scene count dynamically from brief, duration, narrative complexity and pacing; never target a fixed count. Typical guidance only (not a hard rule): 10-15s may need 4-7 scenes; 20-30s may need 7-13; 30-45s may need 10-18; 45-60s may need 14-22. Scene count must fit the requested duration and the story. Keep every scene visually distinct and purposeful.
OUTPUT FORMAT:
{"title":"...","concept":"...","palette":{"bg1":"#...","bg2":"#...","accent":"#...","accent2":"#...","text":"#...","muted":"#..."},"fonts":{"display":"...","body":"..."},"scenes":[{"type":"custom","id":"c1","seconds":3.5,"soundCue":"typing","brief":"...","headline":"...","fallbackText":"..."}, ...]}

RULES
- Scene count is adaptive, not fixed. Choose the count that best serves the brief and pacing; keep within the renderer's supported maximum. The sum of scene seconds should be approximately ${o.seconds} plus only the small amount needed for transition overlap, and the final timeline must not exceed ${o.seconds}. Scene durations may be short for fast edits (about 1.5-5 seconds) or longer for complex explanations and emotional moments (up to 8 seconds). Avoid monotonous pacing.
- First scene opens the video, last is "outro" or a closing custom scene.
- Choose each scene type intentionally using the MEDIA CHOICE rules. Use a thoughtful mix of custom code, still images, and real footage when the subject benefits from it; all-custom is valid for abstract/design-led videos, and media-heavy is valid for real-world stories. Never repeat the same composition or motion concept twice in a row.
- SOUND DESIGN PLAN: include a "soundCue" field per scene, chosen from "typing", "soft-click", "whoosh", "impact", "chime", "riser", "none". Use typing/soft-click for UI or text-entry moments, whoosh for meaningful transitions, impact for major reveals, chime for a positive resolution, and none when silence is more effective. Avoid using a loud effect on every scene. Effects will be generated and timed by the renderer; do not request copyrighted audio.
- On-screen text SHORT (headlines max 7 words), English unless the brief asks otherwise.
- NEVER invent statistics, prices or facts. Use numbers only if they are in the brief or you are certain; otherwise use non-numeric scenes.
- ${o.voice ? 'Every scene needs a "narration" (natural spoken English, about 2 words per second of the scene) that agrees with the on-screen text.' : 'Do not add "narration".'}${o.context ? `\n\nWHAT YOU KNOW ABOUT THE USER:${o.context}` : ""}

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
  scene: Record<string, unknown>; palette?: Record<string, string>; fonts?: { display?: string; body?: string };
  aspect: string; frames: number; concept?: string; previousCode?: string; error?: string; critique?: string;
}): string {
  const fix = o.previousCode
    ? `\n\nYOUR PREVIOUS CODE:\n${o.previousCode}\n\n${o.error ? `IT FAILED WITH THIS ERROR:\n${o.error}\nFix the cause.` : ""}${o.critique ? `A REVIEWER / THE USER SAID:\n${o.critique}\nApply this.` : ""}`
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
- Keep "type" unless the instruction asks for a different kind of scene. For this project, preserve "custom" code-generated scenes unless explicitly asked otherwise.
- Library scene types: title, kinetic, bullets, stat, bar-chart, line-chart, quote, split, timeline, ranking, image, footage, outro. Keep their props valid. "camera" may hold up to 3 of: push, pull, pan-left, pan-right, tilt-up, tilt-down, orbit, handheld, crash-zoom, whip.
- If the scene is "custom": update "brief" (what appears and how it moves) and set "regenerateCode": true when the VISUAL design must change; for text-only changes edit "headline" and set false.
- Preserve or update "soundCue" to match the edited scene; allowed values: typing, soft-click, whoosh, impact, chime, riser, none.
- Keep text short. Never invent statistics.`;
}

export function reviewPrompt(tiles: Array<{ tile: number; index: number; type: string; summary: string }>): string {
  const lines = tiles.map((t) => `Tile ${t.tile} (left to right, top to bottom) = scene index ${t.index}, type "${t.type}", text: "${t.summary}"`).join("\n");
  return `You are the quality reviewer of a motion-graphics video. The image is a contact sheet of frames from the middle of each scene.

${lines}

Check each tile for REAL problems only: text cut off or overflowing the frame, text too small to read, overlapping elements, an empty or broken layout, low contrast. Do not nitpick style.

Reply with ONE JSON object only:
{"verdict":"good"|"fix","issues":[{"scene":<scene index>,"problem":"<specific visual problem>","patch":{...}}]}

"patch" may contain ONLY: "fontScale" (0.5-1.2; smaller when text overflows), "transition" (fade|slide|zoom|wipe|blur), and shorter replacements for "headline", "subhead", "text", "label", "caption". For custom scenes leave "patch" empty and describe the problem precisely. If everything looks fine answer {"verdict":"good","issues":[]}.`;
}