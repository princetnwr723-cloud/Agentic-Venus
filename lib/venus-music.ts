// Venus Pro music engine, version 3. Built on top of the existing synth script (SYNTH_V2_SOURCE): the old fixed-mood composer is renamed
// and a generative composer takes its place. A mood is only a bias; key, mode, chords, tempo, instruments, groove and structure come from
// the seed, so every video gets different music. The same script also renders the sound effects (seed per project).
// NOTE: the composer lives in a template string: no backticks, no dollar-brace sequences.
import { SYNTH_V2_SOURCE } from "@/lib/venus-audio";

const COMPOSER_V3 = String.raw`// A mood is only a BIAS: ranges and families to pick from. Every track is composed fresh from the seed
// (key, mode, progression, tempo, instruments, groove, structure), so two videos never share the same music.
const MOODS3 = {
  dark:    {bpm: [78, 106],  modes: ["aeolian", "phrygian", "harmonic", "dorian"],       drive: [0, 2], arp: [2, 3, 4], bright: [1200, 2400]},
  epic:    {bpm: [92, 126],  modes: ["aeolian", "dorian", "lydian", "harmonic"],         drive: [1, 2], arp: [2, 3, 4], bright: [2000, 3200]},
  bright:  {bpm: [104, 134], modes: ["ionian", "lydian", "mixolydian", "pentatonic"],   drive: [1, 2], arp: [2, 3, 4], bright: [2600, 4200]},
  tech:    {bpm: [108, 138], modes: ["dorian", "aeolian", "phrygian", "mixolydian"],    drive: [1, 2], arp: [3, 4],    bright: [2000, 3600]},
  calm:    {bpm: [64, 92],   modes: ["ionian", "lydian", "pentatonic", "dorian"],       drive: [0, 1], arp: [2, 3],    bright: [1200, 2400]},
  playful: {bpm: [98, 130],  modes: ["mixolydian", "ionian", "pentatonic", "lydian"],   drive: [1, 2], arp: [2, 3, 4], bright: [2800, 4400]},
};
const MODES3 = {
  ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], pentatonic: [0, 2, 4, 7, 9],
};
const NEXT7_3 = {0: [3, 4, 5, 2, 6], 1: [4, 6, 0], 2: [5, 3, 0], 3: [4, 0, 1, 5], 4: [0, 5, 2], 5: [3, 1, 4, 0], 6: [0, 2]};
const ARP3 = [
  [0, 1, 2, 3, 2, 1, 2, 1], [0, 2, 1, 3, 2, 3, 1, 2], [3, 2, 1, 0, 1, 2, 3, 2], [0, 0, 1, 2, 0, 0, 3, 2],
  [0, 1, 2, 1, 0, 1, 2, 3], [0, 3, 1, 2, 3, 1, 2, 0], [2, 1, 0, 1, 2, 3, 2, 1], [0, 2, 3, 2, 0, 2, 1, 3],
];
// 16-step grooves: x = hit, o = soft hit
const GROOVES3 = {
  four:   {kick: "x...x...x...x...", snare: "....o.......o...", hat: "..x...x...x...x.", min: 2},
  half:   {kick: "x.......x.o.....", snare: "........x.......", hat: "x.x.x.x.x.x.x.x.", min: 1},
  broken: {kick: "x.....x...x.....", snare: "....x.......x..o", hat: "x.x.x.xox.x.x.xo", min: 1},
  trap:   {kick: "x.......x..x....", snare: "........x.......", hat: "xxoxxxoxxoxxxxox", min: 2},
  skip:   {kick: "x..x..x...x..x..", snare: "....x.......x...", hat: "..x...x...x...x.", min: 1},
  light:  {kick: "x.......x.......", snare: "................", hat: "o.o.o.o.o.o.o.o.", min: 0},
};

function pickOf(r, list) { return list[Math.floor(r() * list.length) % list.length]; }
function between(r, a, b) { return a + r() * (b - a); }

function runMusic(inp, outPath) {
  const secs = clampN(Number(inp.seconds) || 30, 6, 90);
  const r = rng((Number(inp.seed) || 7) * 2654435761);
  for (let w = 0; w < 4; w++) r();
  const moodName = MOODS3[inp.mood] ? inp.mood : pickOf(r, Object.keys(MOODS3));
  const M = MOODS3[moodName];

  // ---- the identity of THIS track ----
  const modeName = pickOf(r, M.modes);
  const scale = MODES3[modeName];
  const sl = scale.length;
  const deg = (d) => scale[((d % sl) + sl) % sl] + 12 * Math.floor(d / sl);
  const root = 38 + Math.floor(r() * 12);
  const bpm = clampN(Number(inp.bpm) > 0 ? Number(inp.bpm) : Math.round(between(r, M.bpm[0], M.bpm[1])), 60, 150);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const bars = Math.max(3, Math.ceil(secs / bar));
  const lastBar = bars - 1;
  const swing = r() < 0.4 ? between(r, 0.04, 0.16) : 0;
  const drive = pickOf(r, M.drive);
  const bright = between(r, M.bright[0], M.bright[1]);

  // chord progression: a random walk with functional bias (not a fixed loop)
  const progLen = pickOf(r, [4, 4, 4, 3, 2]);
  const prog = [pickOf(r, [0, 0, 0, 5 % sl, 3 % sl])];
  for (let i = 1; i < progLen; i++) {
    const prev = prog[i - 1];
    const opts = sl === 7 ? NEXT7_3[prev] : [0, 1, 2, 3, 4].filter((x) => x !== prev);
    prog.push(pickOf(r, opts));
  }
  const slow = r() < 0.3;                       // one chord per two bars
  const extra = pickOf(r, [null, null, 6, 1]);  // 7th or 9th colour
  const padType = pickOf(r, ["saw", "saw", "tri", "square", "sine"]);
  const detune = between(r, 0.002, 0.009);
  const padAtk = between(r, 0.2, 0.55);
  const bassStyle = drive === 0 ? pickOf(r, ["sub", "sub", "none"]) : pickOf(r, ["sub", "pluck8", "offbeat", "walk", "pluck8"]);
  const arpDensity = pickOf(r, M.arp);
  const arpPat = pickOf(r, ARP3);
  const arpTimbre = pickOf(r, ["saw", "pluck", "bell", "pluck", "square"]);
  const arpOct = pickOf(r, [24, 24, 12, 36]);
  const arpGain = between(r, 0.035, 0.07);
  const leadOn = r() < 0.65;
  const leadType = pickOf(r, ["sine", "tri", "saw"]);
  const grooveName = drive === 0 ? pickOf(r, ["light", "none"]) : drive === 1 ? pickOf(r, ["half", "light", "broken", "skip"]) : pickOf(r, ["four", "half", "broken", "trap", "skip"]);
  const groove = GROOVES3[grooveName] || null;
  const introBars = pickOf(r, [1, 2, 2, 3]);
  const drumBar = introBars + pickOf(r, [1, 1, 2]);
  const leadBar = drumBar + pickOf(r, [0, 1, 2]);
  const breakBar = bars > 7 && r() < 0.55 ? Math.floor(bars * between(r, 0.45, 0.62)) : -1;

  const main = buf(secs + 4);
  const arp = buf(secs + 4);
  const lead = buf(secs + 4);
  const kit = drumKit(r);
  // a short motif that is varied every two bars
  const motif = [];
  let md = pickOf(r, [2, 4, 7]);
  const rhythm = pickOf(r, [[2, 1, 1, 2, 2], [1, 1, 2, 1, 1, 2], [3, 1, 2, 2], [2, 2, 2, 2], [1, 2, 1, 2, 2]]);
  rhythm.forEach((len) => { md = clampN(md + pickOf(r, [-2, -1, -1, 0, 1, 1, 2]), 0, 11); motif.push({d: md, len: len}); });

  for (let bi = 0; bi < bars; bi++) {
    const t0 = bi * bar;
    const chordIdx = (slow ? Math.floor(bi / 2) : bi) % prog.length;
    const d0 = prog[chordIdx];
    const last = bi === lastBar;
    const inBreak = bi === breakBar;
    const chord = [deg(d0), deg(d0 + 2), deg(d0 + 4)];
    if (extra !== null) chord.push(deg(d0 + extra));
    const rootN = root + deg(d0);
    const len = last ? bar * 2.4 : bar + 0.3;
    const fcNow = bright * (0.55 + 0.7 * (bi / Math.max(1, bars)));

    chord.forEach((c, ci) => {
      [-1, 1].forEach((sd) => {
        put(main, t0, tone(hz(root + 12 + c) * (1 + sd * detune), len, {type: padType, fc: padType === "sine" ? undefined : fcNow, a: bar * padAtk, rel: bar * 0.45, sus: true}), ci === 3 ? 0.03 : 0.05, sd * 0.5);
      });
    });
    if (bassStyle !== "none") put(main, t0, tone(hz(rootN), len, {a: 0.3, rel: 0.6, sus: true}), 0.16, 0);

    if (bi >= introBars && !last && !inBreak) {
      if (bassStyle === "sub") put(main, t0, tone(hz(rootN), bar * 0.95, {type: "tri", fc: 300, a: 0.02, tc: bar * 0.6}), 0.28, 0);
      else if (bassStyle === "pluck8") {
        for (let j = 0; j < 8; j++) put(main, t0 + (j * beat) / 2, tone(hz(rootN + (j === 7 ? 12 : j === 3 ? 7 : 0)), beat * 0.45, {type: "saw", fc: 420, a: 0.004, tc: 0.14}), j % 2 === 0 ? 0.3 : 0.18, 0);
      } else if (bassStyle === "offbeat") {
        for (let j = 0; j < 4; j++) put(main, t0 + j * beat + beat / 2, tone(hz(rootN + 12 * (j % 2)), beat * 0.4, {type: "square", fc: 520, a: 0.004, tc: 0.12}), 0.2, 0);
      } else if (bassStyle === "walk") {
        const steps = [0, deg(d0 + 4) - deg(d0), deg(d0 + 2) - deg(d0), deg(d0 + 4) - deg(d0)];
        for (let j = 0; j < 4; j++) put(main, t0 + j * beat, tone(hz(rootN + steps[j]), beat * 0.85, {type: "tri", fc: 600, a: 0.01, tc: 0.35}), 0.26, 0);
      }
    }
    if (bi === introBars - 1 + (introBars > 1 ? 0 : 1) && drive >= 1 && !last) put(main, t0, sweepNoise(bar, 300, 7000, 0.6, (t) => t * t, r), 0.09, 0);
    if (inBreak) put(main, t0 + bar - beat * 2, sweepNoise(beat * 2, 400, 6500, 0.6, (t) => t * t, r), 0.1, 0);

    if (bi >= introBars && !last) {
      const steps = 4 * arpDensity;
      const gain = inBreak ? arpGain * 1.4 : arpGain;
      for (let st = 0; st < steps; st++) {
        const idx = arpPat[st % arpPat.length] % chord.length;
        const m = root + arpOct + chord[idx];
        const at = t0 + (st * bar) / steps + (st % 2 ? swing * (bar / steps) : 0);
        const dur = (bar / steps) * 1.6;
        const snd = arpTimbre === "bell" ? bell(hz(m)) : arpTimbre === "pluck" ? tone(hz(m), dur * 1.4, {type: "tri", fc: 3200, fc2: 500, a: 0.002, tc: 0.12}) : tone(hz(m), dur, {type: arpTimbre, fc: 4200, fc2: 600, a: 0.002, tc: 0.16});
        put(arp, at, snd, gain, st % 2 ? 0.45 : -0.45);
      }
    }

    if (leadOn && bi >= leadBar && !last && !inBreak && bi % 2 === 0) {
      let tt = 0;
      motif.forEach((n) => {
        const dd = n.d + (bi % 4 === 2 ? pickOf(r, [0, 1, 2]) : 0);
        const dl = (n.len * beat) / 2;
        if (tt + dl <= bar * 2) put(lead, t0 + tt, tone(hz(root + 24 + deg(d0 + dd - 4)), dl * 1.5, {type: leadType, fc: leadType === "saw" ? 2400 : undefined, a: 0.01, tc: dl * 0.9}), 0.07, 0.15);
        tt += dl;
      });
    }

    if (groove && !last && !inBreak && bi >= drumBar && drive >= groove.min) {
      const stepT = beat / 4;
      for (let st = 0; st < 16; st++) {
        const at = t0 + st * stepT + (st % 2 ? swing * stepT : 0);
        const k = groove.kick[st], sn = groove.snare[st], h = groove.hat[st];
        if (k === "x" || k === "o") put(main, at, kit.kick, (drive >= 2 ? 0.42 : 0.3) * (k === "o" ? 0.6 : 1), 0);
        if (sn === "x" || sn === "o") put(main, at, grooveName === "four" || grooveName === "skip" ? kit.clap : kit.snare, 0.16 * (sn === "o" ? 0.6 : 1), 0);
        if ((h === "x" || h === "o") && bi >= drumBar + 1) put(main, at, kit.hat, (h === "o" ? 0.03 : 0.065), st % 4 === 0 ? 0 : (st % 2 ? 0.25 : -0.25));
      }
    }
    if (last) put(main, t0 + 0.05, bell(hz(root + 36 + chord[0])), 0.09, 0);
  }

  const e1 = pickOf(r, [0.5, 0.75, 1]);
  const e2 = pickOf(r, [0.5, 0.75, 1.5]);
  echo(arp.L, Math.round(e1 * beat * SR), between(r, 0.25, 0.45));
  echo(arp.R, Math.round(e2 * beat * SR), between(r, 0.25, 0.45));
  echo(lead.L, Math.round(0.75 * beat * SR), 0.3);
  echo(lead.R, Math.round(0.5 * beat * SR), 0.3);
  for (let i = 0; i < main.n; i++) { main.L[i] += arp.L[i] + lead.L[i]; main.R[i] += arp.R[i] + lead.R[i]; }
  const wet = between(r, 0.6, 1.5);
  main.L = reverbCh(main.L, 0, wet);
  main.R = reverbCh(main.R, 23, wet);
  const n = master(main, secs, 0.9, 0.8, 2.2);
  writeWav(main, n, outPath);
  console.log("MUSIC " + moodName + " " + modeName + " root=" + root + " bpm=" + bpm + " prog=" + prog.join("-") + " groove=" + grooveName + " bass=" + bassStyle + " arp=" + arpTimbre);
}

`;

function swap(src: string, from: string, to: string): string {
  if (!src.includes(from)) throw new Error("venus-music: anchor not found: " + from.slice(0, 40));
  return src.split(from).join(to);
}

let v3 = SYNTH_V2_SOURCE;
v3 = swap(v3, "function runMusic(inp, outPath) {", "function runMusicOld(inp, outPath) {");
v3 = swap(v3, "const mode = process.argv[2];", COMPOSER_V3 + "\nconst mode = process.argv[2];");
v3 = swap(v3, "const r = rng(1234);", "const r = rng(Number(inp.seed) || 1234);");
v3 = swap(v3, "clampN(Number(inp.total) || 10, 2, 95)", "clampN(Number(inp.total) || 10, 2, 260)");
v3 = swap(v3, ".slice(0, 160).forEach", ".slice(0, 1500).forEach");

export const SYNTH_V3_SOURCE = v3;
