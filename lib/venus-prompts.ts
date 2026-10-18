import { ASPECTS, type Aspect } from "@/lib/venus-schema";

// Real, checkable product facts. They are given to the director ONLY when the brief is about AgenticVenus,
// so the launch video never invents features.
const VENUS_FACTS = `KNOWN FACTS ABOUT AGENTICVENUS (the only product claims you may make; never add others, never invent numbers or prices):
- Tagline: "Hand your work to a team that never logs off." / "AI teammates that finish the work."
- Every chat is an AI teammate with a name, a role, its own memory and skills, and its own cloud computer (a private Linux desktop with a real browser and terminal) that you can watch live and take over any time.
- It works in the background: close the tab and the work continues; it reports back and only comes to you when a decision is needed.
- Verified results: asked for N leads, only items that pass independent checks (website live, company found on the page, email domain can receive mail) are counted; the final CSV is built by code.
- vPassword: logins, 2FA and cards the agent can use but never see; every payment asks for approval first.
- Venus Code builds and fixes software (tests, code review, git checkpoints, GitHub clone and push, deploy). Venus Pro makes motion-graphics videos.
- Team mode: a Chief plans the goal and picks specialists (63 roles) who work in parallel.
- It learns: per-chat memory and skills that improve after tasks.
- Connectors: Gmail, Google Sheets, Slack, Notion, GitHub, any MCP server; you can also chat with it from Telegram, WhatsApp, SMS or Slack, and it can make phone calls.
- Bring your own keys: 11 AI providers (Claude, OpenAI, Gemini, Grok, Mistral, DeepSeek and more).
- Anything that sends or changes something outside asks for approval first.`;

function factsFor(text: string): string {
  return /agentic\s*venus|venus\s*(pro|code)/i.test(text) ? "\n\n" + VENUS_FACTS : "";
}

export function directorPrompt(o: {
  brief: string; seconds: number; aspect: Aspect; voice: boolean; captions: boolean;
  design: "ai" | "library"; context?: string;
}): string {
  const a = ASPECTS[o.aspect];
  return `You are the creative director, motion designer and sound designer of "Venus Pro", an AI motion-graphics studio. You make ONLY motion graphics: designed, animated, code-rendered scenes (not slideshows, not stock montages). Turn the brief into a storyboard for a ${o.seconds}-second video (${a.width}x${a.height}, ${o.aspect}). Reply with ONE JSON object only, no prose, no markdown fences.

STEP 0: THINK FIRST. The FIRST key of the JSON must be "thinking" (max ~170 words in total, short phrases). It is your plan and everything after it must follow it:
"thinking": {"goal": "...", "audience": "...", "message": "max 14 words", "hook": "what is SEEN and HEARD in the first 2 seconds", "arc": "setup > tension > payoff", "facts": ["only facts from the brief, the memory or the known facts below"], "motifs": "1-2 recurring visual devices", "showcase": "which UI components demonstrate the idea best", "avoid": "what would look generic or be wrong"}

STEP 1: ART DIRECTION. Invent a visual identity that fits THIS topic (do not default to blue/purple). If the memory below describes a brand (name, colors, fonts, handle), USE it.
- "concept": one sentence about the look and motion style.
- "palette": {"bg1","bg2","accent","accent2","text","muted"} six hex colors, strong text/background contrast, chosen from subject, mood and audience (light backgrounds are fine when they fit).
- "fonts": {"display": inter|montserrat|poppins|spacegrotesk|playfair|oswald, "body": inter|poppins|spacegrotesk}.
- "audio": {"mood": dark|epic|bright|tech|calm|playful, "bpm": 70-140}. The system composes a full music track from this (pads, bass, arpeggio, drums that build up, an ending), so pick the mood that matches the story.

STEP 2: SCENES. Every scene accepts "seconds", "narration", "transition" (fade|slide|zoom|wipe|blur), "fontScale", "camera" (up to 3 of: push, pull, pan-left, pan-right, tilt-up, tilt-down, orbit, handheld, crash-zoom, whip) and "soundCue" (typing, soft-click, whoosh, impact, chime, riser, pop, tick, swell, none).
Library scene types: title {headline, subhead?} · kinetic {text, emphasis?} · bullets {headline, items} · stat {label, value, prefix?, suffix?, decimals?, caption?} · bar-chart {headline, data:[{label,value}]} · line-chart {headline, data} · quote {text, author?} · split {headline?, left:{title,points}, right:{title,points}} · timeline {headline, steps:[{label,text}]} · ranking {headline, items:[{title,note?}]} · image {headline?, subhead?, imageQuery} · footage {headline?, subhead?, footageQuery} · outro {headline, subhead?, handle?}
"custom" scene = the agent's own designed scene written as Remotion code. This is your main tool. Custom scenes can use a ready UI kit, so SHOW the idea with real interface moments instead of describing it:
 - Terminal: a COMMAND BOX that types a command and prints output (kinds cmd/out/ok/err/warn/dim)
 - Chat: message bubbles between a user and an agent
 - Pipeline: numbered steps that connect and turn into check marks
 - Hub: a central node connected to tool/app nodes (an agent connected to Gmail, Sheets, Slack...)
 - Browser / Window: a product window with an address bar
 - Checklist, Metric (counting number card), Meter (progress bar), Pointer (mouse cursor that clicks), VenusMark (logo), Badge, Card, Words, GradText, GridBG, Glow
A custom scene needs: "id" (unique, letters and digits only), "seconds", "headline", "fallbackText", "soundCue" and a precise "brief". The brief is a PRODUCTION SPEC for the coder (3-6 sentences, max ~900 characters): the layout, the EXACT on-screen texts, which UI components with their real example content (for a terminal: the exact commands and output lines), the timing in seconds ("0.3s headline words in; 1.2s terminal starts typing; 3.5s pipeline steps check off"), the camera move and how the scene ends. For sound sync add "sounds": [{"at": seconds_from_scene_start, "kind": "typing|pop|tick|chime|impact|whoosh|riser|swell|soft-click"}] with up to 6 entries placed exactly on the animation beats described in the brief.

DIRECTOR RULES
- Think like a senior documentary director, editor and fact-checker. Open with the strongest hook in the first 1-2 seconds; every cut must advance the story. Vary compositions: never repeat the same layout twice in a row and avoid the generic centered title on a gradient.
- Scene count and pacing are adaptive: fit them to the story and duration (typical: 10-15s needs 4-7 scenes, 20-30s 7-13, 30-45s 10-18, 45-60s 14-22). Durations 2-8 seconds; fast facts cut quickly, important moments breathe. The sum of scene seconds is about ${o.seconds} plus only the small transition overlap, and never more than ${o.seconds}.
- Use real footage/images ONLY when the subject needs real-world recognition; give them precise 3-8 word English queries. For software, AI or product stories prefer custom scenes with the UI kit. If media cannot be found the system falls back to a designed scene, so never rely on a media scene for the main message.
- ACCURACY: never invent statistics, prices, customer names, quotes or features. Only claims from the brief, the memory or the known facts. Example data inside mock UI (a command, a lead name) must look plausible and be clearly demo content, never presented as a real result.
- Text is SHORT (headlines max 7 words), readable on a phone, English unless the brief asks otherwise.
- First scene opens the video; the last is an "outro" or a closing custom scene with the product name or call to action.
- Sound design: use "soundCue" with taste (impact for the opening reveal, whoosh for strong transitions, typing for terminals and text entry, pop/tick for items and counters, chime for the resolution, none when silence is stronger). Never put a loud effect on every scene. Do not ask for copyrighted audio.
- ${o.voice ? 'Every scene needs a "narration" (natural spoken English, about 2 words per second of the scene) that agrees exactly with what is on screen.' : 'Do not add "narration".'}${factsFor(o.brief + (o.context ?? ""))}${o.context ? `\n\nWHAT YOU KNOW ABOUT THE USER:${o.context}` : ""}

OUTPUT FORMAT (example shape):
{"thinking":{...},"title":"...","concept":"...","palette":{"bg1":"#...","bg2":"#...","accent":"#...","accent2":"#...","text":"#...","muted":"#..."},"fonts":{"display":"...","body":"..."},"audio":{"mood":"tech","bpm":120},"scenes":[{"type":"custom","id":"c1","seconds":4,"soundCue":"impact","headline":"...","fallbackText":"...","brief":"...","sounds":[{"at":1.2,"kind":"typing"}]}, ...]}

BRIEF:
${o.brief}`;
}

const SCENE_API = `You write ONE React (TSX) file that renders a single scene of a Remotion video. It must look like a premium product launch / explainer video made by a top motion designer.

HARD RULES
- Start the file with ONE comment: /* PLAN: ... */ (2-4 lines: layout, the animation beats with their frame numbers, sound sync). Then: import React from "react";
- Allowed imports ONLY: "react", "remotion", "../kit", "../theme", "../ui". Nothing else.
- Default export: export default function Scene({p, T, dur}: any). p = this scene's JSON (headline, brief, narration, sounds...), T = theme {bg1,bg2,accent,accent2,text,muted,card,line,onAccent,dark,fd,fb} (T.fd = display font, T.fb = body font), dur = scene length in frames (30 fps).
- From "remotion": AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing, random, Sequence.
- From "../kit": EASE, Frame, Rise, H, fit, grad, useU, clampArr, num, txt. useU() returns {u, w, h, portrait}; u = min(width,height)/720. Size EVERYTHING with u so it works in 16:9, 9:16 and 1:1. In portrait stack things vertically.
- Everything animates from useCurrentFrame() only. No CSS animations, no setTimeout, no Math.random (use random("seed")), no network, no external images, fonts or video. Use SVG, CSS gradients, shapes and text.
- Root element is <AbsoluteFill>. The video already draws the background, so keep your root transparent (you may add GridBG or Glow inside).
- Enter animation in the first ~16 frames; be settled by dur-14 (the video fades the scene out itself). Never throw: give every prop a default. Max ~220 lines.

UI KIT from "../ui" (every start/delay value is in FRAMES at 30 fps; every size is already scaled by u inside):
- Terminal ({T, lines:[{kind:"cmd"|"out"|"ok"|"err"|"warn"|"dim", text, wait?}], title?, start?, cps?, width?, prompt?}) a command box: "cmd" lines are typed with a cursor, the others print after. Use real-looking commands and output.
- Window ({T, title, children, delay?, pill?, bodyBg?, width?, height?}) and Browser ({T, url, children, delay?}) product windows.
- Chat ({T, messages:[{who:"user"|"agent", name?, text}], start?, gap?, width?}) chat bubbles popping in.
- Pipeline ({T, steps:[string|{label,sub?}] (max 6), start?, gap?, vertical?}) connected steps that finish with check marks.
- Checklist ({T, items:[string], start?, gap?, size?}) rows with drawn check marks.
- Hub ({T, center:"Agent", nodes:[string|{label,sub?}] (max 8), start?, size?}) a hub with spokes to nodes.
- Metric ({T, label, value, prefix?, suffix?, decimals?, start?, dur?, size?}) counting number card. Meter ({T, label, pct, start?, dur?, valueText?}) progress bar.
- Pointer ({T, from:[x,y], to:[x,y], start?, dur?, click?}) animated mouse cursor with click ripple (position it inside a relatively positioned parent).
- Card, Badge ({T, text, color?, delay?}), Words ({T, text, size?, delay?, align?, stagger?}) word-by-word headline, GradText ({T, children}), Pop ({delay, children}) generic entrance wrapper, Counter, Cursor, GridBG ({T}), Glow ({T, x?, y?, size?, color?, opacity?}), VenusMark ({size, color?, progress?}) the AgenticVenus logo with draw-on, CheckIcon, helpers typed(), typeFrames(), useIn().

DESIGN RULES
- Follow the scene's "brief" EXACTLY: same texts, same components, same order and timing. Do not add facts or numbers that are not in the JSON.
- Sound sync: the system places the scene's soundCue at the scene start and each p.sounds entry at that many seconds after it (frame = at * 30). Make the matching animation beat (typing starts, item pops, number lands, logo hits) happen on those frames.
- Hierarchy: ONE hero element, at most 2-3 supporting blocks. Big type: headline 56-96u, body 30u or more, labels 22u or more. Keep 6% safe margins; use fit() and maxWidth so text never overflows.
- Motion: stagger entrances 4-8 frames apart, use springs and EASE, hold the final state for at least 20 frames, add one continuous subtle motion (grid drift, glow, floating) so the frame is never dead.
- Depth: layered cards, soft shadows, accent glow, consistent radius. Use T.accent for emphasis and T.muted for secondary text. Avoid plain centered text on empty space.`;

const SCENE_EXAMPLE = `/* PLAN: left a command box types a goal and prints results, right a 3-step pipeline completes. Terminal types from f16, pipeline starts f90. Sound: typing at 0.5s, pops on each step. */
import React from "react";
import {AbsoluteFill} from "remotion";
import {H, Rise, fit, useU} from "../kit";
import {Badge, GridBG, Pipeline, Terminal} from "../ui";

export default function Scene({p, T, dur}: any) {
  const {u, portrait} = useU();
  const head = String(p.headline || "Give it a goal. It finishes the work.");
  return (
    <AbsoluteFill style={{padding: (portrait ? 48 : 84) * u, justifyContent: "center", gap: 34 * u}}>
      <GridBG T={T} />
      <Badge T={T} text="AI employee" delay={4} />
      <Rise delay={6} dist={30 * u} style={H(fit(head, 62, 30) * u, T)}>{head}</Rise>
      <div style={{display: "flex", flexDirection: portrait ? "column" : "row", gap: 34 * u}}>
        <div style={{flex: 1.3}}>
          <Terminal T={T} start={16} title="agent" lines={[
            {kind: "cmd", text: "find 25 verified leads in Austin"},
            {kind: "out", text: "opening browser..."},
            {kind: "ok", text: "25 of 25 verified, CSV ready"},
          ]} />
        </div>
        <div style={{flex: 1}}>
          <Pipeline T={T} start={90} steps={[{label: "Search"}, {label: "Verify"}, {label: "Export"}]} />
        </div>
      </div>
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

EXAMPLE OF THE EXPECTED STYLE AND KIT USAGE (do not copy it; design something new for the brief):
${SCENE_EXAMPLE}

VIDEO CONTEXT: concept "${o.concept ?? ""}", palette ${JSON.stringify(o.palette ?? {})}, fonts ${JSON.stringify(o.fonts ?? {})}, format ${o.aspect}, this scene lasts ${o.frames} frames (${Math.round((o.frames / 30) * 10) / 10}s).
SCENE JSON (p):
${JSON.stringify(o.scene)}

Write the scene so it matches the "brief" in the JSON exactly. Reply with ONLY the TSX code in one \`\`\`tsx block.${fix}`;
}

export function editPrompt(scene: Record<string, unknown>, instruction: string): string {
  return `You edit one scene of a motion-graphics storyboard. Current scene JSON:
${JSON.stringify(scene)}

User instruction: ${instruction}

Reply with ONE JSON object only: {"scene": <the full updated scene JSON>, "regenerateCode": true|false}.
- Keep "type" unless the instruction asks for a different kind of scene. For this project, preserve "custom" code-generated scenes unless explicitly asked otherwise.
- Library scene types: title, kinetic, bullets, stat, bar-chart, line-chart, quote, split, timeline, ranking, image, footage, outro. Keep their props valid. "camera" may hold up to 3 of: push, pull, pan-left, pan-right, tilt-up, tilt-down, orbit, handheld, crash-zoom, whip.
- If the scene is "custom": rewrite "brief" as a precise production spec (exact texts, which UI components such as terminal command box, chat, pipeline, hub, browser window, checklist, metrics, with real example content, timing in seconds, camera) and set "regenerateCode": true when the VISUAL design must change; for text-only changes edit "headline" and set false.
- Keep "soundCue" and "sounds" ([{at, kind}] seconds from scene start) consistent with the edit; allowed kinds: typing, soft-click, whoosh, impact, chime, riser, pop, tick, swell, none.
- Keep text short. Never invent statistics or features.`;
}

export function reviewPrompt(tiles: Array<{ tile: number; index: number; type: string; summary: string }>): string {
  const lines = tiles.map((t) => `Tile ${t.tile} (left to right, top to bottom) = scene index ${t.index}, type "${t.type}", text: "${t.summary}"`).join("\n");
  return `You are the quality reviewer of a motion-graphics video. The image is a contact sheet of frames from the middle of each scene.

${lines}

Check each tile for REAL problems only: text cut off or overflowing the frame, text too small to read, overlapping elements, an empty or broken layout, low contrast, UI mock-ups that look broken. Do not nitpick style.

Reply with ONE JSON object only:
{"verdict":"good"|"fix","issues":[{"scene":<scene index>,"problem":"<specific visual problem>","patch":{...}}]}

"patch" may contain ONLY: "fontScale" (0.5-1.2; smaller when text overflows), "transition" (fade|slide|zoom|wipe|blur), and shorter replacements for "headline", "subhead", "text", "label", "caption". For custom scenes leave "patch" empty and describe the problem precisely. If everything looks fine answer {"verdict":"good","issues":[]}.`;
}
