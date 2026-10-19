// The audio engine of Venus Pro. Pure Node (no packages) so it runs on any studio computer.
// Modes: "sfx" and "music" (built-in presets), "code" (runs audio code that the AGENT wrote, with a preset fallback).
// NOTE: the source below must not contain backticks or dollar-brace sequences (it lives in a template string).

export const SYNTH_V2_SOURCE = String.raw`"use strict";
const fs = require("fs");
const vm = require("vm");
const SR = 44100;
const TAU = Math.PI * 2;

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function buf(sec) {
  const n = Math.max(1, Math.ceil(sec * SR));
  return {n: n, L: new Float32Array(n), R: new Float32Array(n)};
}
function put(b, t0, d, g, pan) {
  const s0 = Math.round(t0 * SR);
  const a = ((pan || 0) + 1) * Math.PI / 4;
  const gl = g * Math.cos(a);
  const gr = g * Math.sin(a);
  for (let i = 0; i < d.length; i++) {
    const k = s0 + i;
    if (k < 0) continue;
    if (k >= b.n) break;
    b.L[k] += d[i] * gl;
    b.R[k] += d[i] * gr;
  }
}
function osc(type, ph) {
  const x = (ph / TAU) % 1;
  const p = x < 0 ? x + 1 : x;
  if (type === "saw") return 2 * p - 1;
  if (type === "square") return p < 0.5 ? 1 : -1;
  if (type === "tri") return 4 * Math.abs(p - 0.5) - 1;
  return Math.sin(ph);
}

function tone(freq, dur, o) {
  o = o || {};
  const n = Math.max(1, Math.floor(dur * SR));
  const out = new Float32Array(n);
  const a = o.a === undefined ? 0.004 : o.a;
  const tc = o.tc || dur / 3;
  const rel = o.rel || 0.012;
  const f2 = o.f2 || freq;
  const sw = o.sweep || dur;
  const type = o.type || "sine";
  const glide = f2 !== freq;
  const sweepFc = Boolean(o.fc && o.fc2);
  let k = o.fc && !sweepFc ? 1 - Math.exp(-TAU * o.fc / SR) : 0;
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = glide ? freq * Math.pow(f2 / freq, Math.min(1, t / sw)) : freq;
    ph += TAU * f / SR;
    let v = osc(type, ph);
    if (o.fc) {
      if (sweepFc) k = 1 - Math.exp(-TAU * (o.fc * Math.pow(o.fc2 / o.fc, Math.min(1, t / dur))) / SR);
      lp += k * (v - lp);
      v = lp;
    }
    let e = t < a ? t / a : o.sus ? 1 : Math.exp(-(t - a) / tc);
    e *= Math.min(1, (dur - t) / (o.sus ? rel : 0.01));
    out[i] = v * e;
  }
  return out;
}

function sweepNoise(dur, f1, f2, q, env, r) {
  const n = Math.max(1, Math.floor(dur * SR));
  const out = new Float32Array(n);
  let low = 0;
  let band = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const fc = Math.min(7000, f1 * Math.pow(f2 / f1, t));
    const f = 2 * Math.sin(Math.PI * fc / SR);
    const x = r() * 2 - 1;
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    out[i] = band * env(t);
  }
  return out;
}

function layer(items) {
  let end = 0;
  items.forEach((it) => { end = Math.max(end, it.at + it.d.length / SR); });
  const out = new Float32Array(Math.ceil(end * SR) + 1);
  items.forEach((it) => {
    const s0 = Math.round(it.at * SR);
    const g = it.g === undefined ? 1 : it.g;
    for (let i = 0; i < it.d.length; i++) {
      const k = s0 + i;
      if (k >= out.length) break;
      out[k] += it.d[i] * g;
    }
  });
  return out;
}

function bell(f) {
  return layer([
    {d: tone(f, 1.4, {tc: 0.45, a: 0.003}), at: 0, g: 1},
    {d: tone(f * 2, 0.9, {tc: 0.2, a: 0.003}), at: 0, g: 0.3},
    {d: tone(f * 3.01, 0.5, {tc: 0.1, a: 0.002}), at: 0, g: 0.12},
  ]);
}

function mkSfx(kind, r, dur) {
  switch (kind) {
    case "whoosh": {
      const d = dur || 0.6;
      return layer([
        {d: sweepNoise(d, 220, 5200, 0.55, (t) => Math.pow(Math.sin(Math.PI * t), 1.6), r), at: 0, g: 1},
        {d: sweepNoise(d, 90, 900, 0.8, (t) => Math.sin(Math.PI * t), r), at: 0, g: 0.5},
      ]);
    }
    case "impact":
      return layer([
        {d: tone(130, 0.8, {f2: 36, sweep: 0.3, tc: 0.25, a: 0.002}), at: 0, g: 1},
        {d: sweepNoise(0.4, 3000, 150, 0.9, (t) => Math.exp(-t * 7), r), at: 0, g: 0.7},
        {d: tone(55, 1.1, {tc: 0.45, a: 0.004}), at: 0.02, g: 0.8},
      ]);
    case "chime":
      return layer([{d: bell(1046.5), at: 0, g: 0.8}, {d: bell(1318.5), at: 0.09, g: 0.7}, {d: bell(1568), at: 0.18, g: 0.7}]);
    case "pop":
      return layer([
        {d: tone(640, 0.16, {f2: 240, sweep: 0.1, tc: 0.05, a: 0.002}), at: 0, g: 1},
        {d: tone(1900, 0.05, {tc: 0.012, a: 0.001}), at: 0, g: 0.3},
      ]);
    case "click":
      return layer([
        {d: sweepNoise(0.04, 2800, 6500, 0.7, (t) => Math.exp(-t * 7), r), at: 0, g: 0.55},
        {d: tone(1700, 0.04, {tc: 0.01, a: 0.0008}), at: 0, g: 0.5},
      ]);
    case "tick":
      return tone(3300, 0.03, {tc: 0.007, a: 0.0008});
    case "typing": {
      const d = dur || 1.1;
      const n = Math.max(3, Math.round(d * 13));
      const items = [];
      for (let i = 0; i < n; i++) {
        const f = 1400 + r() * 1500;
        const c = layer([
          {d: sweepNoise(0.03, f, f * 2, 0.7, (t) => Math.exp(-t * 8), r), at: 0, g: 0.5},
          {d: tone(f * 0.9, 0.03, {tc: 0.008, a: 0.0008}), at: 0, g: 0.4},
        ]);
        items.push({d: c, at: Math.max(0, i * (d / n) + (r() - 0.5) * 0.02), g: 0.6 + r() * 0.4});
      }
      return layer(items);
    }
    case "riser": {
      const d = dur || 1.0;
      return layer([
        {d: sweepNoise(d, 200, 7000, 0.7, (t) => t * t, r), at: 0, g: 1},
        {d: tone(160, d, {f2: 1500, sweep: d, a: d * 0.9, sus: true, rel: 0.04, type: "saw", fc: 2500}), at: 0, g: 0.3},
      ]);
    }
    case "swell": {
      const d = dur || 1.4;
      return layer([196, 294, 392].map((f) => ({d: tone(f, d, {a: d * 0.55, sus: true, rel: d * 0.4}), at: 0, g: 0.4})));
    }
    default:
      return null;
  }
}

function comb(x, delay, fb, damp) {
  const n = x.length;
  const out = new Float32Array(n);
  const bf = new Float32Array(delay);
  let idx = 0;
  let store = 0;
  for (let i = 0; i < n; i++) {
    const y = bf[idx];
    store = y * (1 - damp) + store * damp;
    bf[idx] = x[i] + store * fb;
    idx = (idx + 1) % delay;
    out[i] = y;
  }
  return out;
}
function allpass(x, delay) {
  const n = x.length;
  const out = new Float32Array(n);
  const bf = new Float32Array(delay);
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const bo = bf[idx];
    out[i] = -x[i] + bo;
    bf[idx] = x[i] + bo * 0.5;
    idx = (idx + 1) % delay;
  }
  return out;
}
function reverbCh(x, spread, wet) {
  let acc = new Float32Array(x.length);
  [1116, 1188, 1277, 1356].forEach((d) => {
    const c = comb(x, d + spread, 0.8, 0.25);
    for (let i = 0; i < acc.length; i++) acc[i] += c[i];
  });
  acc = allpass(allpass(acc, 556 + spread), 441 + spread);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + acc[i] * wet * 0.15;
  return out;
}
function echo(x, d, fb) {
  for (let i = d; i < x.length; i++) x[i] += x[i - d] * fb;
}

function peakOf(b) {
  let m = 0;
  for (let i = 0; i < b.n; i++) m = Math.max(m, Math.abs(b.L[i]), Math.abs(b.R[i]));
  return m;
}
function master(b, len, peak, fadeIn, fadeOut) {
  const n = Math.min(b.n, Math.floor(len * SR));
  let m = 1e-9;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let g = 1;
    if (fadeIn) g *= Math.min(1, t / fadeIn);
    if (fadeOut) g *= Math.max(0, Math.min(1, (len - t) / fadeOut));
    b.L[i] = Math.tanh(b.L[i] * 1.1) * g;
    b.R[i] = Math.tanh(b.R[i] * 1.1) * g;
    m = Math.max(m, Math.abs(b.L[i]), Math.abs(b.R[i]));
  }
  const k = peak / m;
  for (let i = 0; i < n; i++) { b.L[i] *= k; b.R[i] *= k; }
  return n;
}
function writeWav(b, n, path) {
  const out = Buffer.alloc(44 + n * 4);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + n * 4, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    out.writeInt16LE(Math.round(clampN(b.L[i], -1, 1) * 32767), 44 + i * 4);
    out.writeInt16LE(Math.round(clampN(b.R[i], -1, 1) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(path, out);
}

// ---------------- preset sound effects ----------------
function runSfx(inp, outPath) {
  const total = clampN(Number(inp.total) || 10, 2, 95);
  const b = buf(total + 1.5);
  const r = rng(1234);
  let flip = 1;
  (Array.isArray(inp.cues) ? inp.cues : []).slice(0, 160).forEach((c) => {
    const kind = c.kind === "soft-click" ? "click" : String(c.kind);
    const d = mkSfx(kind, r, Number(c.dur) || 0);
    if (!d) return;
    flip = -flip;
    const pan = kind === "whoosh" || kind === "riser" ? flip * 0.35 : 0;
    put(b, Math.max(0, Number(c.at) || 0), d, c.g === undefined ? 1 : Number(c.g), pan);
  });
  const n = master(b, total + 1.5, 0.85, 0, 0);
  writeWav(b, n, outPath);
}

// ---------------- preset music ----------------
const MOODS = {
  dark:    {bpm: 94,  root: 45, minor: true,  prog: [0, 5, 2, 6], drive: 1, arp: 2, bright: 1800, floor: false},
  epic:    {bpm: 108, root: 50, minor: true,  prog: [0, 5, 2, 6], drive: 2, arp: 2, bright: 2600, floor: false},
  bright:  {bpm: 118, root: 48, minor: false, prog: [0, 4, 5, 3], drive: 1, arp: 2, bright: 3400, floor: false},
  tech:    {bpm: 124, root: 40, minor: true,  prog: [0, 2, 5, 6], drive: 2, arp: 4, bright: 2800, floor: true},
  calm:    {bpm: 78,  root: 53, minor: false, prog: [0, 4, 5, 3], drive: 0, arp: 2, bright: 1900, floor: false},
  playful: {bpm: 112, root: 48, minor: false, prog: [0, 3, 4, 3], drive: 1, arp: 2, bright: 3600, floor: false},
};

function drumKit(r) {
  return {
    kick: tone(165, 0.36, {f2: 42, sweep: 0.09, tc: 0.11, a: 0.001}),
    hat: sweepNoise(0.05, 6500, 6500, 0.3, (t) => Math.exp(-t * 7), r),
    clap: layer([
      {d: sweepNoise(0.17, 1700, 1700, 0.5, (t) => Math.exp(-t * 9), r), at: 0, g: 1},
      {d: sweepNoise(0.12, 2100, 2100, 0.5, (t) => Math.exp(-t * 12), r), at: 0.014, g: 0.7},
    ]),
    snare: layer([
      {d: sweepNoise(0.2, 2200, 2200, 0.5, (t) => Math.exp(-t * 11), r), at: 0, g: 0.8},
      {d: tone(190, 0.15, {f2: 130, sweep: 0.1, tc: 0.05, a: 0.001}), at: 0, g: 0.7},
    ]),
  };
}

function runMusic(inp, outPath) {
  const secs = clampN(Number(inp.seconds) || 30, 6, 90);
  const M = MOODS[inp.mood] || MOODS.dark;
  const bpm = clampN(Number(inp.bpm) || M.bpm, 70, 140);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const bars = Math.max(2, Math.ceil(secs / bar));
  const r = rng(Number(inp.seed) || 7);
  const scale = M.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const deg = (d) => scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const main = buf(secs + 4);
  const arp = buf(secs + 4);
  const kit = drumKit(r);
  const lastBar = bars - 1;

  for (let bi = 0; bi < bars; bi++) {
    const t0 = bi * bar;
    const d0 = M.prog[bi % M.prog.length];
    const last = bi === lastBar;
    const chord = [deg(d0), deg(d0 + 2), deg(d0 + 4)];
    const rootN = M.root + deg(d0);

    const len = last ? bar * 2.4 : bar + 0.3;
    chord.forEach((c) => {
      [-1, 1].forEach((s) => {
        put(main, t0, tone(hz(M.root + 12 + c) * (1 + s * 0.004), len, {type: "saw", fc: M.bright, a: bar * 0.35, rel: bar * 0.45, sus: true}), 0.05, s * 0.5);
      });
    });
    put(main, t0, tone(hz(rootN), len, {a: 0.3, rel: 0.6, sus: true}), 0.16, 0);

    if (bi >= 1 && !last) {
      if (M.drive === 0) {
        put(main, t0, tone(hz(rootN), bar * 0.95, {type: "tri", fc: 300, a: 0.02, tc: bar * 0.6}), 0.3, 0);
      } else {
        for (let j = 0; j < 8; j++) {
          const note = rootN + (j === 7 ? 12 : 0);
          put(main, t0 + (j * beat) / 2, tone(hz(note), beat * 0.45, {type: "saw", fc: 420, a: 0.004, tc: 0.14}), j % 2 === 0 ? 0.3 : 0.18, 0);
        }
      }
    }
    if (bi === 1 && M.drive >= 1) put(main, t0, sweepNoise(bar, 300, 7000, 0.6, (t) => t * t, r), 0.1, 0);

    if (bi >= 2 && !last) {
      const steps = 4 * M.arp;
      const pat = [0, 1, 2, 3, 2, 1, 2, 1];
      for (let s = 0; s < steps; s++) {
        const idx = pat[s % 8];
        const m = M.root + 24 + (idx === 3 ? chord[0] + 12 : chord[idx]);
        put(arp, t0 + (s * bar) / steps, tone(hz(m), (bar / steps) * 1.6, {type: "saw", fc: 4200, fc2: 600, a: 0.002, tc: 0.16}), M.arp === 4 ? 0.04 : 0.06, s % 2 ? 0.4 : -0.4);
      }
    }
    if (M.drive >= 1 && bi >= 2 && !last) {
      const beats = M.floor ? [0, 1, 2, 3] : [0, 2];
      beats.forEach((q) => put(main, t0 + q * beat, kit.kick, M.drive >= 2 ? 0.42 : 0.3, 0));
      if (bi >= 3) {
        for (let j = 0; j < 4; j++) {
          put(main, t0 + j * beat + beat / 2, kit.hat, 0.07, 0.2);
          if (M.floor) {
            put(main, t0 + j * beat + beat / 4, kit.hat, 0.03, -0.2);
            put(main, t0 + j * beat + (3 * beat) / 4, kit.hat, 0.03, 0.2);
          }
        }
      }
      if (M.drive >= 2 && bi >= 4) {
        put(main, t0 + beat, kit.clap, 0.16, 0);
        put(main, t0 + 3 * beat, kit.clap, 0.16, 0);
      }
    }
    if (last) put(main, t0 + 0.05, tone(hz(M.root + 36 + chord[0]), 2.2, {tc: 0.8, a: 0.003}), 0.08, 0);
  }

  echo(arp.L, Math.round(0.75 * beat * SR), 0.38);
  echo(arp.R, Math.round(0.5 * beat * SR), 0.38);
  for (let i = 0; i < main.n; i++) { main.L[i] += arp.L[i]; main.R[i] += arp.R[i]; }
  main.L = reverbCh(main.L, 0, 1);
  main.R = reverbCh(main.R, 23, 1);
  const n = master(main, secs, 0.9, 0.8, 2.2);
  writeWav(main, n, outPath);
}

// ---------------- audio code written by the AGENT ----------------
function cleanOpts(o) {
  const c = {};
  if (!o || typeof o !== "object") return c;
  if (["sine", "saw", "tri", "square"].indexOf(o.type) >= 0) c.type = o.type;
  ["a", "tc", "rel", "f2", "sweep", "fc", "fc2"].forEach((k) => {
    if (o[k] !== undefined && isFinite(Number(o[k]))) c[k] = Number(o[k]);
  });
  if (o.sus) c.sus = true;
  if (c.fc) c.fc = clampN(c.fc, 40, 18000);
  if (c.fc2) c.fc2 = clampN(c.fc2, 40, 18000);
  if (c.f2) c.f2 = clampN(c.f2, 20, 16000);
  if (c.a !== undefined) c.a = clampN(c.a, 0.0005, 16);
  if (c.tc !== undefined) c.tc = clampN(c.tc, 0.002, 30);
  if (c.rel !== undefined) c.rel = clampN(c.rel, 0.002, 16);
  return c;
}

function runCode(job, outPath) {
  const kind = job.kind === "sfx" ? "sfx" : "music";
  const secs = clampN(Number(job.seconds) || 30, 4, 95);
  const len = kind === "sfx" ? secs + 1.5 : secs;
  const b = buf(len + (kind === "music" ? 4 : 0));
  const r = rng(Number(job.seed) || 11);
  let budget = 4000 * SR;
  let puts = 0;
  const use = (sec) => { budget -= sec * SR; if (budget < 0) throw new Error("too much audio was generated (budget)"); };
  const fx = {rev: 0, eDelay: 0, eFb: 0};
  const drums = drumKit(r);
  const A = {
    SR: SR, seconds: secs, mood: String(job.mood || ""), bpm: Number(job.bpm) || 0,
    scenes: Array.isArray(job.scenes) ? job.scenes.slice(0, 40) : [],
    hz: hz, clamp: clampN, rand: r,
    tone: function (f, d, o) {
      d = clampN(Number(d) || 0.1, 0.005, 16);
      use(d);
      return tone(clampN(Number(f) || 440, 20, 16000), d, cleanOpts(o));
    },
    noise: function (d, f1, f2, q, env) {
      d = clampN(Number(d) || 0.1, 0.005, 16);
      use(d);
      const e = typeof env === "function" ? env : function () { return 1; };
      return sweepNoise(d, clampN(Number(f1) || 200, 20, 7000), clampN(Number(f2) || Number(f1) || 200, 20, 7000), clampN(Number(q) || 0.6, 0.1, 1.5), e, r);
    },
    layer: function (items) {
      const list = Array.isArray(items) ? items.slice(0, 200) : [];
      const ok = list.filter(function (it) { return it && it.d && it.d.length; }).map(function (it) { return {d: it.d, at: Math.max(0, Number(it.at) || 0), g: it.g === undefined ? 1 : Number(it.g) || 0}; });
      return ok.length ? layer(ok) : new Float32Array(1);
    },
    drum: function (name) { return drums[name] || drums.kick; },
    sfx: function (name, dur) {
      use(0.5);
      const d = mkSfx(String(name === "soft-click" ? "click" : name), r, Number(dur) || 0);
      return d || new Float32Array(1);
    },
    put: function (t, data, gain, pan) {
      if (!data || !data.length) return;
      if (++puts > 6000) throw new Error("too many put() calls");
      put(b, Number(t) || 0, data, gain === undefined ? 1 : Number(gain) || 0, clampN(Number(pan) || 0, -1, 1));
    },
    fx: {
      reverb: function (w) { fx.rev = clampN(Number(w) || 0, 0, 1); },
      echo: function (d, f) { fx.eDelay = clampN(Number(d) || 0, 0.02, 2); fx.eFb = clampN(Number(f) || 0, 0, 0.6); },
    },
  };
  try {
    const ctx = vm.createContext({A: A, console: {log: function () {}}});
    vm.runInContext(String(job.code) + "\n;compose(A);", ctx, {timeout: 30000});
    if (peakOf(b) < 0.0001) throw new Error("the code produced silence");
    if (fx.eDelay > 0 && fx.eFb > 0) {
      echo(b.L, Math.round(fx.eDelay * SR), fx.eFb);
      echo(b.R, Math.round(fx.eDelay * 0.67 * SR), fx.eFb);
    }
    if (fx.rev > 0) {
      b.L = reverbCh(b.L, 0, fx.rev * 1.5);
      b.R = reverbCh(b.R, 23, fx.rev * 1.5);
    }
    const n = kind === "sfx" ? master(b, len, 0.85, 0, 0) : master(b, len, 0.9, 0.8, 2.2);
    writeWav(b, n, outPath);
    console.log("AUDIO_OK");
    return;
  } catch (e) {
    console.log("AUDIO_FALLBACK: " + String(e && e.message ? e.message : e).slice(0, 200).replace(/\s+/g, " "));
  }
  if (kind === "sfx") runSfx(job.fallback || {total: len, cues: []}, outPath);
  else runMusic(job.fallback || {seconds: secs, mood: job.mood}, outPath);
}

const mode = process.argv[2];
const inp = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const outPath = process.argv[4];
if (mode === "sfx") runSfx(inp, outPath);
else if (mode === "music") runMusic(inp, outPath);
else if (mode === "code") runCode(inp, outPath);
else { console.error("unknown mode " + mode); process.exit(2); }
`;
