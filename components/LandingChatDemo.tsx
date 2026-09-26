"use client";

import { useState } from "react";
import { ArrowUp, Plus } from "lucide-react";
import BotAvatar from "./BotAvatar";
import AuthModal from "./AuthModal";

export default function LandingChatDemo() {
  const [value, setValue] = useState("");
  const [authOpen, setAuthOpen] = useState(false);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    // No agent is connected yet on the public demo — any message you send
    // here is the moment we ask you to create an account, matching the
    // real flow: sign up, and this exact box becomes a live teammate.
    setAuthOpen(true);
  }

  return (
    <div className="w-full rounded-xl2 border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <BotAvatar color="amber" size={26} />
        <span className="text-sm text-muted">Sales Outbound</span>
      </div>

      <div className="space-y-3 px-4 py-5">
        <div className="max-w-[85%] rounded-xl bg-panel2 px-3.5 py-2.5 text-sm leading-relaxed text-ink">
          Tell me what you'd hand off first — outbound, an inbox, expenses,
          anything. I'll show you how it gets worked.
        </div>
      </div>

      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 border-t border-line px-3 py-3"
      >
        <button
          type="button"
          className="rounded-full p-2 text-muted hover:bg-panel2"
          aria-label="Attach"
        >
          <Plus size={18} />
        </button>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Message Sales Outbound"
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          className="rounded-full bg-gold p-2 text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          disabled={!value.trim()}
        >
          <ArrowUp size={16} />
        </button>
      </form>

      <AuthModal
        open={authOpen}
        initialTab="signup"
        onClose={() => setAuthOpen(false)}
      />
    </div>
  );
}