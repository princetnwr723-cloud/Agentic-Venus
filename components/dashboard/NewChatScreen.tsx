"use client";
// The start screen of a brand-new chat, in the style of Claude's own new-chat page:
// the agent's avatar, a calm "Evening, <name>" greeting, a small status pill, a few things to try, and the big message box at the bottom.
import { useEffect, useRef, useState } from "react";
import { Code2, Film, Globe2, Monitor, Presentation } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import { useAuth } from "@/lib/auth-context";
import { avatarFor, getActiveChat, useAnyActivity, useAvatarStore } from "@/lib/avatar-activity";
import type { AvatarColor } from "@/lib/bots";
import { shownName, useProfile } from "@/lib/profile";

function partOfDay(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "Night";
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  if (h < 22) return "Evening";
  return "Night";
}

const IDEAS: Array<{ label: string; text: string; icon: React.ReactNode }> = [
  { label: "Build a website", text: "Build me a landing page for ", icon: <Code2 size={15} /> },
  { label: "Research", text: "Research this and write a short report with sources: ", icon: <Globe2 size={15} /> },
  { label: "Use the computer", text: "Open the browser on your computer and ", icon: <Monitor size={15} /> },
  { label: "Make a video", text: "Make a 30 second video about ", icon: <Film size={15} /> },
  { label: "Presentation", text: "/deck ", icon: <Presentation size={15} /> },
];

export default function NewChatScreen({
  agentName,
  color,
  role,
  onIdentity,
  onFill,
  children,
}: {
  agentName: string;
  color: AvatarColor;
  /** what this agent does, shown under the greeting (optional) */
  role?: string;
  onIdentity: () => void;
  /** a suggestion was tapped: put this text in the message box */
  onFill: (text: string) => void;
  /** the message box */
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const busy = useAnyActivity();
  useAvatarStore();
  const shown = avatarFor(getActiveChat(), color);
  const wrap = useRef<HTMLDivElement>(null);

  // computed after the first paint so the greeting always matches the clock of this device
  const [part, setPart] = useState("Hello");
  useEffect(() => {
    setPart(partOfDay());
    const id = window.setInterval(() => setPart(partOfDay()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const first = shownName(profile, user?.email).trim().split(/\s+/)[0] ?? "";
  const greeting = part === "Hello" ? (first ? `Hello, ${first}` : "Hello") : first ? `${part}, ${first}` : `Good ${part.toLowerCase()}`;

  const fill = (text: string) => {
    onFill(text);
    window.requestAnimationFrame(() => {
      const el = wrap.current?.querySelector("textarea");
      if (el) { el.focus(); const p = el.value.length; el.setSelectionRange(p, p); }
    });
  };

  return (
    <div ref={wrap} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain md:justify-center">
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-4 pt-6 text-center md:flex-none md:pb-6">
        <div className="rise float-y mb-5 drop-shadow-[0_8px_24px_rgba(231,178,77,0.28)]">
          <BotAvatar color={shown} size={76} working={busy} />
        </div>

        <h1 className="av-serif rise text-[34px] font-medium leading-tight text-ink sm:text-[40px]" style={{ animationDelay: "80ms" }}>
          {greeting}
        </h1>

        <button
          type="button"
          onClick={onIdentity}
          className="rise press mt-6 flex max-w-full items-center gap-2 rounded-full bg-panel2 px-5 py-3 text-[15px] text-muted transition-colors hover:text-ink"
          style={{ animationDelay: "160ms" }}
          title="Open profile"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${busy ? "animate-pulse bg-gold" : "bg-avatar-teal"}`} />
          <span className="truncate">{agentName}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0 font-semibold text-ink">{busy ? "Working" : role ? "Ready" : "Online"}</span>
        </button>

        {role && (
          <p className="rise mt-3 max-w-sm text-[13px] leading-relaxed text-faint" style={{ animationDelay: "220ms" }}>{role}</p>
        )}

        <div
          className="rise cc-strip mt-6 flex max-w-full gap-2 overflow-x-auto px-1 py-1"
          style={{ animationDelay: "260ms" }}
          role="list"
          aria-label="Things to try"
        >
          {IDEAS.map((i) => (
            <button
              key={i.label}
              type="button"
              role="listitem"
              onClick={() => fill(i.text)}
              className="press flex shrink-0 items-center gap-2 rounded-full border border-line bg-panel/70 px-3.5 py-2 text-[13px] text-muted transition-colors hover:border-gold/50 hover:text-ink"
            >
              <span className="text-gold">{i.icon}</span>
              {i.label}
            </button>
          ))}
        </div>
      </div>

      {children}
    </div>
  );
}
