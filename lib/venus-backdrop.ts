// Venus Pro background engine. Written to the studio computer on every "prepare" (like the UI kit), so old computers get it without a reinstall.
// Nothing here is a template: each video has its own seed; the seed decides the family of background kinds, the colour roles,
// the angles, the speeds and the density. The director may also name a kind / colours per scene, or say "none" (the scene paints its own).
// NOTE: this source lives in a template string. It must not contain backticks or dollar-brace sequences.

export const BACKDROP_SOURCE = String.raw`import React from "react";
import {AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig} from "remotion";

export const BG_KINDS = ["mesh", "aurora", "grid", "halftone", "stripes", "rings", "waves", "noise", "spot", "blocks", "flow", "stars", "paper", "conic", "topo", "checker", "rays", "bokeh", "circuit", "glass"];

export const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 999983;
};

const hexOk = (c: any) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);
const rgba = (hex: string, a: number) => {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return "rgba(255,255,255," + a + ")";
  return "rgba(" + parseInt(h.slice(0, 2), 16) + "," + parseInt(h.slice(2, 4), 16) + "," + parseInt(h.slice(4, 6), 16) + "," + a + ")";
};
const R = (seed: number, tag: string, i: number = 0): number => random("bd-" + seed + "-" + tag + "-" + i);
const pick = (cols: string[], k: number) => cols[((k % cols.length) + cols.length) % cols.length];

type Ctx = {w: number; h: number; t: number; f: number; seed: number; cols: string[]; dark: boolean; intensity: number; scale: number; angle: number; u: number; big: number};

const Mesh = (c: Ctx) => {
  const n = 3 + Math.floor(R(c.seed, "n") * 3);
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    const size = c.big * (0.5 + R(c.seed, "s", i) * 0.7) * c.scale;
    const sp = 0.15 + R(c.seed, "p", i) * 0.4;
    const ph = R(c.seed, "h", i) * 6.28;
    const x = c.w * (R(c.seed, "x", i) + Math.sin(c.t * sp + ph) * 0.12) - size / 2;
    const y = c.h * (R(c.seed, "y", i) + Math.cos(c.t * sp * 0.8 + ph) * 0.12) - size / 2;
    out.push(<div key={i} style={{position: "absolute", left: x, top: y, width: size, height: size, borderRadius: "50%", background: "radial-gradient(circle, " + rgba(pick(c.cols, i), (c.dark ? 0.55 : 0.4) * c.intensity) + " 0%, transparent 65%)"}} />);
  }
  return <AbsoluteFill>{out}</AbsoluteFill>;
};

const Aurora = (c: Ctx) => {
  const out: any[] = [];
  for (let i = 0; i < 4; i++) {
    const sp = 0.2 + R(c.seed, "sp", i) * 0.35;
    const ph = R(c.seed, "ph", i) * 6.28;
    out.push(
      <div key={i} style={{
        position: "absolute", width: c.w * 1.7, height: c.h * (0.16 + R(c.seed, "hh", i) * 0.22),
        left: -c.w * 0.35 + Math.sin(c.t * sp + ph) * c.w * 0.16,
        top: c.h * (0.05 + R(c.seed, "tt", i) * 0.75 + Math.sin(c.t * 0.3 + ph) * 0.05),
        transform: "rotate(" + (c.angle * 0.1 - 12 + R(c.seed, "rr", i) * 24) + "deg)", borderRadius: "50%",
        background: "linear-gradient(90deg, transparent, " + rgba(pick(c.cols, i), 0.6 * c.intensity) + ", transparent)", filter: "blur(" + 38 * c.u * c.scale + "px)",
      }} />
    );
  }
  return <AbsoluteFill>{out}</AbsoluteFill>;
};

const Grid = (c: Ctx) => {
  const cell = (46 + R(c.seed, "cell") * 70) * c.u * c.scale;
  const line = rgba(c.cols[0], 0.2 * c.intensity);
  const persp = R(c.seed, "persp") > 0.5;
  const dx = (c.t * 18 * c.u) % cell;
  const dy = (c.t * (6 + R(c.seed, "dy") * 22) * c.u) % cell;
  const inner: any = {
    position: "absolute", left: persp ? -c.w * 0.6 : 0, top: persp ? -c.h * 0.2 : 0, width: persp ? c.w * 2.2 : c.w, height: persp ? c.h * 2 : c.h,
    backgroundImage: "linear-gradient(" + line + " 1px, transparent 1px), linear-gradient(90deg, " + line + " 1px, transparent 1px)",
    backgroundSize: cell + "px " + cell + "px", backgroundPosition: dx + "px " + dy + "px",
  };
  if (persp) { inner.transform = "perspective(" + 900 * c.u + "px) rotateX(58deg)"; inner.transformOrigin = "50% 100%"; }
  return (
    <AbsoluteFill style={{WebkitMaskImage: "linear-gradient(to " + (persp ? "top" : "bottom right") + ", black 15%, transparent 95%)"}}>
      <div style={inner} />
    </AbsoluteFill>
  );
};

const Halftone = (c: Ctx) => {
  const dot = (16 + R(c.seed, "dot") * 26) * c.u * c.scale;
  const ang = Math.round(R(c.seed, "dir") * 360);
  return (
    <AbsoluteFill style={{WebkitMaskImage: "linear-gradient(" + ang + "deg, black 0%, transparent 85%)"}}>
      <AbsoluteFill style={{backgroundImage: "radial-gradient(circle, " + rgba(c.cols[0], 0.5 * c.intensity) + " 24%, transparent 26%)", backgroundSize: dot + "px " + dot + "px", backgroundPosition: (c.t * 10 * c.u) + "px " + (c.t * 6 * c.u) + "px"}} />
      <AbsoluteFill style={{backgroundImage: "radial-gradient(circle, " + rgba(pick(c.cols, 1), 0.3 * c.intensity) + " 20%, transparent 22%)", backgroundSize: dot * 1.5 + "px " + dot * 1.5 + "px", backgroundPosition: (dot * 0.5) + "px " + (dot * 0.5 - c.t * 5 * c.u) + "px"}} />
    </AbsoluteFill>
  );
};

const Stripes = (c: Ctx) => {
  const wd = (24 + R(c.seed, "wd") * 70) * c.u * c.scale;
  const ang = c.angle;
  const col = rgba(c.cols[0], 0.22 * c.intensity);
  const col2 = rgba(pick(c.cols, 1), 0.16 * c.intensity);
  return (
    <AbsoluteFill style={{backgroundImage: "repeating-linear-gradient(" + ang + "deg, " + col + " 0px, " + col + " " + wd + "px, transparent " + wd + "px, transparent " + wd * 2.4 + "px, " + col2 + " " + wd * 2.4 + "px, " + col2 + " " + wd * 2.8 + "px, transparent " + wd * 2.8 + "px, transparent " + wd * 3.6 + "px)", backgroundPosition: (c.t * 26 * c.u) + "px 0px"}} />
  );
};

const Rings = (c: Ctx) => {
  const cx = c.w * (0.15 + R(c.seed, "cx") * 0.7);
  const cy = c.h * (0.15 + R(c.seed, "cy") * 0.7);
  const maxR = c.big * 0.9 * c.scale;
  const n = 7 + Math.floor(R(c.seed, "rn") * 6);
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    const r = ((i * maxR) / n + c.t * 26 * c.u) % maxR;
    out.push(<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={rgba(pick(c.cols, i), (1 - r / maxR) * 0.55 * c.intensity)} strokeWidth={(1.2 + R(c.seed, "sw", i) * 3) * c.u} />);
  }
  return <svg width={c.w} height={c.h} style={{position: "absolute", left: 0, top: 0}}>{out}</svg>;
};

const Waves = (c: Ctx) => {
  const layers = 4 + Math.floor(R(c.seed, "ln") * 3);
  const out: any[] = [];
  for (let l = 0; l < layers; l++) {
    const amp = c.h * (0.03 + R(c.seed, "am", l) * 0.07);
    const fr = (1.2 + R(c.seed, "fr", l) * 3.2) / c.w * 6.28 / c.scale;
    const ph = R(c.seed, "ph", l) * 6.28;
    const sp = (0.3 + R(c.seed, "sp", l) * 0.7) * (l % 2 ? -1 : 1);
    const base = c.h * (0.38 + (l / layers) * 0.55);
    let d = "M 0 " + c.h;
    for (let x = 0; x <= c.w + 20; x += c.w / 36) d += " L " + x.toFixed(1) + " " + (base + Math.sin(x * fr + c.t * sp + ph) * amp).toFixed(1);
    d += " L " + c.w + " " + c.h + " Z";
    out.push(<path key={l} d={d} fill={rgba(pick(c.cols, l), (0.12 + l * 0.06) * c.intensity)} />);
  }
  return <svg width={c.w} height={c.h} style={{position: "absolute", left: 0, top: 0}}>{out}</svg>;
};

const Grain = (c: Ctx & {op?: number; fq?: number}) => (
  <svg width={c.w} height={c.h} style={{position: "absolute", left: 0, top: 0, opacity: c.op === undefined ? 0.16 : c.op, mixBlendMode: c.dark ? "screen" : "multiply"}}>
    <filter id={"gr" + c.seed}><feTurbulence type="fractalNoise" baseFrequency={c.fq || 0.8} numOctaves={2} seed={c.seed % 200} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
    <rect width="100%" height="100%" filter={"url(#gr" + c.seed + ")"} />
  </svg>
);

const Noise = (c: Ctx) => (
  <AbsoluteFill>
    <div style={{position: "absolute", left: c.w * (0.3 + Math.sin(c.t * 0.3) * 0.2), top: c.h * (0.4 + Math.cos(c.t * 0.25) * 0.2), width: c.big * 0.9, height: c.big * 0.9, marginLeft: -c.big * 0.45, marginTop: -c.big * 0.45, borderRadius: "50%", background: "radial-gradient(circle, " + rgba(c.cols[0], 0.4 * c.intensity) + ", transparent 65%)"}} />
    <Grain {...c} op={0.22} fq={0.65} />
  </AbsoluteFill>
);

const Spot = (c: Ctx) => {
  const x1 = 50 + Math.sin(c.t * 0.35 + R(c.seed, "a") * 6) * 30;
  const y1 = 35 + Math.cos(c.t * 0.28 + R(c.seed, "b") * 6) * 18;
  const x2 = 50 + Math.cos(c.t * 0.22 + R(c.seed, "c") * 6) * 35;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: "radial-gradient(ellipse " + 55 * c.scale + "% " + 60 * c.scale + "% at " + x1 + "% " + y1 + "%, " + rgba(c.cols[0], 0.5 * c.intensity) + " 0%, transparent 70%)"}} />
      <AbsoluteFill style={{background: "radial-gradient(ellipse 40% 45% at " + x2 + "% 90%, " + rgba(pick(c.cols, 1), 0.35 * c.intensity) + " 0%, transparent 70%)"}} />
      <div style={{position: "absolute", left: 0, right: 0, top: c.h * 0.78, height: 2 * c.u, background: "linear-gradient(90deg, transparent, " + rgba(c.cols[0], 0.35) + ", transparent)"}} />
    </AbsoluteFill>
  );
};

const Blocks = (c: Ctx) => {
  const n = 6 + Math.floor(R(c.seed, "bn") * 5);
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    const s = c.big * (0.08 + R(c.seed, "bs", i) * 0.28) * c.scale;
    const x = c.w * R(c.seed, "bx", i) + Math.sin(c.t * 0.25 + i) * 18 * c.u;
    const y = c.h * R(c.seed, "by", i) + Math.cos(c.t * 0.2 + i * 2) * 18 * c.u;
    const rot = R(c.seed, "br", i) * 360 + c.t * (R(c.seed, "bv", i) - 0.5) * 12;
    const kind = Math.floor(R(c.seed, "bk", i) * 3);
    const fill = rgba(pick(c.cols, i), (0.22 + R(c.seed, "bo", i) * 0.3) * c.intensity);
    out.push(
      <svg key={i} width={s} height={s} viewBox="0 0 100 100" style={{position: "absolute", left: x - s / 2, top: y - s / 2, transform: "rotate(" + rot + "deg)"}}>
        {kind === 0 ? <rect x="8" y="8" width="84" height="84" fill={fill} /> : kind === 1 ? <circle cx="50" cy="50" r="44" fill={fill} /> : <polygon points="50,6 94,90 6,90" fill={fill} />}
      </svg>
    );
  }
  return <AbsoluteFill>{out}</AbsoluteFill>;
};

const Flow = (c: Ctx) => {
  const n = 22 + Math.floor(R(c.seed, "fn") * 22);
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    const y0 = c.h * (i / n) * 1.1 - c.h * 0.05;
    const amp = c.h * (0.04 + R(c.seed, "fa", i) * 0.12);
    const fr = (1 + R(c.seed, "ff", i) * 2.4) / c.w * 6.28 / c.scale;
    const ph = R(c.seed, "fp", i) * 6.28 + c.t * (0.25 + R(c.seed, "fs", i) * 0.5);
    let d = "";
    for (let x = 0; x <= c.w + 10; x += c.w / 24) d += (x === 0 ? "M " : " L ") + x.toFixed(1) + " " + (y0 + Math.sin(x * fr + ph) * amp + Math.sin(x * fr * 2.3 - ph) * amp * 0.4).toFixed(1);
    out.push(<path key={i} d={d} fill="none" stroke={rgba(pick(c.cols, i), (0.1 + R(c.seed, "fo", i) * 0.28) * c.intensity)} strokeWidth={(1 + R(c.seed, "fw", i) * 2) * c.u} />);
  }
  return <svg width={c.w} height={c.h} style={{position: "absolute", left: 0, top: 0}}>{out}</svg>;
};

const Stars = (c: Ctx) => {
  const n = 40 + Math.floor(R(c.seed, "sn") * 90);
  const dx = (R(c.seed, "sdx") - 0.5) * 30;
  const dy = -8 - R(c.seed, "sdy") * 22;
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    const s = (1.5 + R(c.seed, "ss", i) * 4.5 * (R(c.seed, "sb", i) > 0.9 ? 2 : 1)) * c.u;
    const x = (((R(c.seed, "sx", i) * c.w + c.t * dx * (0.4 + R(c.seed, "sv", i))) % c.w) + c.w) % c.w;
    const y = (((R(c.seed, "sy", i) * c.h + c.t * dy * (0.4 + R(c.seed, "sv", i))) % c.h) + c.h) % c.h;
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(c.t * (0.6 + R(c.seed, "st", i) * 2) + i));
    out.push(<div key={i} style={{position: "absolute", left: x, top: y, width: s, height: s, borderRadius: "50%", background: pick(c.cols, i), opacity: tw * 0.7 * c.intensity, boxShadow: s > 6 * c.u ? "0 0 " + s * 3 + "px " + pick(c.cols, i) : "none"}} />);
  }
  return <AbsoluteFill>{out}</AbsoluteFill>;
};

const Paper = (c: Ctx) => (
  <AbsoluteFill>
    <AbsoluteFill style={{background: "linear-gradient(" + (c.angle + 100) + "deg, rgba(0,0,0,0.0), rgba(0,0,0," + (c.dark ? 0.35 : 0.07) + "))"}} />
    <div style={{position: "absolute", left: c.w * (0.08 + R(c.seed, "pa") * 0.2), top: 0, width: 3 * c.u, height: c.h, background: rgba(c.cols[0], 0.2 * c.intensity)}} />
    <div style={{position: "absolute", left: 0, top: c.h * (0.78 + R(c.seed, "pb") * 0.1), width: c.w, height: 2 * c.u, background: rgba(pick(c.cols, 1), 0.25 * c.intensity)}} />
    <Grain {...c} op={0.3} fq={0.9} />
  </AbsoluteFill>
);

const Conic = (c: Ctx) => {
  const size = c.big * 1.9 * c.scale;
  const stops = c.cols.slice(0, 4).map((x, i) => rgba(x, 0.7 * c.intensity) + " " + i * 25 + "%").join(", ") + ", " + rgba(c.cols[0], 0.7 * c.intensity) + " 100%";
  return (
    <AbsoluteFill>
      <div style={{position: "absolute", left: c.w * (0.3 + R(c.seed, "cx") * 0.4) - size / 2, top: c.h * (0.3 + R(c.seed, "cy") * 0.4) - size / 2, width: size, height: size, borderRadius: "50%", background: "conic-gradient(from " + (c.t * (6 + R(c.seed, "cr") * 14)) + "deg, " + stops + ")", filter: "blur(" + 70 * c.u + "px)", opacity: 0.7}} />
    </AbsoluteFill>
  );
};

const Topo = (c: Ctx) => {
  const cx = c.w * (0.25 + R(c.seed, "tx") * 0.5);
  const cy = c.h * (0.25 + R(c.seed, "ty") * 0.5);
  const lobes = 2 + Math.floor(R(c.seed, "tl") * 4);
  const rings = 9 + Math.floor(R(c.seed, "tn") * 6);
  const out: any[] = [];
  for (let k = 1; k <= rings; k++) {
    const r0 = (k / rings) * c.big * 0.8 * c.scale;
    let d = "";
    for (let a = 0; a <= 64; a++) {
      const th = (a / 64) * 6.2832;
      const r = r0 * (1 + 0.16 * Math.sin(th * lobes + k * 0.35 + c.t * 0.35) + 0.07 * Math.sin(th * (lobes + 2) - c.t * 0.25 + k));
      d += (a === 0 ? "M " : " L ") + (cx + Math.cos(th) * r).toFixed(1) + " " + (cy + Math.sin(th) * r).toFixed(1);
    }
    out.push(<path key={k} d={d + " Z"} fill="none" stroke={rgba(pick(c.cols, k), (0.1 + (k / rings) * 0.28) * c.intensity)} strokeWidth={1.4 * c.u} />);
  }
  return <svg width={c.w} height={c.h} style={{position: "absolute", left: 0, top: 0}}>{out}</svg>;
};

const Checker = (c: Ctx) => {
  const cell = (40 + R(c.seed, "kc") * 60) * c.u * c.scale;
  const col = rgba(c.cols[0], 0.2 * c.intensity);
  return (
    <AbsoluteFill style={{WebkitMaskImage: "radial-gradient(ellipse at " + Math.round(R(c.seed, "kx") * 100) + "% " + Math.round(R(c.seed, "ky") * 100) + "%, black 0%, transparent 80%)"}}>
      <AbsoluteFill style={{backgroundImage: "conic-gradient(" + col + " 25%, transparent 0 50%, " + col + " 0 75%, transparent 0)", backgroundSize: cell * 2 + "px " + cell * 2 + "px", backgroundPosition: (c.t * 14 * c.u) + "px " + (c.t * 14 * c.u) + "px"}} />
    </AbsoluteFill>
  );
};

const Rays = (c: Ctx) => {
  const a = 4 + R(c.seed, "ra") * 9;
  return (
    <AbsoluteFill style={{WebkitMaskImage: "radial-gradient(circle at " + Math.round(20 + R(c.seed, "rx") * 60) + "% " + Math.round(R(c.seed, "ry") * 70) + "%, black 0%, transparent 75%)"}}>
      <AbsoluteFill style={{background: "repeating-conic-gradient(from " + (c.t * 5 + c.angle) + "deg at " + Math.round(20 + R(c.seed, "rx") * 60) + "% " + Math.round(R(c.seed, "ry") * 70) + "%, " + rgba(c.cols[0], 0.26 * c.intensity) + " 0deg, " + rgba(c.cols[0], 0.26 * c.intensity) + " " + a + "deg, transparent " + a + "deg, transparent " + a * 2 + "deg)"}} />
    </AbsoluteFill>
  );
};

const Bokeh = (c: Ctx) => {
  const n = 10 + Math.floor(R(c.seed, "kn") * 10);
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    const s = c.big * (0.04 + R(c.seed, "ks", i) * 0.14) * c.scale;
    const x = c.w * R(c.seed, "kx", i) + Math.sin(c.t * 0.2 + i * 1.7) * 30 * c.u;
    const y = ((c.h * R(c.seed, "ky", i) - c.t * (4 + R(c.seed, "kv", i) * 12) * c.u) % (c.h + s)) + (c.h + s) * 0;
    out.push(<div key={i} style={{position: "absolute", left: x - s / 2, top: (y < -s ? y + c.h + s : y) - s / 2, width: s, height: s, borderRadius: "50%", background: rgba(pick(c.cols, i), (0.2 + R(c.seed, "ko", i) * 0.3) * c.intensity), filter: "blur(" + 6 * c.u + "px)", boxShadow: "0 0 " + s * 0.4 + "px " + rgba(pick(c.cols, i), 0.35)}} />);
  }
  return <AbsoluteFill>{out}</AbsoluteFill>;
};

const Circuit = (c: Ctx) => {
  const n = 12 + Math.floor(R(c.seed, "cn") * 10);
  const g = 36 * c.u * c.scale;
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    let x = Math.round((R(c.seed, "cx", i) * c.w) / g) * g;
    let y = Math.round((R(c.seed, "cy", i) * c.h) / g) * g;
    let d = "M " + x + " " + y;
    const steps = 3 + Math.floor(R(c.seed, "cs", i) * 4);
    for (let s = 0; s < steps; s++) {
      const horiz = s % 2 === 0;
      const len = g * (2 + Math.floor(R(c.seed, "cl" + s, i) * 6)) * (R(c.seed, "cd" + s, i) > 0.5 ? 1 : -1);
      if (horiz) x += len; else y += len;
      d += " L " + x + " " + y;
    }
    out.push(<path key={"p" + i} d={d} fill="none" stroke={rgba(pick(c.cols, i), 0.16 * c.intensity)} strokeWidth={1.6 * c.u} />);
    out.push(<path key={"q" + i} d={d} fill="none" stroke={rgba(pick(c.cols, i + 1), 0.8 * c.intensity)} strokeWidth={2.4 * c.u} strokeLinecap="round" strokeDasharray={(30 * c.u) + " " + (500 * c.u)} strokeDashoffset={-(c.t * (60 + R(c.seed, "cv", i) * 120) * c.u + R(c.seed, "co", i) * 500)} />);
    out.push(<circle key={"c" + i} cx={x} cy={y} r={4 * c.u} fill={rgba(pick(c.cols, i), 0.5 * c.intensity)} />);
  }
  return <svg width={c.w} height={c.h} style={{position: "absolute", left: 0, top: 0}}>{out}</svg>;
};

const Glass = (c: Ctx) => (
  <AbsoluteFill>
    {Mesh(c)}
    {[0, 1, 2].map((i) => {
      const wd = c.w * (0.28 + R(c.seed, "gw", i) * 0.3);
      const ht = c.h * (0.25 + R(c.seed, "gh", i) * 0.3);
      return (
        <div key={i} style={{position: "absolute", width: wd, height: ht, left: c.w * (0.05 + R(c.seed, "gx", i) * 0.65) + Math.sin(c.t * 0.3 + i * 2) * 14 * c.u, top: c.h * (0.05 + R(c.seed, "gy", i) * 0.6) + Math.cos(c.t * 0.27 + i) * 14 * c.u, borderRadius: 28 * c.u, background: "linear-gradient(135deg, rgba(255,255,255," + (c.dark ? 0.09 : 0.35) + "), rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255," + (c.dark ? 0.16 : 0.5) + ")", transform: "rotate(" + (R(c.seed, "gr", i) * 16 - 8) + "deg)"}} />
      );
    })}
  </AbsoluteFill>
);

const DRAW: any = {mesh: Mesh, aurora: Aurora, grid: Grid, halftone: Halftone, stripes: Stripes, rings: Rings, waves: Waves, noise: Noise, spot: Spot, blocks: Blocks, flow: Flow, stars: Stars, paper: Paper, conic: Conic, topo: Topo, checker: Checker, rays: Rays, bokeh: Bokeh, circuit: Circuit, glass: Glass};

export const videoSeed = (sb: any): number => Number(sb && sb.seed) || hashStr(String((sb && sb.title) || "") + "|" + String(sb && sb.scenes ? sb.scenes.length : 0));

export const Backdrop = ({sb, i, T}: any) => {
  const frame = useCurrentFrame();
  const {width: w, height: h} = useVideoConfig();
  const sc = (sb.scenes && sb.scenes[i]) || {};
  if (sc.type === "clip" || sc.bg === "none" || sc.bg === "own") return null;
  const g = sb.bg && typeof sb.bg === "object" ? sb.bg : {};
  const own = sc.bg && typeof sc.bg === "object" ? sc.bg : {};
  const vs = videoSeed(sb);
  const order = BG_KINDS.map((k, idx) => ({k, r: random("fam-" + vs + "-" + idx)})).sort((a, b) => a.r - b.r).map((x) => x.k);
  const family = order.slice(0, 4 + Math.floor(random("famsize-" + vs) * 3));
  if (g.kind && BG_KINDS.indexOf(g.kind) >= 0 && family.indexOf(g.kind) < 0) family[0] = g.kind;
  const off = Math.floor(random("off-" + vs) * family.length);
  const kind = own.kind && DRAW[own.kind] ? own.kind : family[(i + off) % family.length];
  const seed = Number(own.seed) || vs * 31 + (i + 1) * 7919;
  const raw = (own.colors || g.colors || []).filter(hexOk);
  const roles = raw.length >= 2 ? raw.slice() : [T.accent, T.accent2, T.bg2, T.text].filter(hexOk);
  const rot = Math.floor(R(seed, "rot") * roles.length);
  const cols = roles.map((_: any, k: number) => roles[(k + rot) % roles.length]);
  const baseOpts = [own.base || g.base, T.bg1, T.bg2].filter(hexOk);
  const base = own.base && hexOk(own.base) ? own.base : R(seed, "base") > 0.3 ? T.bg1 : baseOpts[baseOpts.length - 1] || T.bg1;
  const mode = Math.floor(R(seed, "mode") * 3);
  const angle = Number.isFinite(Number(own.angle)) && own.angle !== undefined ? Number(own.angle) : Math.round(R(seed, "ang") * 360);
  const speed = (own.speed !== undefined ? Number(own.speed) : g.speed !== undefined ? Number(g.speed) : 0.5 + R(seed, "spd") * 1.0);
  const c: Ctx = {
    w, h, f: frame, t: (frame / 30) * speed, seed, cols, dark: T.dark !== false,
    intensity: own.intensity !== undefined ? Number(own.intensity) : g.intensity !== undefined ? Number(g.intensity) : 0.75 + R(seed, "int") * 0.5,
    scale: own.scale !== undefined ? Number(own.scale) : 0.75 + R(seed, "scl") * 0.6, angle, u: Math.min(w, h) / 720, big: Math.max(w, h),
  };
  const fadeIn = i > 0 ? interpolate(frame, [0, 12], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}) : 1;
  const bgFill = mode === 0 ? base : mode === 1 ? "linear-gradient(" + angle + "deg, " + base + ", " + (T.bg2 || base) + ")" : "radial-gradient(ellipse at " + Math.round(R(seed, "bx") * 100) + "% " + Math.round(R(seed, "by") * 100) + "%, " + (T.bg2 || base) + ", " + base + " 75%)";
  const vig = own.vignette !== undefined ? Number(own.vignette) : g.vignette !== undefined ? Number(g.vignette) : R(seed, "vig") > 0.35 ? 0.25 + R(seed, "vg2") * 0.35 : 0;
  const grain = typeof own.grain === "boolean" ? own.grain : typeof g.grain === "boolean" ? g.grain : R(seed, "gr") > 0.7;
  const Draw = DRAW[kind];
  return (
    <AbsoluteFill style={{opacity: fadeIn}}>
      <AbsoluteFill style={{background: bgFill}} />
      <Draw {...c} />
      {grain && kind !== "noise" && kind !== "paper" ? <Grain {...c} op={0.12} fq={0.8} /> : null}
      {vig > 0 ? <AbsoluteFill style={{background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0," + (c.dark ? vig : vig * 0.3) + ") 100%)"}} /> : null}
    </AbsoluteFill>
  );
};
`;
