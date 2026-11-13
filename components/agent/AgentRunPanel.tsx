"use client";

import { useEffect, useRef, useState } from "react";
import { agentApi, usd, watchEvents, watchLive, watchRun, type RunEvent, type RunView } from "@/lib/agent/client";
import { friendlyError, statusText, visibleEvents } from "@/lib/agent/friendly";

const tone: Record<string, string> = { queued: "bg-gold", running: "bg-gold", paused: "bg-avatar-teal", done: "bg-avatar-teal", error: "bg-red-400", stopped: "bg-faint", budget: "bg-red-400" };

export default function AgentRunPanel({ uid, runId, compact = false }: { uid: string; runId: string; compact?: boolean }) {
  const [run, setRun] = useState<RunView | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [typing, setTyping] = useState<{ text: string; round: number } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [details, setDetails] = useState(false);
  const beatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { const a = watchRun(uid, runId, setRun), b = watchEvents(uid, runId, setEvents, compact ? 6 : 80), c = watchLive(uid, runId, setTyping); return () => { a(); b(); c(); }; }, [uid, runId, compact]);

  const pending = run?.status === "paused" ? run.pending : null;
  const taking = pending?.kind === "request_takeover" && run?.takeover?.status === "active";

  // While the owner controls the screen, tell the server every 20 s that someone is watching (it hands back after 90 s of silence).
  useEffect(() => {
    if (!taking || !pending) return;
    const send = () => agentApi(uid, { action: "takeover_beat", runId, pendingId: pending.id }).catch(() => {});
    beatRef.current = setInterval(send, 20_000);
    return () => { if (beatRef.current) clearInterval(beatRef.current); };
  }, [taking, pending?.id, uid, runId]);

  // A run held by a limit that resets by itself goes on without a click: the scheduler wakes it, and this open panel does too.
  const resumeAt = run?.status === "budget" && run.error?.code !== "cost" ? run.resumeAt ?? null : null;
  useEffect(() => {
    if (!resumeAt) return;
    const t = setTimeout(() => { void agentApi(uid, { action: "continue", runId }).catch(() => {}); }, Math.max(0, resumeAt - Date.now()) + 3000);
    return () => clearTimeout(t);
  }, [resumeAt, uid, runId]);

  async function act(body: Record<string, unknown>) {
    setBusy(true); setErr("");
    try { await agentApi(uid, { runId, pendingId: pending?.id, ...body }); setText(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed."); }
    finally { setBusy(false); }
  }

  if (!run) return <div className="rounded-lg border border-line bg-panel p-4 text-sm text-muted">Loading run…</div>;
  const live = run.status === "queued" || run.status === "running";
  const btn = "rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-bg disabled:opacity-50";
  const primary = "rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50";

  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className={`h-2 w-2 shrink-0 rounded-full ${tone[run.status]}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-ink">{run.task}</div>
          <div className="text-[11px] text-faint">{statusText(run.status, run.round, run.error, run.resumeAt)}{run.autoApprove ? " · Auto" : ""}</div>
        </div>
        {(live || run.status === "paused") && <button className={btn} disabled={busy} onClick={() => act({ action: "stop" })}>Stop</button>}
        {run.status === "budget" && run.error?.code === "cost" && <button className={primary} disabled={busy} onClick={() => act({ action: "continue" })}>Allow more</button>}
      </div>

      {pending && (
        <div className="m-3 rounded-md border border-gold/60 bg-bg p-3">
          <div className="text-[11px] uppercase tracking-wide text-gold">{pending.kind === "ask_user" ? "Question" : pending.kind === "request_secret" ? "Secret needed" : pending.kind === "request_takeover" ? "Take over" : "Approval needed"}</div>
          <div className="mt-1 text-sm text-ink">{pending.question || pending.summary}</div>
          {pending.tainted && <div className="mt-1 text-xs text-red-400">The agent has read untrusted web or file content in this run. Check the action carefully.</div>}
          {pending.args && <pre className="mt-2 max-h-40 overflow-auto rounded bg-panel p-2 text-[11px] text-muted">{JSON.stringify(pending.args, null, 2)}</pre>}

          {pending.kind === "ask_user" && (
            <div className="mt-2 space-y-2">
              {pending.options?.length ? <div className="flex flex-wrap gap-2">{pending.options.map((o) => <button key={o} className={btn} disabled={busy} onClick={() => act({ action: "reply", reply: "answer", text: o })}>{o}</button>)}</div> : null}
              <div className="flex gap-2"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" className="flex-1 rounded-md border border-line bg-panel px-2 py-1.5 text-sm text-ink" />
                <button className={primary} disabled={busy || !text.trim()} onClick={() => act({ action: "reply", reply: "answer", text })}>Send</button></div>
            </div>
          )}
          {pending.kind === "request_secret" && (
            <div className="mt-2 flex gap-2"><input type="password" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder={pending.secretName || "value"} className="flex-1 rounded-md border border-line bg-panel px-2 py-1.5 text-sm text-ink" />
              <button className={primary} disabled={busy || !text} onClick={() => act({ action: "reply", reply: "secret", value: text })}>Save to vault</button></div>
          )}
          {(pending.kind === "approve_tool" || pending.kind === "request_approval") && (
            <div className="mt-2 flex gap-2"><button className={primary} disabled={busy} onClick={() => act({ action: "reply", reply: "approve" })}>Approve</button><button className={btn} disabled={busy} onClick={() => act({ action: "reply", reply: "deny" })}>Deny</button></div>
          )}
          {pending.kind === "request_takeover" && (
            <div className="mt-2 flex flex-wrap gap-2">
              {!taking ? <button className={primary} disabled={busy} onClick={() => act({ action: "takeover_start" })}>Take control</button> : <button className={primary} disabled={busy} onClick={() => act({ action: "takeover_handback", note: text })}>Hand back to agent</button>}
              {!taking && <button className={btn} disabled={busy} onClick={() => act({ action: "reply", reply: "deny" })}>Decline</button>}
              {taking && <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Note for the agent (optional)" className="min-w-[12rem] flex-1 rounded-md border border-line bg-panel px-2 py-1.5 text-xs text-ink" />}
              {taking && <span className="self-center text-[11px] text-faint">Control ends after 15 min or 90 s without this page open.</span>}
            </div>
          )}
          <div className="mt-2 text-[11px] text-faint">Expires {new Date(pending.expiresAt).toLocaleString()}</div>
        </div>
      )}

      {run.status === "budget" && run.error && <div className="mx-3 mt-3 rounded-md border border-line p-3 text-xs text-muted">{friendlyError(run.error.code, run.error.message)}</div>}
      {run.status === "error" && run.error && <div className="mx-3 mt-3 rounded-md border border-red-400/50 p-3 text-xs text-red-400">{friendlyError(run.error.code, run.error.message)}</div>}
      {run.status === "done" && run.result && <div className="mx-3 mt-3 whitespace-pre-wrap rounded-md border border-line p-3 text-sm text-ink">{run.result}</div>}
      {err && <div className="mx-3 mt-2 text-xs text-red-400">{err}</div>}

      {typing && typing.text && (run.status === "running" || run.status === "queued") && (
        <div className="mx-3 mt-3 whitespace-pre-wrap rounded-md border border-line bg-bg p-3 text-sm text-ink">{typing.text}<span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-gold align-middle" /></div>
      )}

      <div className={`${compact ? "max-h-28" : "max-h-72"} space-y-1 overflow-auto px-4 py-3`}>
        {(() => {
          const lines = visibleEvents(events, compact ? 3 : 8);
          return lines.length === 0 ? <div className="text-xs text-faint">{live ? "Working on it…" : ""}</div>
            : lines.map((l) => <div key={l.id} className="text-[12px] text-muted">{l.text}</div>);
        })()}
        <button className="pt-1 text-[11px] text-faint underline-offset-2 hover:underline" onClick={() => setDetails((v) => !v)}>{details ? "Hide details" : "Details"}</button>
        {details && (
          <div className="mt-1 space-y-1 rounded-md border border-line bg-bg p-2">
            <div className="text-[11px] text-faint">{run.model} · ~{usd(run.costMicros)} · {Math.max(0, Number(run.usage?.inTok) || 0) + Math.max(0, Number(run.usage?.outTok) || 0)} tokens · {run.calls} model calls</div>
            {events.map((e) => <div key={e.id} className="break-words text-[11px] text-faint"><span className="mr-1">{e.kind}</span>{e.text}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
