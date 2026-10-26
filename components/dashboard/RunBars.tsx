"use client";

import { useEffect } from "react";
import { Code2, Film, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { beginActivity } from "@/lib/avatar-activity";

const CSS = `
@keyframes rb-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes rb-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes rb-slide { 0% { transform: translateX(-120%); } 100% { transform: translateX(380%); } }
@keyframes rb-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
.rb-card { animation: rb-in .28s cubic-bezier(.2,.8,.2,1) both; }
.rb-shimmer {
  background: linear-gradient(90deg, #8B8A90 0%, #8B8A90 38%, #F1F0EC 50%, #8B8A90 62%, #8B8A90 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: rb-shimmer 2.4s linear infinite;
}
.rb-slide { animation: rb-slide 1.6s cubic-bezier(.4,0,.2,1) infinite; }
.rb-icon { animation: rb-pulse 2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .rb-card, .rb-slide, .rb-icon, .rb-shimmer { animation: none !important; }
  .rb-shimmer { -webkit-text-fill-color: #F1F0EC; color: #F1F0EC; background: none; }
}
`;

function Card({
  icon: Icon, kind, title, label, value, children,
}: {
  icon: LucideIcon; kind: string; title?: string; label?: string; value?: number | null; children?: React.ReactNode;
}) {
  const hasBar = value !== undefined;
  const pct = typeof value === "number" ? Math.max(0, Math.min(100, Math.round(value * 100))) : null;
  return (
    <div className="rb-card relative overflow-hidden rounded-2xl border border-line bg-panel px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="rb-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-goldSoft text-gold">
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-medium text-ink">
              {kind}{title ? <span className="font-normal text-muted"> · {title}</span> : null}
            </p>
            {hasBar && <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{pct === null ? "…" : `${pct}%`}</span>}
          </div>
          {label ? <p className="rb-shimmer mt-0.5 block truncate text-xs">{label}</p> : null}
          {children}
        </div>
      </div>
      {hasBar && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-panel2">
          {pct === null ? (
            <div className="rb-slide h-full w-1/4 rounded-full bg-gradient-to-r from-transparent via-gold to-transparent" />
          ) : (
            <div className="h-full rounded-full bg-gold transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          )}
        </div>
      )}
    </div>
  );
}

export default function RunBars({
  venusRun, codeRun, teamRun,
}: {
  venusRun: { title: string; label: string; value: number | null } | null;
  codeRun: { title: string; label: string } | null;
  teamRun: string | null;
}) {
  const active = Boolean(venusRun || codeRun || teamRun);

  // while a video / code / team run is showing, the agent avatars show the "under pressure" look
  useEffect(() => {
    if (!active) return;
    return beginActivity();
  }, [active]);

  if (!active) return null;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-2 px-6 pb-2">
      <style>{CSS}</style>
      {venusRun && <Card icon={Film} kind="Venus Pro" title={venusRun.title} label={venusRun.label} value={venusRun.value} />}
      {codeRun && (
        <Card icon={Code2} kind="Venus Code" title={codeRun.title} label={codeRun.label} value={null} />
      )}
      {teamRun && (
        <Card icon={Users} kind="Team working" title={teamRun}>
          <p className="mt-0.5 truncate text-xs text-muted">Team panel kholo, wahan live dikh raha hai.</p>
        </Card>
      )}
    </div>
  );
}
