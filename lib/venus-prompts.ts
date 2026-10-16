
import { ASPECTS, type Aspect } from "@/lib/venus-schema";

export function directorPrompt(o: {
  brief: string;
  seconds: number;
  aspect: Aspect;
  voice: boolean;
  captions: boolean;
  design: "ai" | "library";
  context?: string;
}): string {
  const a = ASPECTS[o.aspect];

  return `You are the art director of Venus Pro, an AI motion-graphics studio. Turn the brief into a storyboard for a ${o.seconds}-second video (${a.width}x${a.height}, ${o.aspect}). Reply with ONE JSON object only. No prose or markdown fences.

STEP 1 — ART DIRECTION
Invent a visual identity that fits this exact topic. Do not default to blue or purple unless it suits the topic. If the user context contains brand colors, fonts, names or handles, use them.
- concept: one sentence describing the visual identity and motion style.
- palette: hex colors bg1, bg2, accent, accent2, text and muted. Maintain strong contrast.
- fonts: display and body chosen from inter, montserrat, poppins, spacegrotesk, playfair or oswald.

STEP 2 — CODE-ONLY MOTION GRAPHICS (MANDATORY)
Every scene MUST have type "custom". Every scene will be implemented as a separate React/TSX Remotion component by a motion designer.

Never use the built-in library scene types, image scenes, footage scenes, stock photos, stock videos or downloaded visual assets. Do not make a slideshow. Create the visuals with code.

Use:
- React components and inline styles
- SVG paths, circles, diagrams, graphs, masks and vector shapes
- CSS gradients and layered geometric compositions
- Kinetic typography, animated labels and highlighted words
- Data visualizations, timelines, radial meters and isometric constructions
- Particle-like effects and orbital geometry using deterministic seeded randomness
- Frame-driven transitions, staggered entrances, scale, rotation, position and opacity
- Layering and depth that match the subject and aspect ratio

No external visual media is permitted. Voiceover audio may be generated separately if requested; it must not be used as a substitute for visual animation.

Each scene MUST have:
{"type":"custom","id":"c1","seconds":5,"brief":"Describe the exact composition, elements, hierarchy, colors and how each element animates.","headline":"Short readable headline","fallbackText":"Short fallback text if rendering fails"}

Use a different visual concept for every scene. Examples include masked kinetic type, SVG diagrams, particle bursts, animated charts, orbital geometry, isometric blocks, split reveals, ticker systems, radial progress and morph-like transitions. Choose only the techniques that fit the topic; do not use every technique in every video.

Each brief must be specific enough that a coding agent can implement it without inventing the entire composition. Describe what enters first, what moves next, where the headline sits and how the scene resolves.

STEP 3 — STORY STRUCTURE
Create 6 to 12 scenes, with durations adding up to approximately ${o.seconds} seconds and never exceeding the requested duration. Keep each scene between 3 and 9 seconds where possible.
- First scene: a strong visual hook.
- Middle scenes: develop the idea with clear visual progression.
- Final scene: a custom-coded conclusion or call to action.
- Do not repeat the same composition or motion concept in consecutive scenes.
- On-screen headlines should be short, usually no more than 7 words.
- Use the language requested in the brief.
- Never invent facts, statistics, prices or unsupported claims.
- Maintain readable typography and safe margins in the requested aspect ratio.
- Use transitions that connect the story instead of adding random effects.
- Every scene must have a unique letters-and-digits-only ID.
- ${o.voice ? 'Every scene needs natural narration that agrees with its visuals and on-screen text. Aim for about 2 spoken words per second.' : 'Do not add narration.'}
- Captions preference: ${o.captions ? 'reserve space for readable captions and avoid placing key visual information behind them.' : 'do not design extra caption blocks.'}

OUTPUT FORMAT
Return one valid JSON object:
{"title":"...","concept":"...","palette":{"bg1":"#000000","bg2":"#111111","accent":"#ffffff","accent2":"#888888","text":"#ffffff","muted":"#aaaaaa"},"fonts":{"display":"spacegrotesk","body":"inter"},"scenes":[{"type":"custom","id":"c1","seconds":4,"brief":"...","headline":"...","fallbackText":"..." }]}

The example colors above are format examples only; select colors for the actual topic.

USER BRIEF:
${o.brief}
${o.context ? `

USER / BRAND CONTEXT:
${o.context}` : ""}`;
}

const SCENE_API = `You write ONE complete React TSX file that renders a single custom scene in a Remotion video.

HARD RULES
- First line: import React from "react";
- Allowed imports ONLY: "react", "remotion", "../kit", "../theme".
- Default export: export default function Scene({p, T, dur}: any).
- p contains the scene JSON and fields such as p.headline, p.brief and p.fallbackText.
- T contains bg1, bg2, accent, accent2, text, muted, card, line, onAccent, dark, fd and fb. Use T.fd for display headings and T.fb for body text.
- dur is scene duration in frames at 30 fps.
- Available Remotion imports include AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing, random and Sequence.
- Available ../kit helpers: EASE, Frame, Rise, H, fit, grad, useU, clampArr, num and txt.
- useU() returns {u, w, h, portrait}. Size elements using u = min(width,height)/720 to support landscape, portrait and square.
- Animate using useCurrentFrame() and deterministic Remotion APIs only.
- Do not use CSS keyframe animations, setTimeout, Math.random, network calls, external media or external imports.
- Root element must be AbsoluteFill. Keep the root background transparent because the video renderer supplies the background.
- Start the entrance within roughly 16 frames and settle the composition before the final 14 frames.
- Give every prop a fallback, keep content inside the frame and use fit() or maxWidth where appropriate.
- Return a polished composition with layered visuals, staggered motion, depth, deliberate typography and clear visual hierarchy. Never return an empty scene.
- Implement the actual scene brief rather than repeating a generic template.`;

const SCENE_EXAMPLE = `import React from "react";
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing} from "remotion";
import {useU} from "../kit";

export default function Scene({p, T, dur}: any) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {u, w, h} = useU();
  const words = String(p.headline || "Make it move").split(" ");
  const sweep = interpolate(frame, [10, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic)
  });

  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
      <svg width={w} height={h} style={{position: "absolute"}}>
        {[0, 1, 2, 3].map((i) => {
          const r = (140 + i * 70) * u;
          const a = frame * (0.6 + i * 0.25) * (i % 2 ? -1 : 1);

          return (
            <g
              key={i}
              transform={"rotate(" + a + " " + w / 2 + " " + h / 2 + ")"}
              opacity={0.18 + i * 0.1}
            >
              <circle
                cx={w / 2}
                cy={h / 2}
                r={r}
                fill="none"
                stroke={T.accent}
                strokeWidth={2 * u}
                strokeDasharray={12 * u + " " + 18 * u}
              />
              <circle cx={w / 2 + r} cy={h / 2} r={7 * u} fill={T.accent2} />
            </g>
          );
        })}
      </svg>

      <div style={{
        display: "flex",
        gap: 22 * u,
        flexWrap: "wrap",
        justifyContent: "center",
        maxWidth: "80%"
      }}>
        {words.map((word, i) => {
          const s = spring({
            frame: frame - (6 + i * 5),
            fps,
            config: {damping: 14, stiffness: 120}
          });

          return (
            <span
              key={i}
              style={{
                fontFamily: T.fd,
                fontWeight: 800,
                fontSize: 96 * u,
                color: i % 2 ? T.accent : T.text,
                display: "inline-block",
                opacity: s,
                transform: "translateY(" + (1 - s) * 60 * u + "px) rotate(" + (1 - s) * -6 + "deg)"
              }}
            >
              {word}
            </span>
          );
        })}
      </div>

      <div style={{
        position: "absolute",
        bottom: h * 0.28,
        width: 360 * u * sweep,
        height: 8 * u,
        borderRadius: 99,
        background: "linear-gradient(90deg, " + T.accent + ", " + T.accent2 + ")"
      }} />
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
    ? `

YOUR PREVIOUS CODE:
${o.previousCode}
${o.error ? `

RENDER OR COMPILATION ERROR:
${o.error}
Fix the root cause while preserving the scene's intended visual design.` : ""}
${o.critique ? `

REVIEWER OR USER FEEDBACK:
${o.critique}
Apply the requested visual corrections.` : ""}`
    : "";

  return `${SCENE_API}

EXAMPLE OF A VALID SCENE (reference only; do not copy the design):
${SCENE_EXAMPLE}

VIDEO CONTEXT
Concept: ${o.concept ?? ""}
Palette: ${JSON.stringify(o.palette ?? {})}
Fonts: ${JSON.stringify(o.fonts ?? {})}
Aspect ratio: ${o.aspect}
Scene duration: ${o.frames} frames.

SCENE JSON:
${JSON.stringify(o.scene)}

IMPLEMENTATION REQUIREMENTS
- Follow the scene's brief precisely.
- Write the complete scene component, not a plan or explanation.
- Make every important graphic element code-rendered.
- Ensure the composition works at the supplied aspect ratio.
- Use deterministic frame-driven animation.
- Keep all text readable and inside the visible frame.
- Do not add external images, videos, network requests or dependencies.
- If repairing code, fix the underlying error instead of removing the intended design.

Reply with ONLY the complete TSX source inside one \`\`\`tsx code block.${fix}`;
}

export function editPrompt(scene: Record<string, unknown>, instruction: string): string {
  return `You are editing a scene in a code-rendered Remotion motion-graphics video.

CURRENT SCENE JSON:
${JSON.stringify(scene)}

USER INSTRUCTION:
${instruction}

Reply with ONE valid JSON object only:
{"scene": <the complete updated scene JSON>, "regenerateCode": true|false}

Rules:
- Keep the scene type "custom". Do not change it to a library, image or footage scene.
- If the visual composition, layout, animation, colors or graphic elements change, set "regenerateCode": true.
- If only the headline or narration text changes and the existing visual implementation remains correct, set "regenerateCode": false.
- Update the scene brief to describe the new visual result clearly.
- Keep the scene ID unchanged.
- Keep text concise and do not invent statistics or factual claims.
- Never remove the scene's code-rendered motion-graphics approach.`;
}

export function reviewPrompt(
  tiles: Array<{ tile: number; index: number; type: string; summary: string }>
): string {
  const lines = tiles
    .map((t) => `Tile ${t.tile} (left to right, top to bottom) = scene index ${t.index}, type "${t.type}", text: "${t.summary}"`)
    .join("\n");

  return `You are the quality reviewer of a code-rendered Remotion motion-graphics video. The image is a contact sheet of frames from the middle of each scene.

${lines}

Inspect each tile for real problems:
- Text is clipped, too small or unreadable.
- Elements overlap or leave the safe area.
- The scene is empty, broken or visually unfinished.
- Contrast is poor.
- The motion-graphics composition does not communicate the scene brief.
- Several scenes look like duplicates rather than distinct visual ideas.

Do not nitpick stylistic preferences. Do not request stock footage or external images.

Reply with ONE JSON object only:
{"verdict":"good"|"fix","issues":[{"scene":<scene index>,"problem":"<specific visual problem>","patch":{...}}]}

The patch may contain only:
- fontScale: a number from 0.5 to 1.2.
- transition: fade, slide, zoom, wipe or blur.
- Shorter replacements for headline, subhead, text, label or caption.

For custom scenes, leave patch empty and describe the problem precisely so the scene code can be regenerated. If everything is acceptable, return {"verdict":"good","issues":[]}.`;
}
