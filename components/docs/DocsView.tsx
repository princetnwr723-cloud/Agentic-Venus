"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, ArrowUp, BookOpen, Brain, Check, ChevronDown, ChevronRight, Clock, Code2, Copy, Film, GitBranch,
  KeyRound, Layers, Link2, MapPin, Menu, MessageSquare, Minus, Monitor, Phone, Plug, Rocket, Search, ShieldCheck, Sparkles,
  Tag as TagIcon, Users, X,
} from "lucide-react";
import Logo from "@/components/Logo";
import { PLANS } from "@/lib/plans";
import {
  AGENTS, GROUPS, MATRIX, PRODUCT, RATINGS, TOTAL_SECTIONS, type Cell, type IconKey, type Sec, type Tag,
} from "@/lib/docs-content";

const ICONS: Record<IconKey, ReactNode> = {
  monitor: <Monitor size={16} />, code: <Code2 size={16} />, film: <Film size={16} />, users: <Users size={16} />,
  brain: <Brain size={16} />, plug: <Plug size={16} />, key: <KeyRound size={16} />, phone: <Phone size={16} />,
  rocket: <Rocket size={16} />, clock: <Clock size={16} />, shield: <ShieldCheck size={16} />, check: <Check size={16} />,
  message: <MessageSquare size={16} />, git: <GitBranch size={16} />, sparkles: <Sparkles size={16} />, layers: <Layers size={16} />,
  map: <MapPin size={16} />, book: <BookOpen size={16} />, tag: <TagIcon size={16} />,
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

type Flat = { id: string; n: number; group: string; groupId: string; sec: Sec; hay: string };

// ---------- flatten every section once, give it a stable number and a unique id ----------
const FLAT: Flat[] = (() => {
  const seen = new Set<string>();
  let n = 0;
  const out: Flat[] = [];
  for (const g of GROUPS) {
    for (const sec of g.items) {
      n += 1;
      let id = slug(sec.t) || `section-${n}`;
      if (seen.has(id)) id = `${id}-${n}`;
      seen.add(id);
      const hay = [sec.t, sec.kw, sec.p, sec.note, sec.warn, sec.code, ...(sec.pts ?? []), ...(sec.steps ?? []), ...(sec.table ?? []).flat(), g.title]
        .filter(Boolean).join(" ").toLowerCase();
      out.push({ id, n, group: g.title, groupId: g.id, sec, hay });
    }
  }
  return out;
})();

// ---------- inline markup: **bold** and `code` ----------
function rich(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <b key={i} className="font-medium text-ink">{p.slice(2, -2)}</b>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="rounded bg-panel2 px-1.5 py-0.5 text-[12.5px] text-gold">{p.slice(1, -1)}</code>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

const TAG_STYLE: Record<Tag, string> = {
  Now: "border-avatar-teal/40 text-avatar-teal",
  Beta: "border-gold/50 text-gold",
  Soon: "border-line text-muted",
  Planned: "border-line text-faint",
};

// ---------- building blocks ----------
function Callout({ tone, children }: { tone: "info" | "warn"; children: ReactNode }) {
  return (
    <div className={`rounded-xl border p-3.5 text-[13.5px] leading-relaxed ${tone === "warn" ? "border-gold/40 bg-goldSoft/40 text-ink" : "border-line bg-panel text-muted"}`}>
      <span className="mr-1.5 font-semibold text-ink">{tone === "warn" ? "Important." : "Note."}</span>{children}
    </div>
  );
}

function CodeBlock({ children, label }: { children: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-1.5 text-[11px] text-faint">
        <span>{label ?? "example"}</span>
        <button
          onClick={() => { navigator.clipboard?.writeText(children); setDone(true); setTimeout(() => setDone(false), 1200); }}
          className="flex items-center gap-1 hover:text-ink"
        >
          {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 text-[12.5px] leading-relaxed text-ink"><code>{children}</code></pre>
    </div>
  );
}

function Table({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[420px] text-left text-[13px]">
        <thead className="bg-panel text-[11px] uppercase tracking-wider text-faint">
          <tr>{head.map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => <td key={j} className={`px-4 py-2.5 ${j === 0 ? "font-medium text-ink" : ""}`}>{rich(c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CELL: Record<Cell, ReactNode> = {
  yes: <Check size={15} className="mx-auto text-avatar-teal" />,
  part: <Minus size={15} className="mx-auto text-gold" />,
  no: <X size={14} className="mx-auto text-faint" />,
};

function Ratings() {
  const totals = AGENTS.map((_, i) => RATINGS.reduce((n, r) => n + r.scores[i], 0));
  const max = RATINGS.length * 10;
  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="bg-panel text-[11px] uppercase tracking-wider text-faint">
            <tr>
              <th className="px-4 py-3 font-medium">Dimension</th>
              {AGENTS.map((a, i) => <th key={a} className={`px-3 py-3 text-center font-medium ${i === 0 ? "text-gold" : ""}`}>{a}</th>)}
            </tr>
          </thead>
          <tbody>
            {RATINGS.map((r) => (
              <tr key={r.dim} className="border-t border-line">
                <td className="px-4 py-3"><p className="text-ink">{r.dim}</p><p className="text-[11px] text-faint">{r.why}</p></td>
                {r.scores.map((s, i) => (
                  <td key={i} className="px-3 py-3 text-center">
                    <span className={`text-sm font-semibold ${i === 0 ? "text-gold" : "text-ink"}`}>{s}</span>
                    <div className="mx-auto mt-1.5 h-1 w-14 overflow-hidden rounded-full bg-panel2">
                      <div className={`h-full rounded-full ${i === 0 ? "bg-gold" : "bg-muted"}`} style={{ width: `${s * 10}%` }} />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-line bg-panel">
              <td className="px-4 py-3 font-medium text-ink">Total (out of {max})</td>
              {totals.map((t, i) => <td key={i} className={`px-3 py-3 text-center text-base font-semibold ${i === 0 ? "text-gold" : "text-ink"}`}>{t}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="bg-panel text-[11px] uppercase tracking-wider text-faint">
            <tr>
              <th className="px-4 py-3 font-medium">Capability</th>
              {AGENTS.map((a, i) => <th key={a} className={`px-3 py-3 text-center font-medium ${i === 0 ? "text-gold" : ""}`}>{a}</th>)}
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((m) => (
              <tr key={m.row} className="border-t border-line">
                <td className="px-4 py-2.5 text-ink">{m.row}</td>
                {m.v.map((c, i) => <td key={i} className={`px-3 py-2.5 ${i === 0 ? "bg-goldSoft/20" : ""}`}>{CELL[c]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap gap-4 text-[11px] text-faint">
        <span className="flex items-center gap-1"><Check size={12} className="text-avatar-teal" /> built in</span>
        <span className="flex items-center gap-1"><Minus size={12} className="text-gold" /> partial / needs setup</span>
        <span className="flex items-center gap-1"><X size={12} /> not offered</span>
      </p>
    </div>
  );
}

function Plans() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {PLANS.map((p) => (
        <div key={p.id} className={`rounded-xl border bg-panel p-4 ${p.badge ? "border-gold/50" : "border-line"}`}>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold text-ink">{p.name}</p>
            <p className="text-sm text-gold">{p.price === 0 ? "Free" : `$${p.price}/mo`}</p>
          </div>
          <p className="mb-2 text-[12px] text-faint">{p.tagline}{p.badge ? ` · ${p.badge}` : ""}</p>
          <ul className="space-y-1 text-[12.5px] text-muted">
            {p.perks.map((x) => <li key={x} className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-avatar-teal" />{x}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SectionView({ f, onCopy, copied }: { f: Flat; onCopy: (id: string) => void; copied: string }) {
  const s = f.sec;
  return (
    <article id={f.id} className="group scroll-mt-24 border-b border-line py-8 last:border-0">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <span className="rounded-md bg-panel2 px-2 py-0.5 font-mono text-[11px] text-faint">§{String(f.n).padStart(3, "0")}</span>
        <h3 className="text-xl font-semibold tracking-tight text-ink">{s.t}</h3>
        {s.tag && <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${TAG_STYLE[s.tag]}`}>{s.tag}</span>}
        <button
          onClick={() => onCopy(f.id)} aria-label="Copy link to this section"
          className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-faint opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover:opacity-100"
        >
          {copied === f.id ? <Check size={12} /> : <Link2 size={12} />} {copied === f.id ? "Link copied" : "Link"}
        </button>
      </div>
      <div className="space-y-3.5 text-[15px] leading-relaxed text-muted">
        {s.p && <p>{rich(s.p)}</p>}
        {s.pts && (
          <ul className="space-y-1.5">
            {s.pts.map((x) => <li key={x} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" /><span>{rich(x)}</span></li>)}
          </ul>
        )}
        {s.steps && (
          <ol className="space-y-2.5">
            {s.steps.map((x, i) => (
              <li key={x} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-goldSoft text-xs font-semibold text-gold">{i + 1}</span>
                <span className="text-[14.5px]">{rich(x)}</span>
              </li>
            ))}
          </ol>
        )}
        {s.table && <Table rows={s.table} />}
        {s.code && <CodeBlock label={s.codeLabel}>{s.code}</CodeBlock>}
        {s.widget === "ratings" && <Ratings />}
        {s.widget === "plans" && <Plans />}
        {s.note && <Callout tone="info">{rich(s.note)}</Callout>}
        {s.warn && <Callout tone="warn">{rich(s.warn)}</Callout>}
      </div>
    </article>
  );
}

// ---------- page ----------
export default function DocsView() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(FLAT[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [top, setTop] = useState(false);
  const [copied, setCopied] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const search = useRef<HTMLInputElement>(null);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (needle ? FLAT.filter((x) => x.hay.includes(needle)) : FLAT), [needle]);
  const shownGroups = useMemo(() => GROUPS.filter((g) => shown.some((x) => x.groupId === g.id)), [shown]);

  const activeIdx = FLAT.findIndex((x) => x.id === active);
  const prev = activeIdx > 0 ? FLAT[activeIdx - 1] : null;
  const next = activeIdx >= 0 && activeIdx < FLAT.length - 1 ? FLAT[activeIdx + 1] : null;

  useEffect(() => {
    const els = FLAT.map((x) => document.getElementById(x.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const v = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (v) setActive(v.target.id);
      },
      { rootMargin: "-90px 0px -70% 0px" }
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setProgress(max > 0 ? Math.min(100, (h.scrollTop / max) * 100) : 0);
      setTop(h.scrollTop > 900);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView(), 80);
  }, []);

  function go(id: string) {
    setOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    history.replaceState(null, "", "#" + id);
  }
  function copyLink(id: string) {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    navigator.clipboard?.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(""), 1400);
    history.replaceState(null, "", "#" + id);
  }

  const sidebar = (
    <nav className="space-y-2 pb-10">
      {shownGroups.map((g) => {
        const items = shown.filter((x) => x.groupId === g.id);
        const isOpen = needle ? true : !collapsed[g.id];
        const hasActive = items.some((x) => x.id === active);
        return (
          <div key={g.id}>
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] font-medium transition-colors hover:bg-panel ${hasActive ? "text-ink" : "text-muted"}`}
            >
              <span className={hasActive ? "text-gold" : "text-faint"}>{ICONS[g.icon]}</span>
              <span className="flex-1">{g.title}</span>
              <span className="text-[10px] text-faint">{items.length}</span>
              <ChevronDown size={13} className={`text-faint transition-transform ${isOpen ? "" : "-rotate-90"}`} />
            </button>
            {isOpen && (
              <div className="ml-4 border-l border-line pl-2">
                {items.map((x) => (
                  <button
                    key={x.id} onClick={() => go(x.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-[12.5px] leading-snug transition-colors ${active === x.id ? "bg-panel2 font-medium text-ink" : "text-muted hover:text-ink"}`}
                  >
                    <span className="w-6 shrink-0 font-mono text-[10px] text-faint">{x.n}</span>
                    <span className="flex-1">{x.sec.t}</span>
                    {active === x.id && <ChevronRight size={12} className="text-gold" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {shown.length === 0 && <p className="px-3 text-sm text-faint">Nothing matches “{q}”.</p>}
    </nav>
  );

  return (
    <div className="min-h-screen bg-bg">
      <div className="fixed left-0 top-0 z-50 h-0.5 bg-gold transition-[width] duration-150" style={{ width: `${progress}%` }} />

      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[88rem] items-center gap-3 px-4 md:px-6">
          <button className="rounded-lg p-1.5 text-muted hover:bg-panel lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <Link href="/" className="flex items-center gap-2"><Logo size={18} /></Link>
          <span className="hidden rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted sm:inline">Docs · {TOTAL_SECTIONS} sections</span>
          <div className="ml-auto flex w-full max-w-xs items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5">
            <Search size={14} className="text-faint" />
            <input
              ref={search} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) go(shown[0].id); if (e.key === "Escape") setQ(""); }}
              placeholder="Search all sections…" className="w-full bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
            />
            {q ? <button onClick={() => setQ("")} aria-label="Clear"><X size={13} className="text-faint" /></button>
              : <kbd className="hidden rounded border border-line px-1.5 text-[10px] text-faint sm:block">⌘K</kbd>}
          </div>
          <Link href="/dashboard" className="hidden rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-bg hover:opacity-90 sm:block">Open app</Link>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-80 max-w-[88vw] overflow-y-auto border-r border-line bg-panel p-4">
            <button className="mb-3 rounded-lg p-1.5 text-muted hover:bg-panel2" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
            {sidebar}
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-[88rem] gap-10 px-4 md:px-6">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-72 shrink-0 overflow-y-auto py-8 lg:block">{sidebar}</aside>

        <main className="min-w-0 max-w-3xl flex-1 pb-24">
          {/* hero */}
          <div className="relative overflow-hidden border-b border-line py-14">
            <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-gold/[0.08] blur-3xl" />
            <div className="pointer-events-none absolute -bottom-32 left-10 h-64 w-64 rounded-full bg-avatar-teal/[0.06] blur-3xl" />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted"><span className="h-1.5 w-1.5 rounded-full bg-gold" /> Documentation · Beta</span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight text-ink md:text-5xl">{PRODUCT.name}<br /><span className="text-gold">{PRODUCT.tagline}</span></h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">{PRODUCT.intro}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button onClick={() => go("create-your-account")} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-bg hover:opacity-90">Quick start <ArrowRight size={15} /></button>
              <button onClick={() => go("the-mission-do-the-work")} className="rounded-full border border-line px-5 py-2.5 text-sm text-ink hover:bg-panel">What Agent Works means</button>
            </div>
            <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[[String(TOTAL_SECTIONS), "sections"], [String(GROUPS.length), "chapters"], ["63", "specialists"], ["11", "model providers"]].map(([n, l]) => (
                <div key={l} className="rounded-xl border border-line bg-panel p-3.5"><p className="text-2xl font-semibold text-gold">{n}</p><p className="text-xs text-muted">{l}</p></div>
              ))}
            </div>
          </div>

          {/* chapter cards */}
          {!needle && (
            <div className="grid gap-3 border-b border-line py-10 sm:grid-cols-2">
              {GROUPS.map((g) => {
                const first = FLAT.find((x) => x.groupId === g.id);
                return (
                  <button
                    key={g.id} onClick={() => first && go(first.id)}
                    className="rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-gold/50"
                  >
                    <div className="mb-1.5 flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-panel2 text-gold">{ICONS[g.icon]}</span>
                      <p className="text-sm font-medium text-ink">{g.title}</p>
                      <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-[10px] text-faint">{g.items.length}</span>
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-muted">{g.blurb}</p>
                  </button>
                );
              })}
            </div>
          )}

          {needle && (
            <p className="border-b border-line py-4 text-sm text-muted">
              {shown.length} {shown.length === 1 ? "section matches" : "sections match"} “{q}”. Press Enter to open the first.
            </p>
          )}

          {/* chapters */}
          {GROUPS.map((g) => {
            const items = FLAT.filter((x) => x.groupId === g.id && (!needle || x.hay.includes(needle)));
            if (!items.length) return null;
            return (
              <section key={g.id} id={`chapter-${g.id}`} className="scroll-mt-24">
                <div className="mt-12 flex items-center gap-3 border-b border-gold/30 pb-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-goldSoft text-gold">{ICONS[g.icon]}</span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">Chapter</p>
                    <h2 className="text-2xl font-semibold tracking-tight text-ink">{g.title}</h2>
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted">{g.blurb}</p>
                {items.map((f) => <SectionView key={f.id} f={f} onCopy={copyLink} copied={copied} />)}
              </section>
            );
          })}

          {/* prev / next */}
          {!needle && (prev || next) && (
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {prev ? (
                <button onClick={() => go(prev.id)} className="rounded-xl border border-line bg-panel p-4 text-left hover:border-gold/50">
                  <p className="mb-1 flex items-center gap-1 text-[11px] text-faint"><ArrowLeft size={12} /> Previous · §{prev.n}</p>
                  <p className="text-sm font-medium text-ink">{prev.sec.t}</p>
                </button>
              ) : <span />}
              {next && (
                <button onClick={() => go(next.id)} className="rounded-xl border border-line bg-panel p-4 text-right hover:border-gold/50">
                  <p className="mb-1 flex items-center justify-end gap-1 text-[11px] text-faint">Next · §{next.n} <ArrowRight size={12} /></p>
                  <p className="text-sm font-medium text-ink">{next.sec.t}</p>
                </button>
              )}
            </div>
          )}

          <div className="mt-10 rounded-2xl border border-line bg-panel p-6 text-center">
            <p className="text-lg font-semibold text-ink">Ready to hand something off?</p>
            <p className="mt-1 text-sm text-muted">Start with one teammate and one real task. Let it do the work.</p>
            <Link href="/dashboard" className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-bg hover:opacity-90">Open the app <ArrowRight size={15} /></Link>
          </div>
        </main>
      </div>

      {top && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top"
          className="fixed bottom-5 right-5 z-40 rounded-full border border-line bg-panel p-3 text-ink shadow-lg hover:border-gold/50"
        >
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  );
}
