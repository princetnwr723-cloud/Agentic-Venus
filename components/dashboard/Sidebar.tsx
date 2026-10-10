"use client";

import { useState } from "react";
import { Key, LogOut, Plus, Settings, Search, AudioLines } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import Logo from "@/components/Logo";
import type { Chat } from "@/lib/chats";
import Link from "next/link";

export default function Sidebar({
  chats,
  activeId,
  onSelect,
  onNewChat,
  userLabel,
  onOpenApiKeys,
  onSignOut,
}: {
  chats: Chat[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  userLabel: string;
  onOpenApiKeys: () => void;
  onSignOut: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState("");
  const initial = userLabel.trim().charAt(0).toUpperCase() || "?";

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? chats.filter((c) => c.agentName.toLowerCase().includes(needle) || c.messages.some((m) => m.content.toLowerCase().includes(needle)))
    : chats;

  return (
    <aside className="flex h-screen w-[320px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center justify-between px-4 py-4">
        <Logo size={18} />
        <button
          aria-label="New chat"
          title="New chat"
          onClick={onNewChat}
          className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
          <Search size={15} className="text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search chats and messages"
            className="w-full bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto">
        {chats.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-faint">
            No chats yet — hit + to bring on your first teammate.
          </p>
        )}
        {chats.length > 0 && shown.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-faint">Nothing matches “{q}”.</p>
        )}
        {shown.map((chat) => {
          const active = chat.id === activeId;
          const last = chat.messages[chat.messages.length - 1];
          return (
            <button
              key={chat.id}
              onClick={() => onSelect(chat.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                active ? "bg-panel2" : "hover:bg-panel2/60"
              }`}
            >
              <BotAvatar color={chat.agentColor} size={34} />
              <div className="min-w-0 flex-1">
                <span className="truncate text-sm font-medium text-ink">{chat.agentName}</span>
                <p className="truncate text-xs text-muted">{last ? last.content : "New chat"}</p>
              </div>
            </button>
          );
        })}
      </nav>

      <div className="relative border-t border-line px-4 py-3.5">
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute bottom-[calc(100%+4px)] left-4 right-4 z-20 overflow-hidden rounded-lg border border-line bg-panel2 shadow-xl">
              <button
                onClick={() => { setMenuOpen(false); onOpenApiKeys(); }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-ink hover:bg-line"
              >
                <Key size={15} /> API keys
              </button>
              <Link href="/voice" onClick={() => setMenuOpen(false)} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-ink hover:bg-line">
                <AudioLines size={15} /> Voice & Calling
              </Link>
              <button
                onClick={() => { setMenuOpen(false); onSignOut(); }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-ink hover:bg-line"
              >
                <LogOut size={15} /> Sign out
              </button>
            </div>
          </>
        )}

        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-panel2 text-xs font-medium text-ink">
            {initial}
          </div>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{userLabel}</span>
          <button
            aria-label="Settings"
            title="Settings"
            onClick={() => setMenuOpen((v) => !v)}
            className="relative z-20 rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
