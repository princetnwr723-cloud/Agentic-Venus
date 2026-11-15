"use client";

// The background agent inside the chat screen (it sits right above the message box).
// It watches the runs of THIS chat and always shows the owner what is going on, so a reply is never "silent":
//   - the answer while the model is still writing it, and one line about what the agent is doing right now
//   - the card when the agent needs the owner: approve / question / secret / take over the screen
//   - a clear message when a task broke or is held by a limit (with the reason), and a Stop button while it works
//   - it wakes a stuck task by itself (a task that stopped moving is nudged again, no scheduler needed)
// The finished answer arrives in the chat itself (the server writes it there). A run that has just ended is reported to the
// dashboard (onDone) once, so it can learn from it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, KeyRound, Loader2, Monitor, RotateCcw, Send, ShieldCheck, Square, X } from "lucide-react";
import Markdown from "@/components/Markdown";
import { agentApi, isActiveRun, watchChatRuns, watchEvents, watchLive, type RunEvent, type RunView } from "@/lib/agent/client";

const NUDGE_AFTER_MS = 60_000; // a queued / running task that has not moved for this long is woken up
const NUDGE_EVERY_MS = 45_000; // and not more often than this
const BEAT_EVERY_MS = 20_000; // heartbeat while the owner has the screen (the server hands it back after 90 s without one)
const ERROR_SHOWN_MS = 15 * 60_000; // a broken task stays visible this long (or until it is closed)

type Act = (body: Record<string, unknown>) => Promise<void>;

const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50";
const btnMain = `${btn} bg-gold text-black hover:opacity-90`;
const btnSoft = `${btn} border border-line bg-panel2 text-ink hover:border-gold/50`;
const field = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-gold/60";

/** The card for something only the owner can decide. */
function PendingCard({ run, busy, act }: { run: RunView; busy: boolean; act: Act }) {
  const p = run.pending;
  const [text, setText] = useState("");
  const [secret, setSecret] = useState("");
  const pid = p?.id ?? "";
  useEffect(() => { setText(""); setSecret(""); }, [pid]);

  if (!p) return null;
  const takingOver = run.takeover?.status === "active";
  const reply = (extra: Record<string, unknown>) => act({ action: "reply", runId: run.id, pendingId: p.id, ...extra });

  if (p.kind === "request_takeover") {
    return (
      <div className="mt-2.5 space-y-2.5">
        <p className="flex items-start gap-2 text-sm text-ink"><Monitor size={15} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />{p.summary}</p>
        {takingOver ? (
          <>
            <p className="text-xs text-muted">The screen is yours now. Do what is needed (login, captcha, payment), then press &quot;Hand back&quot;.</p>
            <div className="flex flex-wrap gap-2">
              <button className={btnMain} disabled={busy} onClick={() => void act({ action: "takeover_handback", runId: run.id, pendingId: p.id, note: "" })}><Check size={13} aria-hidden="true" />Hand back to the agent</button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className={btnMain} disabled={busy} onClick={() => void act({ action: "takeover_start", runId: run.id, pendingId: p.id })}><Monitor size={13} aria-hidden="true" />Take over the screen</button>
            <button className={btnSoft} disabled={busy} onClick={() => void reply({ reply: "deny" })}>Not now</button>
          </div>
        )}
      </div>
    );
  }

  if (p.kind === "request_secret") {
    return (
      <div className="mt-2.5 space-y-2.5">
        <p className="flex items-start gap-2 text-sm text-ink"><KeyRound size={15} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />{p.summary}</p>
        <input type="password" autoComplete="off" className={field} placeholder={p.secretName ? `Value for ${p.secretName}` : "Enter the value"} value={secret} onChange={(e) => setSecret(e.target.value)} />
        <p className="text-[11px] text-muted">It goes straight into your encrypted vault. It is never written into the chat and the AI never sees it.</p>
        <div className="flex flex-wrap gap-2">
          <button className={btnMain} disabled={busy || !secret} onClick={() => void reply({ reply: "secret", value: secret })}><ShieldCheck size={13} aria-hidden="true" />Save safely</button>
          <button className={btnSoft} disabled={busy} onClick={() => void reply({ reply: "deny" })}>Skip</button>
        </div>
      </div>
    );
  }

  if (p.kind === "ask_user") {
    const send = () => { const t = text.trim(); if (t) void reply({ reply: "answer", text: t }); };
    return (
      <div className="mt-2.5 space-y-2.5">
        <p className="text-sm text-ink">{p.question || p.summary}</p>
        {p.options && p.options.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {p.options.slice(0, 8).map((o) => <button key={o} className={btnSoft} disabled={busy} onClick={() => void reply({ reply: "answer", text: o })}>{o}</button>)}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input className={field} placeholder="Type your answer…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
          <button className={btnMain} disabled={busy || !text.trim()} onClick={send} aria-label="Send answer"><Send size={13} aria-hidden="true" />Send</button>
        </div>
      </div>
    );
  }

  // approve_tool / request_approval
  const args = p.args && Object.keys(p.args).length ? JSON.stringify(p.args) : "";
  return (
    <div className="mt-2.5 space-y-2.5">
      <p className="text-sm text-ink">{p.summary}</p>
      {args && <p className="max-h-24 overflow-y-auto break-all rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-[11px] text-muted">{args.slice(0, 500)}</p>}
      {p.tainted && <p className="flex items-center gap-1.5 text-[11px] text-amber-400"><AlertTriangle size={12} aria-hidden="true" />This action came after untrusted content (a web page, mail or file). Check it carefully.</p>}
      <div className="flex flex-wrap gap-2">
        <button className={btnMain} disabled={busy} onClick={() => void reply({ reply: "approve" })}><Check size={13} aria-hidden="true" />Approve</button>
        <button className={btnSoft} disabled={busy} onClick={() => void reply({ reply: "deny" })}><X size={13} aria-hidden="true" />Deny</button>
      </div>
    </div>
  );
}

export default function AgentDock({ uid, chatId, onDone }: { uid: string; chatId: string; onDone?: (run: RunView) => void }) {
  const [runs, setRuns] = useState<RunView[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [live, setLive] = useState<{ text: string; round: number } | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const seen = useRef(new Set<string>());
  const lastNudge = useRef<Record<string, number>>({});

  useEffect(() => {
    seen.current = new Set(); lastNudge.current = {};
    setRuns([]); setDismissed([]); setErr("");
    return watchChatRuns(uid, chatId, setRuns);
  }, [uid, chatId]);

  // a run this screen saw working that is now over: report it once (the dashboard learns from it)
  useEffect(() => {
    for (const r of runs) {
      if (isActiveRun(r)) seen.current.add(r.id);
      else if (seen.current.delete(r.id)) onDone?.(r);
    }
  }, [runs, onDone]);

  const active = useMemo(() => runs.filter(isActiveRun), [runs]);

  // a clock, only while something is working
  useEffect(() => {
    if (!active.length) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [active.length]);

  // what to show: a card that waits for the owner first, then the newest working task, then a task that just broke
  const focus: RunView | null = useMemo(() => {
    const waiting = active.find((r) => r.status === "paused" && r.pending);
    if (waiting) return waiting;
    if (active.length) return active[0];
    const newest = runs[0];
    if (newest && newest.status === "error" && !dismissed.includes(newest.id) && Date.now() - (newest.endedAt ?? newest.updatedAt) < ERROR_SHOWN_MS) return newest;
    return null;
  }, [runs, active, dismissed]);

  const fid = focus?.id ?? "";
  const fstatus = focus?.status ?? "";
  const fpending = focus?.pending?.id ?? "";

  useEffect(() => {
    setLive(null);
    if (!fid || (fstatus !== "running" && fstatus !== "queued")) return;
    return watchLive(uid, fid, setLive);
  }, [uid, fid, fstatus]);

  useEffect(() => {
    setEvents([]);
    if (!fid) return;
    return watchEvents(uid, fid, setEvents, 8);
  }, [uid, fid]);

  useEffect(() => { setErr(""); }, [fid, fpending]);

  const act: Act = useCallback(async (body) => {
    setBusy(true); setErr("");
    try { await agentApi(uid, body); }
    catch (e) { setErr(e instanceof Error ? e.message : "That did not work. Please try again."); }
    finally { setBusy(false); }
  }, [uid]);

  // a task that stopped moving (a slice died, the scheduler is not set up, a limit has reset) is woken up from here
  useEffect(() => {
    if (!focus) return;
    const idle = now - focus.updatedAt;
    const due = focus.status === "queued" || focus.status === "running" ? idle > NUDGE_AFTER_MS : focus.status === "budget" ? !focus.resumeAt || now >= focus.resumeAt : false;
    if (!due || now - (lastNudge.current[focus.id] ?? 0) < NUDGE_EVERY_MS) return;
    lastNudge.current[focus.id] = now;
    void agentApi(uid, { action: "nudge", runId: focus.id }).catch(() => {});
  }, [now, focus, uid]);

  // the owner has the screen: tell the server every 20 s that this page is still open
  const takeoverActive = focus?.status === "paused" && focus.pending?.kind === "request_takeover" && focus.takeover?.status === "active";
  useEffect(() => {
    if (!takeoverActive || !fid || !fpending) return;
    const send = () => { void agentApi(uid, { action: "takeover_beat", runId: fid, pendingId: fpending }).catch(() => {}); };
    const t = setInterval(send, BEAT_EVERY_MS);
    return () => clearInterval(t);
  }, [takeoverActive, uid, fid, fpending]);

  if (!focus) return null;

  const r = focus;
  const others = active.length - (active.some((x) => x.id === r.id) ? 1 : 0);
  const line = [...events].reverse().find((e) => e.kind !== "text" && e.text);
  const waitingCard = r.status === "paused" && r.pending;
  const canStop = isActiveRun(r);

  let head = "";
  if (r.status === "queued") head = "Starting…";
  else if (r.status === "running") head = r.round > 0 ? `Working · step ${r.round}` : "Working…";
  else if (waitingCard) head = "Waiting for you";
  else if (r.status === "paused") head = "Paused";
  else if (r.status === "budget") head = "On hold";
  else if (r.status === "error") head = "This task stopped";

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-2" role="status" aria-live="polite">
      <div className="rounded-2xl border border-line bg-panel px-3.5 py-2.5">
        <div className="flex items-center gap-2.5">
          {r.status === "error" || r.status === "budget"
            ? <AlertTriangle size={15} className="shrink-0 text-amber-400" aria-hidden="true" />
            : waitingCard ? <ShieldCheck size={15} className="shrink-0 text-gold" aria-hidden="true" />
            : <Loader2 size={15} className="shrink-0 animate-spin text-gold" aria-hidden="true" />}
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {head}
            {others > 0 && <span className="font-normal text-muted"> · +{others} more running</span>}
          </p>
          {canStop && (
            <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:bg-panel2 hover:text-ink disabled:opacity-50" disabled={busy} onClick={() => void act({ action: "stop", runId: r.id })} aria-label="Stop this task"><Square size={11} aria-hidden="true" />Stop</button>
          )}
          {r.status === "error" && (
            <button className="rounded-md p-1 text-muted hover:bg-panel2 hover:text-ink" onClick={() => setDismissed((d) => [...d, r.id])} aria-label="Close"><X size={13} aria-hidden="true" /></button>
          )}
        </div>

        {(r.status === "running" || r.status === "queued") && (
          <>
            {line && <p className={`mt-1 truncate text-xs ${line.kind === "error" ? "text-red-400" : "text-muted"}`}>{line.text}</p>}
            {live?.text
              ? <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink"><Markdown text={live.text} /></div>
              : r.status === "running" && !line && <p className="mt-1 text-xs text-muted">Thinking…</p>}
          </>
        )}

        {waitingCard && <PendingCard run={r} busy={busy} act={act} />}

        {r.status === "budget" && (
          <div className="mt-1.5 space-y-2">
            <p className="text-xs text-muted">{r.error?.message || "A limit is holding this task."}</p>
            {r.error?.code === "cost" && (
              <button className={btnMain} disabled={busy} onClick={() => void act({ action: "continue", runId: r.id })}><RotateCcw size={13} aria-hidden="true" />Continue</button>
            )}
          </div>
        )}

        {r.status === "error" && (
          <p className="mt-1.5 break-words text-xs text-red-400">{r.error?.message || "The task failed. Send your message again."}</p>
        )}

        {err && <p className="mt-2 break-words text-xs text-red-400">{err}</p>}
      </div>
    </div>
  );
}
