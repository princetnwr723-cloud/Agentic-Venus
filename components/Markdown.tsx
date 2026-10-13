"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, Copy, ImageOff } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

// Remote images are only shown from these hosts (a model-written image URL can otherwise leak data in its query string).
const IMG_HOSTS = [
  "upload.wikimedia.org", "images.unsplash.com", "images.pexels.com",
  "raw.githubusercontent.com", "user-images.githubusercontent.com", "avatars.githubusercontent.com",
];
const hostOk = (h: string) => IMG_HOSTS.includes(h) || h.endsWith(".supabase.co");
const urlCache = new Map<string, string>();

function ChatImage({ src, alt }: { src: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    setUrl(null);
    setFailed(false);
    (async () => {
      try {
        if (src.startsWith("vimg:")) {
          const path = src.slice(5);
          const hit = urlCache.get(path);
          if (hit) { if (!dead) setUrl(hit); return; }
          const res = await fetch("/api/venus/media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "url", path }),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok || !d.url) throw new Error("no url");
          urlCache.set(path, String(d.url));
          if (!dead) setUrl(String(d.url));
        } else if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(src)) {
          setUrl(src);
        } else {
          const u = new URL(src);
          if (u.protocol === "https:" && hostOk(u.hostname)) setUrl(src);
          else throw new Error("blocked");
        }
      } catch {
        if (!dead) setFailed(true);
      }
    })();
    return () => { dead = true; };
  }, [src]);

  if (failed) {
    return (
      <span className="my-1 inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-faint">
        <ImageOff size={13} /> {alt || "Image unavailable"}
      </span>
    );
  }
  return (
    <figure className="my-2" style={{ width: "28rem", maxWidth: "100%" }}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer noopener">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="w-full rounded-lg border border-line bg-bg"
          />
        </a>
      ) : (
        <div className="h-40 w-full animate-pulse rounded-lg border border-line bg-bg" />
      )}
      {alt && <figcaption className="mt-1 text-[11px] text-faint">{alt}</figcaption>}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Charts (bar / line / pie / donut) as plain SVG                      */
/* ------------------------------------------------------------------ */

const PALETTE = ["#E7B24D", "#3FC9AE", "#A98BF0", "#5FA6F0", "#F08A5E", "#7FBF93"];
const INK = "#F1F0EC";
const MUTED = "#8B8A90";
const LINE = "#28282D";

type ChartSpec = {
  type: "bar" | "line" | "pie" | "donut";
  title?: string;
  unit?: string;
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
};

function normChart(raw: any): ChartSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  let labels: string[] = [];
  let series: Array<{ name: string; values: number[] }> = [];
  if (Array.isArray(raw.data)) {
    labels = raw.data.map((d: any) => String(d?.label ?? d?.name ?? ""));
    series = [{ name: String(raw.name ?? ""), values: raw.data.map((d: any) => num(d?.value)) }];
  } else if (Array.isArray(raw.labels) && Array.isArray(raw.series)) {
    labels = raw.labels.map(String);
    series = raw.series.slice(0, 6).map((s: any) => ({
      name: String(s?.name ?? ""),
      values: (Array.isArray(s?.values) ? s.values : []).map(num),
    }));
  } else if (Array.isArray(raw.labels) && Array.isArray(raw.values)) {
    labels = raw.labels.map(String);
    series = [{ name: String(raw.name ?? ""), values: raw.values.map(num) }];
  } else return null;
  labels = labels.slice(0, 24);
  series = series.filter((s) => s.values.length).map((s) => ({ ...s, values: s.values.slice(0, labels.length) }));
  if (!labels.length || !series.length) return null;
  const t = String(raw.type ?? "bar").toLowerCase();
  const type = t === "line" || t === "area" ? "line" : t === "pie" ? "pie" : t === "donut" || t === "doughnut" ? "donut" : "bar";
  return {
    type, labels, series,
    title: raw.title ? String(raw.title).slice(0, 80) : undefined,
    unit: raw.unit ? String(raw.unit).slice(0, 12) : undefined,
  };
}

const fmt = (n: number) =>
  Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n * 100) / 100);
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const polar = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

function ChartView({ spec }: { spec: ChartSpec }) {
  const { type, title, unit, labels, series } = spec;
  const W = 480;
  const multi = series.length > 1;
  const top = (title ? 28 : 10) + (multi && type !== "pie" && type !== "donut" ? 20 : 0);
  const wrapStyle = { width: "34rem", maxWidth: "100%" } as const;

  const titleEl = title ? (
    <text x={6} y={18} fill={INK} fontSize={13} fontWeight={700}>{title}</text>
  ) : null;

  if (type === "pie" || type === "donut") {
    const vals = labels.map((_, i) => Math.max(0, series[0].values[i] ?? 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const H = Math.max(200, top + labels.length * 20 + 16);
    const cy = (top + H) / 2;
    const r = Math.min(82, (H - top) / 2 - 6);
    const cx = 116;
    const ri = type === "donut" ? r * 0.58 : 0;
    let a0 = -Math.PI / 2;
    const slices = vals.map((v, i) => {
      const frac = v / total;
      const a1 = a0 + frac * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      let node: ReactNode = null;
      if (frac >= 0.9999) {
        node = (
          <g key={i}>
            <circle cx={cx} cy={cy} r={r} fill={PALETTE[i % 6]} />
            {ri > 0 && <circle cx={cx} cy={cy} r={ri} fill="#1B1B1F" />}
          </g>
        );
      } else if (frac > 0) {
        const [x1, y1] = polar(cx, cy, r, a0);
        const [x2, y2] = polar(cx, cy, r, a1);
        let d: string;
        if (ri > 0) {
          const [x3, y3] = polar(cx, cy, ri, a1);
          const [x4, y4] = polar(cx, cy, ri, a0);
          d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${ri} ${ri} 0 ${large} 0 ${x4} ${y4} Z`;
        } else {
          d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
        }
        node = <path key={i} d={d} fill={PALETTE[i % 6]} stroke="#1B1B1F" strokeWidth={1.5} />;
      }
      a0 = a1;
      return node;
    });
    return (
      <div className="my-2 rounded-lg border border-line bg-bg p-2" style={wrapStyle}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title || "chart"}>
          {titleEl}
          {slices}
          {labels.map((l, i) => (
            <g key={i} transform={`translate(250 ${top + 6 + i * 20})`}>
              <rect width={10} height={10} rx={2} fill={PALETTE[i % 6]} />
              <text x={16} y={9} fill={INK} fontSize={11}>
                {cut(l, 20)} · {fmt(vals[i])}{unit ? ` ${unit}` : ""} ({Math.round((vals[i] / total) * 100)}%)
              </text>
            </g>
          ))}
        </svg>
      </div>
    );
  }

  const H = 250;
  const rotate = labels.length > 6;
  const L = 46, R = 14, B = rotate ? 62 : 34;
  const pw = W - L - R, ph = H - top - B;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (v: number) => top + ph - ((v - min) / span) * ph;
  const ticks = [0, 1, 2, 3, 4].map((i) => min + (span * i) / 4);
  const n = labels.length;
  const band = pw / n;
  const showVals = n * series.length <= 8;

  return (
    <div className="my-2 rounded-lg border border-line bg-bg p-2" style={wrapStyle}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title || "chart"}>
        {titleEl}
        {multi && series.map((s, i) => (
          <g key={i} transform={`translate(${6 + i * 110} ${title ? 32 : 14})`}>
            <rect width={10} height={10} rx={2} fill={PALETTE[i % 6]} />
            <text x={15} y={9} fill={MUTED} fontSize={10.5}>{cut(s.name || `Series ${i + 1}`, 14)}</text>
          </g>
        ))}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={LINE} strokeWidth={1} />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" fill={MUTED} fontSize={10}>{fmt(t)}</text>
          </g>
        ))}
        {type === "bar" && series.map((s, si) => {
          const group = band * 0.72;
          const bw = group / series.length;
          return labels.map((_, i) => {
            const v = s.values[i] ?? 0;
            const x = L + i * band + (band - group) / 2 + si * bw;
            const yy = Math.min(y(v), y(0));
            const hh = Math.max(1, Math.abs(y(v) - y(0)));
            return (
              <g key={`${si}-${i}`}>
                <rect x={x} y={yy} width={Math.max(2, bw - 2)} height={hh} rx={3} fill={PALETTE[si % 6]} />
                {showVals && (
                  <text x={x + bw / 2 - 1} y={yy - 4} textAnchor="middle" fill={INK} fontSize={10}>{fmt(v)}{unit ? ` ${unit}` : ""}</text>
                )}
              </g>
            );
          });
        })}
        {type === "line" && series.map((s, si) => {
          const pts = labels.map((_, i): [number, number] => [L + band * i + band / 2, y(s.values[i] ?? 0)]);
          return (
            <g key={si}>
              <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={PALETTE[si % 6]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => (
                <g key={i}>
                  <circle cx={p[0]} cy={p[1]} r={3.5} fill="#1B1B1F" stroke={PALETTE[si % 6]} strokeWidth={2} />
                  {showVals && <text x={p[0]} y={p[1] - 8} textAnchor="middle" fill={INK} fontSize={10}>{fmt(s.values[i] ?? 0)}</text>}
                </g>
              ))}
            </g>
          );
        })}
        {labels.map((l, i) => {
          const x = L + band * i + band / 2;
          const yy = H - B + 16;
          return rotate ? (
            <text key={i} x={x} y={yy} textAnchor="end" fill={MUTED} fontSize={10} transform={`rotate(-35 ${x} ${yy})`}>{cut(l, 14)}</text>
          ) : (
            <text key={i} x={x} y={yy} textAnchor="middle" fill={MUTED} fontSize={10.5}>{cut(l, 12)}</text>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diagrams: mermaid-style flowcharts ("A[Start] --> B{Ok?}") as SVG   */
/* ------------------------------------------------------------------ */

type GNode = { id: string; label: string; shape: "rect" | "round" | "diamond" };
type GEdge = { from: string; to: string; label?: string };

function parseGraph(src: string): { dir: "LR" | "TD"; nodes: GNode[]; edges: GEdge[] } | null {
  let dir: "LR" | "TD" = "TD";
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const clean = (s: string) => s.trim().replace(/^["']|["']$/g, "").replace(/<br\s*\/?>/gi, " ").slice(0, 40);

  const node = (raw: string): string | null => {
    const t = raw.trim();
    if (!t) return null;
    const m = /^([A-Za-z0-9_\u0900-\u097F]+)\s*(?:\[\[?([^\]]*)\]?\]|\(\(?([^)]*)\)?\)|\{([^}]*)\})?\s*$/.exec(t);
    if (!m) {
      const label = clean(t);
      if (!nodes.has(label)) nodes.set(label, { id: label, label, shape: "rect" });
      return label;
    }
    const id = m[1];
    const text = m[2] ?? m[3] ?? m[4];
    if (text === undefined) {
      if (!nodes.has(id)) nodes.set(id, { id, label: id, shape: "rect" });
      return id;
    }
    nodes.set(id, { id, label: clean(text), shape: m[4] !== undefined ? "diamond" : m[3] !== undefined ? "round" : "rect" });
    return id;
  };

  const arrow = /\s*(?:-->|==>|-\.->|->|---|--)\s*(?:\|([^|]*)\|)?\s*/g;
  for (const rawLine of src.split(/\n|;/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const head = /^(graph|flowchart)\b\s*(\w+)?/i.exec(line);
    if (head) { dir = /^(LR|RL)$/i.test(head[2] ?? "") ? "LR" : "TD"; continue; }
    if (/^(%%|subgraph\b|end\b|style\b|classDef\b|class\b|click\b|linkStyle\b|direction\b)/i.test(line)) continue;

    const segs: string[] = [];
    const labels: Array<string | undefined> = [];
    let last = 0;
    arrow.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = arrow.exec(line)) !== null) {
      segs.push(line.slice(last, m.index));
      labels.push(m[1]);
      last = arrow.lastIndex;
    }
    segs.push(line.slice(last));
    if (segs.length < 2) { node(line); continue; }
    const ids = segs.map(node);
    for (let i = 0; i < ids.length - 1; i++) {
      const a = ids[i], b = ids[i + 1];
      if (a && b) edges.push({ from: a, to: b, label: labels[i]?.trim() || undefined });
    }
  }
  if (!nodes.size || nodes.size > 40) return null;
  return { dir, nodes: Array.from(nodes.values()), edges: edges.slice(0, 80) };
}

function DiagramView({ src }: { src: string }) {
  const uid = "arr" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const g = parseGraph(src);
  if (!g) return <CodeBlock code={src} lang="diagram" />;

  const { dir, nodes, edges } = g;
  const LR = dir === "LR";
  const PAD = 16, GM = 56, GC = 22;
  const dims = new Map(nodes.map((n) => {
    const w = Math.max(84, n.label.length * 7.2 + (n.shape === "diamond" ? 54 : 28));
    return [n.id, { w, h: n.shape === "diamond" ? 54 : 38 }] as const;
  }));

  const layer = new Map(nodes.map((n) => [n.id, 0] as const));
  for (let it = 0; it < nodes.length; it++) {
    let changed = false;
    for (const e of edges) {
      if (e.from === e.to) continue;
      const nl = (layer.get(e.from) ?? 0) + 1;
      if (nl > (layer.get(e.to) ?? 0) && nl < nodes.length) { layer.set(e.to, nl); changed = true; }
    }
    if (!changed) break;
  }
  const groups: GNode[][] = [];
  for (const n of nodes) { const l = layer.get(n.id) ?? 0; (groups[l] ||= []).push(n); }
  const rows = groups.filter((x) => x && x.length);

  const mainOf = (id: string) => (LR ? dims.get(id)!.w : dims.get(id)!.h);
  const crossOf = (id: string) => (LR ? dims.get(id)!.h : dims.get(id)!.w);
  const totals = rows.map((gr) => gr.reduce((s, n) => s + crossOf(n.id), 0) + (gr.length - 1) * GC);
  const C = Math.max(...totals);
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  let main = PAD;
  rows.forEach((gr, gi) => {
    const ext = Math.max(...gr.map((n) => mainOf(n.id)));
    let c = PAD + (C - totals[gi]) / 2;
    for (const n of gr) {
      const d = dims.get(n.id)!;
      const start = main + (ext - mainOf(n.id)) / 2;
      pos.set(n.id, LR ? { x: start, y: c, w: d.w, h: d.h } : { x: c, y: start, w: d.w, h: d.h });
      c += crossOf(n.id) + GC;
    }
    main += ext + GM;
  });
  const mainTotal = main - GM + PAD;
  const vw = LR ? mainTotal : C + PAD * 2;
  const vh = LR ? C + PAD * 2 : mainTotal;

  const clip = (p: { x: number; y: number; w: number; h: number }, tx: number, ty: number): [number, number] => {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const s = Math.min(dx ? p.w / 2 / Math.abs(dx) : Infinity, dy ? p.h / 2 / Math.abs(dy) : Infinity);
    return [cx + dx * s, cy + dy * s];
  };

  return (
    <div className="my-2 overflow-x-auto rounded-lg border border-line bg-bg p-2" style={{ width: Math.min(vw + 18, 600), maxWidth: "100%" }}>
      <svg viewBox={`0 0 ${vw} ${vh}`} width="100%" role="img" aria-label="diagram">
        <defs>
          <marker id={uid} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={MUTED} />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos.get(e.from), b = pos.get(e.to);
          if (!a || !b) return null;
          const [x1, y1] = clip(a, b.x + b.w / 2, b.y + b.h / 2);
          const [x2, y2] = clip(b, a.x + a.w / 2, a.y + a.h / 2);
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={MUTED} strokeWidth={1.5} markerEnd={`url(#${uid})`} />
              {e.label && (
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle" fontSize={10.5} fill={INK} stroke="#1B1B1F" strokeWidth={4} paintOrder="stroke">{cut(e.label, 18)}</text>
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
          return (
            <g key={n.id}>
              {n.shape === "diamond" ? (
                <polygon points={`${cx},${p.y} ${p.x + p.w},${cy} ${cx},${p.y + p.h} ${p.x},${cy}`} fill="#151517" stroke="#E7B24D" strokeWidth={1.5} />
              ) : (
                <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={n.shape === "round" ? p.h / 2 : 8} fill="#151517" stroke="#5B5A60" strokeWidth={1.5} />
              )}
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fill={INK}>{n.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Code + fenced blocks                                                */
/* ------------------------------------------------------------------ */

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-line bg-bg">
      <div className="flex items-center justify-between border-b border-line px-3 py-1 text-[11px] text-faint">
        <span>{lang || "code"}</span>
        <button
          type="button"
          onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          className="flex items-center gap-1 hover:text-ink"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed text-ink"><code>{code}</code></pre>
    </div>
  );
}

function Drawing({ what }: { what: string }) {
  return (
    <div className="my-2 flex h-20 items-center justify-center rounded-lg border border-line bg-bg text-xs text-faint">
      <span className="animate-pulse">{what}</span>
    </div>
  );
}

function FenceBlock({ lang, code, closed }: { lang: string; code: string; closed: boolean }) {
  if (lang === "chart") {
    if (!closed) return <Drawing what="Drawing chart…" />;
    try {
      const spec = normChart(JSON.parse(code));
      if (spec) return <ChartView spec={spec} />;
    } catch { /* shown as code below */ }
    return <CodeBlock code={code} lang="chart (could not draw)" />;
  }
  if (lang === "mermaid" || lang === "diagram" || lang === "flow" || lang === "flowchart") {
    if (!closed) return <Drawing what="Drawing diagram…" />;
    return <DiagramView src={code} />;
  }
  return <CodeBlock code={code} lang={lang} />;
}

/* ------------------------------------------------------------------ */
/* Inline text                                                         */
/* ------------------------------------------------------------------ */

function renderInline(text: string, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`\n]+`)|(!\[[^\]\n]*\]\([^\s)]+\))|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\((?:https?:\/\/|\/(?!\/))[^\s)]+\))|(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${prefix}-${i++}`;
    if (m[1]) {
      nodes.push(<code key={k} className="rounded bg-bg px-1 py-0.5 text-[12.5px] text-gold">{tok.slice(1, -1)}</code>);
    } else if (m[2]) {
      const mm = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(tok);
      const alt = mm?.[1] ?? "";
      const src = (mm?.[2] ?? "").trim();
      let kind: "img" | "link" | "none" = "none";
      if ((/^vimg:[\w\-./]+$/.test(src) && !src.includes("..")) || /^data:image\//i.test(src)) kind = "img";
      else {
        try {
          const u = new URL(src);
          if (u.protocol === "https:") kind = hostOk(u.hostname) ? "img" : "link";
        } catch { /* not a URL */ }
      }
      if (kind === "img") nodes.push(<ChatImage key={k} src={src} alt={alt} />);
      else if (kind === "link") nodes.push(<a key={k} href={src} target="_blank" rel="noreferrer noopener" className="break-all text-gold underline">🖼 {alt || src}</a>);
      else nodes.push(alt);
    } else if (m[3]) {
      nodes.push(<strong key={k} className="font-semibold">{renderInline(tok.slice(2, -2), k)}</strong>);
    } else if (m[4]) {
      nodes.push(<s key={k} className="text-muted">{renderInline(tok.slice(2, -2), k)}</s>);
    } else if (m[5]) {
      nodes.push(<em key={k}>{renderInline(tok.slice(1, -1), k)}</em>);
    } else if (m[6]) {
      const mm = /^\[([^\]]+)\]\(((?:https?:\/\/|\/(?!\/))[^)]+)\)$/.exec(tok);
      nodes.push(mm ? <a key={k} href={mm[2]} target="_blank" rel="noreferrer noopener" className="text-gold underline">{mm[1]}</a> : tok);
    } else {
      nodes.push(<a key={k} href={tok} target="_blank" rel="noreferrer noopener" className="break-all text-gold underline">{tok}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/* ------------------------------------------------------------------ */
/* Block parser                                                        */
/* ------------------------------------------------------------------ */

const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const isHeading = (l: string) => /^#{1,4}\s+/.test(l);
const isFence = (l: string) => l.trim().startsWith("```");
const isHr = (l: string) => /^\s*([-*_])\1{2,}\s*$/.test(l);
const isQuote = (l: string) => /^\s*>/.test(l);
const isListLine = (l: string) => BULLET.test(l) || NUMBERED.test(l);
const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") { cur += "|"; i++; }
    else if (t[i] === "|") { cells.push(cur.trim()); cur = ""; }
    else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

function tableStarts(lines: string[], i: number): boolean {
  const a = lines[i], b = lines[i + 1];
  if (b === undefined || !a.includes("|")) return false;
  return SEP.test(b) && b.includes("-") && (b.includes("|") || a.trim().startsWith("|"));
}

const startsBlock = (lines: string[], i: number) =>
  isFence(lines[i]) || isHeading(lines[i]) || isListLine(lines[i]) || isHr(lines[i]) || isQuote(lines[i]) || tableStarts(lines, i);

const HEAD_CLS = ["", "mb-1 mt-3 text-[17px] font-semibold text-ink", "mb-1 mt-3 text-[15.5px] font-semibold text-ink", "mb-1 mt-2.5 text-[14.5px] font-semibold text-ink", "mb-1 mt-2 text-[14px] font-semibold text-muted"];

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isFence(line)) {
      const lang = line.trim().slice(3).trim().toLowerCase().split(/\s+/)[0] ?? "";
      const code: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) { code.push(lines[i]); i++; }
      const closed = i < lines.length;
      i++;
      out.push(<FenceBlock key={key++} lang={lang} code={code.join("\n")} closed={closed} />);
    } else if (tableStarts(lines, i)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left")) as Array<"left" | "center" | "right">;
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) { rows.push(splitRow(lines[i])); i++; }
      const k = key++;
      out.push(
        <div key={k} className="my-2 overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-panel">
              <tr>
                {head.map((h, n) => (
                  <th key={n} className="whitespace-nowrap px-3 py-2 font-semibold text-ink" style={{ textAlign: align[n] ?? "left" }}>
                    {renderInline(h, `th${k}-${n}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className={ri % 2 ? "bg-panel/60" : ""}>
                  {head.map((_, n) => (
                    <td key={n} className="border-t border-line px-3 py-2 align-top text-ink" style={{ textAlign: align[n] ?? "left" }}>
                      {renderInline(r[n] ?? "", `td${k}-${ri}-${n}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (isHeading(line)) {
      const level = Math.min(4, /^#+/.exec(line)![0].length);
      out.push(<div key={key++} className={HEAD_CLS[level]}>{renderInline(line.replace(/^#{1,4}\s+/, ""), `h${key}`)}</div>);
      i++;
    } else if (isHr(line)) {
      out.push(<hr key={key++} className="my-3 border-line" />);
      i++;
    } else if (isQuote(line)) {
      const q: string[] = [];
      while (i < lines.length && isQuote(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(<div key={key++} className="my-2 border-l-2 border-gold/70 pl-3 text-muted"><Markdown text={q.join("\n")} /></div>);
    } else if (isListLine(line)) {
      const items: ReactNode[] = [];
      const k = key++;
      while (i < lines.length && isListLine(lines[i])) {
        const b = BULLET.exec(lines[i]);
        const nm = b ? null : NUMBERED.exec(lines[i]);
        const indent = (b ? b[1] : nm![1]).replace(/\t/g, "  ").length;
        const level = Math.min(4, Math.floor(indent / 2));
        let body = b ? b[2] : nm![3];
        let marker = b ? (level % 2 ? "–" : "•") : `${nm![2]}.`;
        const task = /^\[( |x|X)\]\s+/.exec(body);
        if (task) { marker = task[1] === " " ? "☐" : "☑"; body = body.slice(task[0].length); }
        items.push(
          <div key={items.length} className="flex gap-2" style={{ paddingLeft: level * 16 }}>
            <span className="w-5 shrink-0 text-right text-faint">{marker}</span>
            <span className="min-w-0 flex-1">{renderInline(body, `l${k}-${items.length}`)}</span>
          </div>
        );
        i++;
      }
      out.push(<div key={k} className="my-1.5 space-y-1">{items}</div>);
    } else if (line.trim() === "") {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines, i)) { para.push(lines[i]); i++; }
      if (!para.length) { para.push(lines[i]); i++; }
      const k = key++;
      out.push(
        <div key={k} className="my-1.5">
          {para.map((p, n) => (
            <span key={n}>
              {n > 0 && <br />}
              {renderInline(p, `p${k}-${n}`)}
            </span>
          ))}
        </div>
      );
    }
  }
  return <div className="break-words">{out}</div>;
}