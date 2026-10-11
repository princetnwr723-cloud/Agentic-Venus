import Link from "next/link";
import { Activity, Clock, Monitor, PanelLeftClose, PanelLeftOpen, Plug, Users } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import type { AvatarColor } from "@/lib/bots";

type Props = {
  name: string; color: AvatarColor; focusMode: boolean; onToggleFocus: () => void; onIdentity: () => void;
  onCode: () => void; onVenus: () => void; onSkills: () => void; onRuns: () => void; onVpassword: () => void;
  onConnectors: () => void; hasConnectors: boolean;
  onRoutines: () => void; hasRoutines: boolean;
  onTeam: () => void; teamOpen: boolean; teamRunning: boolean;
  onPc: () => void; pcOpen: boolean; hasComputer: boolean; pcPaused: boolean;
};

const link = "rounded-lg px-2.5 py-1.5 text-xs font-medium text-gold hover:bg-panel2";
const icon = (on: boolean) => `relative rounded-lg p-2 hover:bg-panel2 hover:text-ink ${on ? "bg-panel2 text-ink" : "text-muted"}`;
const dot = (c: string) => <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${c}`} />;

export default function ChatHeader(p: Props) {
  return (
    <header className="flex items-center justify-between border-b border-line px-6 py-3.5">
      <div className="flex items-center gap-2.5">
        <button onClick={p.onToggleFocus} title={p.focusMode ? "Show chat list" : "Focus mode — hide the chat list"} className="rounded-lg p-1.5 text-muted hover:bg-panel2 hover:text-ink">{p.focusMode ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
        <button onClick={p.onIdentity} title="Open this agent's identity (profile, email, activity)" className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-panel2">
          <BotAvatar color={p.color} size={26} />
          <span className="text-sm font-medium text-ink">{p.name}</span>
        </button>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={p.onCode} title="Venus Code — only for coding projects" className={link}>Code</button>
        <button onClick={p.onVenus} title="Venus Pro — motion graphics" className={link}>Venus Pro</button>
        <Link href="/missions" title="Missions — long multi-step jobs that run in the background" className={link}>Missions</Link>
        <button onClick={p.onSkills} title="This chat's memory & skills" className={link}>Skills</button>
        <button onClick={p.onVpassword} title="vPassword — logins and cards your agents can use but never see" className={link}>vPassword</button>
        <button onClick={p.onRuns} title="Runs — every agent run, step by step" className={link}><Activity size={13} className="mr-1 inline" />Runs</button>
        <button onClick={p.onConnectors} title="Connectors — plugins, MCP, chat apps" className={icon(false)}><Plug size={17} />{p.hasConnectors && dot("bg-avatar-teal")}</button>
        <button onClick={p.onRoutines} title="Routines" className={icon(false)}><Clock size={17} />{p.hasRoutines && dot("bg-avatar-teal")}</button>
        <button onClick={p.onTeam} title="Team — specialists working for this chat" className={icon(p.teamOpen)}><Users size={17} />{p.teamRunning && dot("animate-pulse bg-gold")}</button>
        <button onClick={p.onPc} title={p.pcOpen ? "Hide this chat's computer" : p.hasComputer ? "Show this chat's computer" : "Give this chat a cloud computer"} className={icon(p.pcOpen)}><Monitor size={17} />{p.hasComputer && dot(p.pcPaused ? "bg-faint" : "bg-avatar-teal")}</button>
      </div>
    </header>
  );
}