import { sceneLayout, type Storyboard } from "@/lib/venus-schema";

/** The timeline the audio code works against (seconds). Built from the CURRENT storyboard, so edits are respected. */
export function timelineOf(sb: Storyboard) {
  const L = sceneLayout(sb);
  return sb.scenes.map((s, i) => ({
    i,
    start: Math.round((L[i].from / 30) * 100) / 100,
    dur: Math.round((L[i].dur / 30) * 100) / 100,
    type: String(s.type),
    headline: String(s.headline ?? s.text ?? s.label ?? s.title ?? "").slice(0, 60),
    soundCue: typeof s.soundCue === "string" ? s.soundCue : "",
    sounds: Array.isArray(s.sounds) ? s.sounds : [],
  }));
}

export function extractAudioCode(text: string): string {
  const m = /```(?:js|javascript)?\s*\n([\s\S]*?)```/.exec(text);
  return (m ? m[1] : text).trim();
}

/** Returns an error message, or null when the code is acceptable. */
export function checkAudioCode(code: string): string | null {
  if (!code || code.length < 80) return "The audio code is empty.";
  if (code.length > 14000) return "The audio code is too long.";
  if (!/function\s+compose\s*\(/.test(code)) return "Missing function compose(A).";
  const bad = /\b(require|process|eval|Function|globalThis|constructor|__proto__|child_process|fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval)\b|\bimport\s|Math\.random/.exec(code);
  if (bad) return "Forbidden usage: " + bad[0].trim();
  return null;
}

const API = `CONTRACT
- Define exactly one function: function compose(A) { ... }. No imports, no require, no async, no timers, no Math.random (use A.rand()). Reply with ONE js code block and nothing else.
- A.put(timeSeconds, sound, gain, pan) places a sound on the timeline (gain about 0.05-1, pan -1..1).
- A.tone(freq, dur, opts) -> sound. opts: type "sine"|"saw"|"tri"|"square", a (attack seconds), tc (decay time constant), sus:true (sustained pad, uses a=attack and rel=release), f2 + sweep (pitch glide to f2 over "sweep" seconds), fc (+ fc2) low-pass cutoff in Hz (optionally sweeping to fc2). dur max 16s.
- A.noise(dur, f1, f2, q, envFn) -> band-passed noise sweeping f1->f2 Hz (20-7000). envFn(t) with t 0..1 returns amplitude. q 0.2-1.2 (lower = more resonant).
- A.layer([{d: sound, at: seconds, g: gain}, ...]) -> one sound (use it to build custom sounds from several parts).
- A.drum("kick"|"snare"|"hat"|"clap") -> ready drum hit. A.sfx(name) -> ready effect: whoosh, impact, chime, pop, tick, click, riser, swell, typing (use A.sfx(name, durationSeconds) for riser, whoosh, typing, swell).
- A.hz(midiNote) -> frequency. A.rand() -> seeded random 0..1. A.clamp(v, a, b).
- A.fx.reverb(0..1) and A.fx.echo(delaySeconds, feedback 0..0.6): applied once to the whole mix.
- Read only: A.seconds (video length), A.mood, A.bpm (0 = you decide), A.scenes = [{i, start, dur, type, headline, soundCue, sounds:[{at, kind}]}] in seconds.
- Budget: at most ~700 tone/noise calls, nothing longer than 16s. The system normalizes the loudness and fades the ending, so do not worry about clipping.`;

type Info = { brief: string; concept?: string; mood: string; bpm: number; seconds: number; scenes: unknown[]; constraints?: string };

const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MODE_NAMES = ["major (ionian)", "dorian", "phrygian", "lydian", "mixolydian", "natural minor (aeolian)", "harmonic minor", "minor pentatonic", "major pentatonic"];
const LEADS = ["glassy bell arpeggio", "plucked triangle stabs", "soft detuned saw pad with slow filter sweep", "muted square-wave pulses", "airy sine melody with echo", "marimba-like decaying tones (fast tc, sine+tri)", "wide stereo saw chords played as a slow swell"];
const BASSES = ["sub sine drones", "syncopated offbeat saw bass", "walking triangle bass", "none (pads and percussion only)", "pulsing eighth-note bass", "slow octave jumps"];
const GROOVES = ["no drums, only soft pulses and a riser", "half-time kick and snare with light hats", "broken-beat kick pattern with a clap", "four-on-the-floor only in the last third", "skipping kick, ghost hats, no snare", "minimal clicks and ticks as rhythm"];
const FORMS = ["slow build that blooms in the last scenes", "start busy, strip back to a pad in the middle, end with a lift", "two-part structure with a sudden change at the midpoint", "steady pulse with the harmony changing at every scene cut", "sparse and spacious, one big swell near the end"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** Random creative constraints (different on every call) so two videos never get the same music or the same cue style. */
export function randomConstraints(part: "music" | "sfx"): string {
  if (part === "sfx") {
    return `- Sonic palette for this video: ${pick(["glassy and digital", "warm and analog", "percussive and woody", "airy and soft", "punchy and cinematic", "playful and bubbly"])}. Pitch centre: ${pick(KEY_NAMES)}. Do not use the plain presets for every cue; design at least 3 sounds yourself with A.tone, A.noise and A.layer.`;
  }
  return `- Key centre: ${pick(KEY_NAMES)}; scale: ${pick(MODE_NAMES)}.
- Main voice: ${pick(LEADS)}. Bass: ${pick(BASSES)}. Rhythm: ${pick(GROOVES)}.
- Form: ${pick(FORMS)}.
- Tempo: pick any tempo that fits the mood within its natural range (do not default to 110). Progression: invent your own 3 to 5 chords, never the stock i-VI-III-VII loop.
- Seed for your own choices: ${Math.floor(Math.random() * 100000)}.`;
}

export function audioCodePrompt(part: "music" | "sfx", o: Info): string {
  const ctx = `CREATIVE CONSTRAINTS (follow them, they exist so that every video gets different audio):\n${o.constraints ?? randomConstraints(part)}\n\nVIDEO: "${o.brief.slice(0, 400)}"\nLOOK AND FEEL: ${o.concept ?? ""}\nMOOD: ${o.mood}${o.bpm ? `, tempo ${o.bpm} bpm` : ""}\nLENGTH: ${o.seconds}s\nSCENES (the real timeline): ${JSON.stringify(o.scenes).slice(0, 3500)}`;
  if (part === "music") {
    return `You are the composer of "Venus Pro", an AI motion-graphics studio. Write the BACKGROUND MUSIC of the video below as JavaScript code that synthesizes real audio. No samples, no vocals.

${API}

COMPOSITION RULES
- Write a real arrangement, not a loop: a sparse intro (pad only), bass and arpeggio enter, drums build, a lift when the LAST scenes start (use A.scenes[k].start to place the builds and the lift), then a resolved ending chord that rings until about A.seconds - 1.5.
- Follow the key, scale, voices, rhythm and form from the CREATIVE CONSTRAINTS below; the mood only guides the energy. Use a beat grid from the tempo. Make a riser into the main lift when the form calls for one.
- Use stereo: detuned pairs panned left and right, arpeggio ping-pong, a little echo and reverb.
- Voices stay quiet (pads about 0.05 each, bass about 0.2, arp about 0.05, drums up to 0.4) so a voice-over fits on top. Avoid constant busy 16th hats and avoid harsh high notes.

EXAMPLE THAT ONLY SHOWS THE API (never reuse its key, scale, progression, instruments, rhythm or structure; the result must sound completely different):
\`\`\`js
function compose(A) {
  const bpm = A.bpm || 110, beat = 60 / bpm, bar = beat * 4;
  const minor = [0, 2, 3, 5, 7, 8, 10], root = 45, prog = [0, 5, 2, 6];
  const note = (d) => root + minor[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const lift = A.scenes.length > 1 ? A.scenes[A.scenes.length - 2].start : A.seconds * 0.7;
  for (let b = 0; b * bar < A.seconds; b++) {
    const t = b * bar, d = prog[b % 4];
    [0, 2, 4].forEach((k) => [-1, 1].forEach((s) => A.put(t, A.tone(A.hz(note(d + k) + 12) * (1 + s * 0.004), bar + 0.3, {type: "saw", fc: 1800, a: bar * 0.35, rel: bar * 0.4, sus: true}), 0.05, s * 0.5)));
    A.put(t, A.tone(A.hz(note(d)), bar + 0.2, {a: 0.2, rel: 0.5, sus: true}), 0.16, 0);
    if (b >= 1) for (let i = 0; i < 8; i++) A.put(t + i * beat / 2, A.tone(A.hz(note(d + [0, 2, 4, 2][i % 4]) + 24), beat, {type: "saw", fc: 3500, fc2: 600, tc: 0.15}), 0.05, i % 2 ? 0.4 : -0.4);
    if (t >= lift) for (let i = 0; i < 4; i++) A.put(t + i * beat, A.drum("kick"), 0.4, 0);
  }
  A.fx.reverb(0.5); A.fx.echo(beat * 0.75, 0.35);
}
\`\`\`

${ctx}`;
  }
  return `You are the sound designer of "Venus Pro", an AI motion-graphics studio. Write the SOUND EFFECTS of the video below as JavaScript code that synthesizes real audio.

${API}

SOUND DESIGN RULES
- The scenes carry the director's plan: soundCue (one effect at the scene start) and sounds ([{at, kind}] seconds after the scene start). Follow it exactly, using A.scenes at run time (never hard-code times), because the timeline can change.
- Transitions: put whoosh/riser slightly BEFORE the next scene start (start - 0.12). Opening scene: a strong hit near 0.2s. Last scene: a satisfying resolution (chime or a custom layered hit).
- Add your own design where it adds meaning: a signature logo hit built with A.layer, UI blips, a boot-up arpeggio, data ticks. Never put a sound on every beat, leave silence. Vary gain (0.4-1.0) and pan, about 60 sounds at most.
- You may design new sounds with A.tone, A.noise and A.layer instead of A.sfx.

EXAMPLE THAT ONLY SHOWS THE API (design your own sounds; do not copy these choices):
\`\`\`js
function compose(A) {
  A.scenes.forEach((s, i) => {
    const cue = s.soundCue || (i === 0 ? "impact" : "whoosh");
    if (cue !== "none") A.put(i === 0 ? 0.2 : Math.max(0, s.start - 0.12), A.sfx(cue), 0.9, i % 2 ? 0.3 : -0.3);
    (s.sounds || []).forEach((x) => A.put(s.start + x.at, A.sfx(x.kind), 0.7, 0));
  });
  const last = A.scenes[A.scenes.length - 1];
  if (last) A.put(last.start + 0.3, A.layer([{d: A.tone(A.hz(84), 1.2, {tc: 0.5}), at: 0, g: 0.5}, {d: A.tone(A.hz(91), 1.2, {tc: 0.5}), at: 0.08, g: 0.4}]), 0.8, 0);
}
\`\`\`

${ctx}`;
}
