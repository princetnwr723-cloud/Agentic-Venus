export const TEMPLATE_VERSION = "1";

export const TEMPLATE_FILES: Record<string, string> = {
  "package.json": String.raw`{"name":"venus-studio","private":true,"version":"1.0.0"}`,

  "tsconfig.json": String.raw`{"compilerOptions":{"target":"ES2018","module":"commonjs","jsx":"react-jsx","strict":false,"moduleResolution":"node","esModuleInterop":true,"skipLibCheck":true}}`,

  "src/index.ts": String.raw`import {registerRoot} from "remotion";
import {Root} from "./Root";
registerRoot(Root);
`,

  "src/theme.ts": String.raw`import {loadFont as loadInter} from "@remotion/google-fonts/Inter";
import {loadFont as loadMontserrat} from "@remotion/google-fonts/Montserrat";

const inter = loadInter("normal", {weights: ["400", "500", "600"], subsets: ["latin"]});
const mont = loadMontserrat("normal", {weights: ["600", "800"], subsets: ["latin"]});

export const FONT_BODY = inter.fontFamily + ", 'Liberation Sans', Arial, sans-serif";
export const FONT_DISPLAY = mont.fontFamily + ", 'Liberation Sans', Arial, sans-serif";

const dark = (o: any) =>
  Object.assign({dark: true, card: "rgba(255,255,255,0.07)", line: "rgba(255,255,255,0.14)", onAccent: "#06070d"}, o);

export const THEMES: any = {
  midnight: dark({bg1: "#070b1f", bg2: "#111a45", accent: "#5b8cff", accent2: "#a66bff", text: "#f4f6ff", muted: "#9aa6d6"}),
  sunset: dark({bg1: "#1a0b1f", bg2: "#3b1233", accent: "#ff7a45", accent2: "#ff4d8d", text: "#fff4ef", muted: "#d9a9b8"}),
  emerald: dark({bg1: "#04150f", bg2: "#0a2e22", accent: "#2de2a6", accent2: "#7ae0ff", text: "#effff9", muted: "#8fc9b6"}),
  gold: dark({bg1: "#0a0a0b", bg2: "#1b1b1f", accent: "#e7b24d", accent2: "#ffd98a", text: "#f1f0ec", muted: "#8b8a90"}),
  neon: dark({bg1: "#05040a", bg2: "#120a2a", accent: "#00f0ff", accent2: "#ff2ec4", text: "#f5f5ff", muted: "#8f8fb8"}),
  paper: {dark: false, bg1: "#f6f1e7", bg2: "#ebe3d2", accent: "#e5483a", accent2: "#1d3557", text: "#16161a", muted: "#6b675c", card: "rgba(0,0,0,0.05)", line: "rgba(0,0,0,0.12)", onAccent: "#ffffff"},
};
`,

  "src/kit.tsx": String.raw`import React from "react";
import {AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {FONT_BODY, FONT_DISPLAY} from "./theme";

export const EASE = Easing.bezier(0.16, 1, 0.3, 1);
export const clampArr = (a: any, n: number): any[] => (Array.isArray(a) ? a : []).slice(0, n);
export const num = (v: any, d: number = 0): number => {
  const x = Number(v);
  return isFinite(x) ? x : d;
};
export const txt = (v: any): string =>
  typeof v === "string" ? v : v && typeof v === "object" ? String(v.text || v.title || v.label || v.name || "") : v === undefined || v === null ? "" : String(v);
export const fit = (text: any, base: number, maxChars: number): number => {
  const n = String(text || "").length || 1;
  return base * Math.min(1, Math.max(0.5, maxChars / n));
};
export const grad = (T: any) => "linear-gradient(135deg, " + T.accent + ", " + T.accent2 + ")";
export const H = (size: number, T: any): any => ({
  fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: size, color: T.text, letterSpacing: "-0.02em", lineHeight: 1.08,
});

export function useU() {
  const {width, height} = useVideoConfig();
  return {u: Math.min(width, height) / 720, w: width, h: height, portrait: height > width};
}

export const Frame = ({children}: any) => {
  const {u, portrait} = useU();
  return (
    <AbsoluteFill style={{padding: (portrait ? 56 : 84) * u, justifyContent: "center", fontFamily: FONT_BODY}}>
      {children}
    </AbsoluteFill>
  );
};

export const Rise = ({children, delay = 0, dist = 40, style}: any) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({frame: frame - delay, fps, config: {damping: 200}});
  return <div style={{opacity: p, transform: "translateY(" + (1 - p) * dist + "px)", ...style}}>{children}</div>;
};

export const Background = ({T}: any) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const t = frame / 30;
  const big = Math.max(width, height);
  const blob = (x: number, y: number, size: number, color: string, sp: number, ph: number, key: string) => (
    <div
      key={key}
      style={{
        position: "absolute", width: size, height: size, borderRadius: "50%",
        left: width * x + Math.sin(t * sp + ph) * width * 0.06 - size / 2,
        top: height * y + Math.cos(t * sp * 0.8 + ph) * height * 0.06 - size / 2,
        background: "radial-gradient(circle, " + color + " 0%, transparent 65%)",
        opacity: T.dark ? 0.42 : 0.3,
      }}
    />
  );
  const dots: any[] = [];
  for (let i = 0; i < 26; i++) {
    const x = random("x" + i) * width;
    const y0 = random("y" + i) * height;
    const s = 2 + random("s" + i) * 4;
    const sp = 8 + random("v" + i) * 22;
    const y = (((y0 - t * sp) % height) + height) % height;
    dots.push(
      <div key={i} style={{position: "absolute", left: x, top: y, width: s, height: s, borderRadius: "50%", background: T.text, opacity: 0.08 + random("o" + i) * 0.12}} />
    );
  }
  return (
    <AbsoluteFill style={{background: "linear-gradient(135deg, " + T.bg1 + ", " + T.bg2 + ")"}}>
      {blob(0.2, 0.25, big * 0.8, T.accent, 0.35, 0, "a")}
      {blob(0.85, 0.8, big * 0.9, T.accent2, 0.28, 2, "b")}
      {dots}
      <AbsoluteFill style={{background: "radial-gradient(ellipse at center, transparent 55%, " + (T.dark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.10)") + " 100%)"}} />
    </AbsoluteFill>
  );
};

export const Shell = ({children, transition, dur}: any) => {
  const frame = useCurrentFrame();
  const IN = 16;
  const OUT = 12;
  const e = interpolate(frame, [0, IN], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE});
  const x = interpolate(frame, [dur - OUT, dur], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic)});
  let style: any = {opacity: e * (1 - x)};
  if (transition === "slide") style = {opacity: e * (1 - x), transform: "translateX(" + ((1 - e) * 70 - x * 70) + "px)"};
  else if (transition === "zoom") style = {opacity: e * (1 - x), transform: "scale(" + (1 + (1 - e) * 0.09 - x * 0.05) + ")"};
  else if (transition === "wipe") style = {opacity: 1 - x, clipPath: "inset(0 " + (1 - e) * 100 + "% 0 0)"};
  else if (transition === "blur") style = {opacity: e * (1 - x), filter: "blur(" + ((1 - e) * 22 + x * 14) + "px)"};
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

export const Captions = ({text, dur, T}: any) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {u, h, portrait} = useU();
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const start = 10;
  const end = Math.max(start + 10, dur - 14);
  const per = (end - start) / words.length;
  const idx = Math.min(words.length - 1, Math.max(0, Math.floor((frame - start) / per)));
  const chunk = portrait ? 4 : 6;
  const base = Math.floor(idx / chunk) * chunk;
  const show = words.slice(base, base + chunk);
  const enter = interpolate(frame, [4, 14], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const out = interpolate(frame, [dur - 12, dur - 4], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{justifyContent: "flex-end", alignItems: "center", paddingBottom: h * 0.075, opacity: enter * out}}>
      <div style={{display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 * u, maxWidth: "86%", padding: 14 * u + "px " + 26 * u + "px", borderRadius: 18 * u, background: "rgba(0,0,0,0.58)", fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: (portrait ? 46 : 40) * u}}>
        {show.map((w: string, i: number) => {
          const active = base + i === idx;
          const s = spring({frame: frame - (start + (base + i) * per), fps, config: {damping: 14, stiffness: 180}});
          return (
            <span key={i} style={{color: active ? T.accent : "#ffffff", transform: "scale(" + (active ? 1.06 + 0.04 * s : 1) + ")", opacity: base + i <= idx ? 1 : 0.35}}>
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
`,

  "src/scenes.tsx": String.raw`import React from "react";
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {FONT_BODY, FONT_DISPLAY} from "./theme";
import {EASE, Frame, H, Rise, clampArr, fit, grad, num, txt, useU} from "./kit";

export const TitleScene = ({p, T}: any) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const {u, portrait} = useU();
  const fs = num(p.fontScale, 1);
  const words = String(p.headline || "").split(" ").filter(Boolean);
  const size = fit(p.headline, portrait ? 96 : 104, 20) * u * fs;
  const bar = interpolate(frame, [0, 24], [0, 1], {extrapolateRight: "clamp", easing: EASE});
  const s = Math.min(width, height) * 0.9;
  return (
    <Frame>
      <div style={{width: 120 * u * bar, height: 8 * u, background: grad(T), borderRadius: 99, marginBottom: 36 * u}} />
      <div style={{display: "flex", flexWrap: "wrap", gap: "0 " + 0.28 * size + "px", fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: size, lineHeight: 1.05, letterSpacing: "-0.03em", color: T.text}}>
        {words.map((w: string, i: number) => (
          <Rise key={i} delay={6 + i * 4} dist={50 * u}>{w}</Rise>
        ))}
      </div>
      {p.subhead ? (
        <Rise delay={14 + words.length * 4} style={{marginTop: 32 * u, fontSize: 34 * u * fs, color: T.muted, maxWidth: "80%", lineHeight: 1.35}}>
          {p.subhead}
        </Rise>
      ) : null}
      <div style={{position: "absolute", right: -s * 0.25, bottom: -s * 0.25, width: s, height: s, opacity: 0.5, transform: "rotate(" + frame * 0.3 + "deg)"}}>
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <circle cx="50" cy="50" r="46" fill="none" stroke={T.accent} strokeWidth="0.4" strokeDasharray="2 3" />
          <circle cx="50" cy="50" r="34" fill="none" stroke={T.accent2} strokeWidth="0.5" />
          <circle cx="50" cy="4" r="2" fill={T.accent} />
        </svg>
      </div>
    </Frame>
  );
};

export const KineticScene = ({p, T, dur}: any) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {u, portrait} = useU();
  const fs = num(p.fontScale, 1);
  const words = String(p.text || "").split(/\s+/).filter(Boolean);
  const norm = (w: any) => String(w).toLowerCase().replace(/[^a-z0-9]/g, "");
  const emph = clampArr(p.emphasis, 8).map(norm);
  const size = fit(p.text, portrait ? 88 : 96, 38) * u * fs;
  const per = Math.max(3, Math.min(8, (dur - 40) / Math.max(1, words.length)));
  return (
    <Frame>
      <div style={{display: "flex", flexWrap: "wrap", gap: 0.18 * size + "px " + 0.3 * size + "px", fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: size, lineHeight: 1.05, letterSpacing: "-0.02em"}}>
        {words.map((w: string, i: number) => {
          const s = spring({frame: frame - (6 + i * per), fps, config: {damping: 12, stiffness: 140}});
          const isE = emph.includes(norm(w));
          return (
            <span key={i} style={{display: "inline-block", opacity: Math.min(1, s * 1.5), transform: "translateY(" + (1 - s) * 40 * u + "px) scale(" + (0.7 + 0.3 * s) + ") rotate(" + (1 - s) * (i % 2 ? 4 : -4) + "deg)", color: isE ? T.accent : T.text, textShadow: isE ? "0 0 " + 30 * u + "px " + T.accent + "66" : "none"}}>
              {w}
            </span>
          );
        })}
      </div>
    </Frame>
  );
};

export const BulletsScene = ({p, T}: any) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {u} = useU();
  const fs = num(p.fontScale, 1);
  const items = clampArr(p.items, 5);
  return (
    <Frame>
      <Rise dist={30 * u} style={{...H(fit(p.headline, 64, 26) * u * fs, T), marginBottom: 34 * u}}>{p.headline}</Rise>
      <div style={{display: "flex", flexDirection: "column", gap: 16 * u}}>
        {items.map((it: any, i: number) => {
          const s = spring({frame: frame - (14 + i * 9), fps, config: {damping: 200}});
          return (
            <div key={i} style={{display: "flex", alignItems: "center", gap: 22 * u, padding: 20 * u + "px " + 26 * u + "px", background: T.card, border: "1px solid " + T.line, borderRadius: 22 * u, opacity: s, transform: "translateX(" + (1 - s) * -90 * u + "px)"}}>
              <div style={{flexShrink: 0, width: 46 * u, height: 46 * u, borderRadius: 99, background: grad(T), color: T.onAccent, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 24 * u}}>{i + 1}</div>
              <div style={{color: T.text, fontSize: fit(txt(it), 38, 46) * u * fs, fontWeight: 600, lineHeight: 1.25}}>{txt(it)}</div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

export const StatScene = ({p, T, dur}: any) => {
  const frame = useCurrentFrame();
  const {u, portrait} = useU();
  const fs = num(p.fontScale, 1);
  const target = num(p.value, 0);
  const dec = Math.max(0, Math.min(3, Math.round(num(p.decimals, 0))));
  const prog = interpolate(frame, [10, Math.max(20, Math.min(64, dur - 24))], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE});
  const shown = (target * prog).toLocaleString("en-US", {minimumFractionDigits: dec, maximumFractionDigits: dec});
  const R = 46;
  const C = 2 * Math.PI * R;
  const len = shown.length + String(p.prefix || "").length + String(p.suffix || "").length;
  const size = (portrait ? 150 : 190) * u * fs * Math.min(1, 7 / Math.max(4, len));
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY}}>
      <svg width={560 * u} height={560 * u} viewBox="0 0 100 100" style={{position: "absolute", transform: "rotate(-90deg)"}}>
        <circle cx="50" cy="50" r={R} fill="none" stroke={T.line} strokeWidth="1.2" />
        <circle cx="50" cy="50" r={R} fill="none" stroke={T.accent} strokeWidth="1.8" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - prog)} />
      </svg>
      <div style={{textAlign: "center", maxWidth: "80%"}}>
        <Rise dist={20 * u} style={{fontSize: 26 * u, letterSpacing: "0.18em", textTransform: "uppercase", color: T.muted, fontWeight: 600}}>{p.label}</Rise>
        <div style={{fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: size, color: T.text, lineHeight: 1.05, margin: 10 * u + "px 0"}}>
          <span style={{color: T.accent, fontSize: size * 0.6}}>{p.prefix || ""}</span>
          {shown}
          <span style={{color: T.accent, fontSize: size * 0.6}}>{p.suffix || ""}</span>
        </div>
        {p.caption ? <Rise delay={24} dist={20 * u} style={{fontSize: 30 * u * fs, color: T.muted, lineHeight: 1.3}}>{p.caption}</Rise> : null}
      </div>
    </AbsoluteFill>
  );
};

export const BarChartScene = ({p, T}: any) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {u, portrait} = useU();
  const fs = num(p.fontScale, 1);
  const data = clampArr(p.data, 6).map((d: any) => ({label: txt(d && d.label), value: num(d && d.value, 0)}));
  const max = Math.max(1, ...data.map((d: any) => d.value));
  const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");
  return (
    <Frame>
      <Rise dist={30 * u} style={{...H(fit(p.headline, 60, 28) * u * fs, T), marginBottom: 38 * u}}>{p.headline}</Rise>
      <div style={{display: "flex", flexDirection: "column", gap: 20 * u}}>
        {data.map((d: any, i: number) => {
          const s = spring({frame: frame - (12 + i * 8), fps, config: {damping: 200}});
          return (
            <div key={i} style={{display: "flex", alignItems: "center", gap: 20 * u}}>
              <div style={{width: (portrait ? 190 : 250) * u, textAlign: "right", fontSize: 28 * u * fs, color: T.muted, fontWeight: 600}}>{d.label}</div>
              <div style={{flex: 1, height: 44 * u, background: T.card, borderRadius: 99, overflow: "hidden"}}>
                <div style={{width: (d.value / max) * 100 * s + "%", height: "100%", background: grad(T), borderRadius: 99}} />
              </div>
              <div style={{width: 150 * u, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 30 * u * fs, color: T.text}}>{fmt(d.value * s) + (p.unit ? " " + p.unit : "")}</div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

export const LineChartScene = ({p, T, dur}: any) => {
  const frame = useCurrentFrame();
  const {u} = useU();
  const fs = num(p.fontScale, 1);
  const data = clampArr(p.data, 8).map((d: any) => ({label: txt(d && d.label), value: num(d && d.value, 0)}));
  const W = 1000;
  const Hh = 460;
  const padX = 60;
  const padY = 50;
  const vals = data.map((d: any) => d.value);
  const min = Math.min(0, ...vals);
  const max = Math.max(1, ...vals);
  const pts = data.map((d: any, i: number) => ({
    x: data.length > 1 ? padX + (i * (W - 2 * padX)) / (data.length - 1) : W / 2,
    y: padY + (1 - (d.value - min) / (max - min || 1)) * (Hh - 2 * padY),
  }));
  const prog = interpolate(frame, [14, Math.max(30, Math.min(72, dur - 24))], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE});
  let path = "";
  pts.forEach((q: any, i: number) => {
    if (i === 0) path = "M " + q.x + " " + q.y;
    else {
      const a = pts[i - 1];
      const mx = (a.x + q.x) / 2;
      path += " C " + mx + " " + a.y + " " + mx + " " + q.y + " " + q.x + " " + q.y;
    }
  });
  const area = pts.length > 1 ? path + " L " + pts[pts.length - 1].x + " " + Hh + " L " + pts[0].x + " " + Hh + " Z" : "";
  return (
    <Frame>
      <Rise dist={30 * u} style={{...H(fit(p.headline, 60, 28) * u * fs, T), marginBottom: 24 * u}}>{p.headline}</Rise>
      {pts.length > 1 ? (
        <svg viewBox={"0 0 " + W + " " + (Hh + 70)} width="100%" style={{overflow: "visible"}}>
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={T.accent} stopOpacity="0.45" />
              <stop offset="100%" stopColor={T.accent} stopOpacity="0" />
            </linearGradient>
            <clipPath id="lc"><rect x="0" y="0" width={W * prog} height={Hh + 70} /></clipPath>
          </defs>
          <path d={area} fill="url(#lg)" clipPath="url(#lc)" />
          <path d={path} fill="none" stroke={T.accent} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - prog} />
          {pts.map((q: any, i: number) => {
            const shown = prog >= i / (pts.length - 1) - 0.001;
            return (
              <g key={i} opacity={shown ? 1 : 0}>
                <circle cx={q.x} cy={q.y} r="11" fill={T.bg1} stroke={T.accent2} strokeWidth="5" />
                <text x={q.x} y={q.y - 24} textAnchor="middle" fill={T.text} fontSize="30" fontWeight="700" fontFamily={FONT_DISPLAY}>{data[i].value}</text>
                <text x={q.x} y={Hh + 40} textAnchor="middle" fill={T.muted} fontSize="26" fontFamily={FONT_BODY}>{data[i].label}</text>
              </g>
            );
          })}
        </svg>
      ) : null}
    </Frame>
  );
};

export const QuoteScene = ({p, T}: any) => {
  const {u} = useU();
  const fs = num(p.fontScale, 1);
  return (
    <Frame>
      <Rise dist={20 * u} style={{fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 220 * u, lineHeight: 0.7, color: T.accent, height: 120 * u}}>{"\u201C"}</Rise>
      <Rise delay={8} dist={30 * u} style={{fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: fit(p.text, 62, 90) * u * fs, color: T.text, lineHeight: 1.18, letterSpacing: "-0.01em"}}>{p.text}</Rise>
      {p.author ? (
        <Rise delay={24} style={{display: "flex", alignItems: "center", gap: 18 * u, marginTop: 36 * u, color: T.muted, fontSize: 30 * u}}>
          <div style={{width: 64 * u, height: 5 * u, borderRadius: 99, background: grad(T)}} />
          {p.author}
        </Rise>
      ) : null}
    </Frame>
  );
};

export const SplitScene = ({p, T}: any) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {u, portrait} = useU();
  const fs = num(p.fontScale, 1);
  const sides = [p.left || {}, p.right || {}];
  return (
    <Frame>
      {p.headline ? <Rise dist={30 * u} style={{...H(fit(p.headline, 56, 30) * u * fs, T), marginBottom: 30 * u}}>{p.headline}</Rise> : null}
      <div style={{position: "relative", display: "flex", flexDirection: portrait ? "column" : "row", gap: 28 * u, alignItems: "stretch"}}>
        {sides.map((s: any, i: number) => {
          const sp = spring({frame: frame - (10 + i * 8), fps, config: {damping: 200}});
          const dir = i === 0 ? -1 : 1;
          const tx = portrait ? 0 : (1 - sp) * dir * 120 * u;
          const ty = portrait ? (1 - sp) * dir * 60 * u : 0;
          const col = i === 0 ? T.accent : T.accent2;
          return (
            <div key={i} style={{flex: 1, padding: 34 * u, borderRadius: 28 * u, background: T.card, border: "1px solid " + T.line, opacity: sp, transform: "translate(" + tx + "px," + ty + "px)"}}>
              <div style={{fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: fit(txt(s.title), 44, 18) * u * fs, color: col, marginBottom: 14 * u}}>{txt(s.title)}</div>
              {clampArr(s.points, 4).map((pt: any, j: number) => (
                <div key={j} style={{display: "flex", gap: 14 * u, marginTop: 12 * u, fontSize: fit(txt(pt), 30, 36) * u * fs, color: T.text, lineHeight: 1.3}}>
                  <span style={{color: col}}>{"\u25CF"}</span>
                  <span>{txt(pt)}</span>
                </div>
              ))}
            </div>
          );
        })}
        {!portrait ? (
          <div style={{position: "absolute", left: "50%", top: "50%", width: 74 * u, height: 74 * u, marginLeft: -37 * u, marginTop: -37 * u, borderRadius: 99, background: grad(T), color: T.onAccent, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 28 * u}}>VS</div>
        ) : null}
      </div>
    </Frame>
  );
};

export const TimelineScene = ({p, T}: any) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {u, portrait} = useU();
  const fs = num(p.fontScale, 1);
  const steps = clampArr(p.steps, 5);
  return (
    <Frame>
      <Rise dist={30 * u} style={{...H(fit(p.headline, 60, 28) * u * fs, T), marginBottom: 40 * u}}>{p.headline}</Rise>
      <div style={{display: "flex", flexDirection: portrait ? "column" : "row", gap: 22 * u}}>
        {steps.map((st: any, i: number) => {
          const s = spring({frame: frame - (12 + i * 12), fps, config: {damping: 200}});
          return (
            <div key={i} style={{flex: 1, opacity: s, transform: "translateY(" + (1 - s) * 50 * u + "px)"}}>
              <div style={{height: 8 * u, borderRadius: 99, background: grad(T), width: s * 100 + "%", marginBottom: 20 * u}} />
              <div style={{fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 22 * u, color: T.accent, letterSpacing: "0.12em"}}>{"STEP " + (i + 1)}</div>
              <div style={{fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: fit(txt(st && st.label), 36, 16) * u * fs, color: T.text, margin: 6 * u + "px 0 " + 8 * u + "px"}}>{txt(st && st.label)}</div>
              <div style={{fontSize: fit(txt(st && st.text), 26, 60) * u * fs, color: T.muted, lineHeight: 1.35}}>{txt(st && st.text)}</div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

export const RankingScene = ({p, T}: any) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {u} = useU();
  const fs = num(p.fontScale, 1);
  const items = clampArr(p.items, 5);
  return (
    <Frame>
      <Rise dist={30 * u} style={{...H(fit(p.headline, 60, 28) * u * fs, T), marginBottom: 30 * u}}>{p.headline}</Rise>
      <div style={{display: "flex", flexDirection: "column", gap: 14 * u}}>
        {items.map((it: any, i: number) => {
          const s = spring({frame: frame - (12 + i * 10), fps, config: {damping: 200}});
          return (
            <div key={i} style={{display: "flex", alignItems: "center", gap: 26 * u, padding: 16 * u + "px " + 26 * u + "px", background: T.card, border: "1px solid " + T.line, borderRadius: 22 * u, opacity: s, transform: "translateX(" + (1 - s) * 100 * u + "px)"}}>
              <div style={{fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 60 * u, color: T.accent, minWidth: 96 * u}}>{"0" + (i + 1)}</div>
              <div>
                <div style={{fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: fit(txt(it && it.title), 38, 30) * u * fs, color: T.text, lineHeight: 1.15}}>{txt(it && it.title)}</div>
                {it && it.note ? <div style={{fontSize: 24 * u * fs, color: T.muted, marginTop: 4 * u}}>{txt(it.note)}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

export const ImageScene = ({p, T, dur}: any) => {
  const frame = useCurrentFrame();
  const {h} = useVideoConfig();
  const {u, portrait} = useU();
  const fs = num(p.fontScale, 1);
  const hasImg = typeof p.image === "string" && p.image.length > 0;
  const k = interpolate(frame, [0, dur], [1.04, 1.18], {extrapolateRight: "clamp"});
  const col = hasImg ? "#ffffff" : T.text;
  return (
    <AbsoluteFill>
      {hasImg ? (
        <AbsoluteFill style={{transform: "scale(" + k + ") translate(" + frame * -0.08 + "px, 0px)"}}>
          <Img src={staticFile(p.image)} style={{width: "100%", height: "100%", objectFit: "cover"}} />
        </AbsoluteFill>
      ) : null}
      {hasImg ? <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.78) 100%)"}} /> : null}
      <AbsoluteFill style={{padding: (portrait ? 56 : 84) * u, paddingBottom: h * 0.17, justifyContent: "flex-end", fontFamily: FONT_BODY}}>
        {p.headline ? <Rise dist={40 * u} style={{fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: fit(p.headline, 78, 22) * u * fs, color: col, lineHeight: 1.05, letterSpacing: "-0.02em"}}>{p.headline}</Rise> : null}
        {p.subhead ? <Rise delay={10} style={{marginTop: 18 * u, fontSize: 32 * u * fs, color: hasImg ? "rgba(255,255,255,0.85)" : T.muted}}>{p.subhead}</Rise> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const OutroScene = ({p, T}: any) => {
  const frame = useCurrentFrame();
  const {u} = useU();
  const fs = num(p.fontScale, 1);
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: FONT_BODY}}>
      {[0, 1, 2].map((i) => {
        const t = ((frame + i * 24) % 72) / 72;
        return <div key={i} style={{position: "absolute", width: 700 * u, height: 700 * u, borderRadius: "50%", border: 3 * u + "px solid " + T.accent, opacity: (1 - t) * 0.5, transform: "scale(" + (0.35 + t * 1.3) + ")"}} />;
      })}
      <div style={{maxWidth: "80%"}}>
        <Rise dist={40 * u} style={{fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: fit(p.headline, 88, 18) * u * fs, color: T.text, lineHeight: 1.05, letterSpacing: "-0.02em"}}>{p.headline}</Rise>
        {p.subhead ? <Rise delay={10} style={{marginTop: 24 * u, fontSize: 34 * u * fs, color: T.muted}}>{p.subhead}</Rise> : null}
        {p.handle ? <Rise delay={20} style={{display: "inline-block", marginTop: 36 * u, padding: 14 * u + "px " + 34 * u + "px", borderRadius: 99, background: grad(T), color: T.onAccent, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 30 * u}}>{p.handle}</Rise> : null}
      </div>
    </AbsoluteFill>
  );
};
`,

  "src/Main.tsx": String.raw`import React from "react";
import {AbsoluteFill, Audio, Sequence, staticFile} from "remotion";
import {THEMES} from "./theme";
import {Background, Captions, Shell} from "./kit";
import * as S from "./scenes";

export const OVERLAP = 12;
export const sceneFrames = (s: any, fps: number) => Math.max(36, Math.round((Number(s.seconds) || 4) * fps));

export const layout = (sb: any) => {
  const fps = sb.fps || 30;
  let start = 0;
  return (sb.scenes || []).map((s: any) => {
    const dur = sceneFrames(s, fps);
    const from = start;
    start = from + dur - OVERLAP;
    return {s, from, dur};
  });
};

export const totalFrames = (sb: any) => {
  const l = layout(sb);
  if (!l.length) return 60;
  const last = l[l.length - 1];
  return last.from + last.dur;
};

const SCENES: any = {
  title: S.TitleScene,
  kinetic: S.KineticScene,
  bullets: S.BulletsScene,
  stat: S.StatScene,
  "bar-chart": S.BarChartScene,
  "line-chart": S.LineChartScene,
  quote: S.QuoteScene,
  split: S.SplitScene,
  timeline: S.TimelineScene,
  ranking: S.RankingScene,
  image: S.ImageScene,
  outro: S.OutroScene,
};

export const Main = (sb: any) => {
  const T = THEMES[sb.theme] || THEMES.midnight;
  return (
    <AbsoluteFill style={{backgroundColor: T.bg1}}>
      <Background T={T} />
      {layout(sb).map(({s, from, dur}: any, i: number) => {
        const C = SCENES[s.type] || S.TitleScene;
        return (
          <Sequence key={i} from={from} durationInFrames={dur}>
            <Shell transition={s.transition} dur={dur}>
              <C p={s} T={T} dur={dur} />
            </Shell>
            {sb.captions && s.narration ? <Captions text={s.narration} dur={dur} T={T} /> : null}
            {s.voice ? (
              <Sequence from={8}>
                <Audio src={staticFile(s.voice)} />
              </Sequence>
            ) : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
`,

  "src/Root.tsx": String.raw`import React from "react";
import {Composition} from "remotion";
import {Main, totalFrames} from "./Main";

const demo: any = {
  title: "Venus Pro",
  fps: 30,
  width: 1280,
  height: 720,
  theme: "midnight",
  captions: false,
  scenes: [{type: "title", seconds: 4, headline: "Venus Pro", subhead: "AI video studio"}],
};

export const Root = () => (
  <Composition
    id="Main"
    component={Main as any}
    durationInFrames={totalFrames(demo)}
    fps={30}
    width={1280}
    height={720}
    defaultProps={demo}
    calculateMetadata={({props}: any) => ({
      durationInFrames: totalFrames(props),
      fps: props.fps || 30,
      width: props.width || 1280,
      height: props.height || 720,
    })}
  />
);
`,
};