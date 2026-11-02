"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Brain,
  ChevronRight,
  Clock,
  Code2,
  Film,
  KeyRound,
  Maximize2,
  Minimize2,
  Monitor,
  Plug,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import PaymentApprovals from "@/components/dashboard/PaymentApprovals";
import { avatarFor, getActiveChat, useAnyActivity, useAvatarStore } from "@/lib/avatar-activity";
import { parseAvatar, type AvatarColor } from "@/lib/bots";

type Tool = {
  key: string;
  label: string; // full name (tooltip + screen readers)
  short: string; // short name under the icon
  tone: string; // pastel accent of the icon chip
  Icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  dot?: boolean;
};

function Tile({ tool, open, onPick }: { tool: Tool; open: boolean; onPick: (t: Tool) => void }) {
  const { Icon } = tool;
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={open ? 0 : -1}
      title={tool.label}
      aria-label={tool.label}
      aria-pressed={tool.active}
      onClick={() => onPick(tool)}
      className="group flex flex-col items-center gap-1.5 rounded-2xl px-1 pb-2 pt-2.5 transition-all hover:bg-white/5 active:scale-95"
    >
      <span
        className="relative grid h-12 w-12 place-items-center rounded-[18px] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105"
        style={{
          background: `${tool.tone}22`,
          color: tool.tone,
          boxShadow: tool.active ? `0 0 0 2px ${tool.tone}` : `inset 0 0 0 1px ${tool.tone}33`,
        }}
      >
        <Icon size={20} strokeWidth={2} />
        {tool.dot && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-gold ring-2 ring-panel" />
        )}
      </span>
      <span className="max-w-full truncate text-[11px] font-medium leading-none text-muted transition-colors group-hover:text-ink">
        {tool.short}
      </span>
    </button>
  );
}

export default function ChatHeader({
  name,
  color,
  focusMode,
  onToggleFocus,
  onIdentity,
  onCode,
  onVenus,
  onSkills,
  onRuns,
  onVpassword,
  onConnectors,
  hasConnectors,
  onRoutines,
  hasRoutines,
  onTeam,
  teamOpen,
  teamRunning,
  onPc,
  pcOpen,
  hasComputer,
  pcPaused,
}: {
  name: string;
  color: AvatarColor;
  focusMode: boolean;
  onToggleFocus: () => void;
  onIdentity: () => void;
  onCode: () => void;
  onVenus: () => void;
  onSkills: () => void;
  onRuns: () => void;
  onVpassword: () => void;
  onConnectors: () => void;
  hasConnectors: boolean;
  onRoutines: () => void;
  hasRoutines: boolean;
  onTeam: () => void;
  teamOpen: boolean;
  teamRunning: boolean;
  onPc: () => void;
  pcOpen: boolean;
  hasComputer: boolean;
  pcPaused: boolean;
}) {
  const busy = useAnyActivity();
  useAvatarStore();
  const shown = avatarFor(getActiveChat(), color);
  const working = busy || teamRunning;
  const glow = parseAvatar(shown).hex;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // close the tray on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pcLabel = !hasComputer
    ? "Computer (not created yet)"
    : pcPaused
    ? "Computer (off · saved)"
    : "Computer";

  const tools: Tool[] = [
    { key: "profile", label: "Profile & email", short: "Profile", tone: "#8AB4FF", Icon: User, onClick: onIdentity },
    { key: "code", label: "Venus Code", short: "Code", tone: "#5EE6A8", Icon: Code2, onClick: onCode },
    { key: "venus", label: "Venus Pro (video)", short: "Venus Pro", tone: "#FF8FB1", Icon: Film, onClick: onVenus },
    { key: "skills", label: "Memory & Skills", short: "Skills", tone: "#C3A6FF", Icon: Brain, onClick: onSkills },
    { key: "runs", label: "Runs", short: "Runs", tone: "#FFB86B", Icon: Activity, onClick: onRuns },
    { key: "vpass", label: "vPassword", short: "vPassword", tone: "#FFD166", Icon: KeyRound, onClick: onVpassword },
    { key: "conn", label: "Connectors", short: "Connectors", tone: "#6FD6E8", Icon: Plug, onClick: onConnectors, dot: hasConnectors },
    { key: "routines", label: "Routines", short: "Routines", tone: "#FF9E80", Icon: Clock, onClick: onRoutines, dot: hasRoutines },
    { key: "team", label: "Team", short: "Team", tone: "#7FD99A", Icon: Users, onClick: onTeam, active: teamOpen, dot: teamRunning },
    { key: "pc", label: pcLabel, short: "Computer", tone: "#9DB4FF", Icon: Monitor, onClick: onPc, active: pcOpen, dot: hasComputer && !pcPaused },
    {
      key: "focus",
      label: focusMode ? "Exit focus mode" : "Focus mode",
      short: focusMode ? "Exit focus" : "Focus",
      tone: "#E7B24D",
      Icon: focusMode ? Minimize2 : Maximize2,
      onClick: onToggleFocus,
      active: focusMode,
    },
  ];

  const pick = (t: Tool) => {
    setOpen(false);
    t.onClick();
  };

  return (
    <div ref={rootRef} className="relative z-30">
      <PaymentApprovals />
      <header className="relative border-b border-line px-5 pb-4 pt-5">
        {/* soft glow in the avatar's own colour */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-44 opacity-60"
          style={{ background: `radial-gradient(ellipse 280px 150px at 50% 62px, ${glow}2e, transparent 70%)` }}
        />

        <div className="relative mx-auto grid max-w-2xl grid-cols-[1fr_auto_1fr] items-start">
          <div />

          {/* centre: round frame + name + status */}
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={onIdentity}
              title="Open profile · change avatar"
              aria-label={`${name} · open profile and change avatar`}
              className="group relative grid h-[112px] w-[112px] place-items-center rounded-full transition-transform duration-200 hover:scale-[1.04] active:scale-95"
            >
              {/* halo */}
              <span
                aria-hidden
                className={`absolute -inset-2 rounded-full blur-xl ${working ? "animate-pulse opacity-90" : "opacity-60"}`}
                style={{ background: `radial-gradient(circle, ${glow}66, transparent 68%)` }}
              />
              {/* gradient ring (spins while working) */}
              <span
                aria-hidden
                className={`absolute inset-0 rounded-full p-[3px] ${working ? "animate-[spin_5s_linear_infinite]" : ""}`}
                style={{ background: `conic-gradient(from 200deg, ${glow}, #E7B24D, #FF9EC4, #8AB4FF, ${glow})` }}
              >
                <span
                  className="block h-full w-full rounded-full"
                  style={{ background: `radial-gradient(circle at 50% 35%, #26262c 0%, #151517 75%)` }}
                />
              </span>
              {/* the mascot, centred, allowed to pop out of the frame a little */}
              <span className="relative z-10 -translate-y-0.5">
                <BotAvatar color={shown} size={118} working={working} />
              </span>
            </button>

            <div className="mt-3 max-w-[240px] truncate text-base font-semibold tracking-tight text-ink">{name}</div>

            <div
              aria-live="polite"
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-panel/80 px-3 py-1 text-xs text-muted shadow-sm backdrop-blur"
            >
              {working ? (
                <>
                  <span aria-hidden>{teamRunning ? "👥" : "⚡"}</span>
                  <span>{teamRunning ? "Team is working…" : "Working on it…"}</span>
                </>
              ) : (
                <>
                  <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                  <span>Ready</span>
                </>
              )}
            </div>
          </div>

          {/* side arrow: shows / hides all the buttons */}
          <div className="mt-[34px] pl-3">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="menu"
              aria-controls="chat-tools"
              title={open ? "Hide buttons" : "Show buttons"}
              aria-label={open ? "Hide buttons" : "Show buttons"}
              className={`relative grid h-11 w-11 place-items-center rounded-full border border-line bg-panel2 text-muted shadow-md transition-all hover:scale-105 hover:text-ink active:scale-95 ${
                open ? "border-gold/60 text-gold" : ""
              }`}
            >
              <ChevronRight
                size={20}
                strokeWidth={2.4}
                className={`transition-transform duration-300 ${open ? "rotate-90" : ""}`}
              />
              {!open && (hasConnectors || hasRoutines || teamRunning || (hasComputer && !pcPaused)) && (
                <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-gold ring-2 ring-panel2" />
              )}
            </button>
          </div>
        </div>

        {/* the tray with all the buttons */}
        <div
          id="chat-tools"
          role="menu"
          aria-hidden={!open}
          className={`absolute left-1/2 top-full z-40 mt-2 w-[min(94vw,440px)] origin-top -translate-x-1/2 rounded-3xl border border-line bg-panel/95 p-3 shadow-2xl shadow-black/60 backdrop-blur-xl transition-[opacity,transform,visibility] duration-200 ${
            open ? "visible scale-100 opacity-100" : "invisible pointer-events-none scale-95 opacity-0"
          }`}
        >
          <div className="grid grid-cols-4 gap-1">
            {tools.map((t) => (
              <Tile key={t.key} tool={t} open={open} onPick={pick} />
            ))}
          </div>
        </div>
      </header>
    </div>
  );
}