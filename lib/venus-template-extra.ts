export const TEMPLATE_VERSION_FINAL = "2";

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

  "src/Main.tsx": String.raw`import React from "react";
import {AbsoluteFill, Audio, Sequence, staticFile} from "remotion";
import {FONT_BODY, FONT_DISPLAY, THEMES, pickFont} from "./theme";
import {Background, Captions, Shell} from "./kit";
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
  split: S.SplitScene, timeline: S.TimelineScene, ranking: S.RankingScene, image: S.ImageScene, outro: S.OutroScene,
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
  return (
    <AbsoluteFill style={{backgroundColor: T.bg1}}>
      <Background T={T} />
      {layout(sb).map(({s, from, dur}: any, i: number) => {
        const C = s.type === "custom" ? CUSTOM[s.id] || S.TitleScene : SCENES[s.type] || S.TitleScene;
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