"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, Check, Flag, Github, Plus, Search, ShieldCheck, Sparkles, Trash2, X, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { createChat, deleteChat, listChats, type Chat } from "@/lib/chats";
import { createRoutine } from "@/lib/routines";
import { getModelPref } from "@/lib/model-pref";
import { PROVIDERS } from "@/lib/providers";
import type { AvatarColor } from "@/lib/bots";
import { BUILTIN } from "@/lib/marketplace-data";
import {
  CONNECTORS, KIND_LABEL, TOOLS, TOOL_TEXT, categoriesOf, connectorLabel, filterListings, permsOf, scheduleText,
  type Listing, type ListingKind, type RoutineSpec, type ToolKind,
} from "@/lib/marketplace-core";

const inputCls = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";
const btnGold = "rounded-lg bg-gold px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50";
const btnGhost = "rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-panel2 disabled:opacity-50";
const ICON = { skill: Sparkles, agent: Bot, automation: Zap } as const;
const TABS: Array<[ListingKind | "all", string]> = [["all", "All"], ["skill", "Skills"], ["agent", "Agents"], ["automation", "Automations"]];
const SOURCES: Array<["all" | "official" | "community", string]> = [["all", "Everyone"], ["official", "Official"], ["community", "Community"]];

async function api<T = any>(uid: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/marketplace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid, ...body }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || `Request failed (HTTP ${res.status}).`);
  return d as T;
}

export default function MarketplaceHub() {
  const router = useRouter();
  const { user } = useAuth();
  const { apiKeys } = useKeys();

  const [community, setCommunity] = useState<Listing[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [target, setTarget] = useState("");
  const [tab, setTab] = useState<ListingKind | "all">("all");
  const [src, setSrc] = useState<"all" | "official" | "community">("all");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Listing | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [share, setShare] = useState(false);
  const [imp, setImp] = useState(false);

  const say = (text: string, ok = true) => { setToast({ ok, text }); window.setTimeout(() => setToast(null), 5000); };

  async function refreshCommunity() {
    try {
      const d = await (await fetch("/api/marketplace")).json();
      setCommunity(Array.isArray(d.items) ? d.items : []);
    } catch { setCommunity([]); }
  }
  useEffect(() => { void refreshCommunity(); }, []);

  useEffect(() => {
    if (!user) { setChats([]); return; }
    let live = true;
    listChats(user.uid).then((l) => { if (live) setChats(l); }).catch(() => { if (live) setChats([]); });
    return () => { live = false; };
  }, [user]);

  const all = useMemo(() => [...BUILTIN, ...community], [community]);
  const cats = useMemo(() => categoriesOf(filterListings(all, { kind: tab, source: src })), [all, tab, src]);
  const catNow = cats.includes(cat) ? cat : "all";
  const shown = useMemo(() => filterListings(all, { q, kind: tab, category: catNow, source: src }), [all, q, tab, catNow, src]);
  const targetChat = chats.find((c) => c.id === target);

  function pickModel() {
    const pref = getModelPref();
    if (pref && apiKeys[pref.provider]) return pref;
    const p = PROVIDERS.find((x) => apiKeys[x.id]) ?? PROVIDERS[0];
    return { provider: p.id, model: p.models[0] };
  }

  async function ensureChat(): Promise<string> {
    if (target && chats.some((c) => c.id === target)) return target;
    if (!user) throw new Error("Please sign in first.");
    const p = pickModel();
    const c = await createChat(user.uid, { agentName: "Agent", agentColor: "teal", provider: p.provider, model: p.model });
    setChats((prev) => [c, ...prev]);
    setTarget(c.id);
    return c.id;
  }

  function openListing(l: Listing) { setVals({}); setOpen(l); }

  async function install(l: Listing) {
    if (!user) { router.push("/"); return; }
    setBusy(true);
    let made: Chat | null = null;
    try {
      if (l.kind === "agent") {
        const p = pickModel();
        made = await createChat(user.uid, { agentName: l.name, agentColor: (l.color as AvatarColor) || "teal", provider: p.provider, model: p.model });
        await api(user.uid, { action: "install", id: l.id, chatId: made.id });
        say(`${l.name} is ready. Opening your agents…`);
        setOpen(null);
        window.setTimeout(() => router.push("/dashboard"), 900);
        return;
      }
      const chatId = await ensureChat();
      const d = await api<{ routine?: RoutineSpec & { name: string }; names?: string[] }>(user.uid, { action: "install", id: l.id, chatId, fields: vals });
      if (l.kind === "automation" && d.routine) {
        const r = d.routine;
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const schedule = r.schedule.kind === "cron"
          ? { kind: "cron" as const, expr: r.schedule.expr, tz }
          : { kind: "every" as const, minutes: r.schedule.minutes, anchor: Date.now() };
        await createRoutine(user.uid, {
          chatId, name: r.name, instructions: r.instructions, everyMinutes: r.schedule.kind === "every" ? r.schedule.minutes : 1440,
          startAt: Date.now(), schedule, tz, mode: r.mode, toChat: r.toChat, allowWrites: r.allowWrites, notify: r.notify,
        });
        say(`"${l.name}" is set up and runs ${scheduleText(r.schedule)} in that chat.`);
      } else say(`Installed "${l.name}". That chat can use it from now on.`);
      setOpen(null);
    } catch (e) {
      if (made) void deleteChat(user.uid, made.id).catch(() => undefined);
      say(e instanceof Error ? e.message : "Install failed.", false);
    } finally { setBusy(false); }
  }

  async function report(l: Listing) {
    if (!user) { router.push("/"); return; }
    try { await api(user.uid, { action: "report", id: l.id }); say("Thanks. Your report was sent."); }
    catch (e) { say(e instanceof Error ? e.message : "Could not send the report.", false); }
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <button onClick={() => router.push("/dashboard")} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-ink"><ArrowLeft size={14} /> Dashboard</button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Marketplace</h1>
            <p className="mt-1 max-w-xl text-sm text-muted">Skills, agents and automations you can add in one tap. Everything is free. {BUILTIN.length} official and {community.length} community listings.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setImp(true)} className={`${btnGhost} flex items-center gap-1.5`}><Github size={14} /> Import skills</button>
            <button onClick={() => (user ? setShare(true) : router.push("/"))} className={`${btnGold} flex items-center gap-1.5`}><Plus size={14} /> Share yours</button>
          </div>
        </div>

        <div className="relative mt-5">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills, agents and automations…" className={`${inputCls} pl-9`} />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded-full border border-line bg-panel2 p-1 text-xs">
            {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`rounded-full px-3.5 py-1.5 ${tab === k ? "bg-white font-medium text-bg" : "text-muted"}`}>{l}</button>)}
          </div>
          <div className="flex rounded-full border border-line bg-panel2 p-1 text-xs">
            {SOURCES.map(([k, l]) => <button key={k} onClick={() => setSrc(k)} className={`rounded-full px-3 py-1.5 ${src === k ? "bg-white font-medium text-bg" : "text-muted"}`}>{l}</button>)}
          </div>
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {["all", ...cats].map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`shrink-0 rounded-full border px-3 py-1 text-xs ${catNow === c ? "border-gold text-gold" : "border-line text-muted hover:text-ink"}`}>{c === "all" ? "All categories" : c}</button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="mt-16 text-center text-sm text-muted">Nothing matches. Try another word, or share your own.</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((l) => <Card key={l.id} l={l} onOpen={() => openListing(l)} />)}
          </div>
        )}
      </div>

      {open && (
        <Detail
          l={open} chats={chats} target={target} setTarget={setTarget} targetChat={targetChat} vals={vals} setVals={setVals}
          busy={busy} onClose={() => setOpen(null)} onInstall={() => install(open)} onReport={() => report(open)}
        />
      )}
      {share && user && <ShareModal uid={user.uid} defaultAuthor={user.displayName ?? ""} onClose={() => setShare(false)} onChanged={refreshCommunity} say={say} />}
      {imp && <ImportModal uid={user?.uid ?? null} chats={chats} target={target} setTarget={setTarget} ensureChat={ensureChat} onClose={() => setImp(false)} onSignIn={() => router.push("/")} />}

      {toast && (
        <div className={`fixed bottom-5 left-1/2 z-[60] max-w-[92vw] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${toast.ok ? "border-avatar-teal/50 bg-panel text-ink" : "border-red-900/60 bg-red-950/80 text-red-200"}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function Card({ l, onOpen }: { l: Listing; onOpen: () => void }) {
  const Icon = ICON[l.kind];
  return (
    <button onClick={onOpen} className="flex flex-col rounded-xl2 border border-line bg-panel p-4 text-left transition-colors hover:border-gold/60">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint"><Icon size={13} /> {KIND_LABEL[l.kind]}</span>
        {l.official
          ? <span className="flex items-center gap-1 text-[11px] text-avatar-teal"><ShieldCheck size={12} /> Official</span>
          : <span className="truncate text-[11px] text-muted">Community · {l.installs ?? 0} installs</span>}
      </div>
      <h3 className="mt-2 text-sm font-medium text-ink">{l.name}</h3>
      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">{l.tagline}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{l.category}</span>
        {l.kind === "automation" && l.needs?.slice(0, 2).map((n) => <span key={n} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{connectorLabel(n)}</span>)}
      </div>
    </button>
  );
}

function Detail(p: {
  l: Listing; chats: Chat[]; target: string; setTarget: (v: string) => void; targetChat?: Chat;
  vals: Record<string, string>; setVals: (v: Record<string, string>) => void; busy: boolean;
  onClose: () => void; onInstall: () => void; onReport: () => void;
}) {
  const { l } = p;
  const Icon = ICON[l.kind];
  const needsChat = l.kind !== "agent";
  const missing = (l.fields ?? []).some((f) => !(p.vals[f.key] ?? "").trim());
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:px-4" onClick={p.onClose}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-xl2 border border-line bg-panel p-5 sm:rounded-xl2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint"><Icon size={13} /> {KIND_LABEL[l.kind]} · {l.category}</span>
            <h2 className="mt-1 text-lg font-semibold text-ink">{l.name}</h2>
            <p className="mt-0.5 text-xs text-muted">{l.official ? "By AgenticVenus · Official" : `By ${l.author} · Community · ${l.installs ?? 0} installs`}</p>
          </div>
          <button onClick={p.onClose} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={18} /></button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink">{l.tagline}</p>

        <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-faint">What it can do</h3>
        <ul className="mt-2 space-y-1.5">
          {permsOf(l).map((t) => <li key={t} className="flex gap-2 text-xs leading-relaxed text-muted"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-avatar-teal" /> {t}</li>)}
        </ul>

        {l.kind === "automation" && !!l.needs?.length && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {l.needs.map((n) => {
              const on = Boolean(p.targetChat?.connectors?.[`oauth:${n}`]);
              return <span key={n} className={`rounded-full border px-2.5 py-1 text-[11px] ${on ? "border-avatar-teal/60 text-avatar-teal" : "border-line text-muted"}`}>{on ? "Connected · " : "Connect in chat · "}{connectorLabel(n)}</span>;
            })}
          </div>
        )}

        {!!l.fields?.length && (
          <div className="mt-4 space-y-2.5">
            {l.fields.map((f) => (
              <label key={f.key} className="block text-xs text-muted">{f.label}
                <input value={p.vals[f.key] ?? ""} onChange={(e) => p.setVals({ ...p.vals, [f.key]: e.target.value })} placeholder={f.placeholder} className={`${inputCls} mt-1`} />
              </label>
            ))}
          </div>
        )}

        <details className="mt-4 rounded-lg border border-line bg-bg p-3">
          <summary className="cursor-pointer text-xs text-muted">Read exactly what you are installing</summary>
          <div className="mt-2 space-y-3">
            {l.skill && <Pre text={l.skill.instructions} />}
            {l.agent && <><Pre text={`Role: ${l.agent.role}`} />{l.agent.skills.map((s) => <div key={s.name}><p className="mb-1 text-[11px] text-faint">Skill: {s.name}</p><Pre text={s.instructions} /></div>)}</>}
            {l.routine && <Pre text={l.routine.instructions} />}
          </div>
        </details>

        {needsChat && (
          <label className="mt-4 block text-xs text-muted">Add it to
            <select value={p.target} onChange={(e) => p.setTarget(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">A new chat (created for you)</option>
              {p.chats.map((c, i) => <option key={c.id} value={c.id}>{c.agentName || "Agent"} · chat {p.chats.length - i}</option>)}
            </select>
          </label>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          {!l.official ? <button onClick={p.onReport} className="flex items-center gap-1.5 text-xs text-muted hover:text-ink"><Flag size={13} /> Report</button> : <span />}
          <button disabled={p.busy || missing} onClick={p.onInstall} className={btnGold}>
            {p.busy ? "Working…" : l.kind === "agent" ? "Create this agent" : l.kind === "automation" ? "Set up automation" : "Add skill"}
          </button>
        </div>
      </div>
    </div>
  );
}

const Pre = ({ text }: { text: string }) => <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted">{text}</pre>;

const PRESETS: Array<{ label: string; expr?: string; every?: number }> = [
  { label: "Every day at 09:00", expr: "0 9 * * *" },
  { label: "Weekdays at 09:00", expr: "0 9 * * 1-5" },
  { label: "Every Monday at 09:00", expr: "0 9 * * 1" },
  { label: "Every 6 hours", every: 360 },
  { label: "Custom (cron)" },
];

function ShareModal({ uid, defaultAuthor, onClose, onChanged, say }: {
  uid: string; defaultAuthor: string; onClose: () => void; onChanged: () => void; say: (t: string, ok?: boolean) => void;
}) {
  const [view, setView] = useState<"new" | "mine">("new");
  const [kind, setKind] = useState<ListingKind>("skill");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [text, setText] = useState("");
  const [extra, setExtra] = useState("");
  const [tool, setTool] = useState<ToolKind>("think");
  const [preset, setPreset] = useState(0);
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [mode, setMode] = useState<RoutineSpec["mode"]>("auto");
  const [writes, setWrites] = useState(false);
  const [needs, setNeeds] = useState<string[]>([]);
  const [author, setAuthor] = useState(defaultAuthor);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mine, setMine] = useState<Array<Listing & { status?: string; reports?: number }>>([]);

  async function loadMine() {
    try { setMine((await api<{ items: any[] }>(uid, { action: "mine" })).items); } catch { setMine([]); }
  }
  useEffect(() => { if (view === "mine") void loadMine(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true); setErr("");
    const base = { kind, name, tagline, category, tags: tags.split(",") };
    const pr = PRESETS[preset];
    const listing =
      kind === "skill" ? { ...base, skill: { instructions: text } }
      : kind === "agent" ? { ...base, agent: { role: text, tool, skills: extra.trim() ? [{ name: `${name} playbook`, description: tagline, instructions: extra }] : [] } }
      : { ...base, needs, routine: { instructions: text, schedule: pr.every ? { kind: "every", minutes: pr.every } : { kind: "cron", expr: pr.expr ?? cron }, mode, allowWrites: writes, toChat: true, notify: "always" } };
    try {
      await api(uid, { action: "publish", listing, author });
      say("Published. It is live in the marketplace now.");
      onChanged(); setName(""); setTagline(""); setText(""); setExtra(""); setView("mine");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not publish."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    try { await api(uid, { action: "remove", id }); await loadMine(); onChanged(); }
    catch (e) { say(e instanceof Error ? e.message : "Could not remove it.", false); }
  }

  const label = kind === "skill" ? "Instructions" : kind === "agent" ? "Role (who is this agent?)" : "What should it do each run? Use {{topic}} for things the installer fills in";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:px-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-xl2 border border-line bg-panel p-5 sm:rounded-xl2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex rounded-full border border-line bg-panel2 p-1 text-xs">
            {([["new", "Share yours"], ["mine", "My listings"]] as const).map(([k, l]) => <button key={k} onClick={() => setView(k)} className={`rounded-full px-4 py-1.5 ${view === k ? "bg-white font-medium text-bg" : "text-muted"}`}>{l}</button>)}
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={18} /></button>
        </div>

        {view === "mine" ? (
          <div className="mt-4 space-y-2">
            {mine.length === 0 && <p className="py-8 text-center text-sm text-muted">You have not shared anything yet.</p>}
            {mine.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{m.name}</p>
                  <p className="text-[11px] text-muted">{KIND_LABEL[m.kind]} · {m.installs ?? 0} installs · {m.status === "hidden" ? "hidden after reports" : "live"}</p>
                </div>
                <button onClick={() => remove(m.id)} className="rounded-md p-2 text-muted hover:bg-panel2 hover:text-ink" title="Remove"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs leading-relaxed text-muted">Sharing is free. Your listing is text only: it can never run code. Anyone can read it before installing, and it is scanned for secrets and for text that tries to control the agent.</p>
            <div className="flex gap-2">
              {(["skill", "agent", "automation"] as const).map((k) => <button key={k} onClick={() => setKind(k)} className={`flex-1 rounded-lg border px-3 py-2 text-xs ${kind === k ? "border-gold text-gold" : "border-line text-muted"}`}>{KIND_LABEL[k]}</button>)}
            </div>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Name" className={inputCls} />
            <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={160} placeholder="One line: what does it do for people?" className={inputCls} />
            <div className="flex gap-2">
              <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={24} placeholder="Category, e.g. Sales" className={inputCls} />
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated" className={inputCls} />
            </div>
            <label className="block text-xs text-muted">{label}
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={kind === "agent" ? 3 : 7} maxLength={kind === "agent" ? 400 : 8000} className={`${inputCls} mt-1`} />
            </label>
            {kind === "agent" && (
              <>
                <select value={tool} onChange={(e) => setTool(e.target.value as ToolKind)} className={inputCls}>
                  {TOOLS.map((t) => <option key={t} value={t}>{TOOL_TEXT[t]}</option>)}
                </select>
                <textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={4} placeholder="Optional playbook: the steps this agent always follows (becomes a skill)" className={inputCls} />
              </>
            )}
            {kind === "automation" && (
              <>
                <select value={preset} onChange={(e) => setPreset(Number(e.target.value))} className={inputCls}>
                  {PRESETS.map((x, i) => <option key={x.label} value={i}>{x.label}</option>)}
                </select>
                {PRESETS[preset].expr === undefined && !PRESETS[preset].every && <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * 1-5" className={inputCls} />}
                <div className="flex gap-2">
                  <select value={mode} onChange={(e) => setMode(e.target.value as RoutineSpec["mode"])} className={inputCls}>
                    <option value="auto">Mode: automatic</option><option value="lite">Mode: web research only</option><option value="agent">Mode: full agent tools</option>
                  </select>
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted"><input type="checkbox" checked={writes} onChange={(e) => setWrites(e.target.checked)} /> May write or send</label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(CONNECTORS).map((id) => {
                    const on = needs.includes(id);
                    return <button key={id} onClick={() => setNeeds(on ? needs.filter((x) => x !== id) : [...needs, id].slice(0, 6))} className={`rounded-full border px-2.5 py-1 text-[11px] ${on ? "border-gold text-gold" : "border-line text-muted"}`}>{on && <Check size={10} className="mr-1 inline" />}{connectorLabel(id)}</button>;
                  })}
                </div>
              </>
            )}
            <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={40} placeholder="Shown as author (leave empty for “Community member”)" className={inputCls} />
            {err && <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">{err}</p>}
            <div className="flex justify-end"><button disabled={busy} onClick={submit} className={btnGold}>{busy ? "Publishing…" : "Publish for free"}</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

function ImportModal({ uid, chats, target, setTarget, ensureChat, onClose, onSignIn }: {
  uid: string | null; chats: Chat[]; target: string; setTarget: (v: string) => void; ensureChat: () => Promise<string>; onClose: () => void; onSignIn: () => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ names: string[]; errors: string[]; flagged: string[] } | null>(null);
  const [err, setErr] = useState("");

  async function run() {
    if (!uid) { onSignIn(); return; }
    setBusy(true); setErr(""); setRes(null);
    try {
      const chatId = await ensureChat();
      const r = await fetch("/api/skills/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid, chatId, input }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `Import failed (HTTP ${r.status}).`);
      setRes({ names: d.names ?? [], errors: d.errors ?? [], flagged: d.flagged ?? [] });
    } catch (e) { setErr(e instanceof Error ? e.message : "Import failed."); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:px-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-xl2 border border-line bg-panel p-5 sm:rounded-xl2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Import skills from the internet</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">Paste a GitHub repository, a SKILL.md link, an “npx skills add owner/repo” command or the skill text. Every SKILL.md found is added. Anything with suspicious instructions is installed paused so you can read it first.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={18} /></button>
        </div>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={4} placeholder="https://github.com/owner/skills-repo" className={`${inputCls} mt-4`} />
        <select value={target} onChange={(e) => setTarget(e.target.value)} className={`${inputCls} mt-2`}>
          <option value="">Add to a new chat (created for you)</option>
          {chats.map((c, i) => <option key={c.id} value={c.id}>{c.agentName || "Agent"} · chat {chats.length - i}</option>)}
        </select>
        {err && <p className="mt-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">{err}</p>}
        {res && (
          <div className="mt-3 space-y-1 rounded-lg border border-line bg-bg p-3 text-xs">
            <p className="text-ink">{res.names.length} skill{res.names.length === 1 ? "" : "s"} added{res.flagged.length ? `, ${res.flagged.length} paused for review` : ""}.</p>
            {res.names.slice(0, 12).map((n) => <p key={n} className="text-muted">• {n}</p>)}
            {res.names.length > 12 && <p className="text-muted">…and {res.names.length - 12} more</p>}
            {res.errors.slice(0, 5).map((n) => <p key={n} className="text-red-300">• {n}</p>)}
          </div>
        )}
        <div className="mt-4 flex justify-end"><button disabled={busy || input.trim().length < 8} onClick={run} className={btnGold}>{busy ? "Importing…" : "Import"}</button></div>
      </div>
    </div>
  );
}
