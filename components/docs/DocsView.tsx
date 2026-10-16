"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight, Brain, Check, ChevronRight, Clock, Code2, Copy, Film, GitBranch, KeyRound, Layers, Menu, MessageSquare,
  Minus, Monitor, Phone, Plug, Rocket, Search, ShieldCheck, Sparkles, Users, X,
} from "lucide-react";
import Logo from "@/components/Logo";
import {
  AGENTS, BEST_AT, ENV_VARS, FAQ, FEATURES, HELPS, LIMITS, MATRIX, PRODUCT, RATINGS, type Cell, type IconKey,
} from "@/lib/docs-content";

const ICONS: Record<IconKey, ReactNode> = {
  monitor: <Monitor size={17} />, code: <Code2 size={17} />, film: <Film size={17} />, users: <Users size={17} />,
  brain: <Brain size={17} />, plug: <Plug size={17} />, key: <KeyRound size={17} />, phone: <Phone size={17} />,
  rocket: <Rocket size={17} />, clock: <Clock size={17} />, shield: <ShieldCheck size={17} />, check: <Check size={17} />,
  message: <MessageSquare size={17} />, git: <GitBranch size={17} />, sparkles: <Sparkles size={17} />, layers: <Layers size={17} />,
};

type NavItem = { id: string; group: string; title: string; kw: string };
const NAV: NavItem[] = [
  { id: "overview", group: "Start", title: "Overview", kw: "intro what is agenticvenus" },
  { id: "quickstart", group: "Start", title: "Quick start", kw: "setup install begin first chat keys" },
  { id: "agent", group: "The agent", title: "Meet your agent", kw: "chief persona role identity" },
  { id: "routing", group: "The agent", title: "How it decides", kw: "intent understand route commands slash" },
  { id: "different", group: "The agent", title: "What makes it different", kw: "unique advantage why" },
  { id: "features", group: "Features", title: "All features", kw: "list capabilities" },
  { id: "computer", group: "Features", title: "Computer agent", kw: "browser desktop e2b recipes screen" },
  { id: "code", group: "Features", title: "Venus Code", kw: "coding github clone push deploy" },
  { id: "video", group: "Features", title: "Venus Pro (video)", kw: "remotion storyboard reel" },
  { id: "team", group: "Features", title: "Team & specialists", kw: "chief planner parallel roster" },
  { id: "memory", group: "Features", title: "Memory & skills", kw: "learn remember skill trial" },
  { id: "connectors", group: "Features", title: "Connectors & channels", kw: "mcp oauth telegram whatsapp slack gmail" },
  { id: "voice", group: "Features", title: "Voice & missions", kw: "phone call twilio mission routine schedule" },
  { id: "verification", group: "Trust", title: "Verification", kw: "leads verified contract evidence csv" },
  { id: "security", group: "Trust", title: "Security model", kw: "vault vpassword injection shield approval" },
  { id: "compare", group: "Compare", title: "Comparison & ratings", kw: "openclaw hermes grok openai rating score" },
  { id: "best", group: "Compare", title: "Where it is best", kw: "strengths" },
  { id: "help", group: "Compare", title: "How it helps you", kw: "use cases founders developers" },
  { id: "architecture", group: "Reference", title: "Architecture", kw: "firebase vercel supabase e2b runner tick" },
  { id: "env", group: "Reference", title: "Environment variables", kw: "config env vercel secrets" },
  { id: "limits", group: "Reference", title: "Honest limitations", kw: "weakness known issues beta" },
  { id: "faq", group: "Reference", title: "FAQ", kw: "questions answers" },
];

// ---------- small building blocks ----------
function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-line py-12 last:border-0">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">{eyebrow}</p>
      <h2 className="mb-5 text-2xl font-semibold tracking-tight text-ink md:text-[1.7rem]">{title}</h2>
      <div className="space-y-4 text-[15px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}
const H3 = ({ children }: { children: ReactNode }) => <h3 className="mt-6 text-base font-semibold text-ink">{children}</h3>;
const B = ({ children }: { children: ReactNode }) => <b className="font-medium text-ink">{children}</b>;
const Pill = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-panel2 px-1.5 py-0.5 text-[12.5px] text-gold">{children}</code>
);

function Callout({ tone = "info", title, children }: { tone?: "info" | "warn"; title: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border p-4 text-sm ${tone === "warn" ? "border-gold/40 bg-goldSoft/40" : "border-line bg-panel"}`}>
      <p className="mb-1 font-medium text-ink">{title}</p>
      <div className="leading-relaxed text-muted">{children}</div>
    </div>
  );
}

function Code({ children, label }: { children: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2 text-[11px] text-faint">
        <span>{label ?? "shell"}</span>
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

function Steps({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <ol className="space-y-3">
      {items.map(([t, body], i) => (
        <li key={t} className="flex gap-3.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-goldSoft text-xs font-semibold text-gold">{i + 1}</span>
          <div><p className="font-medium text-ink">{t}</p><div className="text-sm">{body}</div></div>
        </li>
      ))}
    </ol>
  );
}

function CardGrid({ items }: { items: Array<{ title: string; body: string; icon?: IconKey; tag?: string }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((f) => (
        <div key={f.title} className="rounded-xl border border-line bg-panel p-4 transition-colors hover:border-gold/50">
          <div className="mb-2 flex items-center gap-2.5">
            {f.icon && <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-panel2 text-gold">{ICONS[f.icon]}</span>}
            <p className="text-sm font-medium text-ink">{f.title}</p>
            {f.tag && <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-[10px] text-faint">{f.tag}</span>}
          </div>
          <p className="text-[13px] leading-relaxed text-muted">{f.body}</p>
        </div>
      ))}
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
              {totals.map((t, i) => (
                <td key={i} className={`px-3 py-3 text-center text-base font-semibold ${i === 0 ? "text-gold" : "text-ink"}`}>{t}</td>
              ))}
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

// ---------- page ----------
export default function DocsView() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState("overview");
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? NAV.filter((x) => `${x.title} ${x.kw} ${x.group}`.toLowerCase().includes(n)) : NAV;
  }, [q]);
  const groups = useMemo(() => Array.from(new Set(shown.map((x) => x.group))), [shown]);

  useEffect(() => {
    const els = NAV.map((n) => document.getElementById(n.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => { const v = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActive(v.target.id); },
      { rootMargin: "-90px 0px -65% 0px" }
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); search.current?.focus(); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  function go(id: string) { setOpen(false); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); history.replaceState(null, "", "#" + id); }

  const sidebar = (
    <nav className="space-y-6 pb-10">
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{g}</p>
          {shown.filter((x) => x.group === g).map((x) => (
            <button
              key={x.id} onClick={() => go(x.id)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${active === x.id ? "bg-panel2 font-medium text-ink" : "text-muted hover:bg-panel hover:text-ink"}`}
            >
              {x.title}{active === x.id && <ChevronRight size={13} className="text-gold" />}
            </button>
          ))}
        </div>
      ))}
      {shown.length === 0 && <p className="px-3 text-sm text-faint">Nothing matches “{q}”.</p>}
    </nav>
  );

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 md:px-6">
          <button className="rounded-lg p-1.5 text-muted hover:bg-panel md:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <Link href="/" className="flex items-center gap-2"><Logo size={18} /></Link>
          <span className="hidden rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted sm:inline">Docs</span>
          <div className="ml-auto flex w-full max-w-xs items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5">
            <Search size={14} className="text-faint" />
            <input
              ref={search} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) { go(shown[0].id); } }}
              placeholder="Search docs…" className="w-full bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
            />
            <kbd className="hidden rounded border border-line px-1.5 text-[10px] text-faint sm:block">⌘K</kbd>
          </div>
          <Link href="/dashboard" className="hidden rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-bg hover:opacity-90 sm:block">Open app</Link>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-line bg-panel p-4">
            <button className="mb-3 rounded-lg p-1.5 text-muted hover:bg-panel2" onClick={() => setOpen(false)}><X size={18} /></button>
            {sidebar}
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-7xl gap-10 px-4 md:px-6">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto py-8 md:block">{sidebar}</aside>

        <main className="min-w-0 max-w-3xl flex-1 pb-24">
          {/* hero */}
          <div className="relative overflow-hidden border-b border-line py-14">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold/[0.07] blur-3xl" />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted"><span className="h-1.5 w-1.5 rounded-full bg-gold" /> Documentation · Beta</span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight text-ink md:text-5xl">{PRODUCT.name}<br /><span className="text-gold">{PRODUCT.tagline}</span></h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">{PRODUCT.intro}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button onClick={() => go("quickstart")} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-bg hover:opacity-90">Quick start <ArrowRight size={15} /></button>
              <button onClick={() => go("compare")} className="rounded-full border border-line px-5 py-2.5 text-sm text-ink hover:bg-panel">See the comparison</button>
            </div>
          </div>

          <Section id="overview" eyebrow="Start" title="Overview">
            <p>AgenticVenus is a web app where each <B>chat is an AI teammate</B>. A teammate has a name, a role you give it, its own memory and skills, its own connected tools, and — when the job needs it — its own cloud computer.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[["11", "model providers"], ["63", "specialist roles"], ["4", "work modes: computer · code · video · team"]].map(([n, l]) => (
                <div key={l} className="rounded-xl border border-line bg-panel p-4"><p className="text-2xl font-semibold text-gold">{n}</p><p className="text-xs text-muted">{l}</p></div>
              ))}
            </div>
            <p>The stack is Next.js 14 on Vercel, Firebase (auth + Firestore), Supabase Storage for large files, and E2B desktop sandboxes for computers. Everything uses <B>your own accounts and keys</B>.</p>
          </Section>

          <Section id="quickstart" eyebrow="Start" title="Quick start">
            <Steps items={[
              ["Create an account", <>Sign up with email or Google. Connect <B>one AI provider</B> key — Claude, OpenAI, Gemini, whichever you have.</>],
              ["Start a chat", <>Press <Pill>+</Pill> and pick a teammate (Chief, Sales Outbound, Inbox Manager…) or create your own.</>],
              ["Give it a role", <>Say <Pill>you are my head of sales</Pill>. The role is pinned in memory for this chat only.</>],
              ["Add a computer (optional)", <>Paste an <B>E2B key</B> under API keys. Computer, Code, Video and Team modes unlock.</>],
              ["Hand over a task", <>Plain language works. Examples below.</>],
            ]} />
            <Code label="examples">{`Find 25 verified HVAC companies in Austin and give me a CSV
/code build a landing page for my dental clinic
/video 30s reel on how AI agents change work, 9:16
/team find leads, write outreach emails and a landing page
/clone owner/repo     ...then...     push all changes`}</Code>
          </Section>

          <Section id="agent" eyebrow="The agent" title="Meet your agent">
            <p>Every chat is an agent with five layers:</p>
            <CardGrid items={[
              { title: "Identity", body: "Name, colour, role (\"you are my CEO\"), and an optional own email inbox for sign-ups and verification codes.", icon: "sparkles" },
              { title: "Brain", body: "Per-chat memory (facts, preferences, lessons, owner profile) and skills (reusable procedures with a win/fail record).", icon: "brain" },
              { title: "Hands", body: "Tools from connectors, MCP servers and APIs, plus the computer, Venus Code and Venus Pro.", icon: "plug" },
              { title: "Guardrails", body: "Approvals for every write, prompt-injection shield, vault, vPassword and audit log.", icon: "shield" },
              { title: "Reach", body: "Dashboard chat, Telegram, WhatsApp, SMS, Slack DM and phone calls — same brain everywhere.", icon: "message" },
              { title: "Initiative", body: "At most one proactive 💡 message a day: a next step, a reminder or one question to know you better.", icon: "rocket" },
            ]} />
            <p>The default <B>Chief</B> is a chief of staff: it plans, picks specialists, tracks progress and reports back in one message.</p>
          </Section>

          <Section id="routing" eyebrow="The agent" title="How it decides what to do">
            <p>Before acting, the agent runs an <B>“understand first”</B> step with your chat’s own model. It chooses one intent and only starts heavy work when you really asked for it.</p>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead className="bg-panel text-[11px] uppercase tracking-wider text-faint"><tr><th className="px-4 py-2.5">Intent</th><th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">Runs on</th></tr></thead>
                <tbody>
                  {[
                    ["chat", "Questions, writing, advice, and anything a connected tool can do in a call (email, Sheets, GitHub files)", "Model + tools"],
                    ["pc", "Live websites, lists of leads, scraping, forms, downloads, terminal work", "Visible computer"],
                    ["code", "Software must be written or changed", "Venus Code (own computer)"],
                    ["video", "Motion-graphics video or reel", "Venus Pro (own computer)"],
                    ["team", "One goal that needs 2+ areas", "Chief + specialists"],
                    ["set_role / assemble / remember / forget", "Setup and memory commands — nothing is started", "Memory only"],
                  ].map(([a, b, c]) => <tr key={a} className="border-t border-line"><td className="px-4 py-2.5 text-gold">{a}</td><td className="px-4 py-2.5 text-ink">{b}</td><td className="px-4 py-2.5">{c}</td></tr>)}
                </tbody>
              </table>
            </div>
            <Callout title="Deterministic safety nets">A work order like “find 100 leads” can never be answered as plain chat (that is how fake lists appear) — it is forced to the computer. And “send these 5 emails” can never open the computer — it uses the Gmail tool.</Callout>
            <p>Slash commands skip the guessing: <Pill>/code</Pill> <Pill>/video</Pill> <Pill>/team</Pill> <Pill>/deploy</Pill> <Pill>/recipe</Pill> <Pill>/clone</Pill> <Pill>/push</Pill> <Pill>/remember</Pill> <Pill>/forget</Pill></p>
          </Section>

          <Section id="different" eyebrow="The agent" title="What makes it different">
            <ul className="space-y-3">
              {[
                ["Results are checked by code", "Lists are verified (site live, company on page, mail-capable domain) and the final CSV is generated by the runner, so the model cannot inflate it."],
                ["Secrets the model never sees", "vPassword types logins, 2FA codes and approved card details straight into the page. The model only sees names."],
                ["Each job has its own computer", "Chat, Venus Code and Venus Pro use separate sandboxes, so a video render never blocks a coding job. Idle computers are paused automatically."],
                ["Honest reporting", "Failed or skipped team steps are never reported as done. A verifier gives pass / partial / fail, and fails closed."],
                ["Self-improvement with brakes", "New skills start on trial, prove themselves in 2 wins, get paused after repeated failures, and keep the previous version for rollback."],
                ["Model-agnostic", "11 providers, fallback chain on rate limits, and a router that uses strong models to plan and fast ones to report."],
              ].map(([t, b]) => (
                <li key={t} className="flex gap-3"><Check size={17} className="mt-1 shrink-0 text-avatar-teal" /><span><B>{t}.</B> {b}</span></li>
              ))}
            </ul>
          </Section>

          <Section id="features" eyebrow="Features" title="Everything in the box">
            <CardGrid items={FEATURES} />
          </Section>

          <Section id="computer" eyebrow="Features" title="Computer agent">
            <p>A private Linux desktop per chat. The agent works on the <B>visible screen</B>: a real Chrome window (driven over CDP, so it still sees numbered elements), a real terminal, real mouse and keyboard.</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Toolbelt: Chrome, VS Code, LibreOffice, GIMP, Inkscape, ffmpeg, pandoc, tesseract, Python data stack.</li>
              <li>Browser ops: click, type, select, check, upload, tabs, downloads; cookie banners are dismissed automatically.</li>
              <li><B>Take control:</B> switch the panel from watch-only to your own mouse and keyboard at any time.</li>
              <li><B>Proof of work:</B> the screen is recorded and a 6-hour replay link is posted with the result.</li>
              <li><B>Recipes:</B> finished tasks are saved as label-based steps and replayed with <B>no AI model</B>. If a site changes, only the broken step is re-learned.</li>
              <li><B>Auto-off:</B> when the work ends, the computer is paused to save credits; files and logins are kept.</li>
            </ul>
          </Section>

          <Section id="code" eyebrow="Features" title="Venus Code">
            <p>A coding agent that runs <B>inside the computer</B> as a background worker, so it keeps going if you close the tab.</p>
            <CardGrid items={[
              { title: "Quality gates", body: "Plan first for big tasks, read-before-edit, diagnostics after every edit, project tests/build on finish." },
              { title: "Independent review", body: "A second pass reviews the git diff for bugs, missing requirements, placeholders and secrets before it can finish." },
              { title: "Parallel writers", body: "Up to 3 writer sub-agents in separate git worktrees on disjoint files, merged back; read-only explorers in parallel." },
              { title: "Safe by default", body: "Destructive commands blocked, .env/keys unreadable, permission modes: plan · strict · auto, project hooks in .venus/hooks.json." },
              { title: "Long projects", body: "Milestone-based fresh context with saved state, stuck detection and a compute budget." },
              { title: "Ship it", body: "Instant HTML preview, live dev server on port 3000, /deploy to Vercel, GitHub clone/push to a new branch with a PR link." },
            ]} />
          </Section>

          <Section id="video" eyebrow="Features" title="Venus Pro (video)">
            <p>A timeline editor with a live animatic, plus a Remotion render pipeline on its own studio computer.</p>
            <Steps items={[
              ["Storyboard", "The model chooses scene count dynamically from duration, story complexity, and pace; it also creates a topic-specific palette, typography, camera moves, transitions, and sound cues."],
              ["Design", "Every scene is custom code-rendered motion graphics. Scene code is syntax-checked, repaired when possible, and paired with optional generated sound effects synchronized to scene beats."],
              ["Assets, voice, music", "Stock photos/footage (Pexels), OpenAI voice-over per scene, generated ambient music bed."],
              ["Review & render", "A contact sheet of frames is reviewed by the model, fixes are applied, then 720p or 1080p is rendered and uploaded."],
            ]} />
            <p>Edit afterwards: razor-split, trim, reorder, change palette/fonts, or ask the in-editor agent (“make this punchier”).</p>
          </Section>

          <Section id="team" eyebrow="Features" title="Team & specialists">
            <p>Say “assemble a team” to pick a roster (nothing starts), or give a goal and Chief builds the <B>smallest</B> team, then plans up to 7 steps with dependencies. Independent steps run in parallel; steps that share one computer run one after another.</p>
            <div className="flex flex-wrap gap-2">
              {["Leadership", "Research", "Sales", "Marketing", "Content", "Engineering", "Design & Video", "Data", "Operations", "Finance & People"].map((c) => (
                <span key={c} className="rounded-full border border-line bg-panel px-3 py-1 text-xs text-ink">{c}</span>
              ))}
            </div>
            <p>Each member maps to a tool: computer, Venus Code, Venus Pro, web research, writing, or email drafts. You can open any member’s thread and talk to them directly, and watch the team feed live.</p>
          </Section>

          <Section id="memory" eyebrow="Features" title="Memory & skills">
            <p>Everything is <B>scoped to one chat</B>. The agent learns quietly: owner profile facts, preferences and lessons — never passwords, keys or card data.</p>
            <CardGrid items={[
              { title: "Skills you install", body: "Paste a SKILL.md link, a GitHub repo, an `npx skills add` command or text. Suspicious instruction-like skills are installed paused." },
              { title: "Skills it creates", body: "After a multi-step success it writes a trial skill, which is promoted after 2 wins." },
              { title: "Skills it repairs", body: "On failure it explains the cause, rewrites the skill as a new version and keeps the previous one for rollback." },
              { title: "Recall", body: "Searches earlier chat messages, missions and call summaries with BM25 ranking." },
            ]} />
          </Section>

          <Section id="connectors" eyebrow="Features" title="Connectors & channels">
            <p>Connect once per chat. The agent’s tool list is rebuilt on every message, and an “Agent updated” note explains what it can now do.</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><B>OAuth:</B> Google (Gmail, Sheets, Drive, Calendar), Microsoft 365, Slack, GitHub, Notion, Linear, HubSpot, Asana, Zoom, Figma, Webflow, Dropbox.</li>
              <li><B>MCP:</B> search a service name (popular list + official registry) or paste a remote MCP URL; servers that need login use automatic OAuth sign-in.</li>
              <li><B>REST API:</B> base URL + key; GET is free, writes ask for approval.</li>
              <li><B>Chat apps:</B> Telegram, WhatsApp and SMS (Twilio), Slack DM, email (Resend). Only your own ID or number is answered.</li>
              <li><B>Batch tools:</B> <Pill>gmail.send_many</Pill>, <Pill>github.put_files</Pill> etc. send many items in one approved call and report each success/failure.</li>
            </ul>
          </Section>

          <Section id="voice" eyebrow="Features" title="Voice, missions & routines">
            <H3>Phone calls</H3>
            <p>Paste a Twilio key once; number, webhooks and permissions are set up automatically. On a call the agent says it is an AI first, may use read-only tools, and adds <Pill>[[TODO]]</Pill> items for anything that changes data. Voices: free built-in, OpenAI, Gemini, ElevenLabs or Deepgram.</p>
            <H3>Missions</H3>
            <p>Long jobs run server-side in 40-second slices with notes as memory: find leads → verify → call one by one → update a sheet → report on every connected channel. Limits you set: number of calls, whether writes need approval, step cap.</p>
            <H3>Routines</H3>
            <p>Repeat a task every hour, day or week through a scheduler you control (GitHub Actions ping every 5 minutes). Failures are posted in chat.</p>
          </Section>

          <Section id="verification" eyebrow="Trust" title="Verification engine">
            <p>When a request looks like “N items”, it becomes a <B>contract</B> that the runner enforces.</p>
            <Steps items={[
              ["Collect candidates", "About 1.6× the quota from real pages, each with its source URL."],
              ["Verify with code", <><Pill>verify.leads</Pill> checks: website live and not parked, company/person found on the page, email syntax + MX/A record, duplicates.</>],
              ["Gate the finish", "The agent cannot finish below quota (up to 8 gate rounds). Rejected items cannot be edited to pass."],
              ["Deliver from code", "A CSV of verified rows and a CSV of rejects are built by the runner. The summary starts with VERIFIED: X of N requested."],
            ]} />
            <Callout tone="warn" title="What it cannot prove">A mailbox cannot be proven to exist without sending mail. The report says so explicitly.</Callout>
          </Section>

          <Section id="security" eyebrow="Trust" title="Security model">
            <CardGrid items={[
              { title: "Vault", body: "AES-256-GCM, ciphertext bound to user + slot. The browser only holds vault:… placeholders. Key rotation via VAULT_KEY_OLD." },
              { title: "vPassword", body: "Host-matched logins, TOTP 2FA, saved sessions and cards with limits. Secrets can never be read back through the app." },
              { title: "Job tokens", body: "Sandboxes get a short-lived signed token, never your connector tokens. Tokens are kept in memory only." },
              { title: "Injection shield", body: "Outside content is wrapped as <untrusted>, scanned for hijack patterns, and taints the run so writes need a human." },
              { title: "Network safety", body: "SSRF-safe fetch re-checks every redirect hop; private IPs and local hostnames are blocked, including in the headless browser." },
              { title: "Audit trail", body: "Tool writes, vault changes, voice calls and missions are logged server-side." },
            ]} />
          </Section>

          <Section id="compare" eyebrow="Compare" title="Comparison & ratings">
            <p>How AgenticVenus compares with <B>OpenClaw</B>, <B>Hermes Agent</B>, <B>Grok-based bots</B> and <B>OpenAI agents</B>. Scores are 0–10, indicative and subjective.</p>
            <Callout tone="warn" title="Read this first">
              AgenticVenus scores come from this repository. Competitor scores come from general public knowledge and move fast — check each project’s own docs before deciding. The comparison is by category, so a lower score is not a flaw in a product built for a different job.
            </Callout>
            <Ratings />
            <H3>Reading the numbers</H3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><B>OpenClaw</B> and <B>Hermes</B> are strongest in self-hosting, community and chat reach, and Hermes in self-learning. They win on maturity.</li>
              <li><B>Grok bots</B> and <B>OpenAI agents</B> win on easy setup and polish, but you cannot bring your own models or self-host.</li>
              <li><B>AgenticVenus</B> leads on verified output, a visible computer per job, team orchestration and the number of built-in studios — and loses on maturity and setup effort.</li>
            </ul>
          </Section>

          <Section id="best" eyebrow="Compare" title="Where AgenticVenus is best">
            <CardGrid items={BEST_AT} />
          </Section>

          <Section id="help" eyebrow="Compare" title="How it helps you">
            <CardGrid items={HELPS.map((h) => ({ title: h.who, body: h.body }))} />
            <p>A typical day: you describe the goal in chat (or Telegram) → the agent plans → it works on its own computer → you get one report with evidence, a replay link and any “needs you” items.</p>
          </Section>

          <Section id="architecture" eyebrow="Reference" title="Architecture">
            <Code label="diagram">{`Browser (Next.js app)
  ├─ Firebase Auth + Firestore (chats, memory, projects, jobs)
  ├─ /api/*  (Vercel, Node runtime, 60 s limit)
  │     vault · tools · chat · runner · voice · channels · missions
  ├─ Supabase Storage (videos, proofs, backups)
  └─ E2B sandboxes (one per chat per slot: pc / code / studio)
        └─ detached runner (pc-runner / runner) ── job token ──> /api/*

GitHub Actions every 5 min → /api/routines/run
                           → /api/runner/tick   (finish unattended jobs, pause idle computers)
                           → /api/missions/tick (keep missions moving)
                           → /api/proactive/tick`}</Code>
            <p>Why this shape: serverless functions are short, so anything long runs inside the sandbox or in 40-second mission slices, and the scheduler is the safety net.</p>
          </Section>

          <Section id="env" eyebrow="Reference" title="Environment variables">
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead className="bg-panel text-[11px] uppercase tracking-wider text-faint"><tr><th className="px-4 py-2.5">Name</th><th className="px-4 py-2.5">Need</th><th className="px-4 py-2.5">Purpose</th></tr></thead>
                <tbody>
                  {ENV_VARS.map((e) => (
                    <tr key={e.name} className="border-t border-line">
                      <td className="px-4 py-2.5 font-mono text-[12px] text-ink">{e.name}</td>
                      <td className={`px-4 py-2.5 ${e.need === "required" ? "text-gold" : "text-faint"}`}>{e.need}</td>
                      <td className="px-4 py-2.5">{e.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>GitHub Actions needs two repository secrets: <Pill>APP_URL</Pill> and <Pill>ROUTINE_RUNNER_SECRET</Pill>. Firestore will print a link to create any missing collection-group index the first time a tick runs.</p>
          </Section>

          <Section id="limits" eyebrow="Reference" title="Honest limitations">
            <ul className="space-y-2.5">
              {LIMITS.map((l) => <li key={l} className="flex gap-3"><Minus size={16} className="mt-1 shrink-0 text-gold" /><span>{l}</span></li>)}
            </ul>
          </Section>

          <Section id="faq" eyebrow="Reference" title="FAQ">
            <div className="space-y-2">
              {FAQ.map((f) => (
                <details key={f.q} className="group rounded-xl border border-line bg-panel px-4 py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-ink">
                    {f.q}<ChevronRight size={15} className="text-faint transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </Section>

          <div className="mt-6 rounded-2xl border border-line bg-panel p-6 text-center">
            <p className="text-lg font-semibold text-ink">Ready to hand something off?</p>
            <p className="mt-1 text-sm text-muted">Start with one teammate and one real task.</p>
            <Link href="/dashboard" className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-bg hover:opacity-90">Open the app <ArrowRight size={15} /></Link>
          </div>
        </main>
      </div>
    </div>
  );
}