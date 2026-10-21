"use client";

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
  Plug,
  User,
  Users,
} from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import { avatarFor, getActiveChat, useAnyActivity, useAvatarStore } from "@/lib/avatar-activity";
import type { AvatarColor } from "@/lib/bots";

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

  const pcLabel = !hasComputer
    ? "Computer (not created yet)"
    : pcPaused
    ? "Computer (off · saved)"
    : "Computer";

  return (
    <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
      <button
        type="button"
        onClick={onIdentity}
        title="Open profile · change avatar"
        className="flex min-w-0 items-center gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-panel2/60"
      >
        <BotAvatar color={shown} size={40} working={busy || teamRunning} />
        <span className="min-w-0 truncate text-sm font-medium text-ink">
          {name}
        </span>
      </button>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5">
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
    </header>
  );
}
