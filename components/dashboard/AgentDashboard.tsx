"use client";
// The Agent Dashboard: one per chat, created with "[dashboard" in the chat. It shows what THIS agent has really done
// (tasks, calls, code, clients booked ...) and updates by itself (every 10 seconds, and at once when the chat changes).
// Light mode looks like the reference design; Night mode is the same design in dark purple.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { ArrowRight, ArrowUpRight, CalendarCheck, CalendarDays, CheckCheck, Code2, MessageSquare, Phone, RefreshCw, Sparkles, TrendingDown, TrendingUp, X } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import type { AvatarColor } from "@/lib/bots";
import type { DashEvent, DashKpi, DashRange, DashSlice, DashStats } from "@/lib/dashboard-server";

// ---------------------------------------------------------------- data
export function useDashStats(chatId: string, active = true) {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashStats | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const gen = useRef(0);

  const reload = useCallback(async (fresh = false) => {
    if (!user || !chatId) return;
    const mine = ++gen.current;
    setBusy(true);
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
        body: JSON.stringify({ action: "stats", chatId, tz: new Date().getTimezoneOffset(), fresh }),
      });
      const d = await res.json().catch(() => ({}));
      if (mine !== gen.current) return;
      if (!res.ok) throw new Error(d?.error || "Could not load the dashboard.");
      setStats(d as DashStats); setError("");
    } catch (e) { if (mine === gen.current) setError(e instanceof Error ? e.message : "Could not load the dashboard."); }
    if (mine === gen.current) setBusy(false);
  }, [user, chatId]);

  useEffect(() => { setStats(null); setError(""); }, [chatId]);
  useEffect(() => {
    if (!active) return;
    void reload();
    const tick = () => { if (document.visibilityState === "visible") void reload(); };
    const id = window.setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    const onCmd = (e: Event) => { if ((e as CustomEvent).detail?.chatId === chatId) window.setTimeout(() => void reload(true), 600); };
    window.addEventListener("av:dashboard", onCmd);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); window.removeEventListener("av:dashboard", onCmd); };
  }, [active, reload, chatId]);

  // the chat itself changed (a new message, a finished task): refresh now instead of waiting for the next tick
  useEffect(() => {
    if (!active || !user || !chatId) return;
    let t: number | undefined, first = true;
    const un = onSnapshot(doc(db, "users", user.uid, "chats", chatId), () => {
      if (first) { first = false; return; }
      window.clearTimeout(t); t = window.setTimeout(() => void reload(true), 1500);
    }, () => {});
    return () => { window.clearTimeout(t); un(); };
  }, [active, user, chatId, reload]);

  return { stats, error, busy, reload };
}

// ---------------------------------------------------------------- small helpers
const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));
export function useCount(target: number, ms = 800) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const a = from.current, b = target;
    if (a === b) return;
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => { const k = Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - k, 3); setV(a + (b - a) * e); if (k < 1) raf = requestAnimationFrame(step); else from.current = b; };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = b; };
  }, [target, ms]);
  return v;
}
function useTypewriter(phrases: string[]) {
  const [text, setText] = useState("");
  const key = phrases.join("|");
  useEffect(() => {
    let i = 0, n = 0, del = false, t: number;
    const run = () => {
      const p = phrases[i % phrases.length];
      if (!del) { n++; setText(p.slice(0, n)); if (n >= p.length) { del = true; t = window.setTimeout(run, 2600); return; } t = window.setTimeout(run, 55); }
      else { n -= 2; setText(p.slice(0, Math.max(0, n))); if (n <= 0) { del = false; n = 0; i++; t = window.setTimeout(run, 400); return; } t = window.setTimeout(run, 22); }
    };
    t = window.setTimeout(run, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return text;
}
const ago = (ms: number) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); if (s < 5) return "just now"; if (s < 60) return `${s}s ago`; const m = Math.round(s / 60); if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; return `${Math.round(h / 24)} d ago`; };
function niceMax(v: number) { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
const PALETTE = ["#8A6FD6", "#4F35A1", "#A18AE6", "#CDBFF7", "#2F3866", "#6B4FD0", "#B8A7F0"];
const KIND_ICON: Record<string, string> = { task: "✅", call: "📞", code: "💻", booking: "📅", mail: "✉️", deck: "🖼️", video: "🎬", mission: "🎯", note: "📝" };

// ---------------------------------------------------------------- styles
export function DashboardStyles() { return <style>{CSS}</style>; }
const CSS = `
.vd-root{--vd-page:#dcd9e6;--vd-card:#f8f8f8;--vd-panel:#fcfcfc;--vd-line:#ebe9f0;--vd-ink:#0d0d12;--vd-sub:#8b8a96;--vd-accent:#5b3fdb;--vd-accent-soft:#ece8fc;--vd-blue:#0b3f91;--vd-purple:#7c2cf0;--vd-chip:#efeef4;--vd-tip:#0d0d12;--vd-tipfg:#fff;--vd-shadow:0 30px 80px rgba(60,40,120,.18);color:var(--vd-ink);font-family:var(--font-inter),-apple-system,"Segoe UI",sans-serif}
html[data-theme="dark"] .vd-root{--vd-page:#0b0a12;--vd-card:#14121c;--vd-panel:#1a1724;--vd-line:#2a2638;--vd-ink:#f4f3f8;--vd-sub:#8f8ca0;--vd-accent:#6d4df0;--vd-accent-soft:#2a2350;--vd-blue:#5b8cff;--vd-purple:#a46bff;--vd-chip:#221f2f;--vd-tip:#f4f3f8;--vd-tipfg:#0d0d12;--vd-shadow:0 30px 80px rgba(0,0,0,.5)}
.vd-root *{box-sizing:border-box}
.vd-card{background:var(--vd-card);border-radius:40px;box-shadow:var(--vd-shadow);overflow:hidden}
.vd-top{display:flex;align-items:center;gap:16px;padding:26px 30px 6px;flex-wrap:wrap}
.vd-brand{display:flex;align-items:center;gap:12px;font-size:20px;font-weight:500;letter-spacing:-.01em;min-width:0}
.vd-brand span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}
.vd-nav{display:flex;gap:6px;margin:0 auto;overflow-x:auto;max-width:100%;scrollbar-width:none}
.vd-nav::-webkit-scrollbar{display:none}
.vd-pill{display:flex;align-items:center;gap:8px;border:0;background:var(--vd-chip);color:var(--vd-ink);border-radius:999px;padding:12px 20px;font-size:14px;cursor:pointer;white-space:nowrap;transition:background .2s,color .2s,transform .15s}
.vd-pill:hover{transform:translateY(-1px)}
.vd-pill.on{background:var(--vd-accent);color:#fff}
.vd-iconbtn{width:46px;height:46px;border-radius:999px;border:1px solid var(--vd-line);background:var(--vd-panel);color:var(--vd-ink);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .15s,background .2s}
.vd-iconbtn:hover{transform:translateY(-1px);background:var(--vd-chip)}
.vd-hero{display:flex;align-items:center;gap:26px;padding:34px 30px 30px;flex-wrap:wrap;background:linear-gradient(180deg,var(--vd-card),var(--vd-card))}
.vd-orb{width:94px;height:94px;border-radius:50%;flex:none;background:radial-gradient(circle at 32% 28%,#fff 0,#e5d9ff 12%,#a98bf5 42%,#6a3fe0 78%,#5a2fd0 100%);box-shadow:0 18px 36px rgba(109,77,240,.45),inset -8px -10px 20px rgba(60,20,160,.35);animation:vd-float 5s ease-in-out infinite}
@keyframes vd-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.vd-hello{flex:1;min-width:260px}
.vd-h1{font-size:clamp(28px,4.4vw,46px);line-height:1.1;font-weight:500;letter-spacing:-.025em;margin:0}
.vd-h2{font-size:clamp(26px,4.2vw,46px);line-height:1.15;font-weight:500;letter-spacing:-.025em;margin:4px 0 0;color:var(--vd-sub);opacity:.75;min-height:1.2em}
.vd-caret{display:inline-block;width:2px;height:.9em;background:var(--vd-ink);margin-right:3px;vertical-align:-.08em;animation:vd-blink 1s steps(1) infinite}
@keyframes vd-blink{50%{opacity:0}}
.vd-date{display:flex;align-items:center;gap:14px}
.vd-day{width:94px;height:94px;border-radius:50%;border:1px solid var(--vd-line);display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:300;background:var(--vd-panel)}
.vd-dm{display:flex;flex-direction:column;gap:2px;font-size:14px;color:var(--vd-sub)}
.vd-dm b{font-size:19px;font-weight:500;color:var(--vd-ink)}
.vd-sep{width:1px;height:34px;background:var(--vd-line);margin:0 4px}
.vd-cta{display:flex;align-items:center;gap:22px;border:0;border-radius:999px;background:var(--vd-accent);color:#fff;padding:20px 30px;font-size:15px;cursor:pointer;transition:transform .15s,box-shadow .2s;box-shadow:0 10px 24px rgba(91,63,219,.35)}
.vd-cta:hover{transform:translateY(-2px);box-shadow:0 14px 30px rgba(91,63,219,.45)}
.vd-body{background:var(--vd-panel);padding:24px 30px 34px;border-radius:0}
.vd-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}
.vd-kpi{border:1px solid var(--vd-line);border-radius:28px;padding:22px 24px 20px;background:var(--vd-card);position:relative;cursor:pointer;transition:transform .2s,box-shadow .2s;text-align:left;color:inherit;font:inherit}
.vd-kpi:hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(60,40,120,.12)}
.vd-kl{font-size:15px;color:var(--vd-sub)}
.vd-kv{display:flex;align-items:center;gap:10px;margin:10px 0 18px;font-size:34px;font-weight:500;letter-spacing:-.02em}
.vd-badge{font-size:11px;font-weight:600;border-radius:7px;padding:3px 7px;letter-spacing:0;color:#fff;background:#15a46b}
.vd-badge.down{background:#ef4444}.vd-badge.flat{background:var(--vd-accent)}
.vd-kic{position:absolute;right:20px;top:18px;width:40px;height:40px;border-radius:50%;border:1px solid var(--vd-line);display:flex;align-items:center;justify-content:center;color:var(--vd-ink);background:var(--vd-panel)}
.vd-kf{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--vd-ink)}
.vd-kf .t{display:flex;align-items:center;gap:4px;color:var(--vd-accent);font-size:11px}
.vd-kf .a{margin-left:auto}
.vd-grid{display:grid;grid-template-columns:1.55fr 1fr;gap:20px;margin-top:20px}
.vd-panel{border:1px solid var(--vd-line);border-radius:28px;padding:22px 24px;background:var(--vd-card);min-width:0}
.vd-ph{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.vd-pic{width:46px;height:46px;border-radius:50%;border:1px solid var(--vd-line);display:flex;align-items:center;justify-content:center;background:var(--vd-panel);flex:none}
.vd-pt{font-size:18px;font-weight:500}
.vd-ps{font-size:13px;color:var(--vd-sub);margin-top:2px}
.vd-legend{margin-left:auto;display:flex;gap:18px;font-size:13px}
.vd-legend button{display:flex;align-items:center;gap:7px;background:none;border:0;color:var(--vd-ink);cursor:pointer;font:inherit;padding:0;transition:opacity .2s}
.vd-legend i{width:9px;height:9px;border-radius:50%;display:inline-block}
.vd-chart{position:relative;margin-top:14px}
.vd-chart svg{width:100%;height:auto;display:block;overflow:visible}
.vd-tip{position:absolute;transform:translate(-50%,-135%);background:var(--vd-tip);color:var(--vd-tipfg);border-radius:10px;padding:8px 12px;font-size:13px;font-weight:500;pointer-events:none;white-space:nowrap;transition:left .18s,top .18s}
.vd-tip small{display:block;font-weight:400;opacity:.7;font-size:11px}
.vd-sel{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:14px;color:var(--vd-ink);border:0;background:none;cursor:pointer;font-family:inherit}
.vd-sel select{appearance:none;background:none;border:0;color:var(--vd-ink);font:inherit;cursor:pointer;padding-right:4px}
.vd-sel select option{color:#111}
.vd-ret{display:flex;align-items:center;gap:24px;margin-top:20px;flex-wrap:wrap;justify-content:center}
.vd-donut{position:relative;width:220px;height:220px;flex:none}
.vd-donut svg{width:100%;height:100%;transform:rotate(-90deg)}
.vd-dc{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.vd-dc b{font-size:25px;font-weight:600}.vd-dc span{font-size:13px;color:var(--vd-sub)}
.vd-list{flex:1;min-width:190px}
.vd-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--vd-line)}
.vd-row:last-child{border-bottom:0}
.vd-dot{width:24px;height:24px;border-radius:50%;flex:none}
.vd-row small{display:block;font-size:11px;color:var(--vd-sub)}
.vd-row b{font-size:13px;font-weight:500}
.vd-row em{margin-left:auto;font-style:normal;font-size:14px}
.vd-live{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--vd-sub)}
.vd-live i{width:8px;height:8px;border-radius:50%;background:#15a46b;box-shadow:0 0 0 0 rgba(21,164,107,.6);animation:vd-pulse 2s infinite}
.vd-live.off i{background:#ef4444;animation:none}
@keyframes vd-pulse{70%{box-shadow:0 0 0 8px rgba(21,164,107,0)}100%{box-shadow:0 0 0 0 rgba(21,164,107,0)}}
.vd-act{margin-top:20px}
.vd-ev{display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--vd-line);font-size:14px}
.vd-ev:last-child{border-bottom:0}
.vd-ev span.e{width:34px;height:34px;border-radius:50%;background:var(--vd-chip);display:flex;align-items:center;justify-content:center;flex:none;font-size:15px}
.vd-ev small{margin-left:auto;color:var(--vd-sub);font-size:12px;white-space:nowrap;padding-left:10px}
.vd-mini{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:18px}
.vd-mini div{border:1px solid var(--vd-line);border-radius:20px;padding:16px 18px;background:var(--vd-card)}
.vd-mini small{color:var(--vd-sub);font-size:12px}.vd-mini b{display:block;font-size:26px;font-weight:500;margin-top:4px}
.vd-empty{color:var(--vd-sub);font-size:14px;padding:14px 0}
.vd-skel{background:linear-gradient(90deg,var(--vd-chip),var(--vd-line),var(--vd-chip));background-size:200% 100%;animation:vd-sh 1.4s infinite;border-radius:14px}
@keyframes vd-sh{to{background-position:-200% 0}}
.vd-in{animation:vd-in .5s cubic-bezier(.2,.8,.2,1) both}
@keyframes vd-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media (max-width:980px){.vd-kpis{grid-template-columns:repeat(2,1fr)}.vd-grid{grid-template-columns:1fr}.vd-card{border-radius:28px}.vd-nav{order:5;width:100%;margin:0}.vd-top{padding:20px 18px 4px}.vd-hero,.vd-body{padding-left:18px;padding-right:18px}}
@media (max-width:560px){.vd-kpis{grid-template-columns:1fr}.vd-date{width:100%}.vd-cta{padding:16px 22px}.vd-orb{width:70px;height:70px}.vd-day{width:70px;height:70px;font-size:26px}}
@media (prefers-reduced-motion:reduce){.vd-orb,.vd-live i,.vd-in,.vd-caret{animation:none!important}}
`;

// ---------------------------------------------------------------- charts
function LineChart({ labels, series }: { labels: string[]; series: Array<{ name: string; color: string; values: number[]; on: boolean }> }) {
  const W = 760, H = 300, L = 46, R = 16, T = 22, B = 38;
  const live = series.filter((s) => s.on);
  const max = niceMax(Math.max(0, ...live.flatMap((s) => s.values)));
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, labels.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const lastCalls = Math.max(0, live.length - 1);
  const [hover, setHover] = useState<{ i: number; s: number } | null>(null);
  const active = hover ?? { i: labels.length - 1, s: lastCalls };
  const sA = live[active.s] ?? live[0];
  const ticks = [0, 1, 2, 3, 4].map((k) => (max * k) / 4);
  const svg = useRef<SVGSVGElement>(null);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || !live.length) return;
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(((px - L) / (W - L - R)) * (labels.length - 1))));
    let best = 0, bd = 1e9;
    live.forEach((s, k) => { const d = Math.abs(y(s.values[i]) - py); if (d < bd) { bd = d; best = k; } });
    setHover({ i, s: best });
  };
  return (
    <div className="vd-chart">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Activity per month" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>{live.map((s, k) => (
          <linearGradient key={k} id={`vdg${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity=".22" /><stop offset="1" stopColor={s.color} stopOpacity="0" /></linearGradient>
        ))}</defs>
        {ticks.map((t, k) => (
          <g key={k}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--vd-line)" strokeWidth="1" /><text x={L - 10} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--vd-ink)">{t >= 1000 ? `${Math.round(t / 100) / 10}k` : Math.round(t * 10) / 10}</text></g>
        ))}
        {labels.map((l, i) => <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--vd-ink)">{l}</text>)}
        {live.map((s, k) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
          return (
            <g key={s.name}>
              <polygon points={`${x(0)},${y(0)} ${pts} ${x(labels.length - 1)},${y(0)}`} fill={`url(#vdg${k})`} />
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" />
              {s.values.map((v, i) => {
                const on = active.i === i && sA === s;
                return <circle key={i} cx={x(i)} cy={y(v)} r={on ? 6 : 4.5} fill={on ? s.color : "var(--vd-card)"} stroke={s.color} strokeWidth="1.6" />;
              })}
            </g>
          );
        })}
      </svg>
      {sA && (
        <div className="vd-tip" style={{ left: `${(x(active.i) / W) * 100}%`, top: `${(y(sA.values[active.i]) / H) * 100}%` }}>
          {fmt(sA.values[active.i])} {sA.name.toLowerCase()}<small>{labels[active.i]}</small>
        </div>
      )}
    </div>
  );
}

function Donut({ slices, total }: { slices: Array<DashSlice & { color: string }>; total: number }) {
  const R = 78, SW = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="vd-donut">
      <svg viewBox="0 0 220 220" role="img" aria-label="Where the work went">
        <defs>
          <pattern id="vdhatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="#8A6FD6" /><line x1="0" y1="0" x2="0" y2="5" stroke="#d9cffa" strokeWidth="1.6" />
          </pattern>
        </defs>
        <circle cx="110" cy="110" r={R} fill="none" stroke="var(--vd-line)" strokeWidth={SW} opacity={total ? 0 : 1} />
        {total > 0 && slices.map((s, i) => {
          const len = (s.count / total) * C;
          const el = <circle key={s.key} cx="110" cy="110" r={R} fill="none" stroke={i === 0 ? "url(#vdhatch)" : s.color} strokeWidth={SW} strokeDasharray={`${Math.max(0, len - 2.5)} ${C}`} strokeDashoffset={-acc} style={{ transition: "stroke-dasharray .6s ease" }} />;
          acc += len; return el;
        })}
      </svg>
      <div className="vd-dc"><b>{total ? fmt(total) : "0"}</b><span>{total ? "(100%)" : "no work yet"}</span></div>
    </div>
  );
}

// ---------------------------------------------------------------- the full dashboard
type Tab = "dashboard" | "calls" | "code" | "bookings";
const NAV: Array<[Tab, string, React.ReactNode]> = [
  ["dashboard", "Dashboard", <CheckCheck key="d" size={17} />], ["calls", "Calls", <Phone key="c" size={17} />],
  ["code", "Code", <Code2 key="o" size={17} />], ["bookings", "Bookings", <CalendarCheck key="b" size={17} />],
];

function Kpi({ label, k, icon, onClick, delay }: { label: string; k: DashKpi; icon: React.ReactNode; onClick: () => void; delay: number }) {
  const v = useCount(k.value);
  const d = k.delta;
  return (
    <button type="button" className="vd-kpi vd-in" style={{ animationDelay: `${delay}ms` }} onClick={onClick}>
      <div className="vd-kl">{label}</div>
      <span className="vd-kic">{icon}</span>
      <div className="vd-kv">{fmt(v)}
        {k.chip ? <span className="vd-badge flat">{k.chip}</span> : d !== null && <span className={`vd-badge ${d < 0 ? "down" : ""}`}>{d >= 0 ? "+" : ""}{d}%</span>}
      </div>
      <div className="vd-kf">
        {d !== null && <span className="t">{d < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}{d >= 0 ? "+" : ""}{d}%</span>}
        <span>{k.sub}</span><ArrowRight size={17} className="a" />
      </div>
    </button>
  );
}

function Events({ list, empty }: { list: DashEvent[]; empty: string }) {
  if (!list.length) return <p className="vd-empty">{empty}</p>;
  return <div>{list.map((e, i) => <div key={i} className="vd-ev"><span className="e">{KIND_ICON[e.kind] ?? "•"}</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{e.text}</span><small>{ago(e.at)}</small></div>)}</div>;
}

export default function AgentDashboard({ open, onClose, chatId, agentName, color }: { open: boolean; onClose: () => void; chatId: string; agentName: string; color: AvatarColor }) {
  const { stats, error, busy, reload } = useDashStats(chatId, open);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [range, setRange] = useState<DashRange>("month");
  const [showAct, setShowAct] = useState(false);
  const [off, setOff] = useState({ tasks: false, calls: false });
  const [now, setNow] = useState(() => new Date());
  const [, tick] = useState(0);
  const act = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!open) return; const id = window.setInterval(() => { setNow(new Date()); tick((n) => n + 1); }, 1000); return () => window.clearInterval(id); }, [open]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); const o = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { window.removeEventListener("keydown", k); document.body.style.overflow = o; }; }, [open, onClose]);
  useEffect(() => { if (open) { setTab("dashboard"); setShowAct(false); } }, [open, chatId]);

  const phrases = useMemo(() => {
    const k = stats?.kpis;
    return ["Just ask me anything!", k ? `${fmt(k.calls.value)} calls made so far.` : "I keep every number live.", k ? `${fmt(k.bookings.value)} clients booked.` : "Tell me what to do next."];
  }, [stats?.kpis]);
  const typed = useTypewriter(phrases);

  if (!open) return null;
  const k = stats?.kpis, x = stats?.extra, ser = stats?.series;
  const bd = stats?.breakdown?.[range];
  const slices = (() => {
    const s = bd?.slices ?? []; if (s.length <= 5) return s;
    const rest = s.slice(4); const count = rest.reduce((a, b) => a + b.count, 0);
    return [...s.slice(0, 4), { key: "other", label: "Other", count, pct: bd && bd.total ? Math.round((count / bd.total) * 100) : 0 }];
  })().map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] }));
  const ev = (kinds: string[]) => (stats?.recent ?? []).filter((e) => kinds.includes(e.kind));
  const loading = !stats && !error;
  const stale = stats ? Date.now() - stats.generatedAt > 40_000 : false;

  return createPortal(
    <div className="vd-root" style={{ position: "fixed", inset: 0, zIndex: 70, overflowY: "auto", background: "var(--vd-page)", padding: "clamp(8px,3vw,40px)" }} role="dialog" aria-modal="true" aria-label="Agent dashboard">
      <DashboardStyles />
      <div className="vd-card" style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div className="vd-top">
          <div className="vd-brand">
            <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden><rect x="1" y="1" width="26" height="26" rx="7" fill="#5b3fdb" /><rect x="19" y="19" width="26" height="26" rx="7" fill="#7b5cf0" /><rect x="19" y="19" width="8" height="8" fill="#3a22a8" opacity=".9" /></svg>
            <span title={agentName}>{agentName}</span>
          </div>
          <nav className="vd-nav" aria-label="Dashboard sections">
            {NAV.map(([key, label, ic]) => <button key={key} type="button" className={`vd-pill ${tab === key ? "on" : ""}`} onClick={() => setTab(key)}>{ic}{label}</button>)}
          </nav>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" className="vd-iconbtn" title="Back to the chat" aria-label="Back to the chat" onClick={onClose}><MessageSquare size={19} /></button>
            <button type="button" className="vd-iconbtn" title="Refresh now" aria-label="Refresh now" onClick={() => void reload(true)}><RefreshCw size={18} className={busy ? "animate-spin" : ""} /></button>
            <button type="button" className="vd-iconbtn" title="Close" aria-label="Close" onClick={onClose}><X size={19} /></button>
            <BotAvatar color={color} size={50} />
          </div>
        </div>

        <div className="vd-hero">
          <div className="vd-orb" aria-hidden />
          <div className="vd-hello">
            <h1 className="vd-h1">Hey, Need help? <span aria-hidden>👋</span></h1>
            <p className="vd-h2"><span className="vd-caret" />{typed}</p>
            <div className={`vd-live ${error ? "off" : ""}`} style={{ marginTop: 10 }}>
              <i />{error ? "Offline · retrying" : stats ? `Live · updated ${ago(stats.generatedAt)}${stale ? " (waiting)" : ""}` : "Connecting…"}
            </div>
          </div>
          <div className="vd-date">
            <div className="vd-day">{now.getDate()}</div>
            <div className="vd-dm"><span>{now.toLocaleDateString("en-US", { weekday: "short" })}</span><b>{now.toLocaleDateString("en-US", { month: "long" })}</b></div>
            <span className="vd-sep" />
            <button type="button" className="vd-cta" onClick={() => { setTab("dashboard"); setShowAct(true); window.setTimeout(() => act.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }}>Show Activity <ArrowRight size={19} /></button>
            <button type="button" className="vd-iconbtn" title="Recent activity" aria-label="Recent activity" onClick={() => setShowAct((v) => !v)}><CalendarDays size={19} /></button>
          </div>
        </div>

        <div className="vd-body">
          {error && !stats && <p className="vd-empty" style={{ color: "#ef4444" }}>{error}</p>}
          {loading && <div className="vd-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="vd-skel" style={{ height: 150 }} />)}</div>}

          {stats && stats.enabled === false && <p className="vd-empty">This chat has no dashboard yet. Type <b>[dashboard</b> in the chat to create it.</p>}

          {stats?.enabled && k && x && ser && tab === "dashboard" && (
            <>
              <div className="vd-kpis">
                <Kpi label="Tasks Done" k={k.tasks} icon={<CheckCheck size={18} />} delay={0} onClick={() => setShowAct(true)} />
                <Kpi label="Calls Made" k={k.calls} icon={<Phone size={18} />} delay={60} onClick={() => setTab("calls")} />
                <Kpi label="Code Written (lines)" k={k.code} icon={<Code2 size={18} />} delay={120} onClick={() => setTab("code")} />
                <Kpi label="Clients Booked" k={k.bookings} icon={<CalendarCheck size={18} />} delay={180} onClick={() => setTab("bookings")} />
              </div>

              <div className="vd-grid">
                <section className="vd-panel vd-in" style={{ animationDelay: "240ms" }}>
                  <div className="vd-ph">
                    <span className="vd-pic"><Sparkles size={19} /></span>
                    <div><div className="vd-pt">Activity Figures</div><div className="vd-ps">Tracking monthly work growth and distribution.</div></div>
                    <div className="vd-legend">
                      <button type="button" onClick={() => setOff((o) => ({ ...o, tasks: !o.tasks }))} style={{ opacity: off.tasks ? 0.4 : 1 }}><i style={{ background: "var(--vd-blue)" }} />Tasks</button>
                      <button type="button" onClick={() => setOff((o) => ({ ...o, calls: !o.calls }))} style={{ opacity: off.calls ? 0.4 : 1 }}><i style={{ background: "var(--vd-purple)" }} />Calls</button>
                    </div>
                  </div>
                  <LineChart labels={ser.labels} series={[
                    { name: "Tasks", color: "var(--vd-blue)", values: ser.tasks, on: !off.tasks },
                    { name: "Calls", color: "var(--vd-purple)", values: ser.calls, on: !off.calls },
                  ]} />
                </section>

                <section className="vd-panel vd-in" style={{ animationDelay: "300ms" }}>
                  <div className="vd-ph">
                    <span className="vd-pic"><TrendingUp size={19} /></span>
                    <div><div className="vd-pt">Work Breakdown</div><div className="vd-ps">Where this agent&apos;s work went.</div></div>
                    <label className="vd-sel"><select value={range} onChange={(e) => setRange(e.target.value as DashRange)} aria-label="Range"><option value="week">Weekly</option><option value="month">Monthly</option><option value="all">All time</option></select>⌄</label>
                  </div>
                  <div className="vd-ret">
                    <Donut slices={slices} total={bd?.total ?? 0} />
                    <div className="vd-list">
                      {slices.length === 0 && <p className="vd-empty">Nothing yet. Ask this agent for work in the chat and this fills up by itself.</p>}
                      {slices.map((s, i) => (
                        <div key={s.key} className="vd-row">
                          <span className="vd-dot" style={{ background: i === 0 ? "repeating-linear-gradient(45deg,#8A6FD6,#8A6FD6 3px,#d9cffa 3px,#d9cffa 4px)" : s.color }} />
                          <div><small>{s.label}</small><b>{fmt(s.count)}</b></div><em>{s.pct}%</em>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>

              <section className="vd-panel vd-act" ref={act} style={{ display: showAct ? "block" : "none" }}>
                <div className="vd-ph"><span className="vd-pic"><CheckCheck size={19} /></span><div><div className="vd-pt">Recent activity</div><div className="vd-ps">The latest things this agent did.</div></div></div>
                <Events list={stats.recent ?? []} empty="Nothing yet. Once the agent finishes tasks, calls or code they appear here." />
              </section>
            </>
          )}

          {stats?.enabled && x && tab === "calls" && (
            <section className="vd-in">
              <div className="vd-mini"><div><small>Calls made</small><b>{fmt(k?.calls.value ?? 0)}</b></div><div><small>Answered</small><b>{fmt(x.answeredCalls)}</b></div><div><small>Minutes talked</small><b>{fmt(x.callMinutes)}</b></div><div><small>Success rate</small><b>{stats.agent?.successPct == null ? "—" : `${stats.agent.successPct}%`}</b></div></div>
              <div className="vd-panel"><div className="vd-pt" style={{ marginBottom: 6 }}>Recent calls</div><Events list={ev(["call"])} empty="No calls yet. Ask the agent to call someone (it needs a phone provider under Voice)." /></div>
            </section>
          )}

          {stats?.enabled && x && tab === "code" && (
            <section className="vd-in">
              <div className="vd-mini"><div><small>Lines written</small><b>{fmt(k?.code.value ?? 0)}</b></div><div><small>Lines removed</small><b>{fmt(x.linesRemoved)}</b></div><div><small>Files touched</small><b>{fmt(x.files)}</b></div><div><small>Projects</small><b>{fmt(x.projects)}</b></div><div><small>Commands run</small><b>{fmt(x.commands)}</b></div><div><small>Decks · Videos</small><b>{fmt(x.decks)} · {fmt(x.videos)}</b></div></div>
              <div className="vd-panel"><div className="vd-pt" style={{ marginBottom: 6 }}>Recent code work</div><Events list={ev(["code", "deck", "video"])} empty="No code yet. Ask for code in the chat and Venus Code shows the work here." /></div>
              <p className="vd-ps" style={{ marginTop: 10 }}>Lines are counted from the project logs Venus Code keeps (the latest 300 steps of each project).</p>
            </section>
          )}

          {stats?.enabled && tab === "bookings" && (
            <section className="vd-in">
              <div className="vd-mini"><div><small>Clients booked</small><b>{fmt(k?.bookings.value ?? 0)}</b></div><div><small>Emails sent</small><b>{fmt(x?.emails ?? 0)}</b></div></div>
              <div className="vd-panel">
                <div className="vd-pt" style={{ marginBottom: 6 }}>Bookings</div>
                {(stats.bookingsList ?? []).length === 0 && <p className="vd-empty">No booking yet. Bookings come from calendar events the agent creates, phone calls that ended with a booked slot, and clients the agent writes down.</p>}
                {(stats.bookingsList ?? []).map((b, i) => <div key={i} className="vd-ev"><span className="e">📅</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{b.who}<small style={{ display: "block", marginLeft: 0, padding: 0 }}>{b.source}</small></span><small>{ago(b.at)}</small></div>)}
              </div>
            </section>
          )}
        </div>
      </div>
      <p className="vd-ps" style={{ textAlign: "center", margin: "14px 0 4px", opacity: 0.8 }}>Updates by itself · press Esc to close <ArrowUpRight size={11} style={{ display: "inline" }} /></p>
    </div>,
    document.body,
  );
}