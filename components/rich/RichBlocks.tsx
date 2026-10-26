"use client";

// Rich reply blocks for the chat: photo collage, interactive calculators / plans, cards with pictures,
// colour palettes, stat tiles, step timelines, explorers and "work done" reports.
// The model writes a fenced block with ONE JSON object; everything here is drawn by our own code
// (no iframes, no eval, no model-written HTML), and any block with bad data falls back to plain code.

import { Component, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Check, ClipboardCheck, ExternalLink, ImageOff, Minus, X } from "lucide-react";
import { evalFormula, type Vars } from "./calc-engine";
import { imgAllowed, useImageUrl } from "./image-url";
import { parseToolArgs } from "@/lib/tools/prompt";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const TEAL = "#3FC9AE";
const GOLD = "#E7B24D";
const PAL = [TEAL, GOLD, "#A98BF0", "#5FA6F0", "#F08A5E", "#7FBF93"];
const MUTED = "#8B8A90";
const LINE = "#28282D";

const str = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
const num = (v: unknown, d = 0) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const httpsUrl = (v: unknown) => { const u = str(v, 500); return /^https:\/\/[^\s]+$/.test(u) ? u : ""; };
const imgSrc = (v: unknown) => { const u = str(v, 600); return u && imgAllowed(u) ? u : ""; };

class Safe extends Component<{ children: ReactNode; fallback: ReactNode }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() { return { bad: true }; }
  render() { return this.state.bad ? this.props.fallback : this.props.children; }
}

function Shell({ label, title, children }: { label?: string; title?: string; children: ReactNode }) {
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line bg-panel" style={{ width: "34rem", maxWidth: "100%" }}>
      {(label || title) && (
        <div className="px-4 pt-3">
          {label && <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</div>}
          {title && <div className="mt-0.5 text-[15px] font-semibold text-ink">{title}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pictures: lightbox, tile, collage                                   */
/* ------------------------------------------------------------------ */

function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={alt || "Image"} onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} referrerPolicy="no-referrer" className="max-h-[88vh] max-w-[94vw] rounded-lg object-contain" />
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80">
        <X size={18} />
      </button>
    </div>
  );
}

function Tile({ src, alt, className = "", more = 0, onOpen }: { src: string; alt: string; className?: string; more?: number; onOpen: (url: string, alt: string) => void }) {
  const { url, failed, fail } = useImageUrl(src);
  if (failed) return <div className={`flex items-center justify-center bg-bg text-faint ${className}`}><ImageOff size={16} /></div>;
  if (!url) return <div className={`animate-pulse bg-bg ${className}`} />;
  return (
    <button type="button" onClick={() => onOpen(url, alt)} aria-label={alt || "Open picture"} className={`group relative block overflow-hidden bg-bg ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={fail} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
      {more > 0 && <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-lg font-semibold text-white">+{more}</span>}
    </button>
  );
}

/** 2 to 4 real pictures as one tidy collage (big picture left, small ones right). Click a picture to see it large. */
export function Collage({ items, credits }: { items: Array<{ src: string; alt: string }>; credits?: ReactNode[] }) {
  const [open, setOpen] = useState<{ url: string; alt: string } | null>(null);
  const shown = items.slice(0, 4);
  const extra = Math.max(0, items.length - 4);
  const n = shown.length;
  const o = (url: string, alt: string) => setOpen({ url, alt });
  const grid = n === 2 ? "grid-cols-2 h-48" : "grid-cols-2 grid-rows-2 h-60";
  const hasCredits = (credits ?? []).some(Boolean);
  return (
    <figure className="my-2" style={{ width: "34rem", maxWidth: "100%" }}>
      <div className={`grid gap-px overflow-hidden rounded-xl border border-line bg-line ${grid}`}>
        {shown.map((it, i) => (
          <Tile
            key={i}
            src={it.src}
            alt={it.alt}
            onOpen={o}
            more={i === n - 1 ? extra : 0}
            className={`h-full w-full ${n === 3 && i === 0 ? "row-span-2" : ""}`}
          />
        ))}
      </div>
      {hasCredits && (
        <details className="mt-1 text-[11px] text-faint">
          <summary className="cursor-pointer select-none hover:text-muted">Photo credits</summary>
          <div className="mt-1 space-y-0.5">{(credits ?? []).filter(Boolean).map((c, i) => <div key={i}>{c}</div>)}</div>
        </details>
      )}
      {open && <Lightbox url={open.url} alt={open.alt} onClose={() => setOpen(null)} />}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Calculator / plan                                                   */
/* ------------------------------------------------------------------ */

type Fmt = "money" | "percent" | "number" | "int";
type Out = { label: string; formula: string; format: Fmt; prefix: string; suffix: string; decimals?: number; tone: "good" | "bad" | "plain" };
type In = { id: string; label: string; min: number; max: number; step: number; value: number; prefix: string; suffix: string };
type ChartSpec = { type: "area" | "line" | "bar"; xLabel: string; from: number; to: number; steps: number; format: Fmt; prefix: string; suffix: string; decimals?: number; series: Array<{ name: string; formula: string }> };
type Tab = { label: string; inputs: In[]; hero?: Out & { sub?: Out }; split?: { a: Out; b: Out }; results: Out[]; chart?: ChartSpec; note: string };
type CalcSpec = { title: string; intro: string; tabs: Tab[] };

function normOut(r: any, fallbackFmt?: Pick<Out, "format" | "prefix" | "suffix">): Out | null {
  if (!r || typeof r !== "object") return null;
  const formula = str(r.formula ?? r.value ?? r.expr, 300);
  if (!formula) return null;
  const f = str(r.format ?? fallbackFmt?.format ?? "number", 12).toLowerCase();
  const format: Fmt = f === "money" || f === "currency" ? "money" : f === "percent" || f === "%" ? "percent" : f === "int" || f === "integer" ? "int" : "number";
  return {
    label: str(r.label, 60),
    formula,
    format,
    prefix: r.prefix !== undefined ? str(r.prefix, 3) : fallbackFmt?.prefix ?? (format === "money" ? "$" : ""),
    suffix: str(r.suffix ?? r.unit ?? fallbackFmt?.suffix ?? "", 16),
    decimals: r.decimals != null && Number.isFinite(Number(r.decimals)) ? Math.max(0, Math.min(4, Math.floor(Number(r.decimals)))) : undefined,
    tone: r.tone === "good" || r.tone === "bad" ? r.tone : "plain",
  };
}

function normIn(r: any, i: number): In | null {
  if (!r || typeof r !== "object") return null;
  let id = str(r.id ?? r.name ?? `v${i}`, 24).replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(id)) id = "v" + id;
  const min = num(r.min, 0);
  let max = num(r.max, min + 100);
  if (max <= min) max = min + 1;
  const span = max - min;
  let step = num(r.step, 0);
  if (!(step > 0)) step = span >= 50 ? 1 : span / 100;
  const value = Math.min(max, Math.max(min, num(r.value ?? r.default, (min + max) / 2)));
  return { id, label: str(r.label ?? r.id, 50), min, max, step, value, prefix: str(r.prefix, 3), suffix: str(r.suffix ?? r.unit, 16) };
}

function normTab(r: any): Tab | null {
  if (!r || typeof r !== "object") return null;
  const inputs = list(r.inputs).slice(0, 6).map(normIn).filter(Boolean) as In[];
  const hero = normOut(r.hero) ?? undefined;
  const sub = hero && r.hero?.sub ? normOut(r.hero.sub, hero) ?? undefined : undefined;
  const results = list(r.results ?? r.rows).slice(0, 10).map((x) => normOut(x, hero)).filter(Boolean) as Out[];
  const a = r.split ? normOut(r.split.a, hero) : null;
  const b = r.split ? normOut(r.split.b, hero) : null;
  let chart: ChartSpec | undefined;
  const c = r.chart;
  if (c && typeof c === "object") {
    const series = list(c.series).slice(0, 3).map((s) => ({ name: str(s?.name, 30), formula: str(s?.formula ?? s?.value, 300) })).filter((s) => s.formula);
    if (series.length) {
      const t = str(c.type, 8).toLowerCase();
      const fm = normOut({ formula: "0", format: c.format ?? hero?.format, prefix: c.prefix ?? hero?.prefix, suffix: c.suffix ?? hero?.suffix, decimals: c.decimals }, hero);
      chart = {
        type: t === "bar" ? "bar" : t === "line" ? "line" : "area",
        xLabel: str(c.xLabel ?? c.x, 20),
        from: num(c.from, 0),
        to: num(c.to, 10) === num(c.from, 0) ? num(c.from, 0) + 10 : num(c.to, 10),
        steps: Math.max(2, Math.min(48, Math.floor(num(c.steps, 20)))),
        format: fm?.format ?? "number", prefix: fm?.prefix ?? "", suffix: fm?.suffix ?? "", decimals: fm?.decimals,
        series,
      };
    }
  }
  if (!hero && !results.length && !chart) return null;
  return { label: str(r.label ?? r.title, 24), inputs, hero: hero ? { ...hero, sub } : undefined, split: a && b ? { a, b } : undefined, results, chart, note: str(r.note, 300) };
}

function normCalc(raw: any): CalcSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const src = Array.isArray(raw.tabs) && raw.tabs.length ? raw.tabs : [raw];
  const tabs = src.slice(0, 5).map(normTab).filter(Boolean) as Tab[];
  if (!tabs.length) return null;
  return { title: str(raw.title, 80), intro: str(raw.intro ?? raw.subtitle, 240), tabs };
}

function fmtVal(v: number, o: { format: Fmt; prefix: string; suffix: string; decimals?: number }): string {
  if (!Number.isFinite(v)) return "—";
  const loc = o.prefix === "₹" ? "en-IN" : "en-US";
  const neg = v < 0;
  const a = Math.abs(v);
  const d = o.decimals;
  let body: string;
  if (o.format === "int") body = Math.round(a).toLocaleString(loc);
  else if (o.format === "money") body = a.toLocaleString(loc, { minimumFractionDigits: d ?? 0, maximumFractionDigits: d ?? (a < 100 ? 2 : 0) });
  else if (o.format === "percent") body = a.toLocaleString(loc, { maximumFractionDigits: d ?? 2 }) + "%";
  else body = a.toLocaleString(loc, { maximumFractionDigits: d ?? 2 });
  return `${neg ? "-" : ""}${o.prefix}${body}${o.suffix ? ` ${o.suffix}` : ""}`;
}

const short = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${+(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${+(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${+(a / 1e3).toFixed(1)}k` : String(+a.toFixed(1));
  return (v < 0 ? "-" : "") + s;
};

function MiniChart({ c, vars }: { c: ChartSpec; vars: Vars }) {
  const gid = "g" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 480, H = 168, L = 8, R = 8, T = 12, B = 22;
  const xs = Array.from({ length: c.steps + 1 }, (_, i) => c.from + ((c.to - c.from) * i) / c.steps);
  const data = c.series.map((s) => xs.map((x) => evalFormula(s.formula, { ...vars, x })));
  const all = data.flat().filter((v) => Number.isFinite(v));
  if (!all.length) return null;
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const span = max - min || 1;
  const px = (i: number) => L + ((W - L - R) * i) / c.steps;
  const py = (v: number) => T + (H - T - B) * (1 - ((Number.isFinite(v) ? v : 0) - min) / span);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const idx = hover ?? c.steps;
  const xl = (x: number) => `${c.xLabel ? c.xLabel + " " : ""}${+x.toFixed(1)}`;
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(c.steps, Math.round(((f - L) / (W - L - R)) * c.steps))));
  };
  const bandW = (W - L - R) / (c.steps + 1);
  return (
    <div className="px-4 pb-1 pt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y select-none" role="img" aria-label="chart" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PAL[0]} stopOpacity={0.28} />
            <stop offset="100%" stopColor={PAL[0]} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f, i) => {
          const v = min + span * f;
          return (
            <g key={i}>
              <line x1={L} x2={W - R} y1={py(v)} y2={py(v)} stroke={LINE} strokeDasharray={f === 0 ? undefined : "3 4"} />
              <text x={L + 2} y={py(v) - 3} fill={MUTED} fontSize={9}>{short(v)}</text>
            </g>
          );
        })}
        {c.type === "bar"
          ? data.map((vals, si) =>
              vals.map((v, i) => {
                const gw = Math.max(2, bandW * 0.7);
                const bw = gw / data.length;
                const x = px(i) - gw / 2 + si * bw;
                const y0 = py(0), y1 = py(v);
                return <rect key={`${si}-${i}`} x={x} y={Math.min(y0, y1)} width={Math.max(1.5, bw - 1)} height={Math.max(1, Math.abs(y1 - y0))} rx={2} fill={PAL[si % 6]} opacity={hover === null || hover === i ? 1 : 0.45} />;
              }),
            )
          : data.map((vals, si) => (
              <g key={si}>
                {c.type === "area" && si === 0 && <path d={`${line(vals)} L${px(c.steps)} ${py(0)} L${px(0)} ${py(0)} Z`} fill={`url(#${gid})`} />}
                <path d={line(vals)} fill="none" stroke={PAL[si % 6]} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            ))}
        {c.type !== "bar" && (
          <>
            <line x1={px(idx)} x2={px(idx)} y1={T} y2={H - B} stroke={MUTED} strokeDasharray="2 3" opacity={hover === null ? 0 : 1} />
            {data.map((vals, si) => <circle key={si} cx={px(idx)} cy={py(vals[idx])} r={4} fill="#1B1B1F" stroke={PAL[si % 6]} strokeWidth={2} />)}
          </>
        )}
        <text x={L} y={H - 6} fill={MUTED} fontSize={10}>{xl(xs[0])}</text>
        <text x={W / 2} y={H - 6} fill={MUTED} fontSize={10} textAnchor="middle">{xl(xs[Math.floor(c.steps / 2)])}</text>
        <text x={W - R} y={H - 6} fill={MUTED} fontSize={10} textAnchor="end">{xl(xs[c.steps])}</text>
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1 text-[11px] text-muted">
        <span className="text-faint">{xl(xs[idx])}</span>
        {c.series.map((s, si) => (
          <span key={si} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: PAL[si % 6] }} />
            {s.name && <span>{s.name}</span>}
            <span className="font-medium text-ink">{fmtVal(data[si][idx], c)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function CalcView({ spec }: { spec: CalcSpec }) {
  const uid = useId();
  const [ti, setTi] = useState(0);
  const [raw, setRaw] = useState<Record<string, string>>({});
  const tab = spec.tabs[Math.min(ti, spec.tabs.length - 1)];
  const k = (id: string) => `${ti}.${id}`;

  const vars: Vars = {};
  for (const inp of tab.inputs) {
    const t = parseFloat(raw[k(inp.id)] ?? "");
    vars[inp.id] = Math.min(inp.max, Math.max(inp.min, Number.isFinite(t) ? t : inp.value));
  }
  const val = (o: Out) => evalFormula(o.formula, vars);
  const toneCls = (o: Out, v: number) => (o.tone === "good" ? "text-avatar-teal" : o.tone === "bad" || v < 0 ? "text-avatar-coral" : "text-ink");

  const hero = tab.hero;
  const heroV = hero ? val(hero) : NaN;
  const subV = hero?.sub ? val(hero.sub) : NaN;
  const sa = tab.split ? val(tab.split.a) : NaN;
  const sb = tab.split ? val(tab.split.b) : NaN;
  const sTotal = sa + sb;

  return (
    <Shell title={spec.title}>
      {spec.intro && <p className="px-4 pt-1 text-[12.5px] leading-relaxed text-muted">{spec.intro}</p>}
      {spec.tabs.length > 1 && (
        <div role="tablist" className="flex gap-1.5 overflow-x-auto px-4 pt-3">
          {spec.tabs.map((t, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === ti}
              type="button"
              onClick={() => setTi(i)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs transition-colors ${i === ti ? "bg-ink text-bg" : "bg-bg text-muted hover:text-ink"}`}
            >
              {t.label || `Option ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      {hero && (
        <div className="px-4 pt-4 text-center">
          {hero.label && <div className="text-[11.5px] text-muted">{hero.label}</div>}
          <div className={`text-[30px] font-semibold leading-tight tracking-tight ${toneCls(hero, heroV)}`}>{fmtVal(heroV, hero)}</div>
          {hero.sub && Number.isFinite(subV) && (
            <div className={`text-[12.5px] font-medium ${hero.sub.tone === "bad" || subV < 0 ? "text-avatar-coral" : "text-avatar-teal"}`}>
              {subV > 0 && hero.sub.format !== "percent" ? "+" : ""}{fmtVal(subV, hero.sub)}{hero.sub.label ? ` ${hero.sub.label}` : ""}
            </div>
          )}
        </div>
      )}

      {tab.split && Number.isFinite(sTotal) && sTotal > 0 && (
        <div className="px-4 pt-3">
          <div className="flex h-2 overflow-hidden rounded-full bg-bg">
            <div className="h-full bg-muted/60 transition-all" style={{ width: `${Math.max(0, (sa / sTotal) * 100)}%` }} />
            <div className="h-full bg-avatar-teal transition-all" style={{ width: `${Math.max(0, (sb / sTotal) * 100)}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>{tab.split.a.label} <span className="text-ink">{fmtVal(sa, tab.split.a)}</span></span>
            <span>{tab.split.b.label} <span className="text-avatar-teal">{fmtVal(sb, tab.split.b)}</span></span>
          </div>
        </div>
      )}

      {tab.chart && <MiniChart c={tab.chart} vars={vars} />}

      {tab.results.length > 0 && (
        <div className="mx-4 mt-2 divide-y divide-line rounded-lg border border-line bg-bg">
          {tab.results.map((o, i) => {
            const v = val(o);
            return (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                <span className="text-muted">{o.label}</span>
                <span className={`font-medium tabular-nums ${toneCls(o, v)}`}>{fmtVal(v, o)}</span>
              </div>
            );
          })}
        </div>
      )}

      {tab.inputs.length > 0 && (
        <div className="mt-2 space-y-2 px-4 pb-1 pt-2">
          {tab.inputs.map((inp) => {
            const id = `${uid}-${ti}-${inp.id}`;
            return (
              <div key={inp.id}>
                <div className="mb-1 flex items-center justify-between gap-3 text-[12px]">
                  <label htmlFor={id} className="text-muted">{inp.label}</label>
                  <span className="flex items-center gap-1 rounded-md border border-line bg-bg px-2 py-0.5 text-ink focus-within:border-gold">
                    {inp.prefix && <span className="text-faint">{inp.prefix}</span>}
                    <input
                      type="number"
                      inputMode="decimal"
                      value={raw[k(inp.id)] ?? String(inp.value)}
                      onChange={(e) => setRaw((r) => ({ ...r, [k(inp.id)]: e.target.value }))}
                      onBlur={() => setRaw((r) => ({ ...r, [k(inp.id)]: String(vars[inp.id]) }))}
                      className="w-20 bg-transparent text-right tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    {inp.suffix && <span className="text-faint">{inp.suffix}</span>}
                  </span>
                </div>
                <input
                  id={id}
                  type="range"
                  min={inp.min}
                  max={inp.max}
                  step={inp.step}
                  value={vars[inp.id]}
                  onChange={(e) => setRaw((r) => ({ ...r, [k(inp.id)]: e.target.value }))}
                  className="h-1.5 w-full cursor-pointer accent-gold"
                />
              </div>
            );
          })}
        </div>
      )}
      <div className="px-4 pb-3 pt-1 text-[11px] text-faint">{tab.note || "Estimate: change the numbers and the result updates."}</div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Cards (menu, products, places, options)                             */
/* ------------------------------------------------------------------ */

type Card = { title: string; text: string; image: string; emoji: string; tag: string; meta: string; link: string; credit: string };

function normCards(raw: any): { label: string; title: string; grid: boolean; items: Card[] } | null {
  const arr = Array.isArray(raw) ? raw : list(raw?.items ?? raw?.cards);
  const items = arr.slice(0, 12).map((c): Card | null => {
    if (!c || typeof c !== "object") return null;
    const title = str(c.title ?? c.name, 90);
    if (!title) return null;
    return { title, text: str(c.text ?? c.description, 320), image: imgSrc(c.image ?? c.img), emoji: str(c.emoji ?? c.icon, 4), tag: str(c.tag ?? c.badge, 24), meta: str(c.meta ?? c.price, 60), link: httpsUrl(c.link ?? c.url), credit: str(c.credit, 120) };
  }).filter(Boolean) as Card[];
  if (!items.length) return null;
  return { label: str(raw?.label, 40), title: str(raw?.title, 80), grid: str(raw?.layout, 8).toLowerCase() === "grid", items };
}

function CardsView({ spec }: { spec: NonNullable<ReturnType<typeof normCards>> }) {
  const [open, setOpen] = useState<{ url: string; alt: string } | null>(null);
  const o = (url: string, alt: string) => setOpen({ url, alt });
  const head = (c: Card) => (
    <div className="flex items-center gap-2">
      {c.link ? (
        <a href={c.link} target="_blank" rel="noreferrer noopener" className="text-[14px] font-semibold text-ink hover:text-gold">{c.title}</a>
      ) : (
        <span className="text-[14px] font-semibold text-ink">{c.title}</span>
      )}
      {c.tag && <span className="rounded-full bg-goldSoft px-2 py-0.5 text-[10.5px] text-gold">{c.tag}</span>}
    </div>
  );
  return (
    <Shell label={spec.label} title={spec.title}>
      {spec.grid ? (
        <div className="grid grid-cols-2 gap-2 p-3">
          {spec.items.map((c, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-line bg-bg" title={c.credit || undefined}>
              {c.image ? <Tile src={c.image} alt={c.title} onOpen={o} className="aspect-[4/3] w-full" /> : <div className="flex aspect-[4/3] w-full items-center justify-center bg-panel2 text-3xl">{c.emoji || "•"}</div>}
              <div className="space-y-0.5 p-2.5">
                {head(c)}
                {c.text && <p className="text-[12px] leading-snug text-muted">{c.text}</p>}
                {c.meta && <div className="text-[11.5px] text-faint">{c.meta}</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 divide-y divide-line">
          {spec.items.map((c, i) => (
            <div key={i} className="flex gap-3 px-4 py-3" title={c.credit || undefined}>
              {c.image ? (
                <Tile src={c.image} alt={c.title} onOpen={o} className="h-[68px] w-[68px] shrink-0 rounded-lg" />
              ) : (
                <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-lg bg-bg text-2xl">{c.emoji || "•"}</div>
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                {head(c)}
                {c.text && <p className="text-[12.5px] leading-snug text-muted">{c.text}</p>}
                {c.meta && <div className="text-[11.5px] text-faint">{c.meta}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && <Lightbox url={open.url} alt={open.alt} onClose={() => setOpen(null)} />}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Palette, stats, steps                                               */
/* ------------------------------------------------------------------ */

function PaletteView({ raw }: { raw: any }) {
  const [copied, setCopied] = useState("");
  const arr = Array.isArray(raw) ? raw : list(raw?.colors ?? raw?.items);
  const colors = arr.slice(0, 10).map((c) => {
    const hex = str(typeof c === "string" ? c : c?.hex ?? c?.color, 9);
    return /^#[0-9a-f]{3,8}$/i.test(hex) ? { hex, name: typeof c === "string" ? "" : str(c?.name, 24) } : null;
  }).filter(Boolean) as Array<{ hex: string; name: string }>;
  if (!colors.length) return null;
  return (
    <Shell label={str(raw?.label, 40)} title={str(raw?.title, 80)}>
      <div className="flex flex-wrap gap-x-4 gap-y-3 px-4 py-3">
        {colors.map((c) => (
          <button
            key={c.hex}
            type="button"
            title={`Copy ${c.hex}`}
            onClick={() => { navigator.clipboard?.writeText(c.hex); setCopied(c.hex); setTimeout(() => setCopied(""), 1200); }}
            className="group flex w-14 flex-col items-center gap-1"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-line shadow-inner transition-transform group-hover:scale-110" style={{ background: c.hex }}>
              {copied === c.hex && <Check size={16} className="text-white mix-blend-difference" />}
            </span>
            <span className="max-w-full truncate text-[10.5px] text-muted">{c.name || c.hex}</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

function StatsView({ raw }: { raw: any }) {
  const arr = Array.isArray(raw) ? raw : list(raw?.items ?? raw?.stats);
  const items = arr.slice(0, 8).map((s) => (s && typeof s === "object" && str(s.value, 30) ? { label: str(s.label, 40), value: str(s.value, 30), delta: str(s.delta ?? s.change, 24), tone: str(s.tone, 6) } : null)).filter(Boolean) as Array<{ label: string; value: string; delta: string; tone: string }>;
  if (!items.length) return null;
  return (
    <Shell label={str(raw?.label, 40)} title={str(raw?.title, 80)}>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
        {items.map((s, i) => {
          const bad = s.tone === "bad" || (!s.tone && s.delta.startsWith("-"));
          return (
            <div key={i} className="rounded-lg border border-line bg-bg px-3 py-2.5">
              <div className="text-[11px] text-muted">{s.label}</div>
              <div className="text-[19px] font-semibold leading-tight text-ink">{s.value}</div>
              {s.delta && <div className={`text-[11.5px] font-medium ${bad ? "text-avatar-coral" : "text-avatar-teal"}`}>{s.delta}</div>}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

function StepsView({ raw }: { raw: any }) {
  const [done, setDone] = useState<Record<number, boolean>>({});
  const arr = Array.isArray(raw) ? raw : list(raw?.steps ?? raw?.items);
  const steps = arr.slice(0, 14).map((s) => {
    if (typeof s === "string") return { title: str(s, 100), text: "", time: "" };
    return s && typeof s === "object" && str(s.title ?? s.label, 100) ? { title: str(s.title ?? s.label, 100), text: str(s.text ?? s.detail, 280), time: str(s.time ?? s.when, 24) } : null;
  }).filter(Boolean) as Array<{ title: string; text: string; time: string }>;
  if (!steps.length) return null;
  return (
    <Shell label={str(raw?.label, 40)} title={str(raw?.title, 80)}>
      <ol className="relative ml-7 mr-4 mt-3 border-l border-line pb-1">
        {steps.map((s, i) => (
          <li key={i} className="relative mb-3.5 pl-6">
            <button
              type="button"
              aria-pressed={!!done[i]}
              aria-label={`Mark step ${i + 1} ${done[i] ? "not done" : "done"}`}
              onClick={() => setDone((d) => ({ ...d, [i]: !d[i] }))}
              className={`absolute -left-[13px] top-0 flex h-[26px] w-[26px] items-center justify-center rounded-full border text-[11px] font-semibold transition-colors ${done[i] ? "border-avatar-teal bg-avatar-teal text-bg" : "border-line bg-panel2 text-muted hover:border-gold"}`}
            >
              {done[i] ? <Check size={13} /> : i + 1}
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[13.5px] font-semibold ${done[i] ? "text-faint line-through" : "text-ink"}`}>{s.title}</span>
              {s.time && <span className="rounded-full bg-bg px-2 py-0.5 text-[10.5px] text-muted">{s.time}</span>}
            </div>
            {s.text && <p className={`text-[12.5px] leading-snug ${done[i] ? "text-faint" : "text-muted"}`}>{s.text}</p>}
          </li>
        ))}
      </ol>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Explorer (pick a part, read what it does)                           */
/* ------------------------------------------------------------------ */

function ExplorerView({ raw }: { raw: any }) {
  const [sel, setSel] = useState<number | null>(null);
  const [open, setOpen] = useState<{ url: string; alt: string } | null>(null);
  const parts = list(raw?.parts ?? raw?.items).slice(0, 8).map((p) => (p && typeof p === "object" && str(p.label ?? p.title, 30) ? { label: str(p.label ?? p.title, 30), text: str(p.text ?? p.description, 400), emoji: str(p.emoji, 4) } : null)).filter(Boolean) as Array<{ label: string; text: string; emoji: string }>;
  if (!parts.length) return null;
  const image = imgSrc(raw?.image);
  const cur = sel === null ? null : parts[sel];
  return (
    <Shell label={str(raw?.label, 40) || "Explore"} title={str(raw?.title, 80)}>
      {image && <div className="px-4 pt-3"><Tile src={image} alt={str(raw?.title, 80)} onOpen={(url, alt) => setOpen({ url, alt })} className="aspect-[16/9] w-full rounded-lg" /></div>}
      <div role="tablist" className="flex flex-wrap gap-1.5 px-4 pt-3">
        {[{ label: "All", emoji: "" }, ...parts].map((p, i) => {
          const on = (i === 0 && sel === null) || i - 1 === sel;
          return (
            <button key={i} role="tab" aria-selected={on} type="button" onClick={() => setSel(i === 0 ? null : i - 1)} className={`rounded-full px-3 py-1 text-xs transition-colors ${on ? "bg-ink text-bg" : "bg-bg text-muted hover:text-ink"}`}>
              {p.emoji ? `${p.emoji} ` : ""}{p.label}
            </button>
          );
        })}
      </div>
      <div className="px-4 pb-3 pt-3">
        {cur ? (
          <div>
            <div className="text-[13.5px] font-semibold text-ink">{cur.emoji ? `${cur.emoji} ` : ""}{cur.label}</div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{cur.text}</p>
          </div>
        ) : (
          <div>
            {str(raw?.intro, 300) && <p className="mb-2 text-[13px] leading-relaxed text-muted">{str(raw?.intro, 300)}</p>}
            <div className="grid grid-cols-2 gap-1.5">
              {parts.map((p, i) => (
                <button key={i} type="button" onClick={() => setSel(i)} className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-left text-[12px] text-ink hover:border-gold">
                  {p.emoji ? `${p.emoji} ` : ""}{p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {open && <Lightbox url={open.url} alt={open.alt} onClose={() => setOpen(null)} />}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Report: what was done, with proof                                   */
/* ------------------------------------------------------------------ */

function ReportView({ raw }: { raw: any }) {
  const st = str(raw?.status, 10).toLowerCase();
  const status: "done" | "partial" | "blocked" = st.startsWith("b") || st.startsWith("f") ? "blocked" : st.startsWith("p") ? "partial" : "done";
  const steps = list(raw?.steps).slice(0, 16).map((s) => {
    if (!s || typeof s !== "object" || !str(s.label ?? s.title, 120)) return null;
    const x = str(s.state ?? s.status, 8).toLowerCase();
    const state: "done" | "failed" | "skipped" = /^(f|e|x|✗|✕)/.test(x) ? "failed" : /^(s|p|w|-|…)/.test(x) ? "skipped" : "done";
    return { label: str(s.label ?? s.title, 120), detail: str(s.detail ?? s.text, 220), state };
  }).filter(Boolean) as Array<{ label: string; detail: string; state: "done" | "failed" | "skipped" }>;
  const stats = list(raw?.stats).slice(0, 6).map((s) => (s && str(s.value, 24) ? { label: str(s.label, 30), value: str(s.value, 24) } : null)).filter(Boolean) as Array<{ label: string; value: string }>;
  const links = list(raw?.links).slice(0, 6).map((l) => (httpsUrl(l?.url) ? { label: str(l?.label, 40) || "Open", url: httpsUrl(l?.url) } : null)).filter(Boolean) as Array<{ label: string; url: string }>;
  const title = str(raw?.title, 90);
  const summary = str(raw?.summary, 400);
  if (!title && !steps.length && !summary) return null;
  const badge = status === "done" ? ["Done", "bg-avatar-teal/15 text-avatar-teal"] : status === "partial" ? ["Partly done", "bg-goldSoft text-gold"] : ["Blocked", "bg-avatar-coral/15 text-avatar-coral"];
  return (
    <Shell>
      <div className="flex items-start gap-3 px-4 pt-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg text-gold"><ClipboardCheck size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-ink">{title || "Work report"}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${badge[1]}`}>{badge[0]}</span>
          </div>
          {summary && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{summary}</p>}
        </div>
      </div>
      {stats.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {stats.map((s, i) => (
            <div key={i} className="rounded-lg border border-line bg-bg px-3 py-1.5">
              <div className="text-[15px] font-semibold leading-tight text-ink">{s.value}</div>
              <div className="text-[10.5px] text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {steps.length > 0 && (
        <ul className="mt-3 space-y-2 px-4">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2.5">
              <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${s.state === "done" ? "bg-avatar-teal text-bg" : s.state === "failed" ? "bg-avatar-coral text-bg" : "bg-line text-muted"}`}>
                {s.state === "done" ? <Check size={11} strokeWidth={3} /> : s.state === "failed" ? <X size={11} strokeWidth={3} /> : <Minus size={11} strokeWidth={3} />}
              </span>
              <div className="min-w-0 text-[13px] leading-snug">
                <span className="text-ink">{s.label}</span>
                {s.detail && <span className="text-muted"> — {s.detail}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 rounded-full border border-line bg-bg px-3 py-1 text-xs text-gold hover:border-gold">
              {l.label} <ExternalLink size={11} />
            </a>
          ))}
        </div>
      )}
      <div className="h-3" />
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Entry point used by Markdown                                        */
/* ------------------------------------------------------------------ */

export const RICH_LANGS = new Set(["calc", "calculator", "widget", "cards", "palette", "stats", "steps", "timeline", "explorer", "report"]);

export const RICH_LOADING: Record<string, string> = {
  calc: "Building calculator…", calculator: "Building calculator…", widget: "Building calculator…",
  cards: "Laying out cards…", palette: "Mixing colours…", stats: "Adding up numbers…",
  steps: "Lining up the steps…", timeline: "Lining up the steps…", explorer: "Building explorer…", report: "Writing the report…",
};

/** Draws one rich block. When the JSON is broken or empty, `fallback` (plain code) is shown instead, so nothing is ever lost. */
export function RichFence({ lang, code, fallback }: { lang: string; code: string; fallback: ReactNode }) {
  const raw = useMemo<any>(() => {
    try {
      const v = JSON.parse(code);
      return v && typeof v === "object" ? v : null;
    } catch {
      const v = parseToolArgs(code);
      return Object.keys(v).length ? v : null;
    }
  }, [code]);

  let el: ReactNode = null;
  if (raw) {
    if (lang === "calc" || lang === "calculator" || lang === "widget") {
      const s = normCalc(raw);
      if (s) el = <CalcView spec={s} />;
    } else if (lang === "cards") {
      const s = normCards(raw);
      if (s) el = <CardsView spec={s} />;
    } else if (lang === "palette") el = <PaletteView raw={raw} />;
    else if (lang === "stats") el = <StatsView raw={raw} />;
    else if (lang === "steps" || lang === "timeline") el = <StepsView raw={raw} />;
    else if (lang === "explorer") el = <ExplorerView raw={raw} />;
    else if (lang === "report") el = <ReportView raw={raw} />;
  }
  return el ? <Safe fallback={fallback}>{el}</Safe> : <>{fallback}</>;
}
