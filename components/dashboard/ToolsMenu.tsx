"use client";
// The list behind the three dots in the chat header: every tool of the agent in one clean, searchable list.
// The same list is shown inside a bottom sheet on a phone and inside a popover on a computer.
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";

export type ToolTone = "gold" | "violet" | "teal" | "sky" | "coral";

export type ToolItem = {
  key: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  tone: ToolTone;
  onClick: () => void;
  /** a small glowing dot: something is on / running */
  dot?: boolean;
  /** the tool is open right now */
  active?: boolean;
  /** extra words the search should also match */
  words?: string;
};

export type ToolGroup = { title: string; items: ToolItem[] };

const TONE: Record<ToolTone, string> = {
  gold: "bg-gold/15 text-gold",
  violet: "bg-avatar-violet/15 text-avatar-violet",
  teal: "bg-avatar-teal/15 text-avatar-teal",
  sky: "bg-avatar-sky/15 text-avatar-sky",
  coral: "bg-avatar-coral/15 text-avatar-coral",
};

export default function ToolsMenu({
  groups,
  onPick,
  footer,
  compact = false,
}: {
  groups: ToolGroup[];
  /** called after a tool was chosen (so the sheet / popover can close first) */
  onPick: (fn: () => void) => void;
  footer?: React.ReactNode;
  /** popover on a computer: tighter rows */
  compact?: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const shown = useMemo(() => {
    if (!needle) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => `${i.label} ${i.hint} ${i.words ?? ""}`.toLowerCase().includes(needle)),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, needle]);

  let n = 0;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-2xl border border-line bg-bg/60 px-3 py-2.5">
        <Search size={15} className="shrink-0 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tools"
          aria-label="Search tools"
          className="w-full bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none md:text-sm"
        />
      </div>

      {shown.length === 0 && <p className="px-2 py-6 text-center text-sm text-faint">No tool matches “{q}”.</p>}

      {shown.map((g) => (
        <section key={g.title} className="mb-3 last:mb-1">
          <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-faint">{g.title}</p>
          <div className="overflow-hidden rounded-2xl border border-line bg-panel/70">
            {g.items.map((it, idx) => {
              const delay = 30 + n++ * 28;
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => onPick(it.onClick)}
                  style={{ animationDelay: `${delay}ms` }}
                  className={`tile-in press relative flex w-full items-center gap-3 px-3 text-left transition-colors hover:bg-panel2/70 ${
                    compact ? "py-2" : "py-3"
                  } ${idx > 0 ? "border-t border-line/70" : ""} ${it.active ? "bg-panel2/80" : ""}`}
                >
                  <span
                    className={`relative flex shrink-0 items-center justify-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px] ${
                      compact ? "h-9 w-9" : "h-10 w-10"
                    } ${TONE[it.tone]}`}
                  >
                    {it.icon}
                    {it.dot && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-gold shadow-[0_0_8px_rgba(231,178,77,0.9)] ring-2 ring-panel" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{it.label}</span>
                    <span className="block truncate text-[12px] text-muted">{it.hint}</span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-faint" />
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {footer}
    </div>
  );
}
