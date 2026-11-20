"use client";

// The notetaker's presence in the chat: a small card at the top of the screen that shows what the agent is doing in a meeting right now
// (joining -> waiting in the lobby -> in the call, with a live timer and sound bars -> writing the notes -> done). It follows the bot live.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Clock, Loader2, LogOut, Mic, Sparkles, Video, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getActiveChat } from "@/lib/avatar-activity";

type Status = "joining" | "waiting" | "in_call" | "ended" | "processing" | "done" | "failed";
type Live = {
  botId: string; title: string; platform: string; status: Status; createdAt: number; updatedAt: number; joinedAt?: number;
  botName: string; agentName: string; auto?: boolean; note?: string; summary?: string; items?: number; durationSec?: number;
};
const ACTIVE: Status[] = ["joining", "waiting", "in_call", "ended", "processing"];
const PLATFORM: Record<string, string> = { meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams", webex: "Webex" };
const STEPS = ["Joining", "Lobby", "Listening", "Notes"];
const stepOf = (s: Status) => (s === "joining" ? 0 : s === "waiting" ? 1 : s === "in_call" ? 2 : s === "done" ? 4 : s === "failed" ? -1 : 3);

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

const CSS = `
@keyframes mi-in { 0% { opacity: 0; transform: translateY(-10px) scale(.94); } 60% { opacity: 1; transform: translateY(2px) scale(1.01); } 100% { opacity: 1; transform: none; } }
@keyframes mi-ring { 0% { transform: scale(.7); opacity: .55; } 100% { transform: scale(1.9); opacity: 0; } }
@keyframes mi-bar { 0%, 100% { transform: scaleY(.25); } 50% { transform: scaleY(1); } }
@keyframes mi-dot { 0%, 80%, 100% { transform: translateY(0); opacity: .35; } 40% { transform: translateY(-3px); opacity: 1; } }
@keyframes mi-blink { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
@keyframes mi-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes mi-slide { 0% { transform: translateX(-120%); } 100% { transform: translateX(380%); } }
@keyframes mi-pop { 0% { transform: scale(.3); opacity: 0; } 60% { transform: scale(1.25); opacity: 1; } 100% { transform: scale(1); } }
@keyframes mi-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); } 50% { box-shadow: 0 0 0 4px rgba(245,158,11,.14); } }
@keyframes mi-glow-live { 0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); } 50% { box-shadow: 0 0 0 4px rgba(239,68,68,.10); } }
@keyframes mi-spin { to { transform: rotate(360deg); } }
@keyframes mi-fade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.mi-card { animation: mi-in .45s cubic-bezier(.2,.9,.25,1.2) both; }
.mi-card[data-state="waiting"] { animation: mi-in .45s cubic-bezier(.2,.9,.25,1.2) both, mi-glow 2s ease-in-out infinite; }
.mi-card[data-state="in_call"] { animation: mi-in .45s cubic-bezier(.2,.9,.25,1.2) both, mi-glow-live 2.6s ease-in-out infinite; }
.mi-ring { animation: mi-ring 1.8s ease-out infinite; }
.mi-ring.mi-d2 { animation-delay: .9s; }
.mi-bar { transform-origin: center; animation: mi-bar 1s ease-in-out infinite; }
.mi-dot { animation: mi-dot 1.2s ease-in-out infinite; }
.mi-blink { animation: mi-blink 1.4s ease-in-out infinite; }
.mi-shimmer {
  background: linear-gradient(90deg, #8B8A90 0%, #8B8A90 38%, #F1F0EC 50%, #8B8A90 62%, #8B8A90 100%); background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; animation: mi-shimmer 2.4s linear infinite;
}
.mi-slide { animation: mi-slide 1.6s cubic-bezier(.4,0,.2,1) infinite; }
.mi-pop { animation: mi-pop .5s cubic-bezier(.2,.9,.25,1.3) both; }
.mi-spin { animation: mi-spin .9s linear infinite; }
.mi-fade { animation: mi-fade .22s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .mi-card, .mi-card[data-state], .mi-ring, .mi-bar, .mi-dot, .mi-blink, .mi-slide, .mi-pop, .mi-spin, .mi-fade, .mi-shimmer { animation: none !important; }
  .mi-shimmer { -webkit-text-fill-color: #F1F0EC; color: #F1F0EC; background: none; }
}
`;

export default function MeetingIsland() {
  const { user } = useAuth();
  const [live, setLive] = useState<Live[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const liveRef = useRef<Live[]>([]);

  const call = useCallback(async (body: Record<string, unknown>) => {
    if (!user) throw new Error("Sign in first.");
    const res = await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) }, body: JSON.stringify({ uid: user.uid, chatId: getActiveChat() ?? undefined, ...body }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.ok === false) throw new Error(d.error || `Request failed (${res.status}).`);
    return d;
  }, [user]);

  const refresh = useCallback(async (): Promise<Live[] | null> => {
    try {
      const d = await call({ action: "live" });
      const next = (Array.isArray(d.live) ? d.live : []) as Live[];
      liveRef.current = next; setLive(next);
      return next;
    } catch { return null; }
  }, [call]);

  // polls every few seconds while the agent is in a meeting, once a minute otherwise (and not at all while the tab is hidden)
  useEffect(() => {
    if (!user) return;
    let stop = false;
    let timer: number | undefined;
    const loop = async () => {
      if (stop) return;
      let wait = 60_000;
      if (document.visibilityState === "visible") {
        const r = (await refresh()) ?? liveRef.current;
        wait = r.some((m) => ACTIVE.includes(m.status)) ? 4000 : 60_000;
      }
      if (!stop) timer = window.setTimeout(loop, wait);
    };
    void loop();
    const onVis = () => { if (document.visibilityState === "visible") { window.clearTimeout(timer); void loop(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [user, refresh]);

  const shownList = live.filter((m) => !hidden[m.botId]);
  const m = shownList[0];
  const ticking = Boolean(m && (m.status === "in_call" || m.status === "joining" || m.status === "ended" || m.status === "processing" || m.status === "waiting"));
  useEffect(() => {
    if (!ticking) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [ticking]);

  if (!user || !m) return null;

  const platform = PLATFORM[m.platform] || "Meeting";
  const step = stepOf(m.status);
  const canLeave = m.status === "joining" || m.status === "waiting" || m.status === "in_call";
  const finished = m.status === "done" || m.status === "failed";
  const elapsed = clock(now - (m.joinedAt ?? m.createdAt));

  let head = "", sub = "", tone = "text-gold border-gold/30 bg-goldSoft";
  switch (m.status) {
    case "joining": head = `Joining ${m.title}`; sub = `${platform} · connecting`; break;
    case "waiting": head = "Waiting in the lobby"; sub = `Admit “${m.botName}” to let ${m.agentName} in`; tone = "text-amber-400 border-amber-400/40 bg-amber-400/10"; break;
    case "in_call": head = `${m.agentName} is in a meeting`; sub = `${m.title} · listening and taking notes`; tone = "text-red-400 border-red-400/40 bg-red-400/10"; break;
    case "ended": head = "Meeting ended"; sub = "Getting the transcript"; break;
    case "processing": head = "Writing the notes"; sub = `${m.agentName} is reading the transcript`; break;
    case "done": head = "Notes are ready"; sub = m.items ? `${m.items} action item${m.items === 1 ? "" : "s"} · ${m.title}` : m.title; tone = "text-emerald-400 border-emerald-400/40 bg-emerald-400/10"; break;
    default: head = "Could not finish the meeting"; sub = m.note || `${m.title}`; tone = "text-red-400 border-red-400/40 bg-red-400/10";
  }

  const Icon = m.status === "in_call" ? Mic : m.status === "waiting" ? Clock : m.status === "done" ? Check : m.status === "failed" ? AlertTriangle : m.status === "processing" || m.status === "ended" ? Sparkles : Video;

  async function leave() {
    if (!m) return;
    setBusy(true); setErr("");
    try { await call({ action: "leave", botId: m.botId }); await refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "Could not leave."); } finally { setBusy(false); }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[45] flex justify-center px-3 sm:top-16" role="status" aria-live="polite">
      <style>{CSS}</style>
      <div key={m.botId} data-state={m.status} className="mi-card pointer-events-auto relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-panel shadow-xl">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
            {m.status === "in_call" && (<><span className="mi-ring absolute inset-0 rounded-full bg-red-400/40" /><span className="mi-ring mi-d2 absolute inset-0 rounded-full bg-red-400/30" /></>)}
            {m.status === "waiting" && <span className="mi-ring absolute inset-0 rounded-full bg-amber-400/40" />}
            <span className={`relative flex h-9 w-9 items-center justify-center rounded-xl border ${tone}`}>
              {m.status === "joining" ? <Loader2 size={16} className="mi-spin" aria-hidden="true" /> : <Icon size={16} className={m.status === "done" ? "mi-pop" : ""} aria-hidden="true" />}
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={`truncate text-sm font-medium text-ink ${m.status === "processing" ? "mi-shimmer" : ""}`}>{head}</span>
              {m.status === "in_call" && <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-red-400"><span className="mi-blink h-1.5 w-1.5 rounded-full bg-red-500" />LIVE</span>}
              {m.auto && !finished && <span className="shrink-0 rounded-full bg-panel2 px-1.5 py-0.5 text-[10px] text-muted">calendar</span>}
              {shownList.length > 1 && <span className="shrink-0 rounded-full bg-panel2 px-1.5 py-0.5 text-[10px] text-muted">+{shownList.length - 1}</span>}
            </span>
            <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
              {sub}
              {(m.status === "joining" || m.status === "ended") && (<span className="ml-1 inline-flex gap-0.5" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="mi-dot h-1 w-1 rounded-full bg-muted" style={{ animationDelay: `${i * 0.18}s` }} />)}</span>)}
            </span>
          </span>
          {m.status === "in_call" && (
            <span className="flex shrink-0 items-center gap-2.5">
              <span className="flex h-5 items-center gap-[2px]" aria-hidden="true">
                {[0.9, 0.5, 1, 0.65, 0.8].map((h, i) => <span key={i} className="mi-bar w-[3px] rounded-full bg-red-400" style={{ height: `${h * 100}%`, animationDelay: `${i * 0.13}s`, animationDuration: `${0.8 + (i % 3) * 0.25}s` }} />)}
              </span>
              <span className="font-mono text-xs tabular-nums text-ink">{elapsed}</span>
            </span>
          )}
          <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>

        {(m.status === "waiting" || m.status === "ended" || m.status === "processing") && (
          <div className="h-0.5 overflow-hidden bg-panel2"><div className="mi-slide h-full w-1/4 bg-gradient-to-r from-transparent via-gold to-transparent" /></div>
        )}

        {open && (
          <div className="mi-fade space-y-3 border-t border-line px-3.5 py-3 text-xs">
            <ol className="flex items-center gap-1" aria-label="Meeting progress">
              {STEPS.map((label, i) => {
                const doneStep = step > i || m.status === "done", cur = step === i;
                return (
                  <li key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${doneStep ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-400" : cur ? "border-gold/50 bg-goldSoft text-gold" : "border-line text-muted"}`}>
                      {doneStep ? <Check size={11} aria-hidden="true" /> : cur ? <span className="mi-blink h-1.5 w-1.5 rounded-full bg-gold" /> : i + 1}
                    </span>
                    <span className={`truncate ${cur ? "text-ink" : "text-muted"}`}>{label}</span>
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
              <span>{platform}</span>
              <span>Bot name: {m.botName}</span>
              {m.durationSec ? <span>{Math.max(1, Math.round(m.durationSec / 60))} min</span> : null}
            </div>
            {m.summary && <p className="text-ink/90">{m.summary}</p>}
            {m.status === "failed" && m.note && <p className="text-red-400">{m.note}</p>}
            {m.status === "done" && <p className="text-muted">The full notes are in this chat.</p>}
            {m.status === "in_call" && <p className="text-muted">Everyone left? Tap “Leave meeting” to end it now. The notetaker also leaves by itself a little while after the last person goes.</p>}
            {err && <p className="text-red-400">{err}</p>}
            <div className="flex gap-2">
              {canLeave && (
                <button type="button" disabled={busy} onClick={() => void leave()} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-ink hover:bg-white/15 disabled:opacity-50">
                  {busy ? <Loader2 size={12} className="mi-spin" /> : <LogOut size={12} aria-hidden="true" />} Leave meeting
                </button>
              )}
              {finished && (
                <button type="button" onClick={() => setHidden((h) => ({ ...h, [m.botId]: true }))} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-ink hover:bg-white/15">
                  <X size={12} aria-hidden="true" /> Hide
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
