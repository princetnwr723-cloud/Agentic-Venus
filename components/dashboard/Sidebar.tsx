"use client";

import { useEffect, useRef, useState } from "react";
import { Key, LogOut, Menu, Plus, Search, Settings, X } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import Logo from "@/components/Logo";
import type { Chat } from "@/lib/chats";
import { splitSuggestions } from "@/lib/suggest";
import { avatarFor, setActiveChat, useAnyActivity, useAvatarStore } from "@/lib/avatar-activity";
import { closeDrawer, openDrawer, useDashFlag, useDrawer } from "@/lib/mobile-ui";

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
  const drawer = useDrawer();
  const touchX = useRef<number | null>(null);
  const busy = useAnyActivity();
  useAvatarStore();
  useDashFlag();
  const initial = userLabel.trim().charAt(0).toUpperCase() || "?";

  // tells the header which chat is open (so a changed avatar shows there too); on a phone the list closes by itself
  useEffect(() => {
    setActiveChat(activeId);
    closeDrawer();
  }, [activeId]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? chats.filter((c) => c.agentName.toLowerCase().includes(needle) || c.messages.some((m) => m.content.toLowerCase().includes(needle)))
    : chats;

  return (
    <>
      {/* phone: no chat open yet, so the header (with its menu button) is not there: this button opens the list */}
      {!drawer && !activeId && (
        <button
          type="button"
          onClick={openDrawer}
          className="glass press fixed left-3 top-[calc(var(--sat)+0.75rem)] z-30 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm text-ink md:hidden"
        >
          <Menu size={16} /> Chats
        </button>
      )}

      {/* phone: dark glass behind the open list */}
      <div
        onClick={closeDrawer}
        className={`fixed inset-0 z-40 bg-black/55 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          drawer ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current !== null && touchX.current - e.changedTouches[0].clientX > 70) closeDrawer();
          touchX.current = null;
        }}
        className={`glass-m fixed inset-y-0 left-0 z-50 flex w-[86%] max-w-[340px] flex-col transition-transform duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)] md:static md:z-auto md:h-screen md:w-[320px] md:max-w-none md:shrink-0 md:translate-x-0 md:border-r md:border-line md:bg-panel ${
          drawer ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-4 pt-[calc(var(--sat)+1rem)] md:pt-4">
          <Logo size={18} />
          <div className="flex items-center gap-1">
            <button
              aria-label="New chat"
              title="New chat"
              onClick={onNewChat}
              className="press rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"
            >
              <Plus size={18} />
            </button>
            <button
              aria-label="Close"
              onClick={closeDrawer}
              className="press rounded-full p-1.5 text-muted md:hidden"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 md:rounded-lg md:border-line md:bg-bg md:py-2">
            <Search size={15} className="text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chats and messages"
              className="w-full bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none md:text-sm"
            />
          </div>
        </div>

        <nav key={drawer ? "open" : "closed"} className="flex-1 overflow-y-auto px-2 md:px-0">
          {chats.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-faint">
              No chats yet — hit + to bring on your first teammate.
            </p>
          )}
          {chats.length > 0 && shown.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-faint">Nothing matches “{q}”.</p>
          )}
          {shown.map((chat, i) => {
            const active = chat.id === activeId;
            const last = chat.messages[chat.messages.length - 1];
            const preview = last ? splitSuggestions(last.content).body : "";
            return (
              <button
                key={chat.id}
                onClick={() => { onSelect(chat.id); closeDrawer(); }}
                style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
                className={`list-in press flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors md:rounded-none md:px-4 md:[animation:none] ${
                  active ? "bg-white/10 md:bg-panel2" : "md:hover:bg-panel2/60"
                }`}
              >
                <BotAvatar color={avatarFor(chat.id, chat.agentColor)} size={38} working={busy && active} />
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-ink">{chat.agentName}</span>
                  <p className="truncate text-xs text-muted">{last ? preview : "New chat"}</p>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="relative border-t border-line px-4 py-3.5 pb-[calc(0.875rem+var(--sab))] md:pb-3.5">
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
              className="press relative z-20 rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}