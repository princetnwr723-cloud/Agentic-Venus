// Remotion sources for editing a REAL video (the "clip" scene), plus the scene shell with all transitions and the global colour grade.
// They are written to the studio computer on every "prepare", so old computers get them without a reinstall.
// NOTE: these sources live in template strings. They must not contain backticks or dollar-brace sequences.

export const SHELL_SOURCE = String.raw`import React from "react";
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from "remotion";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const CL: any = {extrapolateLeft: "clamp", extrapolateRight: "clamp"};

// transition names: fade | slide | zoom | wipe | blur | cut | up | iris | flip
export const Shell = ({children, transition, dur, last}: any) => {
  const frame = useCurrentFrame();
  const IN = transition === "cut" ? 1 : 16;
  const OUT = 12;
  const e = interpolate(frame, [0, IN], [0, 1], {...CL, easing: EASE_OUT});
  const x = interpolate(frame, [dur - OUT, dur], [0, 1], {...CL, easing: Easing.in(Easing.cubic)});
  let style: any = {opacity: e * (1 - x)};
  if (transition === "slide") style = {opacity: e * (1 - x), transform: "translateX(" + ((1 - e) * 70 - x * 70) + "px)"};
  else if (transition === "up") style = {opacity: e * (1 - x), transform: "translateY(" + ((1 - e) * 60 - x * 50) + "px)"};
  else if (transition === "zoom") style = {opacity: e * (1 - x), transform: "scale(" + (1 + (1 - e) * 0.09 - x * 0.05) + ")"};
  else if (transition === "wipe") style = {opacity: 1 - x, clipPath: "inset(0 " + (1 - e) * 100 + "% 0 0)"};
  else if (transition === "iris") style = {opacity: 1 - x * 0.6, clipPath: "circle(" + e * 150 + "% at 50% 50%)"};
  else if (transition === "flip") style = {opacity: e * (1 - x), transform: "perspective(1400px) rotateY(" + ((1 - e) * -65 + x * 65) + "deg)"};
  else if (transition === "blur") style = {opacity: e * (1 - x), filter: "blur(" + ((1 - e) * 22 + x * 14) + "px)"};
  else if (transition === "cut") {
    // a hard cut: the scene is there from its first frame and is gone exactly when the next one starts
    style = {opacity: last ? 1 : frame >= dur - OUT ? 0 : 1};
  }
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};
`;

export const CLIP_SOURCE = String.raw`import React from "react";
import {AbsoluteFill, Easing, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from "remotion";

const CL: any = {extrapolateLeft: "clamp", extrapolateRight: "clamp"};

export const FILTERS: any = {
  none: "",
  warm: "sepia(0.22) saturate(1.2) contrast(1.04) brightness(1.03)",
  cool: "saturate(1.05) hue-rotate(-12deg) contrast(1.05)",
  mono: "grayscale(1) contrast(1.1)",
  noir: "grayscale(1) contrast(1.35) brightness(0.9)",
  vivid: "saturate(1.45) contrast(1.1)",
  fade: "saturate(0.8) contrast(0.9) brightness(1.08)",
  "teal-orange": "contrast(1.12) saturate(1.25) hue-rotate(-8deg) sepia(0.12)",
  vhs: "saturate(1.4) contrast(1.15) blur(0.4px)",
  dream: "brightness(1.08) saturate(1.2) contrast(0.92) blur(0.6px)",
};
export const gradeCss = (g: any): string => (g && FILTERS[g] ? FILTERS[g] : "");

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const numOr = (v: any, d: number) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? d : Number(v));

const Overlay = ({o, T, u, f, fps}: any) => {
  const at = Math.round(numOr(o.at, 0) * fps);
  const d = Math.max(12, Math.round(numOr(o.dur, 2.5) * fps));
  if (f < at || f > at + d) return null;
  const lf = f - at;
  const inn = spring({frame: lf, fps, config: {damping: 16, stiffness: 150}});
  const out = interpolate(lf, [d - 8, d], [1, 0], CL);
  const style = String(o.style || "lower-third");
  const text = String(o.text || "");
  const sub = o.sub ? String(o.sub) : "";
  const fd = T.fd || "sans-serif";
  const fb = T.fb || "sans-serif";
  if (style === "title") {
    return (
      <AbsoluteFill style={{alignItems: "center", justifyContent: "center", opacity: out}}>
        <div style={{fontFamily: fd, fontWeight: 800, fontSize: 92 * u, color: "#fff", textAlign: "center", maxWidth: "84%", lineHeight: 1.04, letterSpacing: "-0.02em", textShadow: "0 6px 40px rgba(0,0,0,0.6)", transform: "scale(" + (0.82 + 0.18 * inn) + ")", opacity: inn}}>{text}</div>
      </AbsoluteFill>
    );
  }
  if (style === "stamp") {
    return (
      <AbsoluteFill style={{alignItems: "flex-end", justifyContent: "flex-start", padding: 52 * u, opacity: out}}>
        <div style={{fontFamily: fd, fontWeight: 800, fontSize: 34 * u, letterSpacing: "0.12em", textTransform: "uppercase", color: T.onAccent || "#fff", background: T.accent, padding: (10 * u) + "px " + (22 * u) + "px", borderRadius: 8 * u, transform: "rotate(" + (-6 + (1 - inn) * 20) + "deg) scale(" + (0.6 + 0.4 * inn) + ")", opacity: inn}}>{text}</div>
      </AbsoluteFill>
    );
  }
  if (style === "callout") {
    return (
      <AbsoluteFill style={{alignItems: "center", justifyContent: "flex-end", paddingBottom: "24%", opacity: out}}>
        <div style={{fontFamily: fb, fontWeight: 700, fontSize: 36 * u, color: "#fff", background: "rgba(0,0,0,0.55)", border: (3 * u) + "px solid " + T.accent, padding: (14 * u) + "px " + (30 * u) + "px", borderRadius: 999, transform: "translateY(" + (1 - inn) * 40 * u + "px)", opacity: inn}}>{text}</div>
      </AbsoluteFill>
    );
  }
  if (style === "chip") {
    return (
      <AbsoluteFill style={{alignItems: "flex-start", justifyContent: "flex-start", padding: 48 * u, opacity: out}}>
        <div style={{fontFamily: fb, fontWeight: 700, fontSize: 26 * u, color: "#fff", background: "rgba(0,0,0,0.5)", padding: (8 * u) + "px " + (18 * u) + "px", borderRadius: 999, opacity: inn, transform: "translateX(" + (1 - inn) * -30 * u + "px)"}}>{text}</div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{alignItems: "flex-start", justifyContent: "flex-end", padding: 64 * u, paddingBottom: "17%", opacity: out}}>
      <div style={{display: "flex", gap: 18 * u, alignItems: "stretch", transform: "translateX(" + (1 - inn) * -80 * u + "px)", opacity: inn, background: "rgba(0,0,0,0.5)", padding: (14 * u) + "px " + (26 * u) + "px " + (14 * u) + "px " + (18 * u) + "px", borderRadius: 10 * u}}>
        <div style={{width: 7 * u, background: T.accent, borderRadius: 4 * u}} />
        <div>
          <div style={{fontFamily: fd, fontWeight: 800, fontSize: 44 * u, color: "#fff", lineHeight: 1.1}}>{text}</div>
          {sub ? <div style={{fontFamily: fb, fontSize: 26 * u, color: "rgba(255,255,255,0.8)", marginTop: 6 * u}}>{sub}</div> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ClipCaptions = ({p, sb, T, u, frame, fps, portrait}: any) => {
  const segs: any[] = (sb && sb.transcript) || [];
  if (!segs.length) return null;
  const speed = numOr(p.speed, 1);
  const ts = numOr(p.srcStart, 0) + (frame / fps) * speed;
  const seg = segs.find((s: any) => ts >= s.s && ts < s.e);
  if (!seg) return null;
  const words = String(seg.t).split(" ").filter(Boolean);
  const size = portrait ? 3 : 5;
  const n = Math.max(1, Math.ceil(words.length / size));
  const idx = Math.min(n - 1, Math.floor(((ts - seg.s) / Math.max(0.2, seg.e - seg.s)) * n));
  const startTs = seg.s + (idx * (seg.e - seg.s)) / n;
  const since = Math.max(0, ((ts - startTs) / speed) * fps);
  const pop = spring({frame: since, fps, config: {damping: 14, stiffness: 220}});
  const text = words.slice(idx * size, idx * size + size).join(" ");
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "flex-end", paddingBottom: (portrait ? 150 : 52) * u}}>
      <div style={{fontFamily: T.fd || "sans-serif", fontWeight: 800, fontSize: (portrait ? 54 : 46) * u, color: "#fff", textAlign: "center", maxWidth: "88%", lineHeight: 1.15, padding: (8 * u) + "px " + (22 * u) + "px", borderRadius: 12 * u, background: "rgba(0,0,0,0.5)", textShadow: "0 2px 10px rgba(0,0,0,0.7)", transform: "scale(" + (0.9 + 0.1 * pop) + ")"}}>{text}</div>
    </AbsoluteFill>
  );
};

export const ClipScene = ({p, T, dur, sb}: any) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const u = Math.min(width, height) / 720;
  const portrait = height > width;
  const src = sb && sb.source;
  const has = typeof p.video === "string" && p.video.length > 0;
  if (!has) return <AbsoluteFill style={{background: "#000"}} />;
  const speed = numOr(p.speed, 1);
  const startFrom = Math.max(0, Math.round(numOr(p.srcStart, 0) * fps));
  const vol = Math.min(1, Math.max(0, numOr(p.volume, 1)));
  const muted = vol <= 0 || (src && src.hasAudio === false);
  const srcRatio = src ? src.width / Math.max(1, src.height) : width / height;
  const outRatio = width / height;
  const fit = p.fit && p.fit !== "auto" ? String(p.fit) : Math.abs(Math.log(srcRatio / outRatio)) > 0.22 ? "contain" : "cover";
  const prog = dur > 1 ? Easing.inOut(Easing.quad)(Math.min(1, frame / (dur - 1))) : 0;
  const scale = lerp(1, numOr(p.zoom, 1), prog);
  const fx = lerp(numOr(p.focusX, 0.5), numOr(p.focusX2, numOr(p.focusX, 0.5)), prog);
  const fy = lerp(numOr(p.focusY, 0.5), numOr(p.focusY2, numOr(p.focusY, 0.5)), prog);
  const filter = FILTERS[String(p.filter || "none")] || "";
  const volume = (f: number) => vol * interpolate(f, [0, 5, Math.max(6, dur - 10), dur], [0, 1, 1, 0], CL);
  const overlays: any[] = Array.isArray(p.overlays) ? p.overlays.slice() : [];
  if (p.headline) overlays.push({at: 0.4, dur: Math.max(1.5, Math.min(4, dur / fps - 1.2)), text: String(p.headline), sub: p.subhead ? String(p.subhead) : "", style: "lower-third"});
  const showCaps = Boolean(sb && sb.captions && p.captions !== false && sb.transcript && sb.transcript.length);
  return (
    <AbsoluteFill style={{background: "#000"}}>
      {fit === "contain" ? (
        <AbsoluteFill style={{filter: "blur(" + 38 * u + "px) brightness(0.55) saturate(1.25)", transform: "scale(1.3)"}}>
          <OffthreadVideo src={staticFile(p.video)} muted startFrom={startFrom} playbackRate={speed} style={{width: "100%", height: "100%", objectFit: "cover"}} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{transform: "scale(" + scale + ")", transformOrigin: fx * 100 + "% " + fy * 100 + "%", filter: filter || undefined}}>
        <OffthreadVideo src={staticFile(p.video)} muted={muted} volume={volume} startFrom={startFrom} playbackRate={speed} style={{width: "100%", height: "100%", objectFit: fit === "cover" ? "cover" : "contain", objectPosition: fx * 100 + "% " + fy * 100 + "%"}} />
      </AbsoluteFill>
      {overlays.map((o: any, i: number) => <Overlay key={i} o={o} T={T} u={u} f={frame} fps={fps} />)}
      {showCaps ? <ClipCaptions p={p} sb={sb} T={T} u={u} frame={frame} fps={fps} portrait={portrait} /> : null}
      {p.bar ? <div style={{position: "absolute", left: 0, bottom: 0, height: 6 * u, width: (frame / Math.max(1, dur)) * 100 + "%", background: T.accent}} /> : null}
    </AbsoluteFill>
  );
};
`;
