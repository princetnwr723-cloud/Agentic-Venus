"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Brain,
  Clock,
  Code2,
  Film,
  KeyRound,
  Maximize2,
  Minimize2,
  Monitor,
  MoreHorizontal,
  Plug,
  User,
  Users,
} from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import PaymentApprovals from "@/components/dashboard/PaymentApprovals";
import { avatarFor, getActiveChat, useAnyActivity, useAvatarStore } from "@/lib/avatar-activity";
import type { AvatarColor } from "@/lib/bots";

/** Below this header width the less-used buttons move into the "More" menu, so nothing ever overlaps the avatar. */
const COMPACT_BELOW = 720;

type Item = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  dot?: boolean;
  /** stays visible even when the header is narrow */
  pinned?: boolean;
};

function IconBtn({ item }: { item: Item }) {
  return (
    <button
      type="button"
      onClick={item.onClick}
      title={item.label}
      aria-label={item.label}
      aria-pressed={item.active}
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-panel2 hover:text-ink active:scale-95 ${
        item.active ? "bg-panel2 text-ink" : "text-muted"
      }`}
    >
      {item.icon}
      {item.dot && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gold" />}
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

  const headerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // measure the header itself (not the screen): the chat column gets narrow when the computer panel is open
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = (w: number) => setCompact(w < COMPACT_BELOW);
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the menu closes on an outside tap, on Escape, and as soon as the header is wide again
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);
  useEffect(() => { if (!compact) setMenuOpen(false); }, [compact]);

  const pcLabel = !hasComputer
    ? "Computer (not created yet)"
    : pcPaused
    ? "Computer (off · saved)"
    : "Computer";

  const items: Item[] = [
    { key: "profile", label: "Profile & email", icon: <User size={16} />, onClick: onIdentity },
    { key: "code", label: "Venus Code", icon: <Code2 size={16} />, onClick: onCode },
    { key: "venus", label: "Venus Pro (video)", icon: <Film size={16} />, onClick: onVenus },
    { key: "skills", label: "Memory & Skills", icon: <Brain size={16} />, onClick: onSkills },
    { key: "runs", label: "Runs", icon: <Activity size={16} />, onClick: onRuns },
    { key: "vpassword", label: "vPassword", icon: <KeyRound size={16} />, onClick: onVpassword },
    { key: "connectors", label: "Connectors", icon: <Plug size={16} />, onClick: onConnectors, dot: hasConnectors },
    { key: "routines", label: "Routines", icon: <Clock size={16} />, onClick: onRoutines, dot: hasRoutines },
    { key: "team", label: "Team", icon: <Users size={16} />, onClick: onTeam, active: teamOpen, dot: teamRunning, pinned: true },
    { key: "pc", label: pcLabel, icon: <Monitor size={16} />, onClick: onPc, active: pcOpen, dot: hasComputer && !pcPaused, pinned: true },
    {
      key: "focus",
      label: focusMode ? "Exit focus mode" : "Focus mode",
      icon: focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />,
      onClick: onToggleFocus,
      active: focusMode,
      pinned: true,
    },
  ];

  const visible = compact ? items.filter((i) => i.pinned) : items;
  const hidden = compact ? items.filter((i) => !i.pinned) : [];
  const hiddenDot = hidden.some((i) => i.dot);

  return (
    <>
      <PaymentApprovals />
      <header ref={headerRef} className="relative z-30 flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 sm:px-5 sm:py-3">
        {/* the avatar never shrinks, so the buttons can no longer slide over it */}
        <button
          type="button"
          onClick={onIdentity}
          title="Open profile · change avatar"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-0.5 pl-1 pr-2 text-left hover:bg-panel2/60"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center">
            <BotAvatar color={shown} size={40} working={busy || teamRunning} />
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-ink">{name}</span>
        </button>

        <div className="flex shrink-0 items-center justify-end gap-0.5">
          {visible.map((i) => <IconBtn key={i.key} item={i} />)}

          {compact && (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                title="More"
                aria-label="More"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-panel2 hover:text-ink active:scale-95 ${
                  menuOpen ? "bg-panel2 text-ink" : "text-muted"
                }`}
              >
                <MoreHorizontal size={18} />
                {hiddenDot && !menuOpen && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gold" />}
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-60 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-line bg-panel p-1.5 shadow-2xl"
                >
                  {hidden.map((i) => (
                    <button
                      key={i.key}
                      type="button"
                      role="menuitem"
                      onClick={() => { setMenuOpen(false); i.onClick(); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-panel2"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted">{i.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{i.label}</span>
                      {i.dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </header>
    </>
  );
}