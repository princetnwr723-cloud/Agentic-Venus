"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  MapPin,
  MoreHorizontal,
  Plug,
  Settings2,
  User,
  Users,
} from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import AboutModal from "@/components/dashboard/AboutModal";
import PaymentApprovals from "@/components/dashboard/PaymentApprovals";
import ToolsMenu, { type ToolGroup, type ToolItem, type ToolTone } from "@/components/dashboard/ToolsMenu";
import DeckStudio from "@/components/decks/DeckStudio";
import { DeckIcon } from "@/components/icons";
import GlassSheet from "@/components/ui/GlassSheet";
import { avatarFor, getActiveChat, useAnyActivity, useAvatarStore } from "@/lib/avatar-activity";
import type { AvatarColor } from "@/lib/bots";
import { openDrawer, useDashFlag, useIsMobile } from "@/lib/mobile-ui";
import { useHeaderButtons } from "@/lib/header-prefs";

/** Below this header width the less-used buttons are only reachable through the three dots, so nothing ever overlaps the avatar. */
const COMPACT_BELOW = 720;

type Def = {
  key: string;
  label: string;
  hint: string;
  tone: ToolTone;
  icon: (size: number) => React.ReactNode;
  onClick: () => void;
  active?: boolean;
  dot?: boolean;
  /** stays on the header even when it is narrow */
  pinned?: boolean;
  words?: string;
  /** only shown on a computer */
  desktopOnly?: boolean;
};

function IconBtn({ d }: { d: Def }) {
  return (
    <button
      type="button"
      onClick={d.onClick}
      title={d.label}
      aria-label={d.label}
      aria-pressed={d.active}
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-panel2 hover:text-ink active:scale-95 ${
        d.active ? "bg-panel2 text-ink" : "text-muted"
      }`}
    >
      {d.icon(16)}
      {d.dot && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gold" />}
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
  minimal = false,
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
  /** a brand-new chat on a phone: only the menu and the avatar, like the start screen of Claude */
  minimal?: boolean;
}) {
  const busy = useAnyActivity();
  useAvatarStore();
  useDashFlag();
  const mobile = useIsMobile();
  const shownKeys = useHeaderButtons();
  const router = useRouter();
  const shown = avatarFor(getActiveChat(), color);
  const working = busy || teamRunning;

  const headerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

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

  // the popover closes on an outside tap and on Escape
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
  useEffect(() => { if (!mobile) setSheet(false); else setMenuOpen(false); }, [mobile]);

  const pcHint = !hasComputer ? "Not created yet" : pcPaused ? "Off · saved" : "On";
  const pcLabel = !hasComputer ? "Computer (not created yet)" : pcPaused ? "Computer (off · saved)" : "Computer";

  const defs: Def[] = [
    { key: "pc", label: pcLabel, hint: pcHint, tone: "teal", icon: (s) => <Monitor size={s} />, onClick: onPc, active: pcOpen, dot: hasComputer && !pcPaused, pinned: true, words: "computer pc browser screen" },
    { key: "team", label: "Team", hint: teamRunning ? "Working" : "Add teammates", tone: "violet", icon: (s) => <Users size={s} />, onClick: onTeam, active: teamOpen, dot: teamRunning, pinned: true, words: "agents members" },
    { key: "routines", label: "Routines", hint: hasRoutines ? "Active" : "Schedule tasks", tone: "gold", icon: (s) => <Clock size={s} />, onClick: onRoutines, dot: hasRoutines, words: "schedule repeat" },
    { key: "runs", label: "Runs", hint: "Background tasks", tone: "sky", icon: (s) => <Activity size={s} />, onClick: onRuns, words: "missions jobs" },
    { key: "vmaps", label: "Vmaps", hint: "Maps & leads", tone: "teal", icon: (s) => <MapPin size={s} />, onClick: () => router.push("/vmaps"), words: "map leads places" },
    { key: "code", label: "Venus Code", hint: "Build & deploy", tone: "sky", icon: (s) => <Code2 size={s} />, onClick: onCode, words: "code website app project" },
    { key: "venus", label: "Venus Pro", hint: "Video studio", tone: "violet", icon: (s) => <Film size={s} />, onClick: onVenus, words: "video reel editor" },
    { key: "decks", label: "Decks", hint: "Make presentations", tone: "violet", icon: (s) => <DeckIcon size={s + 1} />, onClick: () => setDeckOpen(true), active: deckOpen, words: "slides presentation ppt" },
    { key: "skills", label: "Memory & Skills", hint: "What it knows", tone: "gold", icon: (s) => <Brain size={s} />, onClick: onSkills, words: "brain memory skills" },
    { key: "connectors", label: "Connectors", hint: hasConnectors ? "Connected" : "Link your tools", tone: "teal", icon: (s) => <Plug size={s} />, onClick: onConnectors, dot: hasConnectors, words: "gmail github shopify mcp" },
    { key: "vpassword", label: "vPassword", hint: "Logins & cards vault", tone: "sky", icon: (s) => <KeyRound size={s} />, onClick: onVpassword, words: "password card vault login" },
    { key: "profile", label: "Profile & email", hint: "Avatar, role, inbox", tone: "gold", icon: (s) => <User size={s} />, onClick: onIdentity, words: "identity avatar" },
    {
      key: "focus",
      label: focusMode ? "Exit focus mode" : "Focus mode",
      hint: focusMode ? "Show the chat list again" : "Hide the chat list",
      tone: "coral",
      icon: (s) => (focusMode ? <Minimize2 size={s} /> : <Maximize2 size={s} />),
      onClick: onToggleFocus,
      active: focusMode,
      pinned: true,
      desktopOnly: true,
    },
  ];

  const byKey = new Map(defs.map((d) => [d.key, d]));
  const toItem = (d: Def): ToolItem => ({ key: d.key, label: d.label, hint: d.hint, tone: d.tone, icon: d.icon(18), onClick: d.onClick, dot: d.dot, active: d.active, words: d.words });
  const groupOf = (title: string, keys: string[]): ToolGroup => ({
    title,
    items: keys
      .map((k) => byKey.get(k))
      .filter((d): d is Def => Boolean(d) && (!d!.desktopOnly || !mobile))
      .map(toItem),
  });
  const groups: ToolGroup[] = [
    groupOf("Work", ["pc", "team", "routines", "runs", "vmaps"]),
    groupOf("Create", ["code", "venus", "decks"]),
    groupOf("Brain & access", ["skills", "connectors", "vpassword"]),
    groupOf("Agent", ["profile", "focus"]),
  ].filter((g) => g.items.length > 0);

  // the owner picks the header buttons in About → "Header buttons"; every tool is always in the three dots too
  const onHeader = (d: Def) => shownKeys.includes(d.key) && (!compact || d.pinned) && (!d.desktopOnly || !mobile);
  const visible = defs.filter((d) => d.key !== "pc" && onHeader(d));
  const hiddenDot = defs.some((d) => d.key !== "pc" && !visible.includes(d) && d.dot);

  const pcDef = byKey.get("pc") as Def;

  // pick a tool: the sheet / popover slides away first, then the tool opens
  const pick = (fn: () => void) => {
    setSheet(false);
    setMenuOpen(false);
    window.setTimeout(fn, mobile ? 170 : 0);
  };

  const customize = (
    <button
      type="button"
      onClick={() => { setMenuOpen(false); setSheet(false); setAboutOpen(true); }}
      className="press mt-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm text-muted transition-colors hover:bg-panel2 hover:text-ink"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center"><Settings2 size={16} /></span>
      Customize header buttons
    </button>
  );

  const shellCls =
    "glass-m relative z-30 flex items-center justify-between gap-2 border-b border-line bg-panel/80 px-3 pb-2.5 pt-[calc(var(--sat)+0.625rem)] backdrop-blur sm:px-5 sm:pb-3 sm:pt-[calc(var(--sat)+0.75rem)]";

  return (
    <>
      <PaymentApprovals />
      <header ref={headerRef} className={shellCls}>
        {mobile && (
          <button
            type="button"
            onClick={openDrawer}
            aria-label="Chats"
            className="press -ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink"
          >
            <Menu size={22} />
          </button>
        )}

        {mobile && minimal ? (
          <>
            <span className="min-w-0 flex-1" />
            <button
              type="button"
              onClick={onIdentity}
              aria-label={`Open ${name}'s profile`}
              title={`${name} · profile`}
              className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            >
              <BotAvatar color={shown} size={32} working={working} />
            </button>
          </>
        ) : (
          <>
            {/* the avatar never shrinks, so the buttons can never slide over it */}
            <button
              type="button"
              onClick={onIdentity}
              title="Open profile · change avatar"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-0.5 pl-1 pr-2 text-left hover:bg-panel2/60"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                <BotAvatar color={shown} size={40} working={working} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium text-ink md:text-sm">{name}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${working ? "animate-pulse bg-gold" : "bg-avatar-teal"}`} />
                  {working ? "Working…" : "Online"}
                </span>
              </span>
            </button>

            {mobile ? (
              /* phone: the computer button and the three dots, nothing else */
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={pcDef.onClick}
                  aria-label={pcDef.label}
                  title={pcDef.label}
                  className={`press relative flex h-10 w-10 items-center justify-center rounded-full ${
                    pcDef.active ? "bg-white/15 text-ink" : "text-muted"
                  }`}
                >
                  <Monitor size={20} />
                  {pcDef.dot && (
                    <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gold shadow-[0_0_8px_rgba(231,178,77,0.9)]" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSheet(true)}
                  aria-label="All tools"
                  title="All tools"
                  className="press relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-ink"
                >
                  <MoreHorizontal size={21} />
                  {hiddenDot && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gold" />}
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 items-center justify-end gap-0.5">
                {visible.map((d) => <IconBtn key={d.key} d={d} />)}
                <IconBtn d={pcDef} />

                <div ref={menuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    title="All tools"
                    aria-label="All tools"
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
                      className="cc-in absolute right-0 top-full z-50 mt-2 max-h-[min(78vh,640px)] w-[360px] max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-3xl border border-line bg-panel p-3 shadow-2xl"
                    >
                      <ToolsMenu groups={groups} onPick={pick} footer={customize} compact />
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </header>

      <GlassSheet open={sheet} onClose={() => setSheet(false)} title="Tools">
        <ToolsMenu groups={groups} onPick={pick} footer={customize} />
      </GlassSheet>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <DeckStudio open={deckOpen} onClose={() => setDeckOpen(false)} />
    </>
  );
}
