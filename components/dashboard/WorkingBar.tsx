"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Shows the moment you send a message: what the agent is doing right now, a live timer, and the full step list. */
export default function WorkingBar({ label, startedAt, steps }: { label: string; startedAt: number; steps: string[] }) {
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-2">
      <div className="rounded-xl border border-line bg-panel">
        <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left" aria-expanded={open}>
          <span className="flex shrink-0 gap-1" aria-hidden="true">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold [animation-delay:200ms]" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
          <span className="shrink-0 font-mono text-xs text-muted">{mmss(now - startedAt)}</span>
          <ChevronDown size={15} className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="max-h-52 space-y-1 overflow-y-auto border-t border-line px-4 py-2.5 text-xs leading-relaxed text-muted">
            {steps.slice(-40).map((s, i, a) => (
              <p key={i} className={i === a.length - 1 ? "text-ink" : ""}>
                <span className="mr-2 text-faint">{i === a.length - 1 ? "▸" : "✓"}</span>{s}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}