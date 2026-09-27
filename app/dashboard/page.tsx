"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Clock, Monitor, Plus } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import {
  listChats,
  createChat,
  updateChatMessages,
  updateChatModel,
  updateChatSandbox,
  type Chat,
  type ChatMessage,
} from "@/lib/chats";
import { listCustomAgents, createCustomAgent, type CustomAgent } from "@/lib/agents";
import {
  listRoutinesForChat,
  createRoutine,
  setRoutineEnabled,
  deleteRoutine,
  recordManualRun,
  type Routine,
} from "@/lib/routines";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import type { AvatarColor } from "@/lib/bots";
import Sidebar from "@/components/dashboard/Sidebar";
import ChatThread from "@/components/dashboard/ChatThread";
import ModelPicker from "@/components/dashboard/ModelPicker";
import NewChatModal from "@/components/dashboard/NewChatModal";
import SettingsModal from "@/components/dashboard/SettingsModal";
import RoutinesPanel from "@/components/dashboard/RoutinesPanel";
import FirstKeyGate from "@/components/dashboard/FirstKeyGate";
import BotAvatar from "@/components/BotAvatar";

function defaultProviderAndModel(
  apiKeys: Partial<Record<ProviderId, string>>
): { provider: ProviderId; model: string } {
  const found = PROVIDERS.find((p) => apiKeys[p.id]);
  const provider = found?.id ?? PROVIDERS[0].id;
  return { provider, model: providerMeta(provider).models[0] };
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const { apiKeys, daytonaKey, loading: keysLoading } = useKeys();
  const router = useRouter();

  const [chats, setChats] = useState<Chat[]>([]);
  const [customAgents, setCustomAgents] = useState<CustomAgent[]>([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creatingSandbox, setCreatingSandbox] = useState(false);
  const [pcMessage, setPcMessage] = useState<string | null>(null);

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [routinePrefill, setRoutinePrefill] = useState<string | null>(null);
  const [runningRoutineId, setRunningRoutineId] = useState<string | null>(null);

  // Route guard: no session, no dashboard.
  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, user, router]);

  // Load this user's chats + custom agents once.
  useEffect(() => {
    if (!user) return;
    Promise.all([listChats(user.uid), listCustomAgents(user.uid)]).then(
      ([loadedChats, loadedAgents]) => {
        setChats(loadedChats);
        setCustomAgents(loadedAgents);
        setChatsLoaded(true);
        if (loadedChats.length > 0) setActiveId(loadedChats[0].id);
      }
    );
  }, [user]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeId) ?? null,
    [chats, activeId]
  );

  // Load the routines that belong to whichever chat is active.
  useEffect(() => {
    if (!user || !activeChat) {
      setRoutines([]);
      return;
    }
    listRoutinesForChat(user.uid, activeChat.id).then(setRoutines);
  }, [user, activeChat?.id]);

  const hasAnyKey = Object.values(apiKeys).some(Boolean);

  function patchChat(id: string, patch: Partial<Chat>) {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function handlePickAgent(agent: { name: string; color: AvatarColor }) {
    if (!user) return;
    const { provider, model } = defaultProviderAndModel(apiKeys);
    const chat = await createChat(user.uid, {
      agentName: agent.name,
      agentColor: agent.color,
      provider,
      model,
    });
    setChats((prev) => [chat, ...prev]);
    setActiveId(chat.id);
    setNewChatOpen(false);
  }

  async function handleCreateAgent(name: string, color: AvatarColor) {
    if (!user) return;
    const agent = await createCustomAgent(user.uid, name, color);
    setCustomAgents((prev) => [...prev, agent]);
    await handlePickAgent(agent);
  }

  async function handleModelChange(provider: ProviderId, model: string) {
    if (!user || !activeChat) return;
    patchChat(activeChat.id, { provider, model });
    await updateChatModel(user.uid, activeChat.id, provider, model);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !user || !activeChat || sending) return;

    const key = apiKeys[activeChat.provider];
    if (!key) {
      setSettingsOpen(true);
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: text, at: Date.now() };
    const afterUser = [...activeChat.messages, userMsg];
    patchChat(activeChat.id, { messages: afterUser });
    setDraft("");
    setSending(true);
    updateChatMessages(user.uid, activeChat.id, afterUser).catch(() => {});

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: activeChat.provider,
          apiKey: key,
          model: activeChat.model,
          messages: afterUser.map((m) => ({ role: m.role, content: m.content })),
          systemPrompt: `You are ${activeChat.agentName}, an AI teammate working inside AgenticVenus. Be direct and useful, and focus on getting real work done for the person you're talking to.`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed.");

      const botMsg: ChatMessage = {
        role: "assistant",
        content: data.reply || "…",
        at: Date.now(),
      };
      const afterReply = [...afterUser, botMsg];
      patchChat(activeChat.id, { messages: afterReply });
      await updateChatMessages(user.uid, activeChat.id, afterReply);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      const errMsg: ChatMessage = {
        role: "assistant",
        content: `⚠️ ${message}`,
        at: Date.now(),
      };
      const afterError = [...afterUser, errMsg];
      patchChat(activeChat.id, { messages: afterError });
      await updateChatMessages(user.uid, activeChat.id, afterError);
    } finally {
      setSending(false);
    }
  }

  async function handlePcClick() {
    if (!activeChat || !user) return;
    setPcMessage(null);

    if (activeChat.sandboxId) {
      setPcMessage(`Computer running · sandbox ${activeChat.sandboxId}`);
      return;
    }
    if (!daytonaKey) {
      setPcMessage("Add a Daytona API key first — opening settings.");
      setSettingsOpen(true);
      return;
    }

    setCreatingSandbox(true);
    try {
      const res = await fetch("/api/daytona/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: daytonaKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not create a computer.");

      patchChat(activeChat.id, { sandboxId: data.sandboxId });
      await updateChatSandbox(user.uid, activeChat.id, data.sandboxId);
      setPcMessage(`Computer ready · sandbox ${data.sandboxId}`);
    } catch (err) {
      setPcMessage(err instanceof Error ? err.message : "Could not create a computer.");
    } finally {
      setCreatingSandbox(false);
    }
  }

  async function handleCreateRoutine(input: {
    name: string;
    instructions: string;
    everyMinutes: number;
    startAt: number;
  }) {
    if (!user || !activeChat) return;
    const routine = await createRoutine(user.uid, {
      chatId: activeChat.id,
      ...input,
    });
    setRoutines((prev) => [...prev, routine]);
    setRoutinePrefill(null);
  }

  function handleToggleRoutine(id: string, enabled: boolean) {
    if (!user) return;
    setRoutines((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
    setRoutineEnabled(user.uid, id, enabled);
  }

  function handleDeleteRoutine(id: string) {
    if (!user) return;
    setRoutines((prev) => prev.filter((r) => r.id !== id));
    deleteRoutine(user.uid, id);
  }

  async function handleRunRoutineNow(routine: Routine) {
    if (!user || !activeChat) return;
    const key = apiKeys[activeChat.provider];
    if (!key) {
      setSettingsOpen(true);
      return;
    }
    setRunningRoutineId(routine.id);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: activeChat.provider,
          apiKey: key,
          model: activeChat.model,
          messages: [{ role: "user", content: routine.instructions }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Routine run failed.");

      const afterRoutine = [
        ...activeChat.messages,
        { role: "user" as const, content: `🔁 Routine: ${routine.name}`, at: Date.now() },
        { role: "assistant" as const, content: data.reply, at: Date.now() },
      ];
      patchChat(activeChat.id, { messages: afterRoutine });
      await updateChatMessages(user.uid, activeChat.id, afterRoutine);
      await recordManualRun(user.uid, routine.id, data.reply);
      setRoutines((prev) =>
        prev.map((r) =>
          r.id === routine.id
            ? { ...r, lastRunAt: Date.now(), lastResult: data.reply.slice(0, 200) }
            : r
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Routine run failed.";
      await recordManualRun(user.uid, routine.id, `⚠️ ${message}`);
      setRoutines((prev) =>
        prev.map((r) =>
          r.id === routine.id
            ? { ...r, lastRunAt: Date.now(), lastResult: `⚠️ ${message}` }
            : r
        )
      );
    } finally {
      setRunningRoutineId(null);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-bg">
      <Sidebar
        chats={chats}
        activeId={activeId}
        onSelect={setActiveId}
        onNewChat={() => setNewChatOpen(true)}
        userLabel={user.email ?? "Account"}
        onOpenApiKeys={() => setSettingsOpen(true)}
        onSignOut={() => signOut(auth)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {activeChat && (
          <header className="flex items-center justify-between border-b border-line px-6 py-3.5">
            <div className="flex items-center gap-2.5">
              <BotAvatar color={activeChat.agentColor} size={26} />
              <span className="text-sm font-medium text-ink">
                {activeChat.agentName}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setRoutinesOpen(true)}
                title="Routines — teach it once, repeat on a schedule"
                className="relative rounded-lg p-2 text-muted hover:bg-panel2 hover:text-ink"
              >
                <Clock size={17} />
                {routines.some((r) => r.enabled) && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-avatar-teal" />
                )}
              </button>
              <button
                onClick={handlePcClick}
                disabled={creatingSandbox}
                title={
                  activeChat.sandboxId
                    ? "This teammate's computer is running"
                    : "Give this teammate a cloud computer (Daytona)"
                }
                className="relative rounded-lg p-2 text-muted hover:bg-panel2 hover:text-ink disabled:opacity-50"
              >
                <Monitor size={17} />
                {activeChat.sandboxId && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-avatar-teal" />
                )}
              </button>
            </div>
          </header>
        )}

        {pcMessage && (
          <div className="flex items-center justify-between border-b border-line bg-panel px-6 py-2 text-xs text-muted">
            {pcMessage}
            <button onClick={() => setPcMessage(null)} className="text-faint hover:text-ink">
              Dismiss
            </button>
          </div>
        )}

        {!chatsLoaded ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
            Loading your chats…
          </div>
        ) : !hasAnyKey && !keysLoading ? (
          <FirstKeyGate />
        ) : !activeChat ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-ink">Pick a chat, or start a new one.</p>
            <button
              onClick={() => setNewChatOpen(true)}
              className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
            >
              <Plus size={16} /> New chat
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto max-w-2xl">
                <ChatThread
                  messages={activeChat.messages}
                  pending={sending}
                  onSaveAsRoutine={(text) => {
                    setRoutinePrefill(text);
                    setRoutinesOpen(true);
                  }}
                />
              </div>
            </div>

            <div className="mx-auto w-full max-w-2xl px-6 pb-2">
              <ModelPicker
                provider={activeChat.provider}
                model={activeChat.model}
                apiKeys={apiKeys}
                onChange={handleModelChange}
              />
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
                placeholder={`Message ${activeChat.agentName}`}
                className="flex-1 rounded-full border border-line bg-panel px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-gold"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={!draft.trim() || sending}
                className="rounded-full bg-white p-2.5 text-bg hover:opacity-90 disabled:opacity-40"
              >
                <ArrowUp size={16} />
              </button>
            </form>
          </>
        )}
      </div>

      <NewChatModal
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        customAgents={customAgents}
        onPick={handlePickAgent}
        onCreateAgent={handleCreateAgent}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {activeChat && (
        <RoutinesPanel
          open={routinesOpen}
          onClose={() => {
            setRoutinesOpen(false);
            setRoutinePrefill(null);
          }}
          chatName={activeChat.agentName}
          routines={routines}
          prefillInstructions={routinePrefill}
          busyId={runningRoutineId}
          onCreate={handleCreateRoutine}
          onToggle={handleToggleRoutine}
          onDelete={handleDeleteRoutine}
          onRunNow={handleRunRoutineNow}
        />
      )}
    </div>
  );
}