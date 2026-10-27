// The Main composition of Venus Pro (written to the studio computer on every "prepare").
// NOTE: lives in a template string: no backticks, no dollar-brace sequences.
export const MAIN_SOURCE = String.raw`import React from "react";
import {AbsoluteFill, Audio, Sequence, interpolate, staticFile} from "remotion";
import {FONT_BODY, FONT_DISPLAY, THEMES, pickFont} from "./theme";
import {Captions} from "./kit";
import {Camera} from "./camera";
import {FootageScene} from "./footage";
import {CUSTOM} from "./custom/registry";
import {Backdrop} from "./backdrop";
import {Guard} from "./guard";
import {Shell} from "./shell2";
import {ClipScene, gradeCss} from "./clip";
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

const CL: any = {extrapolateLeft: "clamp", extrapolateRight: "clamp"};

// the music gets quieter while a voice-over speaks, and louder when there is none
const duck = (f: number, segs: any[]) => {
  let lv = 1;
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i][0];
    const b = segs[i][1];
    const d = f < a ? interpolate(f, [a - 10, a], [0, 1], CL) : f > b ? interpolate(f, [b, b + 14], [1, 0], CL) : 1;
    lv = Math.min(lv, 1 - 0.7 * d);
  }
  return lv;
};

export const Main = (sb: any) => {
  const T = buildTheme(sb);
  const total = totalFrames(sb);
  const L = layout(sb);
  const speech = sb.source && sb.source.hasAudio;
  const segs: any[] = [];
  L.forEach((x: any) => {
    if (x.s.voice) segs.push([x.from + 8, x.from + x.dur - 14]);
    else if (x.s.type === "clip" && speech && Number(x.s.volume === undefined ? 1 : x.s.volume) > 0) segs.push([x.from + 4, x.from + x.dur - 12]);
  });
  const hasClip = L.some((x: any) => x.s.type === "clip");
  const grade = gradeCss(sb.grade);
  return (
    <AbsoluteFill style={{backgroundColor: T.bg1}}>
      <AbsoluteFill style={{filter: grade || undefined}}>
        {L.map(({s, from, dur}: any, i: number) => {
          const isClip = s.type === "clip";
          const C = s.type === "custom" ? CUSTOM[s.id] || S.TitleScene : SCENES[s.type] || S.TitleScene;
          const text = String(s.headline || s.fallbackText || s.text || s.label || "");
          // what is shown if a scene crashes: a plain title card (never a failed render)
          const plain = (
            <Guard name={"fallback " + i} fallback={null}>
              <S.TitleScene p={{type: "title", headline: text, subhead: s.subhead ? String(s.subhead) : ""}} T={T} dur={dur} />
            </Guard>
          );
          const safeScene = sb.safe === true && s.type === "custom";
          return (
            <Sequence key={i} from={from} durationInFrames={dur}>
              {sb.safe === true ? null : (
                <Guard name={"background " + i} fallback={null}>
                  <Backdrop sb={sb} i={i} T={T} />
                </Guard>
              )}
              <Guard name={"scene " + i} fallback={plain}>
                <Shell transition={s.transition} dur={dur} last={i === L.length - 1}>
                  <Camera moves={s.camera} dur={dur}>
                    {safeScene ? plain : isClip ? <ClipScene p={s} T={T} dur={dur} sb={sb} /> : <C p={s} T={T} dur={dur} />}
                  </Camera>
                </Shell>
              </Guard>
              {sb.captions && s.narration && !isClip ? (
                <Guard name={"captions " + i} fallback={null}>
                  <Captions text={s.narration} dur={dur} T={T} />
                </Guard>
              ) : null}
              {s.voice ? (
                <Sequence from={8}>
                  <Audio src={staticFile(s.voice)} />
                </Sequence>
              ) : null}
            </Sequence>
          );
        })}
      </AbsoluteFill>
      {sb.music ? (
        <Audio
          src={staticFile(sb.music)}
          volume={(f: number) => (hasClip ? 0.2 : 0.3) * duck(f, segs) * interpolate(f, [0, 30, Math.max(31, total - 50), total], [0, 1, 1, 0], CL)}
        />
      ) : null}
      {sb.sfx ? <Audio src={staticFile(sb.sfx)} volume={0.9} /> : null}
    </AbsoluteFill>
  );
};
`;
