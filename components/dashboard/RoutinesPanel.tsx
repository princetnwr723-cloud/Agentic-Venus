"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Clock, Copy, History, Link2, LoaderCircle, Pencil, Play, Plus, Square, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getRoutine, updateRoutine, type NotifyPolicy, type Routine, type RoutineMode } from "@/lib/routines";
import { approxMinutes, effectiveSchedule } from "@/lib/routines-core";
import { describeSchedule, formatLocal, isValidTz, occurrences, pad2, validateSchedule, zonedToUtc, type Schedule } from "@/lib/schedule";

export type CreateInput = {
  name: string;
  instructions: string;
  everyMinutes: number;
  startAt: number;
} & Partial<Omit<Routine, "id" | "chatId" | "name" | "instructions" | "everyMinutes" | "nextRunAt" | "enabled">>;

type Run = {
  id: string; status: string; trigger: string; startedAt: number; finishedAt?: number; durationMs?: number;
  output?: string; error?: string; reason?: string; attempt?: number; mode?: string;
  delivered?: { chat: boolean; sent: string[]; failed: string[] };
};
type Kind = "every" | "daily" | "weekdays" | "weekly" | "monthly" | "cron" | "once";
type F = {
  name: string; instructions: string; kind: Kind; every: string; unit: "m" | "h" | "d"; time: string; days: number[]; dom: string; cron: string; once: string; tz: string;
  mode: RoutineMode; notify: NotifyPolicy; toChat: boolean; channels: string[]; allowWrites: boolean;
  qOn: boolean; qStart: string; qEnd: string; catchUp: "once" | "skip"; retries: string; cap: string; thenRun: string[];
};

const KINDS: Array<[Kind, string]> = [["every", "Every N"], ["daily", "Daily"], ["weekdays", "Weekdays"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["cron", "Cron"], ["once", "Once"]];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CHANNELS: Array<[string, string]> = [["telegram", "Telegram"], ["whatsapp", "WhatsApp"], ["sms", "SMS"], ["slackbot", "Slack"], ["email", "Email"], ["webhook", "Slack/Discord hook"]];
const ZONES = ["Asia/Kolkata", "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
const STATUS_TONE: Record<string, string> = { ok: "text-emerald-500", silent: "text-muted", error: "text-red-400", running: "text-gold", retrying: "text-orange-400", skipped: "text-faint", stopped: "text-muted" };

const box = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold";
const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-white bg-white text-bg" : "border-line text-muted hover:text-ink"}`;

function browserTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } }

function relativeTo(ms: number) {
  const diff = ms - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  const label = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

const blank = (tz: string): F => ({
  name: "", instructions: "", kind: "daily", every: "6", unit: "h", time: "09:00", days: [1], dom: "1", cron: "0 9 * * 1-5", once: "", tz,
  mode: "auto", notify: "always", toChat: true, channels: [], allowWrites: false,
  qOn: false, qStart: "22:00", qEnd: "07:00", catchUp: "once", retries: "3", cap: "50", thenRun: [],
});

function toForm(r: Routine, fallbackTz: string): F {
  const tz = r.tz || fallbackTz;
  const f = blank(tz);
  f.name = r.name; f.instructions = r.instructions; f.mode = r.mode ?? "auto"; f.notify = r.notify ?? "always";
  f.toChat = r.toChat !== false; f.channels = r.channels ?? []; f.allowWrites = r.allowWrites === true;
  f.catchUp = r.catchUp ?? "once"; f.retries = String(r.retries ?? 3); f.cap = String(r.maxRunsPerDay ?? 50); f.thenRun = r.thenRun ?? [];
  if (r.quiet) { f.qOn = true; f.qStart = r.quiet.start; f.qEnd = r.quiet.end; }
  const s = effectiveSchedule(r);
  if (s.kind === "every") {
    f.kind = "every";
    if (s.minutes % 1440 === 0) { f.every = String(s.minutes / 1440); f.unit = "d"; }
    else if (s.minutes % 60 === 0) { f.every = String(s.minutes / 60); f.unit = "h"; }
    else { f.every = String(s.minutes); f.unit = "m"; }
  } else if (s.kind === "at") {
    f.kind = "once"; f.once = formatLocal(s.at, tz).replace(" ", "T");
  } else {
    const p = s.expr.trim().split(/\s+/);
    f.kind = "cron"; f.cron = s.expr;
    if (p.length === 5 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1])) {
      f.time = `${pad2(Number(p[1]))}:${pad2(Number(p[0]))}`;
      if (p[2] === "*" && p[3] === "*" && p[4] === "*") f.kind = "daily";
      else if (p[2] === "*" && p[3] === "*" && p[4] === "1-5") f.kind = "weekdays";
      else if (p[2] === "*" && p[3] === "*" && /^[0-6](,[0-6])*$/.test(p[4])) { f.kind = "weekly"; f.days = p[4].split(",").map(Number); }
      else if (/^\d+$/.test(p[2]) && p[3] === "*" && p[4] === "*") { f.kind = "monthly"; f.dom = p[2]; }
    }
  }
  return f;
}

function buildSchedule(f: F, now: number): { schedule?: Schedule; error?: string } {
  if (!isValidTz(f.tz)) return { error: `Unknown timezone "${f.tz}".` };
  const [hh, mm] = f.time.split(":").map(Number);
  const hasTime = Number.isFinite(hh) && Number.isFinite(mm);
  let s: Schedule;
  switch (f.kind) {
    case "every": {
      const n = Math.round(Number(f.every));
      if (!n || n < 1) return { error: "Enter how often it should repeat." };
      s = { kind: "every", minutes: n * (f.unit === "m" ? 1 : f.unit === "h" ? 60 : 1440), anchor: now };
      break;
    }
    case "cron": s = { kind: "cron", expr: f.cron.trim(), tz: f.tz }; break;
    case "once": {
      const m = f.once.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
      if (!m) return { error: "Pick the date and time." };
      s = { kind: "at", at: zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], f.tz) };
      break;
    }
    default: {
      if (!hasTime) return { error: "Pick a time." };
      if (f.kind === "daily") s = { kind: "cron", expr: `${mm} ${hh} * * *`, tz: f.tz };
      else if (f.kind === "weekdays") s = { kind: "cron", expr: `${mm} ${hh} * * 1-5`, tz: f.tz };
      else if (f.kind === "weekly") {
        if (!f.days.length) return { error: "Pick at least one day." };
        s = { kind: "cron", expr: `${mm} ${hh} * * ${[...f.days].sort().join(",")}`, tz: f.tz };
      } else {
        const d = Math.round(Number(f.dom));
        if (!d || d < 1 || d > 31) return { error: "Day of the month must be 1-31." };
        s = { kind: "cron", expr: `${mm} ${hh} ${d} * *`, tz: f.tz };
      }
    }
  }
  const e = validateSchedule(s, now);
  return e ? { error: e } : { schedule: s };
}

export default function RoutinesPanel({
  open, onClose, chatName, routines, prefillInstructions, busyId, onCreate, onToggle, onDelete,
}: {
  open: boolean;
  onClose: () => void;
  chatName: string;
  routines: Routine[];
  prefillInstructions?: string | null;
  busyId?: string | null;
  onCreate: (input: CreateInput) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onRunNow?: (routine: Routine) => void; // kept for the old dashboard; "Run now" now runs on the server and shows its result here
}) {
  const { user } = useAuth();
  const [docs, setDocs] = useState<Record<string, Routine>>({});
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<Routine | null>(null);
  const [f, setF] = useState<F>(() => blank("UTC"));
  const [advanced, setAdvanced] = useState(false);
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [hooks, setHooks] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const routinesRef = useRef(routines);
  routinesRef.current = routines;
  const ids = routines.map((r) => r.id).join(",");
  const list = useMemo(() => routines.map((r) => (docs[r.id] ? { ...r, ...docs[r.id] } : r)), [routines, docs]);
  const built = useMemo(() => buildSchedule(f, Date.now()), [f]);

  const api = useCallback(async (body: Record<string, unknown>) => {
    if (!user) throw new Error("Sign in again.");
    const res = await fetch("/api/routines/manage", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.reason || d.error || `Request failed (HTTP ${res.status}).`);
    return d;
  }, [user]);

  const refreshDocs = useCallback(async () => {
    if (!user) return;
    const fresh = await Promise.all(routinesRef.current.map((r) => getRoutine(user.uid, r.id).catch(() => null)));
    setDocs((prev) => { const n = { ...prev }; fresh.forEach((d) => { if (d) n[d.id] = d; }); return n; });
  }, [user]);

  const loadRuns = useCallback(async (id: string) => {
    try { const d = await api({ action: "runs", id }); setRuns((p) => ({ ...p, [id]: d.runs ?? [] })); } catch { /* shown on retry */ }
  }, [api]);

  useEffect(() => {
    if (!open || !user) return;
    refreshDocs();
    const iv = setInterval(refreshDocs, 6000);
    return () => clearInterval(iv);
  }, [open, user, ids, refreshDocs]);

  useEffect(() => {
    if (!open || !openRuns) return;
    loadRuns(openRuns);
    const iv = setInterval(() => loadRuns(openRuns), 6000);
    return () => clearInterval(iv);
  }, [open, openRuns, loadRuns]);

  useEffect(() => {
    if (open && prefillInstructions) {
      setEditing(null);
      setF({ ...blank(browserTz()), instructions: prefillInstructions, name: prefillInstructions.slice(0, 40) });
      setView("form");
    }
  }, [open, prefillInstructions]);

  if (!open) return null;

  const set = <K extends keyof F>(k: K, v: F[K]) => setF((p) => ({ ...p, [k]: v }));
  const toggleIn = (k: "days" | "channels" | "thenRun", v: number | string) =>
    setF((p) => { const a = p[k] as Array<number | string>; return { ...p, [k]: a.includes(v) ? a.filter((x) => x !== v) : [...a, v] } as F; });

  function close() { setView("list"); setEditing(null); setNote(null); onClose(); }
  function startNew() { setEditing(null); setF(blank(browserTz())); setAdvanced(false); setView("form"); setNote(null); }
  function startEdit(r: Routine) { setEditing(r); setF(toForm(r, browserTz())); setAdvanced(false); setView("form"); setNote(null); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!f.name.trim() || f.instructions.trim().length < 5) { setNote({ kind: "error", text: "Give it a name and say what to do on every run." }); return; }
    if (!built.schedule) { setNote({ kind: "error", text: built.error || "Check the schedule." }); return; }
    const common = {
      name: f.name.trim(), instructions: f.instructions.trim(), tz: f.tz, mode: f.mode, notify: f.notify, toChat: f.toChat, channels: f.channels,
      allowWrites: f.allowWrites, catchUp: f.catchUp, retries: Number(f.retries) || 0, maxRunsPerDay: Number(f.cap) || 50, thenRun: f.thenRun,
    };
    setSaving(true); setNote(null);
    try {
      if (editing) {
        const cur = effectiveSchedule(editing);
        const same = cur.kind === "every" && built.schedule.kind === "every" ? cur.minutes === built.schedule.minutes : JSON.stringify(cur) === JSON.stringify(built.schedule);
        const fresh = await updateRoutine(user.uid, editing.id, { ...common, quiet: f.qOn ? { start: f.qStart, end: f.qEnd } : null, ...(same && editing.tz === f.tz ? {} : { schedule: built.schedule }) });
        if (fresh) setDocs((p) => ({ ...p, [fresh.id]: fresh }));
        setNote({ kind: "ok", text: "Saved." });
      } else {
        await onCreate({ ...common, ...(f.qOn ? { quiet: { start: f.qStart, end: f.qEnd } } : {}), schedule: built.schedule, everyMinutes: approxMinutes(built.schedule), startAt: Date.now() });
      }
      setView("list"); setEditing(null);
    } catch (err) {
      setNote({ kind: "error", text: err instanceof Error ? err.message : "Could not save." });
    } finally { setSaving(false); }
  }

  async function runNow(r: Routine) {
    setRunning(r.id); setNote(null);
    try {
      const d = await api({ action: "run_now", id: r.id });
      setNote({ kind: d.status === "error" ? "error" : "ok", text: d.status === "started" ? "Started. Follow it in History." : d.status === "retrying" || d.status === "error" ? `Failed: ${d.output ?? ""}` : "Done. The result is in History and in the chat." });
      setOpenRuns(r.id); await loadRuns(r.id); await refreshDocs();
    } catch (err) { setNote({ kind: "error", text: err instanceof Error ? err.message : "Could not run it." }); }
    finally { setRunning(null); }
  }

  async function stop(r: Routine) {
    try { const d = await api({ action: "stop", id: r.id }); setNote({ kind: "ok", text: d.message }); await refreshDocs(); }
    catch (err) { setNote({ kind: "error", text: err instanceof Error ? err.message : "Could not stop it." }); }
  }

  async function hook(r: Routine, o: { enable?: boolean; rotate?: boolean } = {}) {
    try {
      const d = await api({ action: "hook", id: r.id, enable: o.enable ?? true, rotate: o.rotate === true });
      setHooks((p) => { const n = { ...p }; if (d.url) n[r.id] = d.url; else delete n[r.id]; return n; });
      await refreshDocs();
    } catch (err) { setNote({ kind: "error", text: err instanceof Error ? err.message : "Could not change the link." }); }
  }

  const toggle = (r: Routine) => { onToggle(r.id, !r.enabled); setTimeout(refreshDocs, 900); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={close}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl2 border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-ink"><Clock size={15} /> Routines · {chatName}</h2>
          <button onClick={close} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={18} /></button>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted">Teach this agent something once, then let it repeat on a schedule: exact times in your timezone, retries, history, and approvals for anything risky.</p>
        {note && <p className={`mb-3 rounded-lg border px-3 py-2 text-xs ${note.kind === "ok" ? "border-emerald-500/30 text-emerald-500" : "border-red-400/30 text-red-400"}`}>{note.text}</p>}

        {view === "list" ? (
          <>
            {list.length === 0 ? (
              <p className="py-6 text-center text-xs text-faint">No routines yet for this chat. Tip: you can also just tell the agent “every weekday at 9 send me the news”.</p>
            ) : (
              <div className="space-y-2">
                {list.map((r) => {
                  const tz = r.tz || "UTC";
                  const status = r.lastStatus || (r.lastRunAt ? "ok" : "");
                  const active = Boolean(r.activeRunId) && (r.leaseUntil ?? 0) > Date.now();
                  return (
                    <div key={r.id} className="rounded-lg border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-ink">{r.name}</span>
                        <button onClick={() => toggle(r)} className={`h-5 w-9 shrink-0 rounded-full transition-colors ${r.enabled ? "bg-avatar-teal" : "bg-line"}`} title={r.enabled ? "Enabled: click to pause" : "Paused: click to enable"}>
                          <span className={`block h-4 w-4 translate-y-0.5 rounded-full bg-white transition-transform ${r.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                        </button>
                      </div>
                      <p className="mt-0.5 text-[11px] text-gold">{describeSchedule(effectiveSchedule(r), tz)}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{r.instructions}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                        <span>{r.enabled ? `next ${formatLocal(r.nextRunAt, tz)} (${relativeTo(r.nextRunAt)})` : "paused"}</span>
                        {r.lastRunAt ? <span>last {relativeTo(r.lastRunAt)}</span> : null}
                        {status ? <span className={STATUS_TONE[status] ?? "text-muted"}>{active ? "running…" : status}</span> : null}
                        {r.mode && r.mode !== "auto" ? <span>{r.mode}</span> : null}
                      </div>
                      {r.pausedReason && !r.enabled && <p className="mt-1 text-[11px] text-orange-400">{r.pausedReason}</p>}
                      {r.lastResult && <p className="mt-1 line-clamp-2 text-[11px] text-faint">↳ {r.lastResult}</p>}

                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                        <button onClick={() => runNow(r)} disabled={running === r.id || busyId === r.id || active} className="flex items-center gap-1 text-ink hover:underline disabled:opacity-50">
                          {running === r.id ? <LoaderCircle size={12} className="animate-spin" /> : <Play size={12} />} Run now
                        </button>
                        {active && <button onClick={() => stop(r)} className="flex items-center gap-1 text-orange-400 hover:underline"><Square size={12} /> Stop</button>}
                        <button onClick={() => setOpenRuns(openRuns === r.id ? null : r.id)} className="flex items-center gap-1 text-ink hover:underline"><History size={12} /> History {openRuns === r.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
                        <button onClick={() => startEdit(r)} className="flex items-center gap-1 text-ink hover:underline"><Pencil size={12} /> Edit</button>
                        <button onClick={() => hook(r)} className="flex items-center gap-1 text-ink hover:underline"><Link2 size={12} /> {r.hook ? "Webhook" : "Add webhook"}</button>
                        <button onClick={() => onDelete(r.id)} className="ml-auto text-faint hover:text-red-400" aria-label="Delete routine"><Trash2 size={13} /></button>
                      </div>

                      {hooks[r.id] && (
                        <div className="mt-2 rounded-lg border border-line bg-bg p-2">
                          <p className="mb-1 text-[11px] text-muted">POST to this link to run the routine (the body is passed in as event data). Keep it secret.</p>
                          <div className="flex items-center gap-2">
                            <code className="min-w-0 flex-1 truncate text-[11px] text-ink">{hooks[r.id]}</code>
                            <button onClick={() => navigator.clipboard?.writeText(hooks[r.id]).then(() => setNote({ kind: "ok", text: "Link copied." }))} className="text-muted hover:text-ink" aria-label="Copy"><Copy size={13} /></button>
                          </div>
                          <div className="mt-1.5 flex gap-3 text-[11px]">
                            <button onClick={() => hook(r, { rotate: true })} className="text-ink hover:underline">New link</button>
                            <button onClick={() => hook(r, { enable: false })} className="text-red-400 hover:underline">Switch off</button>
                          </div>
                        </div>
                      )}

                      {openRuns === r.id && (
                        <div className="mt-2 space-y-1.5 border-t border-line pt-2">
                          {!runs[r.id] ? <p className="text-[11px] text-faint">Loading…</p> : runs[r.id].length === 0 ? <p className="text-[11px] text-faint">No runs yet.</p> : runs[r.id].map((x) => (
                            <div key={x.id} className="rounded-md bg-bg px-2 py-1.5">
                              <button className="flex w-full items-center gap-2 text-left text-[11px]" onClick={() => setOpenRun(openRun === x.id ? null : x.id)}>
                                {x.status === "ok" || x.status === "silent" ? <CheckCircle2 size={12} className={STATUS_TONE[x.status]} /> : x.status === "running" ? <LoaderCircle size={12} className="animate-spin text-gold" /> : <CircleAlert size={12} className={STATUS_TONE[x.status] ?? "text-muted"} />}
                                <span className={STATUS_TONE[x.status] ?? "text-muted"}>{x.status}</span>
                                <span className="text-faint">{formatLocal(x.startedAt, tz)} · {x.trigger}{x.mode ? ` · ${x.mode}` : ""}{x.durationMs ? ` · ${Math.max(1, Math.round(x.durationMs / 1000))}s` : ""}</span>
                              </button>
                              {openRun === x.id && (
                                <div className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted">
                                  {x.error || x.reason || x.output || "(no output)"}
                                  {x.delivered && (x.delivered.chat || x.delivered.sent.length > 0) ? <p className="mt-1 text-faint">Sent to: {[x.delivered.chat ? "chat" : "", ...x.delivered.sent].filter(Boolean).join(", ")}</p> : null}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <button onClick={startNew} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:border-faint hover:text-ink">
              <Plus size={16} /> New routine
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Routine name" className={box} />
            <textarea value={f.instructions} onChange={(e) => set("instructions", e.target.value)} rows={3} placeholder="What should it do on every run? e.g. Check AI news and send me the 5 most important items with links." className={`${box} resize-none`} />

            <div>
              <p className="mb-1.5 text-xs text-muted">Repeat</p>
              <div className="flex flex-wrap gap-1.5">{KINDS.map(([k, label]) => <button type="button" key={k} onClick={() => set("kind", k)} className={chip(f.kind === k)}>{label}</button>)}</div>
              <div className="mt-2 space-y-2">
                {f.kind === "every" && (
                  <div className="flex gap-2">
                    <input type="number" min={1} value={f.every} onChange={(e) => set("every", e.target.value)} className={box} />
                    <select value={f.unit} onChange={(e) => set("unit", e.target.value as F["unit"])} className={`${box} w-32`}><option value="m">minutes</option><option value="h">hours</option><option value="d">days</option></select>
                  </div>
                )}
                {["daily", "weekdays", "weekly", "monthly"].includes(f.kind) && <input type="time" value={f.time} onChange={(e) => set("time", e.target.value)} className={box} />}
                {f.kind === "weekly" && <div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => <button type="button" key={d} onClick={() => toggleIn("days", i)} className={chip(f.days.includes(i))}>{d}</button>)}</div>}
                {f.kind === "monthly" && <input type="number" min={1} max={31} value={f.dom} onChange={(e) => set("dom", e.target.value)} placeholder="Day of the month (1-31)" className={box} />}
                {f.kind === "cron" && <input value={f.cron} onChange={(e) => set("cron", e.target.value)} placeholder="min hour day month weekday, e.g. 30 9 * * 1-5" className={`${box} font-mono`} />}
                {f.kind === "once" && <input type="datetime-local" value={f.once} onChange={(e) => set("once", e.target.value)} className={box} />}
                {f.kind !== "every" && <input list="venus-zones" value={f.tz} onChange={(e) => set("tz", e.target.value)} placeholder="Timezone, e.g. Asia/Kolkata" className={box} />}
                <datalist id="venus-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
              </div>
              <p className={`mt-1.5 text-[11px] ${built.schedule ? "text-muted" : "text-red-400"}`}>
                {built.schedule ? `${describeSchedule(built.schedule, f.tz)} → next: ${occurrences(built.schedule, Date.now(), 3).map((t) => formatLocal(t, f.tz)).join(" · ")}` : built.error}
              </p>
            </div>

            <button type="button" onClick={() => setAdvanced(!advanced)} className="flex items-center gap-1 text-xs text-muted hover:text-ink">{advanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Advanced</button>
            {advanced && (
              <div className="space-y-3 rounded-lg border border-line p-3">
                <div>
                  <p className="mb-1.5 text-xs text-muted">How it runs</p>
                  <div className="flex flex-wrap gap-1.5">{([["auto", "Auto"], ["lite", "Web research (fast)"], ["agent", "Full agent (tools)"]] as Array<[RoutineMode, string]>).map(([k, l]) => <button type="button" key={k} onClick={() => set("mode", k)} className={chip(f.mode === k)}>{l}</button>)}</div>
                  {(f.mode === "agent" || f.mode === "auto") && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={f.allowWrites} onChange={(e) => set("allowWrites", e.target.checked)} /> Allow it to write/send without asking each time (otherwise it pauses and asks you)</label>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-muted">Tell me</p>
                  <div className="flex flex-wrap gap-1.5">{([["always", "Every time"], ["changes", "Only when it changed"], ["smart", "Only when something is new"]] as Array<[NotifyPolicy, string]>).map(([k, l]) => <button type="button" key={k} onClick={() => set("notify", k)} className={chip(f.notify === k)}>{l}</button>)}</div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-muted">Send the result to</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => set("toChat", !f.toChat)} className={chip(f.toChat)}>This chat</button>
                    {CHANNELS.map(([k, l]) => <button type="button" key={k} onClick={() => toggleIn("channels", k)} className={chip(f.channels.includes(k))}>{l}</button>)}
                  </div>
                  <p className="mt-1 text-[11px] text-faint">Apps only receive it if they are connected to this chat.</p>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={f.qOn} onChange={(e) => set("qOn", e.target.checked)} /> Quiet hours (skip runs in this window)</label>
                  {f.qOn && <div className="mt-2 flex items-center gap-2"><input type="time" value={f.qStart} onChange={(e) => set("qStart", e.target.value)} className={box} /><span className="text-xs text-muted">to</span><input type="time" value={f.qEnd} onChange={(e) => set("qEnd", e.target.value)} className={box} /></div>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-[11px] text-muted">Retries<input type="number" min={0} max={5} value={f.retries} onChange={(e) => set("retries", e.target.value)} className={`${box} mt-1`} /></label>
                  <label className="text-[11px] text-muted">Max runs / day<input type="number" min={1} max={500} value={f.cap} onChange={(e) => set("cap", e.target.value)} className={`${box} mt-1`} /></label>
                  <label className="text-[11px] text-muted">If it was missed
                    <select value={f.catchUp} onChange={(e) => set("catchUp", e.target.value as F["catchUp"])} className={`${box} mt-1`}><option value="once">run once</option><option value="skip">skip</option></select>
                  </label>
                </div>
                {list.filter((r) => r.id !== editing?.id).length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs text-muted">After it succeeds, also run</p>
                    <div className="flex flex-wrap gap-1.5">{list.filter((r) => r.id !== editing?.id).map((r) => <button type="button" key={r.id} onClick={() => toggleIn("thenRun", r.id)} className={chip(f.thenRun.includes(r.id))}>{r.name.slice(0, 24)}</button>)}</div>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setView("list"); setEditing(null); setNote(null); }} className="flex-1 rounded-lg border border-line py-2.5 text-sm text-ink hover:bg-panel2">Back</button>
              <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-white py-2.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-60">{saving ? "Saving…" : editing ? "Save changes" : "Create routine"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}