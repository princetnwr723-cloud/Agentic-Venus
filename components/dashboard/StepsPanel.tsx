"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { AlertTriangle, Check, ChevronDown, ListChecks, Minus, Play, RotateCcw, Users, X } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { dock, useDockEl } from "@/lib/dock";
import {
  fmtDur, fromPlan, fromTeamRun, isRelevant, retryText, summarize,
  type PlanDoc, type RunSummary, type RunView, type StepView, type TeamRunDoc,
} from "@/lib/steps";

const CSS = `
@keyframes sp-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes sp-spin { to { transform: rotate(360deg); } }
@keyframes sp-slide { 0% { transform: translateX(-120%); } 100% { transform: translateX(380%); } }
.sp-card { animation: sp-in .25s cubic-bezier(.2,.8,.2,1) both; }
.sp-spin { animation: sp-spin .9s linear infinite; }
.sp-slide { animation: sp-slide 1.8s cubic-bezier(.4,0,.2,1) infinite; }
@media (prefers-reduced-motion: reduce) { .sp-card, .sp-spin, .sp-slide { animation: none !important; } }
`;

/** Needs attention (paused, partly done, broken) = open by default; running or finished = one tidy line. */
const defaultOpen = (s: RunSummary) => s.state === "paused" || s.state === "partial" || s.state === "broken";

function headline(v: RunView, s: RunSummary): string {
  switch (s.state) {
    case "running": {
      const cur = v.steps.find((x) => x.n === s.current);
      return `Step ${s.current ?? s.total} of ${s.total}${cur ? ` · ${cur.title}` : ""}`;
    }
    case "paused": return `Ruka hua · ${s.done}/${s.total} ho chuke`;
    case "done": return `Poora hua · ${s.total}/${s.total}`;
    case "partial": return `${s.done} hue · ${s.failed + s.skipped} nahi ho paye`;
    default: return s.brokeAt ? `Step ${s.brokeAt.n} par toota` : "Toota";
  }
}

function Dot({ status, live }: { status: StepView["status"]; live: boolean }) {
  const base = "relative z-10 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border";
  if (status === "done") return <span className={`${base} border-avatar-sage/40 bg-panel2`}><Check size={11} strokeWidth={3} className="text-avatar-sage" /></span>;
  if (status === "failed") return <span className={`${base} border-red-500/60 bg-red-950/60`}><X size={11} strokeWidth={3} className="text-red-300" /></span>;
  if (status === "skipped") return <span className={`${base} border-line bg-panel2`}><Minus size={11} strokeWidth={3} className="text-faint" /></span>;
  if (status === "active") {
    return (
      <span className={`${base} border-gold/60 bg-goldSoft`}>
        {live ? <span className="sp-spin block h-2.5 w-2.5 rounded-full border-[1.5px] border-gold border-t-transparent" /> : <Play size={9} className="ml-px text-gold" />}
      </span>
    );
  }
  return <span className={`${base} border-line bg-bg`}><span className="block h-1.5 w-1.5 rounded-full bg-line" /></span>;
}

function Row({ st, live, now }: { st: StepView; live: boolean; now: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const active = st.status === "active";
  useEffect(() => { if (active && live) ref.current?.scrollIntoView({ block: "nearest" }); }, [active, live]);
  const took =
    st.startedAt && st.endedAt ? fmtDur(st.endedAt - st.startedAt)
      : st.startedAt && active && live ? fmtDur(now - st.startedAt)
        : "";
  const tone =
    st.status === "failed" ? "text-red-300"
      : st.status === "active" ? "text-ink"
        : st.status === "pending" ? "text-faint"
          : "text-muted";
  return (
    <li ref={ref} className="relative flex items-start gap-3 py-1">
      <Dot status={st.status} live={live} />
      <div className="min-w-0 flex-1">
        <p className={`break-words text-[13px] leading-relaxed ${tone} ${st.status === "skipped" ? "line-through decoration-faint/60" : ""}`}>
          <span className="mr-1.5 font-mono text-[11px] text-faint">{st.n}.</span>
          {st.who && <span className="mr-1.5 inline-flex items-center gap-1 rounded-full bg-panel2 px-1.5 py-px align-middle text-[10px] text-muted"><Users size={9} aria-hidden="true" />{st.who}</span>}
          {st.title}
        </p>
        {st.note && st.status === "failed" && (
          <p className="mt-1 rounded-md border border-red-900/50 bg-red-950/40 px-2 py-1 text-[11px] leading-relaxed text-red-300">Yahan toota: {st.note}</p>
        )}
        {st.note && st.status !== "failed" && <p className="mt-0.5 line-clamp-2 break-words text-[11px] leading-relaxed text-faint">{st.note}</p>}
      </div>
      {took && <span className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-faint">{took}</span>}
    </li>
  );
}

function Card({ v, s, now, open, onToggle, onDismiss, onRun, busy }: {
  v: RunView; s: RunSummary; now: number; open: boolean;
  onToggle: () => void; onDismiss: () => void; onRun: (text: string) => void; busy: boolean;
}) {
  const live = s.state === "running";
  const bad = s.state === "broken" || s.state === "partial";
  const bar = bad ? "bg-red-400" : s.state === "done" ? "bg-avatar-sage" : "bg-gold";
  const retryAt = s.brokeAt?.n ?? s.current ?? 1;
  const canAct = !busy && !live;
  return (
    <div className={`sp-card relative overflow-hidden rounded-2xl border bg-panel ${bad ? "border-red-900/60" : "border-line"}`}>
      <div className="flex items-center">
        <button onClick={onToggle} aria-expanded={open} className="group flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-panel2/60">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${bad ? "border-red-500/40 bg-red-950/50 text-red-300" : "border-gold/30 bg-goldSoft text-gold"}`}>
            {bad ? <AlertTriangle size={14} aria-hidden="true" /> : <ListChecks size={14} aria-hidden="true" />}
          </span>
          <span className="min-w-0 flex-1" role="status" aria-live="polite">
            <span className="block truncate text-sm font-medium text-ink">
              Progress<span className="font-normal text-muted"> · {v.source === "team" ? "Team" : v.title}</span>
            </span>
            <span className={`block truncate text-xs ${bad ? "text-red-300" : "text-muted"}`}>{headline(v, s)}</span>
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{s.pct}%</span>
          <ChevronDown size={15} className={`shrink-0 text-faint transition-transform duration-200 group-hover:text-muted ${open ? "rotate-180" : ""}`} />
        </button>
        {!live && (
          <button onClick={onDismiss} title="Hide" aria-label="Hide progress" className="mr-2 shrink-0 rounded-md p-1.5 text-faint hover:bg-panel2 hover:text-ink">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="mx-3.5 mb-2.5 h-1 overflow-hidden rounded-full bg-panel2">
        {live && s.pct === 0 ? (
          <div className="sp-slide h-full w-1/4 rounded-full bg-gradient-to-r from-transparent via-gold to-transparent" />
        ) : (
          <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${bar}`} style={{ width: `${s.pct}%` }} />
        )}
      </div>

      {open && (
        <div className="border-t border-line">
          <div className="max-h-[28vh] overflow-y-auto px-3.5 py-2.5">
            <ol className="relative space-y-0.5">
              <span className="absolute bottom-3 left-[9px] top-3 w-px bg-line" aria-hidden="true" />
              {v.steps.map((st) => <Row key={st.n} st={st} live={live} now={now} />)}
            </ol>
          </div>

          {(s.brokeAt || s.state === "paused") && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-2">
              <p className={`min-w-0 flex-1 text-xs ${s.brokeAt ? "text-red-300" : "text-muted"}`}>
                {s.brokeAt
                  ? `Step ${s.brokeAt.n} yahan toota. Baaki steps ${s.state === "broken" ? "chale nahi" : "apni jagah hain"}.`
                  : "Kaam beech me ruka hai. Wahin se aage badhne ke liye dabao."}
              </p>
              <button
                disabled={!canAct}
                onClick={() => onRun(retryText(v, retryAt))}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <RotateCcw size={12} /> {s.brokeAt ? `Step ${retryAt} se dobara` : `Step ${retryAt} se continue`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The "Progress" panel: every step of the work (the agent's checklist and the team's plan), which one is running now,
 * how long each took, and exactly which step broke. It reads the live data, so it works in a plain chat, in team mode
 * and after a refresh.
 */
export default function StepsPanel({ chatId, busy, onRun }: { chatId: string; busy: boolean; onRun: (text: string) => void }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const [plan, setPlan] = useState<PlanDoc | null>(null);
  const [run, setRun] = useState<TeamRunDoc | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [userOpen, setUserOpen] = useState<Record<string, boolean>>({});
  const dockEl = useDockEl();

  useEffect(() => {
    setPlan(null); setRun(null); setHidden({}); setUserOpen({});
    if (!uid || !chatId) return;
    const stopChat = onSnapshot(
      doc(db, "users", uid, "chats", chatId),
      (s) => setPlan(((s.data() as { plan?: PlanDoc } | undefined)?.plan) ?? null),
      () => setPlan(null),
    );
    const stopTeam = onSnapshot(
      doc(db, "users", uid, "teams", chatId),
      (s) => setRun(s.exists() ? (((s.data() as { run?: TeamRunDoc }).run) ?? null) : null),
      () => setRun(null),
    );
    return () => { stopChat(); stopTeam(); };
  }, [uid, chatId]);

  const items = useMemo(() => {
    const list: Array<{ v: RunView; s: RunSummary }> = [];
    const a = fromPlan(plan, now);
    if (a) list.push({ v: a, s: summarize(a, busy) });
    const t = fromTeamRun(run, now);
    if (t) list.push({ v: t, s: summarize(t, busy) });
    return list
      .filter(({ v, s }) => isRelevant(v, s, now) && !hidden[v.key])
      .sort((x, y) => (x.s.state === "running" ? 0 : 1) - (y.s.state === "running" ? 0 : 1) || y.v.updatedAt - x.v.updatedAt);
  }, [plan, run, busy, now, hidden]);

  const ticking = items.some((x) => x.s.state === "running");
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  // when nothing is live the clock still moves forward now and then, so finished cards expire and stale runs show as broken
  useEffect(() => {
    if (ticking) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [ticking]);

  // tells the run cards that the team is already shown here, so it is not shown twice
  const teamRunning = items.some((x) => x.v.source === "team" && x.s.state === "running");
  useEffect(() => {
    dock.setTeamShown(teamRunning);
    return () => dock.setTeamShown(false);
  }, [teamRunning]);

  if (!items.length) return null;
  const cards = (
    <div className="space-y-2">
      <style>{CSS}</style>
      {items.map(({ v, s }) => (
        <Card
          key={v.source}
          v={v} s={s} now={now} busy={busy}
          open={userOpen[v.source] ?? defaultOpen(s)}
          onToggle={() => setUserOpen((o) => ({ ...o, [v.source]: !(o[v.source] ?? defaultOpen(s)) }))}
          onDismiss={() => setHidden((h) => ({ ...h, [v.key]: true }))}
          onRun={onRun}
        />
      ))}
    </div>
  );
  // normally it sits in the activity dock above the message box (one capped area); without a dock it stays under the messages
  return dockEl
    ? createPortal(<div className="mx-auto w-full max-w-2xl px-6 pb-2">{cards}</div>, dockEl)
    : <div className="pt-2">{cards}</div>;
}
