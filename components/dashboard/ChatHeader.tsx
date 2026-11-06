"use client";

import { useState } from "react";
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
import type { LucideIcon } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import PaymentApprovals from "@/components/dashboard/PaymentApprovals";
import GlassSheet from "@/components/ui/GlassSheet";
import { avatarFor, getActiveChat, useAnyActivity, useAvatarStore } from "@/lib/avatar-activity";
import type { AvatarColor } from "@/lib/bots";
import { openDrawer, useDashFlag } from "@/lib/mobile-ui";

function IconBtn({
  label,
  onClick,
  active,
  dot,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`relative rounded-full p-2 transition-colors hover:bg-panel2 hover:text-ink ${
        active ? "bg-panel2 text-ink" : "text-muted"
      }`}
    >
      {children}
      {dot && (
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-gold" />
      )}
    </button>
  );
}

type Tone = "gold" | "violet" | "teal" | "sky";
const TONE: Record<Tone, string> = {
  gold: "bg-gold/15 text-gold",
  violet: "bg-avatar-violet/15 text-avatar-violet",
  teal: "bg-avatar-teal/15 text-avatar-teal",
  sky: "bg-avatar-sky/15 text-avatar-sky",
};

type Tile = { label: string; hint?: string; icon: LucideIcon; tone: Tone; dot?: boolean; onClick: () => void };

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
  const [more, setMore] = useState(false);
  const shown = avatarFor(getActiveChat(), color);
  const working = busy || teamRunning;

  const pcLabel = !hasComputer
    ? "Computer (not created yet)"
    : pcPaused
    ? "Computer (off · saved)"
    : "Computer";
  const pcHint = !hasComputer ? "Not created yet" : pcPaused ? "Off · saved" : "On";

  // phone: the actions are grouped by purpose inside one sheet, instead of 11 icons in one row
  const groups: Array<{ title: string; items: Tile[] }> = [
    {
      title: "Work",
      items: [
        { label: "Computer", hint: pcHint, icon: Monitor, tone: "teal", dot: hasComputer && !pcPaused, onClick: onPc },
        { label: "Team", hint: teamRunning ? "Working" : "Add teammates", icon: Users, tone: "violet", dot: teamRunning, onClick: onTeam },
        { label: "Routines", hint: hasRoutines ? "Active" : "Schedule tasks", icon: Clock, tone: "gold", dot: hasRoutines, onClick: onRoutines },
        { label: "Runs", hint: "Background tasks", icon: Activity, tone: "sky", onClick: onRuns },
      ],
    },
    {
      title: "Create",
      items: [
        { label: "Venus Code", hint: "Build & deploy", icon: Code2, tone: "sky", onClick: onCode },
        { label: "Venus Pro", hint: "Video studio", icon: Film, tone: "violet", onClick: onVenus },
      ],
    },
    {
      title: "Brain & access",
      items: [
        { label: "Memory & Skills", hint: "What it knows", icon: Brain, tone: "gold", onClick: onSkills },
        { label: "Connectors", hint: hasConnectors ? "Connected" : "Link your tools", icon: Plug, tone: "teal", dot: hasConnectors, onClick: onConnectors },
        { label: "vPassword", hint: "Logins vault", icon: KeyRound, tone: "sky", onClick: onVpassword },
      ],
    },
    {
      title: "Agent",
      items: [{ label: "Profile & email", hint: "Avatar, role, inbox", icon: User, tone: "gold", onClick: onIdentity }],
    },
  ];

  const run = (fn: () => void) => {
    setMore(false);
    setTimeout(fn, 170); // let the sheet slide away first
  };
  let n = 0;

  return (
    <>
      <PaymentApprovals />
      <header className="glass-m flex items-center justify-between gap-2 border-b border-line px-3 pb-2.5 pt-[calc(var(--sat)+0.625rem)] md:px-5 md:py-3">
        <button
          type="button"
          onClick={openDrawer}
          aria-label="Chats"
          className="press -ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink md:hidden"
        >
          <Menu size={21} />
        </button>

        <button
          type="button"
          onClick={onIdentity}
          title="Open profile · change avatar"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-0.5 text-left active:opacity-80 md:flex-none md:hover:bg-panel2/60"
        >
          <BotAvatar color={shown} size={40} working={working} />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium text-ink md:text-sm">{name}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted md:hidden">
              <span className={`h-1.5 w-1.5 rounded-full ${working ? "animate-pulse bg-gold" : "bg-avatar-teal"}`} />
              {working ? "Working…" : "Online"}
            </span>
          </span>
        </button>

        {/* desktop: the full icon row, exactly as before */}
        <div className="hidden shrink-0 flex-wrap items-center justify-end gap-0.5 md:flex">
          <IconBtn label="Profile & email" onClick={onIdentity}>
            <User size={16} />
          </IconBtn>
          <IconBtn label="Venus Code" onClick={onCode}>
            <Code2 size={16} />
          </IconBtn>
          <IconBtn label="Venus Pro (video)" onClick={onVenus}>
            <Film size={16} />
          </IconBtn>
          <IconBtn label="Memory & Skills" onClick={onSkills}>
            <Brain size={16} />
          </IconBtn>
          <IconBtn label="Runs" onClick={onRuns}>
            <Activity size={16} />
          </IconBtn>
          <IconBtn label="vPassword" onClick={onVpassword}>
            <KeyRound size={16} />
          </IconBtn>
          <IconBtn label="Connectors" onClick={onConnectors} dot={hasConnectors}>
            <Plug size={16} />
          </IconBtn>
          <IconBtn label="Routines" onClick={onRoutines} dot={hasRoutines}>
            <Clock size={16} />
          </IconBtn>
          <IconBtn label="Team" onClick={onTeam} active={teamOpen} dot={teamRunning}>
            <Users size={16} />
          </IconBtn>
          <IconBtn label={pcLabel} onClick={onPc} active={pcOpen} dot={hasComputer && !pcPaused}>
            <Monitor size={16} />
          </IconBtn>
          <IconBtn
            label={focusMode ? "Exit focus mode" : "Focus mode"}
            onClick={onToggleFocus}
            active={focusMode}
          >
            {focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </IconBtn>
        </div>

        {/* phone: only two buttons, everything else is in the sheet */}
        <div className="flex shrink-0 items-center gap-1 md:hidden">
          <button
            type="button"
            onClick={onPc}
            aria-label={pcLabel}
            className={`press relative flex h-10 w-10 items-center justify-center rounded-full ${
              pcOpen ? "bg-white/15 text-ink" : "text-muted"
            }`}
          >
            <Monitor size={19} />
            {hasComputer && !pcPaused && (
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gold shadow-[0_0_8px_rgba(231,178,77,0.9)]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setMore(true)}
            aria-label="More"
            className="press flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-ink"
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>

      <GlassSheet open={more} onClose={() => setMore(false)} title="Everything your agent can do">
        {groups.map((g) => (
          <section key={g.title} className="mb-4">
            <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-faint">{g.title}</p>
            <div className="grid grid-cols-2 gap-2.5">
              {g.items.map((it) => {
                const Icon = it.icon;
                const delay = 40 + n++ * 45;
                return (
                  <button
                    key={it.label}
                    type="button"
                    onClick={() => run(it.onClick)}
                    style={{ animationDelay: `${delay}ms` }}
                    className="tile-in press relative flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-left"
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE[it.tone]}`}>
                      <Icon size={19} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">{it.label}</span>
                      {it.hint && <span className="block truncate text-[11px] text-muted">{it.hint}</span>}
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