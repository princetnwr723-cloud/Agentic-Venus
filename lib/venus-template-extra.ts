export const TEMPLATE_VERSION_FINAL = "3";

export const EXTRA_FILES: Record<string, string> = {
  "src/theme.ts": String.raw`import {loadFont as loadInter} from "@remotion/google-fonts/Inter";
import {loadFont as loadMontserrat} from "@remotion/google-fonts/Montserrat";
import {loadFont as loadPoppins} from "@remotion/google-fonts/Poppins";
import {loadFont as loadGrotesk} from "@remotion/google-fonts/SpaceGrotesk";
import {loadFont as loadPlayfair} from "@remotion/google-fonts/PlayfairDisplay";
import {loadFont as loadOswald} from "@remotion/google-fonts/Oswald";

const inter = loadInter("normal", {weights: ["400", "500", "600", "800"], subsets: ["latin"]});
const mont = loadMontserrat("normal", {weights: ["600", "800"], subsets: ["latin"]});

export const FONT_BODY = inter.fontFamily + ", 'Liberation Sans', Arial, sans-serif";
export const FONT_DISPLAY = mont.fontFamily + ", 'Liberation Sans', Arial, sans-serif";

const LOADERS: any = {
  inter: () => inter.fontFamily,
  montserrat: () => mont.fontFamily,
  poppins: () => loadPoppins("normal", {weights: ["500", "700", "800"], subsets: ["latin"]}).fontFamily,
  spacegrotesk: () => loadGrotesk("normal", {weights: ["500", "700"], subsets: ["latin"]}).fontFamily,
  playfair: () => loadPlayfair("normal", {weights: ["700", "800"], subsets: ["latin"]}).fontFamily,
  oswald: () => loadOswald("normal", {weights: ["500", "700"], subsets: ["latin"]}).fontFamily,
};
const cache: any = {};
export const pickFont = (name: any, fallback: string): string => {
  const k = String(name || "").toLowerCase();
  if (!LOADERS[k]) return fallback;
  if (!cache[k]) cache[k] = LOADERS[k]() + ", 'Liberation Sans', Arial, sans-serif";
  return cache[k];
};

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

  "src/camera.tsx": String.raw`import React from "react";
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from "remotion";

const ease = Easing.bezier(0.25, 0.1, 0.25, 1);
const EDGE = ["pan-left", "pan-right", "tilt-up", "tilt-down", "orbit", "handheld", "whip"];

export const Camera = ({moves, dur, children}: any) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const list: string[] = Array.isArray(moves) ? moves : moves ? [moves] : [];
  if (list.length === 0) return <AbsoluteFill>{children}</AbsoluteFill>;
  const t = interpolate(frame, [0, Math.max(1, dur)], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease});
  let s = 1;
  let x = 0;
  let y = 0;
  let r = 0;
  for (const m of list) {
    if (m === "push") s += 0.12 * t;
    else if (m === "pull") s += 0.12 * (1 - t);
    else if (m === "pan-left") x += width * 0.03 * (1 - 2 * t);
    else if (m === "pan-right") x += width * 0.03 * (2 * t - 1);
    else if (m === "tilt-up") y += height * 0.03 * (2 * t - 1);
    else if (m === "tilt-down") y += height * 0.03 * (1 - 2 * t);
    else if (m === "orbit") { r += 2.2 * (2 * t - 1); s += 0.05; }
    else if (m === "handheld") {
      x += Math.sin(frame * 0.12) * width * 0.004 + Math.sin(frame * 0.31) * width * 0.002;
      y += Math.cos(frame * 0.1) * height * 0.004 + Math.cos(frame * 0.27) * height * 0.002;
      r += Math.sin(frame * 0.08) * 0.25;
    } else if (m === "crash-zoom") {
      const c = interpolate(frame, [0, 12], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic)});
      s += 0.45 * c;
    } else if (m === "whip") {
      const w = interpolate(frame, [0, 10], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.exp)});
      x += width * 0.6 * w;
    }
  }
  const base = list.some((m) => EDGE.indexOf(m) >= 0) ? 1.07 : 1;
  return (
    <AbsoluteFill style={{transform: "translate(" + x + "px," + y + "px) rotate(" + r + "deg) scale(" + s * base + ")"}}>
      {children}
    </AbsoluteFill>
  );
};
`,

  "src/footage.tsx": String.raw`import React from "react";
import {AbsoluteFill, OffthreadVideo, staticFile, useVideoConfig} from "remotion";
import {FONT_BODY, FONT_DISPLAY} from "./theme";
import {Rise, fit, num, useU} from "./kit";

export const FootageScene = ({p, T}: any) => {
  const {h} = useVideoConfig();
  const {u, portrait} = useU();
  const fs = num(p.fontScale, 1);
  const has = typeof p.video === "string" && p.video.length > 0;
  const col = has ? "#ffffff" : T.text;
  return (
    <AbsoluteFill>
      {has ? (
        <AbsoluteFill style={{filter: "saturate(1.12) contrast(1.06)"}}>
          <OffthreadVideo src={staticFile(p.video)} muted style={{width: "100%", height: "100%", objectFit: "cover"}} />
        </AbsoluteFill>
      ) : null}
      {has ? <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.72) 100%)"}} /> : null}
      <AbsoluteFill style={{padding: (portrait ? 56 : 84) * u, paddingBottom: h * 0.17, justifyContent: "flex-end", fontFamily: FONT_BODY}}>
        {p.headline ? <Rise dist={40 * u} style={{fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: fit(p.headline, 78, 22) * u * fs, color: col, lineHeight: 1.05, letterSpacing: "-0.02em"}}>{p.headline}</Rise> : null}
        {p.subhead ? <Rise delay={10} style={{marginTop: 18 * u, fontSize: 32 * u * fs, color: has ? "rgba(255,255,255,0.85)" : T.muted}}>{p.subhead}</Rise> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
`,

  "src/Main.tsx": String.raw`import React from "react";
import {AbsoluteFill, Audio, Sequence, interpolate, staticFile} from "remotion";
import {FONT_BODY, FONT_DISPLAY, THEMES, pickFont} from "./theme";
import {Background, Captions, Shell} from "./kit";
import {Camera} from "./camera";
import {FootageScene} from "./footage";
import {CUSTOM} from "./custom/registry";
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
  title: S.TitleScene, kinetic: S.KineticScene, bullets: S.BulletsScene, stat: S.StatScene,
  "bar-chart": S.BarChartScene, "line-chart": S.LineChartScene, quote: S.QuoteScene,
  split: S.SplitScene, timeline: S.TimelineScene, ranking: S.RankingScene, image: S.ImageScene,
  footage: FootageScene, outro: S.OutroScene,
};

const lum = (hex: string) => {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return 0;
  return (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255;
};

const buildTheme = (sb: any) => {
  const base = THEMES[sb.theme] || THEMES.midnight;
  const pal = sb.palette || {};
  const T: any = Object.assign({}, base, pal);
  if (pal.bg1) {
    T.dark = lum(T.bg1) < 0.5;
    T.card = T.dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";
    T.line = T.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)";
    T.onAccent = lum(T.accent) > 0.6 ? "#06070d" : "#ffffff";
  }
  T.fd = pickFont(sb.fonts && sb.fonts.display, FONT_DISPLAY);
  T.fb = pickFont(sb.fonts && sb.fonts.body, FONT_BODY);
  return T;
};

export const Main = (sb: any) => {
  const T = buildTheme(sb);
  const total = totalFrames(sb);
  return (
    <AbsoluteFill style={{backgroundColor: T.bg1}}>
      <Background T={T} />
      {layout(sb).map(({s, from, dur}: any, i: number) => {
        const C = s.type === "custom" ? CUSTOM[s.id] || S.TitleScene : SCENES[s.type] || S.TitleScene;
        return (
          <Sequence key={i} from={from} durationInFrames={dur}>
            <Shell transition={s.transition} dur={dur}>
              <Camera moves={s.camera} dur={dur}>
                <C p={s} T={T} dur={dur} />
              </Camera>
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
      {sb.music ? (
        <Audio
          src={staticFile(sb.music)}
          volume={(f: number) => interpolate(f, [0, 30, Math.max(31, total - 45), total], [0, 0.16, 0.16, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})}
        />
      ) : null}
    </AbsoluteFill>
  );
};
`,

  "src/custom/registry.ts": String.raw`export const CUSTOM: any = {};
`,

  "check.cjs": String.raw`const fs = require("fs");
let esbuild;
try {
  esbuild = require("esbuild");
} catch (e) {
  console.log(JSON.stringify({skipped: true, bad: []}));
  process.exit(0);
}
const bad = [];
for (const f of process.argv.slice(2)) {
  try {
    esbuild.transformSync(fs.readFileSync(f, "utf8"), {loader: "tsx", jsx: "automatic"});
  } catch (e) {
    bad.push({file: f, message: String(e.message || e).split("\n").slice(0, 6).join(" | ").slice(0, 500)});
  }
}
console.log(JSON.stringify({bad: bad}));
`,
};