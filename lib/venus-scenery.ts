// Venus Pro scenery engine: drawn worlds for stories (mountains, valleys, rivers, deserts, forests, sea, snow, cities, forts, a galloping rider,
// armies, birds, mist, sun/moon/stars) with parallax. Everything is code (SVG), driven by a seed, so no two places look the same.
// Written to src/scenery.tsx on every "prepare". NOTE: lives in a template string: no backticks, no dollar-brace sequences.
export const SCENERY_SOURCE = String.raw`import React from "react";
import {random} from "remotion";

const R = (seed: number, tag: string, i: number = 0): number => random("sc-" + seed + "-" + tag + "-" + i);
const hx = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a: string, b: string, t: number) => {
  const A = hx(a);
  const B = hx(b);
  return "#" + [0, 1, 2].map((i) => Math.round(A[i] * (1 - t) + B[i] * t).toString(16).padStart(2, "0")).join("");
};
const rgba = (c: string, a: number) => {
  const A = hx(c);
  return "rgba(" + A[0] + "," + A[1] + "," + A[2] + "," + a + ")";
};
const isHex = (c: any) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);

const SKY: any = {
  dawn: {top: "#1c2b4f", mid: "#8a5a8f", low: "#f2a65a", glow: "#ffd9a0", dark: "#241a2e", sun: "#ffe2b0", sunY: 0.6, stars: 0.25},
  day: {top: "#2f78c8", mid: "#6fb1e8", low: "#cfeaff", glow: "#ffffff", dark: "#27402f", sun: "#fff6d0", sunY: 0.2, stars: 0},
  sunset: {top: "#24173a", mid: "#a8404a", low: "#f6a04d", glow: "#ffd08a", dark: "#1b0f1a", sun: "#ffd9a0", sunY: 0.62, stars: 0.1},
  dusk: {top: "#0d1636", mid: "#4a3a78", low: "#d9806a", glow: "#f0b08a", dark: "#0c0a1c", sun: "#f3c9a0", sunY: 0.7, stars: 0.7},
  night: {top: "#04070f", mid: "#0b1633", low: "#1d3260", glow: "#9db7ff", dark: "#03050c", sun: "#e8eeff", sunY: 0.24, stars: 1},
};

const Horse = ({ph, col, rider}: any) => {
  const bob = Math.sin(ph * 2) * 3;
  const legs = [
    {x: 30, p: 0}, {x: 22, p: 0.7}, {x: -28, p: 2.6}, {x: -36, p: 3.3},
  ];
  return (
    <g transform={"translate(0," + bob + ")"} fill={col}>
      <ellipse cx={0} cy={0} rx={48} ry={21} />
      <polygon points="26,-14 50,-54 66,-62 74,-48 54,-10" />
      <polygon points="62,-62 94,-50 96,-41 84,-38 62,-46" />
      <polygon points="64,-62 67,-74 72,-62" />
      <path d={"M44,-50 Q30,-52 20,-34 Q38,-40 52,-30 Z"} />
      <path d={"M-44,-10 Q-78,-18 -92," + (14 + Math.sin(ph) * 6) + " Q-70,-2 -44,6 Z"} />
      {legs.map((l, i) => {
        const a = Math.sin(ph + l.p) * 38;
        const k = -Math.max(0, Math.sin(ph + l.p + 1.1)) * 46;
        return (
          <g key={i} transform={"translate(" + l.x + ",12) rotate(" + a + ")"}>
            <polygon points="-6,0 6,0 4,30 -3,30" />
            <g transform={"translate(0,30) rotate(" + k + ")"}>
              <polygon points="-3,0 4,0 3,30 -3,30" />
              <polygon points="-4,28 5,28 8,35 -5,35" />
            </g>
          </g>
        );
      })}
      {rider ? (
        <g>
          <polygon points="-4,-18 14,-18 24,-54 6,-58" />
          <circle cx={16} cy={-67} r={8.5} />
          <ellipse cx={16} cy={-74} rx={11} ry={6} />
          <path d={"M4,-56 Q-18," + (-60 + Math.sin(ph * 2) * 5) + " -34," + (-46 + Math.sin(ph * 2 + 1) * 6) + " Q-14,-48 6,-46 Z"} />
          <line x1={20} y1={-48} x2={50} y2={-40} stroke={col} strokeWidth={5} strokeLinecap="round" />
          <line x1={-34} y1={-14} x2={128} y2={-98} stroke={col} strokeWidth={3} strokeLinecap="round" />
          <polygon points="128,-98 140,-108 132,-92" />
        </g>
      ) : null}
    </g>
  );
};

const Soldier = ({col, sway, flag}: any) => (
  <g fill={col}>
    <rect x={-3} y={-22} width={6} height={22} />
    <circle cx={0} cy={-27} r={4.2} />
    <line x1={5} y1={0} x2={5 + sway} y2={-52} stroke={col} strokeWidth={1.6} />
    {flag ? <path d={"M" + (5 + sway) + ",-52 l14," + (3 + sway) + " l-14,7 Z"} /> : null}
  </g>
);

const Fort = ({col, s}: any) => {
  const merl: any[] = [];
  for (let i = 0; i < 9; i++) merl.push(<rect key={i} x={-58 + i * 14} y={-62} width={8} height={9} />);
  return (
    <g fill={col} transform={"scale(" + s + ")"}>
      <rect x={-60} y={-54} width={122} height={54} />
      {merl}
      <rect x={-76} y={-92} width={24} height={92} />
      <path d={"M-76,-92 Q-64,-116 -52,-92 Z"} />
      <rect x={-65} y={-122} width={2.5} height={14} />
      <rect x={50} y={-96} width={26} height={96} />
      <path d={"M50,-96 Q63,-122 76,-96 Z"} />
      <rect x={-8} y={-84} width={22} height={30} />
      <path d={"M-8,-84 Q3,-106 14,-84 Z"} />
      <path d={"M-14,0 L-14,-22 Q0,-40 14,-22 L14,0 Z"} fill={mix(col, "#000000", 0.5)} />
    </g>
  );
};

export const Scenery = ({c, spec, terrainSeed}: any) => {
  const {w, h, t, u} = c;
  const biome = ["mountains", "valley", "desert", "forest", "sea", "plains", "snow", "city"].indexOf(spec.biome) >= 0 ? spec.biome : "mountains";
  const timeKey = SKY[spec.time] ? spec.time : "sunset";
  const S0 = SKY[timeKey];
  const oc = (spec.colors || []).filter(isHex);
  const S = oc.length >= 3 ? {...S0, top: oc[0], mid: mix(oc[0], oc[1], 0.5), low: oc[1], dark: oc[2], glow: mix(oc[1], "#ffffff", 0.4)} : S0;
  const seed = terrainSeed;
  const sceneSeed = c.seed;
  const n = Math.max(2, Math.min(7, Math.round(Number(spec.layers) || (biome === "sea" ? 2 : 5))));
  const horizon = h * (biome === "sea" ? 0.6 : biome === "plains" || biome === "desert" ? 0.58 : 0.5);
  const amp0 = biome === "mountains" || biome === "snow" || biome === "valley" ? 0.2 : biome === "forest" ? 0.1 : biome === "city" ? 0.02 : biome === "desert" ? 0.07 : 0.045;
  const hasFig = spec.figure === "rider" || spec.figure === "horse";
  const speed = (hasFig ? 5 : 1) * (Number(spec.drift) >= 0 && spec.drift !== undefined ? Number(spec.drift) : 1) * 16 * u;
  const showSun = spec.sun !== false && biome !== "city" || spec.sun === true;
  const sunX = w * (0.3 + R(sceneSeed, "sx") * 0.4);
  const sunY = h * S.sunY;
  const sunR = Math.min(w, h) * (timeKey === "night" ? 0.07 : 0.1);
  const stars = spec.stars === false ? 0 : S.stars;
  const el: any[] = [];

  // sky
  el.push(
    <defs key="d">
      <linearGradient id={"sky" + seed} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={S.top} />
        <stop offset="0.55" stopColor={S.mid} />
        <stop offset="1" stopColor={S.low} />
      </linearGradient>
      <radialGradient id={"glow" + seed}>
        <stop offset="0" stopColor={rgba(S.glow, 0.95)} />
        <stop offset="0.35" stopColor={rgba(S.glow, 0.35)} />
        <stop offset="1" stopColor={rgba(S.glow, 0)} />
      </radialGradient>
      <linearGradient id={"water" + seed} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={mix(S.low, S.mid, 0.2)} />
        <stop offset="1" stopColor={mix(S.mid, S.dark, 0.55)} />
      </linearGradient>
      <linearGradient id={"mist" + seed} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={rgba(S.glow, 0)} />
        <stop offset="0.5" stopColor={rgba(S.glow, 0.28)} />
        <stop offset="1" stopColor={rgba(S.glow, 0)} />
      </linearGradient>
    </defs>
  );
  el.push(<rect key="sky" x={0} y={0} width={w} height={h} fill={"url(#sky" + seed + ")"} />);

  // stars
  const ns = Math.round(stars * 90);
  for (let i = 0; i < ns; i++) {
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (0.7 + R(sceneSeed, "ts", i) * 2) + i));
    el.push(<circle key={"s" + i} cx={R(sceneSeed, "stx", i) * w} cy={R(sceneSeed, "sty", i) * horizon * 0.95} r={(0.8 + R(sceneSeed, "str", i) * 1.8) * u} fill="#ffffff" opacity={tw * stars} />);
  }
  // sun / moon
  if (showSun) {
    el.push(<circle key="sunglow" cx={sunX} cy={sunY} r={sunR * 4.2} fill={"url(#glow" + seed + ")"} />);
    el.push(<circle key="sun" cx={sunX} cy={sunY} r={sunR} fill={S.sun} />);
  }
  // clouds
  if (timeKey !== "night") {
    for (let i = 0; i < 5; i++) {
      const cw = w * (0.18 + R(sceneSeed, "cw", i) * 0.22);
      const cx = (((R(sceneSeed, "cx", i) * w * 1.4 + t * (4 + i * 2) * u) % (w * 1.4)) - w * 0.2);
      const cy = h * (0.08 + R(sceneSeed, "cy", i) * 0.28);
      el.push(
        <g key={"cl" + i} opacity={0.28 + R(sceneSeed, "co", i) * 0.25} fill={timeKey === "day" ? "#ffffff" : mix(S.low, "#ffffff", 0.3)}>
          <ellipse cx={cx} cy={cy} rx={cw * 0.5} ry={cw * 0.07} />
          <ellipse cx={cx - cw * 0.18} cy={cy - cw * 0.04} rx={cw * 0.3} ry={cw * 0.07} />
          <ellipse cx={cx + cw * 0.2} cy={cy - cw * 0.03} rx={cw * 0.28} ry={cw * 0.06} />
        </g>
      );
    }
  }

  // sea: water instead of hills
  if (biome === "sea") {
    el.push(<rect key="sea" x={0} y={horizon} width={w} height={h - horizon} fill={"url(#water" + seed + ")"} />);
    el.push(<rect key="seaglow" x={sunX - sunR * 0.8} y={horizon} width={sunR * 1.6} height={h - horizon} fill={rgba(S.glow, 0.28)} />);
    for (let i = 0; i < 16; i++) {
      const y = horizon + ((i + 1) / 16) * (h - horizon) * 0.95;
      let d = "M0 " + y;
      for (let x = 0; x <= w + 10; x += w / 24) d += " L " + x + " " + (y + Math.sin(x * 0.02 / u + t * 1.4 + i * 1.7) * (2 + i * 0.6) * u);
      el.push(<path key={"wv" + i} d={d} fill="none" stroke={rgba(S.glow, 0.1 + (i / 16) * 0.2)} strokeWidth={(1 + i * 0.1) * u} />);
    }
  }

  // layered land (far -> near), every layer drifts at its own speed (parallax)
  const layerCount = biome === "sea" ? 0 : n;
  const riverEls: any[] = [];
  const ridgeY = (x: number, i: number) => {
    const f = layerCount > 1 ? i / (layerCount - 1) : 0;
    const base = horizon + h * (0.02 + f * 0.17);
    const open = hasFig || spec.river === true || biome === "valley" || spec.fort === true;
    let prof = 0.45 + f * 0.95;
    if (open) prof = f < 0.5 ? 0.6 + f * 1.6 : Math.max(0.12, 1.4 - f * 1.9); // mountains behind, open ground in front
    const A = h * amp0 * prof;
    let y = 0;
    const ks = biome === "desert" || biome === "plains" ? [1, 2, 3] : [1, 2, 3, 5, 8];
    ks.forEach((k, j) => {
      const sharp = biome === "mountains" || biome === "snow" || biome === "valley";
      const ph = R(seed, "ph" + i, j) * 6.283;
      const wave = Math.sin((6.283 * k * x) / w + ph);
      y += (sharp && j > 0 ? 1 - Math.abs(wave) * 1.1 : wave) * A * (j === 0 ? 1 : 0.62 / (j + 0.4));
    });
    return base - y * 0.9;
  };
  const stand = Math.max(1, layerCount - 2); // the layer that carries the fort and the army
  let standX = w * 0.5;
  {
    let best = -1e9;
    for (let k = 0; k < 24; k++) {
      const x = w * (0.18 + (k / 23) * 0.64);
      let gap = 1e9;
      for (let j = stand + 1; j < layerCount; j++) gap = Math.min(gap, ridgeY(x, j) - ridgeY(x, stand));
      const score = Math.min(gap, 200) - Math.abs(x - w * 0.5) * 0.02;
      if (score > best) { best = score; standX = x; }
    }
  }
  for (let i = 0; i < layerCount; i++) {
    const f = layerCount > 1 ? i / (layerCount - 1) : 0;
    let col = mix(mix(S.low, S.mid, 0.35), S.dark, 0.18 + (hasFig ? 0.6 : 0.82) * Math.pow(f, 0.85));
    if (biome === "desert") col = mix(col, timeKey === "night" ? "#2a2236" : "#c9904f", 0.32);
    if (biome === "snow") col = mix(col, "#e8f1ff", 0.55 - f * 0.3);
    if (biome === "forest") col = mix(col, "#183a2a", 0.4);
    const factor = 0.12 + 0.88 * f;
    const off = (t * speed * factor) % w;
    const pts: string[] = [];
    for (let x = 0; x <= w * 2 + 1; x += w / 36) pts.push(x.toFixed(1) + " " + ridgeY(x, i).toFixed(1));
    const d = "M0 " + h + " L" + pts.join(" L") + " L" + w * 2 + " " + h + " Z";
    const kids: any[] = [];
    // things standing on this layer
    for (const rep of [0, 1]) {
      if (biome === "city") {
        for (let b = 0; b < 16; b++) {
          const bx = (b / 16) * w + rep * w + R(seed, "bx" + i, b) * 14 * u;
          const bh = h * (0.04 + R(seed, "bh" + i, b) * (0.1 + f * 0.1));
          const bw = (w / 16) * (0.6 + R(seed, "bw" + i, b) * 0.5);
          kids.push(<rect key={"b" + rep + b} x={bx} y={ridgeY(bx, i) - bh} width={bw} height={bh + 6} fill={col} />);
          if ((timeKey === "night" || timeKey === "dusk") && f > 0.3) {
            for (let wy = 0; wy < bh - 8 * u; wy += 12 * u) if (R(seed, "wn" + i + b, wy) > 0.55) kids.push(<rect key={"w" + rep + b + wy} x={bx + bw * 0.3} y={ridgeY(bx, i) - bh + wy + 4 * u} width={bw * 0.18} height={5 * u} fill="#ffd98a" opacity={0.85} />);
          }
        }
      }
      if ((biome === "forest" || biome === "plains" || spec.trees === true) && i >= 1) {
        const nt = biome === "forest" ? 26 : 7;
        for (let k = 0; k < nt; k++) {
          const tx = (k / nt) * w + rep * w + R(seed, "tx" + i, k) * (w / nt);
          const ty = ridgeY(tx, i);
          const ts = (10 + f * 26) * u * (0.7 + R(seed, "ts" + i, k) * 0.7);
          kids.push(biome === "forest" || R(seed, "pine", k) > 0.5
            ? <polygon key={"t" + rep + k} points={tx + "," + (ty - ts * 2.6) + " " + (tx - ts * 0.8) + "," + ty + " " + (tx + ts * 0.8) + "," + ty} fill={col} />
            : <g key={"t" + rep + k}><rect x={tx - ts * 0.08} y={ty - ts * 1.1} width={ts * 0.16} height={ts * 1.1} fill={col} /><circle cx={tx} cy={ty - ts * 1.5} r={ts * 0.7} fill={col} /></g>);
        }
      }
      if (spec.fort === true && i === stand) {
        const fx = standX + rep * w;
        kids.push(<g key={"f" + rep} transform={"translate(" + fx + "," + (ridgeY(fx, i) + 4) + ")"}><Fort col={mix(col, S.dark, 0.25)} s={(0.55 + f * 0.7) * u} /></g>);
      }
      if (spec.figure === "army" && i === stand) {
        for (let k = 0; k < 18; k++) {
          const sx = w * (0.1 + (k / 18) * 0.8) + rep * w;
          const sy = ridgeY(sx, i) + 3 * u;
          kids.push(<g key={"a" + rep + k} transform={"translate(" + sx + "," + sy + ") scale(" + (0.9 + f * 0.8) * u + ")"}><Soldier col={mix(col, S.dark, 0.35)} sway={Math.sin(t * 2 + k) * 3} flag={k % 6 === 0} /></g>);
        }
      }
    }
    el.push(<g key={"L" + i}>
      <g transform={"translate(" + -off + ",0)"}>
        <path d={d} fill={col} />
        {kids}
      </g>
      {spec.mist !== false && i < layerCount - 1 && (i === 1 || i === 2) ? <rect x={0} y={horizon + h * (0.02 + f * 0.17) - h * 0.1} width={w} height={h * 0.22} fill={"url(#mist" + seed + ")"} opacity={0.9} /> : null}
    </g>);
    // the river runs between the far and the near land
    if (spec.river === true || (biome === "valley" && spec.river !== false)) {
      if (i === Math.max(1, layerCount - 3)) { // the layers in front of it are low, so the river stays visible
        const yh = ridgeY(w / 2, i) + 2;
        const xc = (y: number) => w * (0.5 + 0.16 * Math.sin((y / h) * 7 + seed) * ((y - yh) / (h - yh)));
        const wid = (y: number) => w * (0.012 + 0.34 * Math.pow((y - yh) / (h - yh), 1.7));
        let L = "";
        let Rr = "";
        for (let k = 0; k <= 22; k++) {
          const y = yh + ((h - yh) * k) / 22;
          L += (k === 0 ? "M" : " L") + (xc(y) - wid(y)).toFixed(1) + " " + y.toFixed(1);
          Rr = " L" + (xc(y) + wid(y)).toFixed(1) + " " + y.toFixed(1) + Rr;
        }
        riverEls.push(<path key="river" d={L + Rr + " Z"} fill={"url(#water" + seed + ")"} />);
        for (let k = 0; k < 14; k++) {
          const y = yh + ((h - yh) * (k + 1)) / 15;
          const half = wid(y) * 0.85;
          const x0 = xc(y) - half + ((t * 20 * u * (0.4 + k * 0.1) + k * 37) % (half * 2));
          riverEls.push(<line key={"rv" + k} x1={x0} y1={y} x2={x0 + wid(y) * 0.25} y2={y} stroke={rgba(S.glow, 0.45)} strokeWidth={(1 + k * 0.15) * u} strokeLinecap="round" />);
        }
      }
    }
  }

  el.push(...riverEls); // the river flows over the open ground, below the foreground bank

  // birds
  if (spec.birds === true) {
    for (let i = 0; i < 6; i++) {
      const bx = (((R(sceneSeed, "bx", i) * w * 1.3 + t * (22 + i * 5) * u) % (w * 1.3)) - w * 0.15);
      const by = h * (0.16 + R(sceneSeed, "by", i) * 0.22) + Math.sin(t * 1.2 + i) * 8 * u;
      const fl = Math.sin(t * 7 + i * 2) * 0.7;
      el.push(<path key={"bd" + i} d={"M-9,0 Q-4," + -7 * fl + " 0,0 Q4," + -7 * fl + " 9,0"} transform={"translate(" + bx + "," + by + ") scale(" + u * 1.2 + ")"} fill="none" stroke={S.dark} strokeWidth={1.8} strokeLinecap="round" />);
    }
  }

  // foreground: dark bank with grass, and the galloping rider
  const fg = mix(S.dark, "#000000", 0.3);
  let gd = "M0 " + h;
  for (let x = 0; x <= w + 1; x += w / 40) gd += " L" + x.toFixed(1) + " " + (h * 0.9 + Math.sin(x * 0.012 / u + seed) * h * 0.012 - (R(seed, "g", Math.round(x)) > 0.6 ? 7 * u : 0)).toFixed(1);
  gd += " L" + w + " " + h + " Z";
  if (hasFig) {
    const fs = (Number(spec.figScale) || 1) * u * 1.5;
    const fxp = w * (Number(spec.figX) >= 0 && spec.figX !== undefined ? Number(spec.figX) : 0.42);
    const fyp = h * (Number(spec.figY) >= 0 && spec.figY !== undefined ? Number(spec.figY) : 0.8);
    const flip = spec.figDir === "left";
    el.push(
      <g key="fig" transform={"translate(" + fxp + "," + fyp + ") scale(" + (flip ? -fs : fs) + "," + fs + ")"}>
        <ellipse cx={0} cy={44} rx={80} ry={5} fill="rgba(0,0,0,0.35)" />
        <Horse ph={t * 9} col={fg} rider={spec.figure === "rider"} />
      </g>
    );
    // dust
    for (let i = 0; i < 9; i++) {
      const life = ((t * 1.6 + i / 9) % 1);
      el.push(<circle key={"du" + i} cx={fxp + (flip ? 1 : -1) * (60 + life * 150) * u} cy={fyp + 38 * u - life * 24 * u} r={(8 + life * 26) * u} fill={rgba(S.glow, 0.2 * (1 - life))} />);
    }
  }
  el.push(<path key="fg" d={gd} fill={fg} />);

  return <svg width={w} height={h} style={{position: "absolute", left: 0, top: 0}}>{el}</svg>;
};
`;
