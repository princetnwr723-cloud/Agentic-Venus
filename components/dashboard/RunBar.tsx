"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { beginActivity } from "@/lib/avatar-activity";
import { fmtDur } from "@/lib/steps";
import { DONE, NOW, kindOf, type RunKind } from "@/lib/run-label";

const CSS = `
@keyframes rb-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes rb-dot { 0%, 100% { opacity: .3; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }
@keyframes rb-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.rb-in { animation: rb-in .22s cubic-bezier(.2,.8,.2,1) both; }
.rb-dot { display: block; border-radius: 9999px; background: #D97757; animation: rb-dot 1.3s ease-in-out infinite; }
.rb-text {
  background: linear-gradient(90deg, #8B8A90 0%, #8B8A90 38%, #F1F0EC 50%, #8B8A90 62%, #8B8A90 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: rb-shimmer 2.6s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .rb-in, .rb-dot, .rb-text { animation: none !important; }
  .rb-text { -webkit-text-fill-color: #8B8A90; color: #8B8A90; background: none; }
}
`;

type Entry = { kind: RunKind; at: number };

/**
 * The one run bar. It sits INSIDE the chat, right under the last message (not above the message box), and shows only
 * a short generic line: "Running a command", "Working", "Thinking" ... with a live timer. Opening it lists the same
 * generic lines for what already happened. Video / code / team runs and the normal "agent is working" state all use it,
 * so no product name ("Venus Pro", "Venus Code") and no internal step text ever shows up.
 */
export default function RunBar({
  work, venusRun, codeRun, teamRun,
}: {
  work?: { label: string; startedAt: number; owner: string } | null;
  venusRun: unknown | null;
  codeRun: unknown | null;
  teamRun: string | null;
}) {
  const mountedAt = useRef(Date.now()).current;
  const start = Math.min(work?.startedAt ?? Infinity, mountedAt);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const kind: RunKind = work
    ? kindOf(work.owner, work.label)
    : teamRun ? "team"
      : codeRun ? "command"
        : venusRun ? "work"
          : "work";
  // a new row for every new step of the same work; runs without steps (video / code / team) only when the kind changes
  const stepKey = work ? `${kind}|${work.label}` : kind;

  const [log, setLog] = useState<Entry[]>(() => [{ kind, at: Date.now() }]);
  const lastKey = useRef(stepKey);
  useEffect(() => {
    if (lastKey.current === stepKey) return;
    lastKey.current = stepKey;
    setLog((l) => [...l.slice(-39), { kind, at: Date.now() }]);
  }, [stepKey, kind]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // while the bar is on screen the agent avatars show the "working" look
  useEffect(() => beginActivity(), []);

  // it lives at the end of the chat: bring it into view when it appears
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  useEffect(() => {
    if (open) rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, log.length]);

  const time = fmtDur(now - start) || "0s";

  return (
    <div ref={rootRef} role="status" aria-live="polite" className="rb-in scroll-mb-6 pt-4">
      <style>{CSS}</style>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group inline-flex max-w-full items-center gap-3 py-1 text-left"
      >
        <span className="flex w-[26px] shrink-0 items-center gap-[5px]" aria-hidden="true">
          <span className="rb-dot h-[6px] w-[6px]" />
          <span className="rb-dot h-[5px] w-[5px]" style={{ animationDelay: "180ms" }} />
          <span className="rb-dot h-[5px] w-[5px]" style={{ animationDelay: "360ms" }} />
        </span>
        <span className="rb-text min-w-0 truncate text-[15px]">{NOW[kind]}</span>
        <span className="shrink-0 text-[15px] tabular-nums text-muted">{time}</span>
        <ChevronDown size={14} className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="rb-in ml-[38px] mt-2 max-h-64 overflow-y-auto rounded-2xl border border-line bg-panel">
          {log.map((e, i) => {
            const last = i === log.length - 1;
            return (
              <div key={`${e.at}-${i}`} className={`px-3.5 py-2.5 text-sm ${last ? "text-ink" : "text-muted"} ${i > 0 ? "border-t border-line" : ""}`}>
                {last ? NOW[e.kind] : DONE[e.kind]}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}