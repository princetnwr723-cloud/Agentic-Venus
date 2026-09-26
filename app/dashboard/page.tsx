"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Monitor, Plus } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Sidebar from "@/components/dashboard/Sidebar";
import ChatThread from "@/components/dashboard/ChatThread";
import BotAvatar from "@/components/BotAvatar";
import { bots, sampleThread, type ThreadMessage } from "@/lib/bots";

// Mock-data dashboard. Once the agent backend is wired in, replace
// `threads` state with a live subscription (Firestore) and swap
// `mockReplyFor` for a real call to the connected AI + the bot's
// cloud computer / browser session.
function initialThreads(): Record<string, ThreadMessage[]> {
  const map: Record<string, ThreadMessage[]> = {};
  for (const bot of bots) {
    map[bot.id] =
      bot.id === "sales-outbound"
        ? sampleThread
        : [{ kind: "text", from: "bot", body: bot.lastMessage }];
  }
  return map;
}

function mockReplyFor(botName: string): ThreadMessage {
  return {
    kind: "text",
    from: "bot",
    body: `On it — I'll work this in the background and come back to ${botName === "Chief" ? "you" : "this thread"} if I need a decision.`,
  };
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [activeId, setActiveId] = useState("sales-outbound");
  const [threads, setThreads] = useState<Record<string, ThreadMessage[]>>(
    initialThreads
  );
  const [draft, setDraft] = useState("");

  // Route guard: no session, no dashboard.
  useEffect(() => {
    if (!loading && !user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  const activeBot = useMemo(
    () => bots.find((b) => b.id === activeId)!,
    [activeId]
  );

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;

    setThreads((prev) => ({
      ...prev,
      [activeId]: [
        ...prev[activeId],
        { kind: "text", from: "user", body: text },
      ],
    }));
    setDraft("");

    // Mock async work — replace with the real agent response.
    setTimeout(() => {
      setThreads((prev) => ({
        ...prev,
        [activeId]: [...prev[activeId], mockReplyFor(activeBot.name)],
      }));
    }, 700);
  }

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-bg">
      <Sidebar
        bots={bots}
        activeId={activeId}
        onSelect={setActiveId}
        userLabel={user.email ?? "Account"}
        onSignOut={() => signOut(auth)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <BotAvatar
              color={activeBot.color}
              paired={activeBot.paired}
              size={26}
            />
            <span className="text-sm font-medium text-ink">
              {activeBot.name}
            </span>
          </div>
          <button
            title="View this teammate's screen (coming soon)"
            className="rounded-lg p-2 text-muted hover:bg-panel2 hover:text-ink"
          >
            <Monitor size={17} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-2xl">
            <ChatThread messages={threads[activeId]} />
          </div>
        </div>

        <form
          onSubmit={handleSend}
          className="mx-auto flex w-full max-w-2xl items-center gap-2 border-t border-line px-6 py-4"
        >
          <button
            type="button"
            aria-label="Attach"
            className="rounded-full p-2 text-muted hover:bg-panel2"
          >
            <Plus size={18} />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Message ${activeBot.name}`}
            className="flex-1 rounded-full border border-line bg-panel px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-gold"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!draft.trim()}
            className="rounded-full bg-white p-2.5 text-bg hover:opacity-90 disabled:opacity-40"
          >
            <ArrowUp size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}