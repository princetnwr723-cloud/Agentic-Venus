"use client";

import { Plus, Search } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import Logo from "@/components/Logo";
import type { Bot } from "@/lib/bots";

export default function Sidebar({
  bots,
  activeId,
  onSelect,
}: {
  bots: Bot[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="flex h-screen w-[320px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center justify-between px-4 py-4">
        <Logo size={18} />
        <button
          aria-label="New teammate"
          className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
          <Search size={15} className="text-faint" />
          <input
            placeholder="Search"
            className="w-full bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto">
        {bots.map((bot) => {
          const active = bot.id === activeId;
          return (
            <button
              key={bot.id}
              onClick={() => onSelect(bot.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                active ? "bg-panel2" : "hover:bg-panel2/60"
              }`}
            >
              <BotAvatar color={bot.color} paired={bot.paired} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {bot.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-faint">
                    {bot.time}
                  </span>
                </div>
                <p className="truncate text-xs text-muted">
                  {bot.lastMessage}
                </p>
              </div>
              {bot.unread && (
                <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}