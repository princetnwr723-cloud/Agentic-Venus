// Venus Pro kit: motion-graphics UI components, code-made audio engine and the Main composition.
// These sources are written to the studio computer on every "prepare", so old computers need NO reinstall.
// NOTE: the sources below must not contain backticks or dollar-brace sequences (they live in template strings).

export const UI_SOURCE = String.raw`import React from "react";
import {interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {EASE, grad, useU} from "./kit";

const CL: any = {extrapolateLeft: "clamp", extrapolateRight: "clamp"};
const MONO = "'DejaVu Sans Mono','Liberation Mono',Menlo,monospace";

export const useIn = (delay: number = 0, snappy: boolean = false): number => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - delay, fps, config: snappy ? {damping: 13, stiffness: 150} : {damping: 200}});
};

export const typed = (text: any, frame: number, start: number, cps: number = 26, fps: number = 30): string => {
  const n = Math.max(0, Math.floor(((frame - start) / fps) * cps));
  return String(text == null ? "" : text).slice(0, n);
};
export const typeFrames = (text: any, cps: number = 26, fps: number = 30): number =>
  Math.ceil((String(text == null ? "" : text).length / cps) * fps);

export const Pop = ({delay = 0, snappy = true, dist = 24, children, style}: any) => {
  const {u} = useU();
  const p = useIn(delay, snappy);
  return (
    <div style={{opacity: Math.min(1, p * 1.4), transform: "translateY(" + (1 - p) * dist * u + "px) scale(" + (0.92 + 0.08 * p) + ")", ...style}}>
      {children}
    </div>
  );
};

const WordIn = ({delay, children}: any) => {
  const {u} = useU();
  const p = useIn(delay, true);
  return <span style={{display: "inline-block", opacity: Math.min(1, p * 1.5), transform: "translateY(" + (1 - p) * 40 * u + "px)"}}>{children}</span>;
};

export const Words = ({text, T, size = 96, delay = 0, color, weight = 800, align = "left", stagger = 4, max = "100%"}: any) => {
  const {u} = useU();
  const words = String(text || "").split(" ").filter(Boolean);
  return (
    <div style={{display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start", gap: "0 " + size * 0.26 * u + "px", fontFamily: T.fd, fontWeight: weight, fontSize: size * u, lineHeight: 1.06, letterSpacing: "-0.03em", color: color || T.text, maxWidth: max, textAlign: align}}>
      {words.map((w: string, i: number) => <WordIn key={i} delay={delay + i * stagger}>{w}</WordIn>)}
    </div>
  );
};

export const GradText = ({T, children, style}: any) => (
  <span style={{background: grad(T), WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent", ...style}}>{children}</span>
);

export const Card = ({T, children, style, pad = 28}: any) => {
  const {u} = useU();
  return (
    <div style={{background: T.card, border: "1px solid " + T.line, borderRadius: 24 * u, padding: pad * u, boxShadow: T.dark ? "0 20px 60px rgba(0,0,0,0.35)" : "0 20px 50px rgba(0,0,0,0.12)", ...style}}>
      {children}
    </div>
  );
};

export const Badge = ({T, text, color, delay = 0}: any) => {
  const {u} = useU();
  const p = useIn(delay, true);
  const c = color || T.accent;
  return (
    <span style={{alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 10 * u, padding: 8 * u + "px " + 18 * u + "px", borderRadius: 99, border: "1.5px solid " + c, color: c, fontFamily: T.fb, fontWeight: 600, fontSize: 22 * u, letterSpacing: "0.08em", textTransform: "uppercase", opacity: p, transform: "scale(" + (0.9 + 0.1 * p) + ")"}}>
      <span style={{width: 10 * u, height: 10 * u, borderRadius: 99, background: c}} />
      {text}
    </span>
  );
};

export const Counter = ({value, start = 0, dur = 40, decimals = 0, prefix = "", suffix = ""}: any) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + dur], [0, 1], {...CL, easing: EASE});
  const v = Number(value) * p;
  return <span>{prefix + v.toLocaleString("en-US", {minimumFractionDigits: decimals, maximumFractionDigits: decimals}) + suffix}</span>;
};

export const Cursor = ({T, size = 1}: any) => {
  const frame = useCurrentFrame();
  const {u} = useU();
  const on = Math.floor(frame / 15) % 2 === 0;
  return <span style={{display: "inline-block", width: 11 * u * size, height: 24 * u * size, marginLeft: 4 * u, verticalAlign: "text-bottom", background: T.accent, opacity: on ? 1 : 0}} />;
};

export const Window = ({T, title, children, width, height, style, delay = 0, pill = false, bodyBg}: any) => {
  const {u} = useU();
  const p = useIn(delay);
  const dark = T.dark;
  return (
    <div style={{width: width ? width * u : "100%", height: height ? height * u : undefined, borderRadius: 20 * u, overflow: "hidden", background: bodyBg || (dark ? "#0b0d14" : "#ffffff"), border: "1px solid " + T.line, boxShadow: "0 30px 80px rgba(0,0,0,0.45)", opacity: p, transform: "translateY(" + (1 - p) * 40 * u + "px) scale(" + (0.96 + 0.04 * p) + ")", ...style}}>
      <div style={{display: "flex", alignItems: "center", gap: 10 * u, padding: 14 * u + "px " + 18 * u + "px", background: dark ? "#141824" : "#eceef3", borderBottom: "1px solid " + T.line}}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} style={{width: 13 * u, height: 13 * u, borderRadius: 99, background: c}} />)}
        {pill ? (
          <span style={{flex: 1, marginLeft: 14 * u, padding: 6 * u + "px " + 16 * u + "px", borderRadius: 99, background: dark ? "#0b0d14" : "#ffffff", border: "1px solid " + T.line, fontSize: 18 * u, color: T.muted, fontFamily: T.fb, textAlign: "center"}}>{title}</span>
        ) : (
          <span style={{marginLeft: 12 * u, fontSize: 18 * u, color: T.muted, fontFamily: T.fb}}>{title}</span>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
};

export const Browser = ({T, url = "app.example.com", children, width, height, delay = 0, style}: any) => (
  <Window T={T} title={url} pill width={width} height={height} delay={delay} style={style}>{children}</Window>
);

export const Terminal = ({T, lines, title = "agent - terminal", start = 8, cps = 34, width, height, prompt = "$", endCursor = true, style}: any) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {u} = useU();
  const list = (Array.isArray(lines) ? lines : []).slice(0, 12);
  let t = start + 12;
  const rows: any[] = [];
  list.forEach((l: any, i: number) => {
    const kind = l && l.kind ? String(l.kind) : "out";
    const text = String(l && l.text != null ? l.text : "");
    rows.push({kind: kind, text: text, at: t, i: i});
    if (kind === "cmd") t += typeFrames(text, cps, fps) + 12;
    else t += l && l.wait !== undefined ? Number(l.wait) || 9 : 9;
  });
  const col: any = {cmd: "#e6edf7", out: "#9fb0c8", ok: "#34d399", err: "#f87171", warn: "#fbbf24", dim: "#64748b"};
  return (
    <Window T={T} title={title} width={width} height={height} delay={Math.max(0, start - 8)} bodyBg="#0a0c12" style={style}>
      <div style={{padding: 26 * u, fontFamily: MONO, fontSize: 24 * u, lineHeight: 1.55, color: "#e6edf7", minHeight: (list.length + 1) * 37 * u + 52 * u}}>
        {rows.map((r: any) => {
          if (frame < r.at) return null;
          if (r.kind === "cmd") {
            const shown = typed(r.text, frame, r.at, cps, fps);
            const typing = shown.length < r.text.length;
            return (
              <div key={r.i} style={{whiteSpace: "pre-wrap", wordBreak: "break-word"}}>
                <span style={{color: T.accent}}>{prompt + " "}</span>
                <span style={{color: col.cmd}}>{shown}</span>
                {typing ? <Cursor T={T} size={0.9} /> : null}
              </div>
            );
          }
          const o = interpolate(frame, [r.at, r.at + 6], [0, 1], CL);
          return <div key={r.i} style={{color: col[r.kind] || col.out, opacity: o, whiteSpace: "pre-wrap", wordBreak: "break-word"}}>{r.text}</div>;
        })}
        {endCursor && frame >= t ? (
          <div><span style={{color: T.accent}}>{prompt + " "}</span><Cursor T={T} size={0.9} /></div>
        ) : null}
      </div>
    </Window>
  );
};

const Bubble = ({T, m, delay}: any) => {
  const {u} = useU();
  const p = useIn(delay, true);
  const me = m.who === "user";
  return (
    <div style={{alignSelf: me ? "flex-end" : "flex-start", maxWidth: "84%", opacity: Math.min(1, p * 1.5), transform: "translateY(" + (1 - p) * 20 * u + "px) scale(" + (0.94 + 0.06 * p) + ")", transformOrigin: me ? "100% 100%" : "0% 100%"}}>
      {m.name ? <div style={{fontSize: 17 * u, color: T.muted, marginBottom: 6 * u, textAlign: me ? "right" : "left", fontFamily: T.fb}}>{m.name}</div> : null}
      <div style={{padding: 18 * u + "px " + 26 * u + "px", borderRadius: 24 * u, background: me ? "linear-gradient(135deg," + T.accent + "," + T.accent2 + ")" : T.card, color: me ? T.onAccent : T.text, border: me ? "none" : "1px solid " + T.line, fontSize: 28 * u, lineHeight: 1.35, fontFamily: T.fb, fontWeight: 500}}>{m.text}</div>
    </div>
  );
};

export const Chat = ({T, messages, start = 8, gap = 34, width}: any) => {
  const {u} = useU();
  return (
    <div style={{display: "flex", flexDirection: "column", gap: 18 * u, width: width ? width * u : "100%"}}>
      {(Array.isArray(messages) ? messages : []).slice(0, 8).map((m: any, i: number) => <Bubble key={i} T={T} m={m} delay={start + i * gap} />)}
    </div>
  );
};

export const CheckIcon = ({size = 28, color = "#fff", progress = 1, stroke = 3}: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M5 12.5l4.5 4.5L19 7.5" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress} />
  </svg>
);

const Step = ({T, s, i, last, delay, vert}: any) => {
  const frame = useCurrentFrame();
  const {u} = useU();
  const p = useIn(delay, true);
  const line = interpolate(frame, [delay + 8, delay + 22], [0, 1], {...CL, easing: EASE});
  const done = frame > delay + 22;
  const chk = interpolate(frame, [delay + 22, delay + 32], [0, 1], CL);
  const D = 64 * u;
  const label = typeof s === "string" ? s : s.label;
  const sub = typeof s === "string" ? "" : s.sub;
  return (
    <div style={{flex: 1, position: "relative", display: "flex", flexDirection: vert ? "row" : "column", alignItems: vert ? "flex-start" : "center", gap: (vert ? 24 : 14) * u, paddingBottom: vert ? 30 * u : 0, opacity: Math.min(1, p * 1.4), transform: "scale(" + (0.9 + 0.1 * p) + ")"}}>
      {!last ? (
        vert ? (
          <div style={{position: "absolute", left: D / 2 - 2 * u, top: D, width: 4 * u, height: "calc(100% - " + D + "px)", background: T.line}}>
            <div style={{width: "100%", height: line * 100 + "%", background: T.accent}} />
          </div>
        ) : (
          <div style={{position: "absolute", top: D / 2 - 2 * u, left: "50%", width: "100%", height: 4 * u, background: T.line}}>
            <div style={{height: "100%", width: line * 100 + "%", background: T.accent}} />
          </div>
        )
      ) : null}
      <div style={{position: "relative", zIndex: 1, width: D, height: D, flexShrink: 0, borderRadius: 99, background: done ? "linear-gradient(135deg," + T.accent + "," + T.accent2 + ")" : T.bg1, border: "2px solid " + T.accent, display: "flex", alignItems: "center", justifyContent: "center", color: T.text, fontFamily: T.fd, fontWeight: 800, fontSize: 28 * u}}>
        {done ? <CheckIcon size={34 * u} color={T.onAccent} progress={chk} stroke={3.2} /> : String(i + 1)}
      </div>
      <div style={{textAlign: vert ? "left" : "center", paddingTop: vert ? 6 * u : 0}}>
        <div style={{fontFamily: T.fd, fontWeight: 800, fontSize: 30 * u, color: T.text, lineHeight: 1.15}}>{label}</div>
        {sub ? <div style={{fontFamily: T.fb, fontSize: 22 * u, color: T.muted, marginTop: 4 * u, lineHeight: 1.3}}>{sub}</div> : null}
      </div>
    </div>
  );
};

export const Pipeline = ({T, steps, start = 8, gap = 22, vertical}: any) => {
  const {portrait} = useU();
  const vert = vertical !== undefined ? Boolean(vertical) : portrait;
  const list = (Array.isArray(steps) ? steps : []).slice(0, 6);
  return (
    <div style={{display: "flex", flexDirection: vert ? "column" : "row", alignItems: vert ? "stretch" : "flex-start", width: "100%"}}>
      {list.map((s: any, i: number) => <Step key={i} T={T} s={s} i={i} last={i === list.length - 1} delay={start + i * gap} vert={vert} />)}
    </div>
  );
};

const CheckRow = ({T, text, delay, size}: any) => {
  const frame = useCurrentFrame();
  const {u} = useU();
  const p = useIn(delay, true);
  const chk = interpolate(frame, [delay + 6, delay + 18], [0, 1], {...CL, easing: EASE});
  return (
    <div style={{display: "flex", alignItems: "center", gap: 20 * u, opacity: Math.min(1, p * 1.4), transform: "translateX(" + (1 - p) * -40 * u + "px)"}}>
      <div style={{width: size * 1.3 * u, height: size * 1.3 * u, borderRadius: 14 * u, background: chk > 0.5 ? "linear-gradient(135deg," + T.accent + "," + T.accent2 + ")" : T.card, border: "2px solid " + T.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0}}>
        <CheckIcon size={size * 0.9 * u} color={T.onAccent} progress={chk} stroke={3.4} />
      </div>
      <div style={{fontFamily: T.fb, fontWeight: 600, fontSize: size * u, color: T.text, lineHeight: 1.25}}>{text}</div>
    </div>
  );
};

export const Checklist = ({T, items, start = 8, gap = 16, size = 34}: any) => {
  const {u} = useU();
  return (
    <div style={{display: "flex", flexDirection: "column", gap: 22 * u}}>
      {(Array.isArray(items) ? items : []).slice(0, 7).map((t: any, i: number) => <CheckRow key={i} T={T} text={typeof t === "string" ? t : t.label} delay={start + i * gap} size={size} />)}
    </div>
  );
};

const HubNode = ({T, n, x, y, delay}: any) => {
  const {u} = useU();
  const p = useIn(delay, true);
  const label = typeof n === "string" ? n : n.label;
  const sub = typeof n === "string" ? "" : n.sub;
  return (
    <div style={{position: "absolute", left: x, top: y, transform: "translate(-50%,-50%) scale(" + (0.7 + 0.3 * p) + ")", opacity: Math.min(1, p * 1.5), padding: 12 * u + "px " + 24 * u + "px", borderRadius: 99, background: T.bg1, border: "2px solid " + T.accent2, textAlign: "center", whiteSpace: "nowrap", boxShadow: "0 10px 30px rgba(0,0,0,0.3)"}}>
      <div style={{fontFamily: T.fb, fontWeight: 700, fontSize: 26 * u, color: T.text}}>{label}</div>
      {sub ? <div style={{fontFamily: T.fb, fontSize: 18 * u, color: T.muted}}>{sub}</div> : null}
    </div>
  );
};

export const Hub = ({T, center = "Agent", nodes, start = 6, size = 760}: any) => {
  const frame = useCurrentFrame();
  const {u} = useU();
  const S = size * u;
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.36;
  const list = (Array.isArray(nodes) ? nodes : []).slice(0, 8);
  const pc = useIn(start, true);
  return (
    <div style={{position: "relative", width: S, height: S, margin: "0 auto", maxWidth: "100%"}}>
      <svg width={S} height={S} style={{position: "absolute", left: 0, top: 0}}>
        {list.map((n: any, i: number) => {
          const a = -Math.PI / 2 + (i / list.length) * Math.PI * 2;
          const x = cx + Math.cos(a) * R;
          const y = cy + Math.sin(a) * R;
          const p = interpolate(frame, [start + 10 + i * 5, start + 24 + i * 5], [0, 1], {...CL, easing: EASE});
          return <line key={i} x1={cx} y1={cy} x2={cx + (x - cx) * p} y2={cy + (y - cy) * p} stroke={T.accent} strokeWidth={3 * u} strokeOpacity={0.6} strokeDasharray={10 * u + " " + 8 * u} />;
        })}
      </svg>
      {list.map((n: any, i: number) => {
        const a = -Math.PI / 2 + (i / list.length) * Math.PI * 2;
        return <HubNode key={i} T={T} n={n} x={cx + Math.cos(a) * R} y={cy + Math.sin(a) * R} delay={start + 18 + i * 5} />;
      })}
      <div style={{position: "absolute", left: cx, top: cy, width: S * 0.27, height: S * 0.27, marginLeft: -S * 0.135, marginTop: -S * 0.135, borderRadius: 99, background: "linear-gradient(135deg," + T.accent + "," + T.accent2 + ")", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: T.onAccent, fontFamily: T.fd, fontWeight: 800, fontSize: 32 * u, lineHeight: 1.1, padding: 12 * u, transform: "scale(" + (0.6 + 0.4 * pc) + ")", opacity: pc, boxShadow: "0 0 " + 60 * u + "px " + T.accent + "88"}}>
        {center}
      </div>
    </div>
  );
};

export const Metric = ({T, label, value, prefix = "", suffix = "", decimals = 0, start = 0, dur = 40, size = 88, style}: any) => {
  const {u} = useU();
  const p = useIn(start);
  return (
    <Card T={T} style={{opacity: p, transform: "translateY(" + (1 - p) * 30 * u + "px)", ...style}}>
      <div style={{fontSize: 22 * u, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, fontFamily: T.fb, fontWeight: 600}}>{label}</div>
      <div style={{fontFamily: T.fd, fontWeight: 800, fontSize: size * u, color: T.text, lineHeight: 1.05, marginTop: 8 * u}}>
        <Counter value={value} start={start + 4} dur={dur} decimals={decimals} prefix={prefix} suffix={suffix} />
      </div>
    </Card>
  );
};

export const Meter = ({T, label, pct = 100, start = 0, dur = 40, valueText}: any) => {
  const frame = useCurrentFrame();
  const {u} = useU();
  const p = interpolate(frame, [start, start + dur], [0, 1], {...CL, easing: EASE});
  return (
    <div style={{width: "100%"}}>
      <div style={{display: "flex", justifyContent: "space-between", fontFamily: T.fb, fontSize: 24 * u, color: T.text, marginBottom: 10 * u, fontWeight: 600}}>
        <span>{label}</span><span style={{color: T.muted}}>{valueText || Math.round(pct * p) + "%"}</span>
      </div>
      <div style={{height: 16 * u, borderRadius: 99, background: T.line, overflow: "hidden"}}>
        <div style={{height: "100%", width: pct * p + "%", borderRadius: 99, background: "linear-gradient(90deg," + T.accent + "," + T.accent2 + ")"}} />
      </div>
    </div>
  );
};

export const Pointer = ({T, from = [0, 0], to = [100, 100], start = 0, dur = 24, click = true}: any) => {
  const frame = useCurrentFrame();
  const {u} = useU();
  const p = interpolate(frame, [start, start + dur], [0, 1], {...CL, easing: EASE});
  const x = (from[0] + (to[0] - from[0]) * p) * u;
  const y = (from[1] + (to[1] - from[1]) * p) * u;
  const c = interpolate(frame, [start + dur, start + dur + 14], [0, 1], CL);
  return (
    <div style={{position: "absolute", left: x, top: y, pointerEvents: "none", zIndex: 5, opacity: interpolate(frame, [start - 6, start], [0, 1], CL)}}>
      {click && c > 0 && c < 1 ? <div style={{position: "absolute", left: -30 * u, top: -30 * u, width: 60 * u, height: 60 * u, borderRadius: 99, border: "3px solid " + T.accent, opacity: 1 - c, transform: "scale(" + (0.3 + c) + ")"}} /> : null}
      <svg width={36 * u} height={36 * u} viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#ffffff" stroke="#111111" strokeWidth="1.4" strokeLinejoin="round" /></svg>
    </div>
  );
};

export const GridBG = ({T, size = 60, opacity = 0.07}: any) => {
  const frame = useCurrentFrame();
  const {u} = useU();
  const s = size * u;
  const off = (frame * 0.4) % s;
  return <div style={{position: "absolute", left: 0, top: 0, right: 0, bottom: 0, opacity: opacity, backgroundImage: "linear-gradient(" + T.text + " 1px, transparent 1px), linear-gradient(90deg, " + T.text + " 1px, transparent 1px)", backgroundSize: s + "px " + s + "px", backgroundPosition: off + "px " + off + "px"}} />;
};

export const Glow = ({T, x = "50%", y = "50%", size = 700, color, opacity = 0.35}: any) => {
  const {u} = useU();
  const c = color || T.accent;
  const s = size * u;
  return <div style={{position: "absolute", left: x, top: y, width: s, height: s, marginLeft: -s / 2, marginTop: -s / 2, borderRadius: "50%", background: "radial-gradient(circle, " + c + " 0%, transparent 65%)", opacity: opacity, pointerEvents: "none"}} />;
};

export const VenusMark = ({size = 120, color = "#E7B24D", progress = 1}: any) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="13" r="8.5" stroke={color} strokeWidth="2.1" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress} />
    <circle cx="16" cy="13" r="2.6" fill={color} opacity={progress} />
    <line x1="16" y1="21.5" x2="16" y2="27.5" stroke={color} strokeWidth="2.1" strokeLinecap="round" opacity={progress} />
    <line x1="12.2" y1="24.5" x2="19.8" y2="24.5" stroke={color} strokeWidth="2.1" strokeLinecap="round" opacity={progress} />
  </svg>
);
`;

export const MAIN_SOURCE = String.raw`import React from "react";
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

const CL: any = {extrapolateLeft: "clamp", extrapolateRight: "clamp"};

// the music gets quieter while a voice-over speaks, and louder when there is none
const duck = (f: number, segs: any[]) => {
  let lv = 1;
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i][0];
    const b = segs[i][1];
    const d = f < a ? interpolate(f, [a - 10, a], [0, 1], CL) : f > b ? interpolate(f, [b, b + 14], [1, 0], CL) : 1;
    lv = Math.min(lv, 1 - 0.62 * d);
  }
  return lv;
};

export const Main = (sb: any) => {
  const T = buildTheme(sb);
  const total = totalFrames(sb);
  const L = layout(sb);
  const segs = L.filter((x: any) => x.s.voice).map((x: any) => [x.from + 8, x.from + x.dur - 14]);
  return (
    <AbsoluteFill style={{backgroundColor: T.bg1}}>
      <Background T={T} />
      {L.map(({s, from, dur}: any, i: number) => {
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
          volume={(f: number) => 0.3 * duck(f, segs) * interpolate(f, [0, 30, Math.max(31, total - 50), total], [0, 1, 1, 0], CL)}
        />
      ) : null}
      {sb.sfx ? <Audio src={staticFile(sb.sfx)} volume={0.9} /> : null}
    </AbsoluteFill>
  );
};
`;

// Pure Node (no packages): synthesizes sound effects and a full background-music track as WAV.
export const SYNTH_SOURCE = String.raw`"use strict";
const fs = require("fs");
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

// one note: type sine|saw|tri|square, a = attack s, tc = decay time constant, sus = sustained (pad) with rel release,
// f2 + sweep = pitch glide, fc (+fc2) = low-pass cutoff (optionally sweeping)
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

// band-passed noise with a moving centre frequency (state-variable filter)
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

// ---------------- sound effects ----------------
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

// ---------------- background music ----------------
const MOODS = {
  dark:    {bpm: 94,  root: 45, minor: true,  prog: [0, 5, 2, 6], drive: 1, arp: 2, bright: 1800, floor: false},
  epic:    {bpm: 108, root: 50, minor: true,  prog: [0, 5, 2, 6], drive: 2, arp: 2, bright: 2600, floor: false},
  bright:  {bpm: 118, root: 48, minor: false, prog: [0, 4, 5, 3], drive: 1, arp: 2, bright: 3400, floor: false},
  tech:    {bpm: 124, root: 40, minor: true,  prog: [0, 2, 5, 6], drive: 2, arp: 4, bright: 2800, floor: true},
  calm:    {bpm: 78,  root: 53, minor: false, prog: [0, 4, 5, 3], drive: 0, arp: 2, bright: 1900, floor: false},
  playful: {bpm: 112, root: 48, minor: false, prog: [0, 3, 4, 3], drive: 1, arp: 2, bright: 3600, floor: false},
};

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
  const kick = tone(165, 0.36, {f2: 42, sweep: 0.09, tc: 0.11, a: 0.001});
  const hat = sweepNoise(0.05, 6500, 6500, 0.3, (t) => Math.exp(-t * 7), r);
  const clap = layer([
    {d: sweepNoise(0.17, 1700, 1700, 0.5, (t) => Math.exp(-t * 9), r), at: 0, g: 1},
    {d: sweepNoise(0.12, 2100, 2100, 0.5, (t) => Math.exp(-t * 12), r), at: 0.014, g: 0.7},
  ]);
  const lastBar = bars - 1;

  for (let bi = 0; bi < bars; bi++) {
    const t0 = bi * bar;
    const d0 = M.prog[bi % M.prog.length];
    const last = bi === lastBar;
    const chord = [deg(d0), deg(d0 + 2), deg(d0 + 4)];
    const rootN = M.root + deg(d0);

    // pad: detuned saws + sub, enters at once and rings out at the end
    const len = last ? bar * 2.4 : bar + 0.3;
    chord.forEach((c) => {
      [-1, 1].forEach((s) => {
        put(main, t0, tone(hz(M.root + 12 + c) * (1 + s * 0.004), len, {type: "saw", fc: M.bright, a: bar * 0.35, rel: bar * 0.45, sus: true}), 0.05, s * 0.5);
      });
    });
    put(main, t0, tone(hz(rootN), len, {a: 0.3, rel: 0.6, sus: true}), 0.16, 0);

    // bass from bar 2
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

    // riser into the first beat drop
    if (bi === 1 && M.drive >= 1) put(main, t0, sweepNoise(bar, 300, 7000, 0.6, (t) => t * t, r), 0.1, 0);

    // arpeggio from bar 3
    if (bi >= 2 && !last) {
      const steps = 4 * M.arp;
      const pat = [0, 1, 2, 3, 2, 1, 2, 1];
      for (let s = 0; s < steps; s++) {
        const idx = pat[s % 8];
        const m = M.root + 24 + (idx === 3 ? chord[0] + 12 : chord[idx]);
        put(arp, t0 + (s * bar) / steps, tone(hz(m), (bar / steps) * 1.6, {type: "saw", fc: 4200, fc2: 600, a: 0.002, tc: 0.16}), M.arp === 4 ? 0.04 : 0.06, s % 2 ? 0.4 : -0.4);
      }
    }

    // drums
    if (M.drive >= 1 && bi >= 2 && !last) {
      const beats = M.floor ? [0, 1, 2, 3] : [0, 2];
      beats.forEach((q) => put(main, t0 + q * beat, kick, M.drive >= 2 ? 0.42 : 0.3, 0));
      if (bi >= 3) {
        for (let j = 0; j < 4; j++) {
          put(main, t0 + j * beat + beat / 2, hat, 0.07, 0.2);
          if (M.floor) {
            put(main, t0 + j * beat + beat / 4, hat, 0.03, -0.2);
            put(main, t0 + j * beat + (3 * beat) / 4, hat, 0.03, 0.2);
          }
        }
      }
      if (M.drive >= 2 && bi >= 4) {
        put(main, t0 + beat, clap, 0.16, 0);
        put(main, t0 + 3 * beat, clap, 0.16, 0);
      }
    }

    // final shimmer on the ending chord
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

const mode = process.argv[2];
const inp = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const outPath = process.argv[4];
if (mode === "sfx") runSfx(inp, outPath);
else if (mode === "music") runMusic(inp, outPath);
else { console.error("unknown mode " + mode); process.exit(2); }
`;
