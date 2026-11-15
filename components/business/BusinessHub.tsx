"use client";

// Venus Business Hub: the owner talks to Chief in ONE chat. Business details can be told in the chat or filled in the Profile.
// Once the business is known, Chief builds the team, and everything the teammates say to each other (tasks, handoffs,
// results, drafts) shows up in this same chat, so nothing happens behind the owner's back.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Briefcase, Building2, Check, CheckCircle2, Circle, CircleAlert, Copy, Download, LoaderCircle, Minus, RefreshCw, Send, Trash2, X } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import Markdown from "@/components/Markdown";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import {
  BIZ_TEAM, PROFILE_FIELDS, approveMsg, assembleBizTeam, clearChat, completeness, emptyDoc, ensureGreeting, hasAnyKey, isReady, leadsCsv, makeLlm,
  memberById, ownerSays, recoverStale, safeHref, saveProfileForm, toggleMember, watchBiz,
  type BizDoc, type BizMember, type BizProfile, type Lead, type Msg, type RunStep,
} from "@/lib/business";

const CHIEF = BIZ_TEAM[0];
const who = (id?: string): BizMember => memberById(id) ?? CHIEF;
const toName = (to?: string) => (to === "you" ? "You" : to === "team" ? "Team" : to ? memberById(to)?.name ?? "" : "");
const hhmm = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const TAG_LABEL: Record<NonNullable<Msg["tag"]>, string> = { task: "Task", handoff: "Handoff", plan: "Plan", result: "Result", draft: "Draft", report: "Final report", note: "Note" };

const QUICK = [
  { label: "Find customers + first messages", text: "Find 10 potential customers for my business and write a short first message for each." },
  { label: "Competitor check", text: "Research my 3 closest competitors: their prices, offers and what customers like or dislike. Then tell me how we can stand out." },
  { label: "7-day content plan", text: "Plan a 7-day content calendar for my business and write the first 3 posts." },
  { label: "Customer FAQs", text: "Write answers to the 8 questions customers ask us most, using my business details." },
  { label: "Pricing review", text: "Review my prices and policies and suggest 2 offers or packages that would bring more customers." },
];

async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); return true; } catch { return false; }
}

// ---------- messages ----------

function LeadsCard({ leads }: { leads: Lead[] }) {
  function download() {
    const url = URL.createObjectURL(new Blob([leadsCsv(leads)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "venus-leads.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-line bg-bg">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <p className="text-xs font-medium text-ink">Leads · {leads.length}</p>
        <button type="button" onClick={download} className="press inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted hover:text-ink"><Download size={12} /> CSV</button>
      </div>
      <ul className="divide-y divide-line">
        {leads.map((l, i) => {
          const site = safeHref(l.website);
          const src = safeHref(l.source);
          return (
            <li key={`${l.name}-${i}`} className="px-3 py-2.5">
              <p className="text-sm font-medium text-ink">{l.name}</p>
              {l.why && <p className="mt-0.5 text-xs text-muted">{l.why}</p>}
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-faint">
                {site && <a href={site} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>}
                {l.contact && <span>{l.contact}</span>}
                {src && src !== site && <a href={src} target="_blank" rel="noopener noreferrer" className="hover:underline">source</a>}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AgentMessage({ m, uid }: { m: Msg; uid: string }) {
  const from = who(m.from);
  const [copied, setCopied] = useState(false);
  const to = toName(m.to);

  // teammates talking to each other: one slim line, like a group chat
  if (m.tag === "task" || m.tag === "handoff") {
    return (
      <div className="flex items-start gap-2 px-1 text-xs text-muted">
        <div className="mt-0.5"><BotAvatar color={from.color} size={22} animate={false} /></div>
        <p className="min-w-0 flex-1 break-words leading-relaxed">
          <b className="font-medium text-ink">{from.name}</b><ArrowRight size={11} className="mx-1 inline" /><b className="font-medium text-ink">{to}</b>
          <span className="ml-2 text-[10px] uppercase tracking-wide text-faint">{TAG_LABEL[m.tag]}</span>
          <br />{m.text.replace(/[*_`]/g, "").slice(0, 420)}
        </p>
        <time className="shrink-0 text-[10px] text-faint">{hhmm(m.at)}</time>
      </div>
    );
  }

  const badge = m.tag ? TAG_LABEL[m.tag] : "";
  const badgeTone = m.tag === "report" ? "bg-emerald-500/15 text-emerald-400" : m.tag === "draft" ? "bg-gold/15 text-gold" : m.tag === "note" && /⚠️/.test(m.text) ? "bg-red-500/15 text-red-400" : "bg-panel text-muted";
  return (
    <div className="flex gap-3">
      <div className="mt-0.5"><BotAvatar color={from.color} size={32} animate={false} /></div>
      <div className="min-w-0 flex-1 rounded-2xl border border-line bg-panel2 px-4 py-3">
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-sm font-medium text-ink">{from.name}</span>
          <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] text-muted">{from.title}</span>
          {to && <span className="inline-flex items-center gap-1 text-faint"><ArrowRight size={11} />{to}</span>}
          {badge && <span className={`rounded-full px-2 py-0.5 text-[10px] ${badgeTone}`}>{badge}</span>}
          <time className="ml-auto text-[10px] text-faint">{hhmm(m.at)}</time>
        </div>
        <div className="break-words text-sm text-ink"><Markdown text={m.text} /></div>
        {m.leads && m.leads.length > 0 && <LeadsCard leads={m.leads} />}
        {m.tag === "draft" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5 text-xs">
            {m.approved ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-400"><CheckCircle2 size={14} /> Approved by you. Copy it and send it yourself: Venus never sends anything on its own.</span>
            ) : (
              <>
                <span className="text-gold">Needs your OK</span>
                <button type="button" onClick={() => void approveMsg(uid, m.id)} className="press inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-bg"><Check size={12} /> Approve draft</button>
              </>
            )}
            <button type="button" onClick={async () => { if (await copyText(m.text)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }} className="press inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-muted hover:text-ink">
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Message({ m, uid }: { m: Msg; uid: string }) {
  if (m.kind === "user") return <div className="ml-auto max-w-[88%] whitespace-pre-wrap break-words rounded-2xl bg-ink px-4 py-2.5 text-sm text-bg sm:max-w-[75%]">{m.text}</div>;
  if (m.kind === "system") return <p className="mx-auto max-w-[92%] rounded-full border border-line px-3 py-1 text-center text-[11px] text-muted">{m.text}</p>;
  return <AgentMessage m={m} uid={uid} />;
}

// ---------- live progress ----------

function StepIcon({ s }: { s: RunStep["status"] }) {
  if (s === "running") return <LoaderCircle size={13} className="animate-spin text-gold" />;
  if (s === "done") return <CheckCircle2 size={13} className="text-emerald-400" />;
  if (s === "failed") return <CircleAlert size={13} className="text-red-400" />;
  if (s === "skipped") return <Minus size={13} className="text-faint" />;
  return <Circle size={13} className="text-faint" />;
}

function RunBanner({ biz }: { biz: BizDoc }) {
  const r = biz.run;
  if (!r || (r.status !== "running" && r.status !== "planning")) return null;
  const done = r.steps.filter((s) => s.status === "done").length;
  return (
    <div className="mx-3 mb-2 rounded-xl border border-line bg-panel px-3 py-2 md:mx-5">
      <p className="truncate text-xs text-ink"><span className="text-muted">Working on:</span> {r.goal}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {r.status === "planning" && <span className="inline-flex items-center gap-1.5 text-[11px] text-muted"><LoaderCircle size={12} className="animate-spin" /> Chief is planning…</span>}
        {r.steps.map((s) => (
          <span key={s.i} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
            <StepIcon s={s.status} /> {s.i + 1}. {who(s.member).name}
          </span>
        ))}
        {r.steps.length > 0 && <span className="ml-auto text-[11px] text-faint">{done}/{r.steps.length}</span>}
      </div>
    </div>
  );
}

// ---------- profile and team panel ----------

function ProfilePanel(p: {
  biz: BizDoc; draft: BizProfile; setDraft: (v: BizProfile) => void; dirty: boolean; setDirty: (v: boolean) => void;
  busy: boolean; keyOk: boolean; onSave: () => void; onRebuild: () => void; onClear: () => void; onToggle: (id: string, on: boolean) => void; onClose: () => void;
}) {
  const pct = completeness(p.draft);
  const ready = isReady(p.draft);
  return (
    <>
      <div onClick={p.onClose} className="fixed inset-0 z-30 bg-black/55 backdrop-blur-sm md:hidden" />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-line bg-panel md:static md:z-auto md:w-[380px] md:max-w-none md:shrink-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 pt-[calc(var(--sat)+0.75rem)] md:pt-3">
          <p className="flex items-center gap-2 text-sm font-medium text-ink"><Building2 size={15} /> Business profile</p>
          <button type="button" aria-label="Close" onClick={p.onClose} className="press rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted"><span>{ready ? "Ready: the team can work" : "Fill at least name and what you sell or do"}</span><span>{pct}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-panel2"><div className="h-full rounded-full bg-gold transition-all" style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="space-y-3">
            {PROFILE_FIELDS.map((f) => {
              const cls = "w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-ink/40";
              return (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-[11px] text-muted">{f.label}</span>
                  {f.long ? (
                    <textarea rows={2} maxLength={600} value={p.draft[f.key]} placeholder={f.hint} className={`${cls} resize-none`} onChange={(e) => { p.setDirty(true); p.setDraft({ ...p.draft, [f.key]: e.target.value }); }} />
                  ) : (
                    <input maxLength={600} value={p.draft[f.key]} placeholder={f.hint} className={cls} onChange={(e) => { p.setDirty(true); p.setDraft({ ...p.draft, [f.key]: e.target.value }); }} />
                  )}
                </label>
              );
            })}
          </div>
          <button type="button" disabled={!p.dirty || p.busy} onClick={p.onSave} className="press mt-4 w-full rounded-full bg-ink py-2.5 text-sm font-medium text-bg disabled:opacity-40">Save profile</button>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-ink">Your team</p>
              <button type="button" disabled={!ready || !p.keyOk || p.busy || p.dirty} onClick={p.onRebuild} title="Let Chief choose the team again" className="press inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted hover:text-ink disabled:opacity-40"><RefreshCw size={12} /> Let Chief rebuild</button>
            </div>
            <ul className="space-y-1.5">
              {BIZ_TEAM.map((m) => {
                const on = p.biz.team.includes(m.id);
                const locked = m.id === "chief";
                return (
                  <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel2 px-3 py-2">
                    <BotAvatar color={m.color} size={30} animate={false} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{m.name} <span className="text-[11px] text-muted">· {m.title}</span></p>
                      <p className="line-clamp-2 text-[11px] text-faint">{m.skill}</p>
                    </div>
                    {locked ? <span className="text-[10px] text-faint">always</span> : (
                      <button type="button" role="switch" aria-checked={on} aria-label={`${on ? "Remove" : "Add"} ${m.name}`} onClick={() => p.onToggle(m.id, !on)} className={`press relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-line"}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <button type="button" disabled={p.busy} onClick={p.onClear} className="press mt-6 inline-flex items-center gap-1.5 text-xs text-faint hover:text-red-400 disabled:opacity-40"><Trash2 size={13} /> Clear chat (profile and team stay)</button>
        </div>
      </aside>
    </>
  );
}

// ---------- the screen ----------

export default function BusinessHub() {
  const { user, loading } = useAuth();
  const { apiKeys, loading: keysLoading } = useKeys();
  const uid = user?.uid ?? "";
  const [biz, setBiz] = useState<BizDoc>(emptyDoc());
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [panel, setPanel] = useState(false);
  const [draft, setDraft] = useState<BizProfile>(emptyDoc().profile);
  const [dirty, setDirty] = useState(false);
  const bizRef = useRef(biz);
  bizRef.current = biz;
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef("");
  const llm = useMemo(() => makeLlm(apiKeys), [apiKeys]);
  const keyOk = hasAnyKey(apiKeys);
  const profileKey = JSON.stringify(biz.profile);

  useEffect(() => {
    if (!uid) return;
    setLoaded(false);
    return watchBiz(uid, (d, ok) => { setBiz(d); setLoaded(ok); });
  }, [uid]);

  // first time on this screen: close any run a closed tab left half-way, and let Chief say hello
  useEffect(() => {
    if (!uid || !loaded || started.current === uid) return;
    started.current = uid;
    void recoverStale(uid).then(() => ensureGreeting(uid));
  }, [uid, loaded]);

  useEffect(() => { if (!dirty) setDraft(bizRef.current.profile); }, [profileKey, dirty]);

  const workingIds = busy ? Object.keys(biz.working) : [];
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [biz.msgs.length, busy, workingIds.join(",")]);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  async function send(text?: string) {
    const t = (text ?? input).trim();
    if (!t || busy || !uid || !keyOk) return;
    setInput("");
    setBusy(true);
    try { await ownerSays({ uid, text: t, llm, biz: bizRef.current }); } finally { setBusy(false); }
  }

  async function saveProfile() {
    if (!uid || busy) return;
    setBusy(true);
    try { await saveProfileForm({ uid, llm, biz: bizRef.current, profile: draft }); setDirty(false); } finally { setBusy(false); }
  }

  async function rebuild() {
    if (!uid || busy) return;
    setBusy(true);
    try { await assembleBizTeam(uid, llm, bizRef.current.profile); } finally { setBusy(false); }
  }

  async function clear() {
    if (!uid || busy || !window.confirm("Clear the chat? Your business profile and team stay.")) return;
    started.current = "";
    await clearChat(uid);
    await ensureGreeting(uid);
    started.current = uid;
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</main>;
  if (!user) return <main className="min-h-screen bg-bg p-8 text-ink"><Link href="/" className="text-sm text-muted hover:text-ink">Sign in to open your Business Hub</Link></main>;

  const team = biz.team.map((id) => memberById(id)).filter((m): m is BizMember => Boolean(m));

  return (
    <main className="flex h-[100dvh] flex-col bg-bg text-ink">
      <header className="flex items-center gap-2 border-b border-line px-3 pb-2.5 pt-[calc(var(--sat)+0.625rem)] md:px-5">
        <Link href="/dashboard" aria-label="Back to dashboard" className="press rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><ArrowLeft size={18} /></Link>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-panel2 text-gold"><Briefcase size={16} /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Venus Business Hub</p>
            <p className="truncate text-[11px] text-muted">{biz.profile.name || "Tell Chief about your business"}</p>
          </div>
        </div>
        {team.length > 0 && (
          <button type="button" onClick={() => setPanel(true)} aria-label="Open your team" className="press hidden items-center -space-x-2 sm:flex">
            {team.slice(0, 6).map((m) => <span key={m.id} className="rounded-full ring-2 ring-bg"><BotAvatar color={m.color} size={28} working={busy && Boolean(biz.working[m.id])} animate={false} /></span>)}
          </button>
        )}
        <button type="button" onClick={() => setPanel((v) => !v)} className="press inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2"><Building2 size={14} /> Profile</button>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5">
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              {!loaded && <p className="py-8 text-center text-xs text-faint">Opening your hub…</p>}
              {biz.msgs.map((m) => <Message key={m.id} m={m} uid={uid} />)}
              {workingIds.map((id) => (
                <div key={id} className="flex items-center gap-2.5 px-1 text-xs text-muted">
                  <BotAvatar color={who(id).color} size={24} working />
                  <span><b className="font-medium text-ink">{who(id).name}</b> · {biz.working[id]}</span>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </div>

          <RunBanner biz={biz} />

          <div className="border-t border-line px-3 pt-3 pb-[calc(0.75rem+var(--sab))] md:px-5">
            <div className="mx-auto max-w-3xl">
              {!keysLoading && !keyOk && (
                <p className="mb-2 rounded-xl border border-line bg-panel px-3 py-2 text-xs text-muted">
                  Your team needs a model to think with. <Link href="/dashboard" className="text-gold underline">Add an API key in the dashboard</Link>, then come back.
                </p>
              )}
              {team.length > 0 && !busy && (
                <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
                  {QUICK.map((q) => <button key={q.label} type="button" onClick={() => { setInput(q.text); taRef.current?.focus(); }} className="press shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink">{q.label}</button>)}
                </div>
              )}
              <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-end gap-2">
                <textarea
                  ref={taRef} rows={1} value={input} disabled={!keyOk} maxLength={4000}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
                  placeholder={team.length ? "Give your team a goal…" : "Tell Chief about your business…"}
                  className="max-h-[140px] min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-panel px-4 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-ink/40 disabled:opacity-50"
                />
                <button type="submit" aria-label="Send" disabled={!input.trim() || busy || !keyOk} className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-bg disabled:opacity-40">
                  {busy ? <LoaderCircle size={17} className="animate-spin" /> : <Send size={16} />}
                </button>
              </form>
            </div>
          </div>
        </section>

        {panel && (
          <ProfilePanel
            biz={biz} draft={draft} setDraft={setDraft} dirty={dirty} setDirty={setDirty} busy={busy} keyOk={keyOk}
            onSave={() => void saveProfile()} onRebuild={() => void rebuild()} onClear={() => void clear()}
            onToggle={(id, on) => void toggleMember(uid, id, on)} onClose={() => setPanel(false)}
          />
        )}
      </div>
    </main>
  );
}
