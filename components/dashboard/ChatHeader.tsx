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
  Menu,
  Minimize2,
  Monitor,
  MoreHorizontal,
  Plug,
  User,
  Users,
} from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import PaymentApprovals from "@/components/dashboard/PaymentApprovals";
import GlassSheet from "@/components/ui/GlassSheet";
import { avatarFor, getActiveChat, useAnyActivity, useAvatarStore } from "@/lib/avatar-activity";
import type { AvatarColor } from "@/lib/bots";
import { openDrawer, useDashFlag, useIsMobile } from "@/lib/mobile-ui";

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

type Tone = "gold" | "violet" | "teal" | "sky";
const TONE: Record<Tone, string> = {
  gold: "bg-gold/15 text-gold",
  violet: "bg-avatar-violet/15 text-avatar-violet",
  teal: "bg-avatar-teal/15 text-avatar-teal",
  sky: "bg-avatar-sky/15 text-avatar-sky",
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
  useDashFlag();
  const mobile = useIsMobile();
  const shown = avatarFor(getActiveChat(), color);
  const working = busy || teamRunning;

  const headerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState(false);

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
  useEffect(() => { if (!mobile) setSheet(false); }, [mobile]);

  const pcLabel = !hasComputer
    ? "Computer (not created yet)"
    : pcPaused
    ? "Computer (off · saved)"
    : "Computer";
  const pcHint = !hasComputer ? "Not created yet" : pcPaused ? "Off · saved" : "On";

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

  // phone: the same actions, grouped by purpose inside one glass sheet
  const byKey = new Map(items.map((i) => [i.key, i]));
  const info: Record<string, { label: string; hint: string; tone: Tone }> = {
    pc: { label: "Computer", hint: pcHint, tone: "teal" },
    team: { label: "Team", hint: teamRunning ? "Working" : "Add teammates", tone: "violet" },
    routines: { label: "Routines", hint: hasRoutines ? "Active" : "Schedule tasks", tone: "gold" },
    runs: { label: "Runs", hint: "Background tasks", tone: "sky" },
    code: { label: "Venus Code", hint: "Build & deploy", tone: "sky" },
    venus: { label: "Venus Pro", hint: "Video studio", tone: "violet" },
    skills: { label: "Memory & Skills", hint: "What it knows", tone: "gold" },
    connectors: { label: "Connectors", hint: hasConnectors ? "Connected" : "Link your tools", tone: "teal" },
    vpassword: { label: "vPassword", hint: "Logins vault", tone: "sky" },
    profile: { label: "Profile & email", hint: "Avatar, role, inbox", tone: "gold" },
  };
  const groups: Array<{ title: string; keys: string[] }> = [
    { title: "Work", keys: ["pc", "team", "routines", "runs"] },
    { title: "Create", keys: ["code", "venus"] },
    { title: "Brain & access", keys: ["skills", "connectors", "vpassword"] },
    { title: "Agent", keys: ["profile"] },
  ];
  const run = (fn: () => void) => {
    setSheet(false);
    setTimeout(fn, 170); // let the sheet slide away first
  };
  let n = 0;

  const pcItem = byKey.get("pc");

  return (
    <>
      <PaymentApprovals />
      <header
        ref={headerRef}
        className="glass-m relative z-30 flex items-center justify-between gap-2 border-b border-line px-3 pb-2.5 pt-[calc(var(--sat)+0.625rem)] sm:px-5 sm:pb-3 sm:pt-[calc(var(--sat)+0.75rem)]"
      >
        {mobile && (
          <button
            type="button"
            onClick={openDrawer}
            aria-label="Chats"
            className="press -ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink"
          >
            <Menu size={21} />
          </button>
        )}

        {/* the avatar never shrinks, so the buttons can no longer slide over it */}
        <button
          type="button"
          onClick={onIdentity}
          title="Open profile · change avatar"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-0.5 pl-1 pr-2 text-left hover:bg-panel2/60"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center">
            <BotAvatar color={shown} size={40} working={working} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">{name}</span>
            {mobile && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${working ? "animate-pulse bg-gold" : "bg-avatar-teal"}`} />
                {working ? "Working…" : "Online"}
              </span>
            )}
          </span>
        </button>

        {mobile ? (
          /* phone: only two buttons, everything else is in the sheet */
          <div className="flex shrink-0 items-center gap-1">
            {pcItem && (
              <button
                type="button"
                onClick={pcItem.onClick}
                aria-label={pcItem.label}
                className={`press relative flex h-10 w-10 items-center justify-center rounded-full ${
                  pcItem.active ? "bg-white/15 text-ink" : "text-muted"
                }`}
              >
                <Monitor size={19} />
                {pcItem.dot && (
                  <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gold shadow-[0_0_8px_rgba(231,178,77,0.9)]" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSheet(true)}
              aria-label="More"
              className="press relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-ink"
            >
              <MoreHorizontal size={20} />
              {hiddenDot && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gold" />}
            </button>
          </div>
        ) : (
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
        )}
      </header>

      <GlassSheet open={sheet} onClose={() => setSheet(false)} title="Everything your agent can do">
        {groups.map((g) => (
          <section key={g.title} className="mb-4">
            <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-faint">{g.title}</p>
            <div className="grid grid-cols-2 gap-2.5">
              {g.keys.map((k) => {
                const it = byKey.get(k);
                const meta = info[k];
                if (!it || !meta) return null;
                const delay = 40 + n++ * 45;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => run(it.onClick)}
                    style={{ animationDelay: `${delay}ms` }}
                    className="tile-in press relative flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-left"
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl [&>svg]:h-[19px] [&>svg]:w-[19px] ${TONE[meta.tone]}`}>
                      {it.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">{meta.label}</span>
                      <span className="block truncate text-[11px] text-muted">{meta.hint}</span>
                    </span>
                    {it.dot && (
                      <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-gold shadow-[0_0_8px_rgba(231,178,77,0.9)]" />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </GlassSheet>
    </>
  );
}