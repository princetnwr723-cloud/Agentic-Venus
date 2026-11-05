"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  ChevronDown,
  Mic,
  Monitor,
  MoreHorizontal,
  Paperclip,
  Plus,
  Puzzle,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import AuthModal from "@/components/AuthModal";
import { useAuth } from "@/lib/auth-context";
import { JOBS } from "./data";

export default function WorkspaceDemo() {
  const [activeId, setActiveId] = useState(JOBS[0].id);
  const [value, setValue] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const { user } = useAuth();
  const router = useRouter();
  const active = JOBS.find((j) => j.id === activeId) ?? JOBS[0];

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    if (user) {
      router.push("/dashboard");
      return;
    }
    // Public demo has no live agent: the first message is the moment to sign up.
    setAuthOpen(true);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6">
      <div className="overflow-hidden rounded-xl2 border border-line bg-panel/70 shadow-2xl">
        <div className="grid md:grid-cols-[270px_1fr]">
          {/* sidebar */}
          <aside className="hidden flex-col border-r border-line bg-bg/60 p-4 md:flex">
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
              </div>
              <div className="flex items-center gap-2 text-sm text-ink">
                <Monitor size={15} className="text-muted" />
                Cloud computer
                <ChevronDown size={14} className="text-muted" />
              </div>
              <Plus size={18} className="text-muted" />
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-faint">
              <Search size={15} /> Search
            </div>

            <p className="mt-5 flex items-center gap-1 px-1 text-xs text-muted">
              Bots <ChevronDown size={12} />
            </p>
            <div className="mt-2 space-y-1">
              {JOBS.map((j) => {
                const on = j.id === activeId;
                return (
                  <button
                    key={j.id}
                    onClick={() => setActiveId(j.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      on ? "bg-panel2" : "hover:bg-panel"
                    }`}
                  >
                    <BotAvatar color={j.color} size={36} animate={on ? true : "hover"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{j.name}</span>
                      <span className="block truncate text-xs text-muted">{j.sub}</span>
                    </span>
                    {j.id === "chief" && <span className="text-[11px] text-faint">now</span>}
                  </button>
                );
              })}
            </div>

            <div className="mt-auto space-y-1 pt-6 text-sm text-muted">
              <div className="flex items-center gap-3 px-3 py-2">
                <Zap size={17} /> Routines
              </div>
              <div className="flex items-center gap-3 px-3 py-2">
                <Puzzle size={17} /> Connectors
              </div>
            </div>
          </aside>

          {/* chat */}
          <div className="flex min-h-[460px] flex-col">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="flex items-center gap-3">
                <BotAvatar color={active.color} size={34} />
                <span className="text-lg font-semibold tracking-tight text-ink">{active.name}</span>
              </div>
              <div className="flex items-center gap-3 text-muted">
                <span className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-sm text-ink sm:inline-flex">
                  <Sparkles size={14} className="lv-brand" /> Claude
                  <ChevronDown size={14} className="text-muted" />
                </span>
                <Monitor size={18} />
                <MoreHorizontal size={18} />
              </div>
            </div>

            <div key={active.id} className="flex-1 space-y-3 px-5 py-6">
              <p className="text-center text-xs text-faint">Today 7:30 AM</p>
              {active.msgs.map((m, i) => (
                <div
                  key={i}
                  className={`lv-msg flex ${m.from === "me" ? "justify-end" : "justify-start"}`}
                  style={{ animationDelay: `${0.3 + i * 1.1}s` }}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                      m.from === "me" ? "bg-[#2f6fed] text-white" : "bg-panel2 text-ink"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleSend} className="px-4 pb-4">
              <div className="flex items-center gap-3 rounded-full border border-line bg-panel2 px-4 py-2.5">
                <Paperclip size={18} className="text-muted" />
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={`Message ${active.name}`}
                  className="flex-1 bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
                />
                <Mic size={18} className="text-muted" />
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={!value.trim()}
                  className="rounded-full bg-white p-2 text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <AuthModal open={authOpen} initialTab="signup" onClose={() => setAuthOpen(false)} />
    </div>
  );
}