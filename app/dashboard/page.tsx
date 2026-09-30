// SAVE AS: app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import PcPanel, { type PcStatus } from "@/components/dashboard/PcPanel";
import BotAvatar from "@/components/BotAvatar";

// Reads a response body safely. If the server crashed and sent HTML or an
// empty body, we show "Server returned 500: ..." instead of Safari's
// confusing "The string did not match the expected pattern."
async function readJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: `Server returned ${res.status}: ${text.slice(0, 200) || "(empty response)"}`,
    };
  }
}

function defaultProviderAndModel(
  apiKeys: Partial<Record<ProviderId, string>>
): { provider: ProviderId; model: string } {
  const found = PROVIDERS.find((p) => apiKeys[p.id]);
  const provider = found?.id ?? PROVIDERS[0].id;
  return { provider, model: providerMeta(provider).models[0] };
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const {
    apiKeys,
    e2bKey,
    pcSandboxId,
    savePcSandboxId,
    loading: keysLoading,
  } = useKeys();
  const router = useRouter();

  const [chats, setChats] = useState<Chat[]>([]);
  const [customAgents, setCustomAgents] = useState<CustomAgent[]>([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pcMessage, setPcMessage] = useState<string | null>(null);

  // ONE shared computer for the whole account — every chat can drive it, so
  // none of this state resets when you switch chats.
  const [pcOpen, setPcOpen] = useState(false);
  const [pcStatus, setPcStatus] = useState<PcStatus>("idle");
  const [pcError, setPcError] = useState<string | null>(null);
  const [screenUrl, setScreenUrl] = useState<string | null>(null);
  const [pcSteps, setPcSteps] = useState<string[]>([]);
  const [pcRunning, setPcRunning] = useState(false);
  const stopRequested = useRef(false);

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
      const data = await readJson(res);
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

  // ---- The shared computer ----

  async function loadScreen(sandboxId: string) {
    if (!e2bKey) {
      setSettingsOpen(true);
      return;
    }
    setPcStatus("loading");
    setPcError(null);
    try {
      const res = await fetch("/api/e2b/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: e2bKey, sandboxId }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not open the computer's screen.");
      setScreenUrl(data.url);
      setPcStatus("ready");
    } catch (err) {
      setPcError(err instanceof Error ? err.message : "Could not open the computer's screen.");
      setPcStatus("error");
    }
  }

  async function handlePcClick() {
    if (!user) return;
    setPcMessage(null);

    if (pcOpen) {
      setPcOpen(false);
      return;
    }
    if (!e2bKey) {
      setPcMessage("Add an E2B API key first — opening settings.");
      setSettingsOpen(true);
      return;
    }
    setPcOpen(true);
    if (pcSandboxId && !screenUrl) {
      await loadScreen(pcSandboxId);
    }
  }

  async function handleStartPc() {
    if (!user) return;
    if (!e2bKey) {
      setSettingsOpen(true);
      return;
    }
    setPcStatus("creating");
    setPcError(null);
    try {
      const res = await fetch("/api/e2b/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: e2bKey }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not create a computer.");

      await savePcSandboxId(data.sandboxId);
      await loadScreen(data.sandboxId);
    } catch (err) {
      setPcError(err instanceof Error ? err.message : "Could not create a computer.");
      setPcStatus("error");
    }
  }

  async function handleDeletePc() {
    if (!user || !e2bKey || !pcSandboxId) return;
    if (!window.confirm("Delete the shared computer? Anything saved on it will be lost.")) {
      return;
    }
    setPcStatus("loading");
    setPcError(null);
    try {
      const res = await fetch("/api/e2b/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: e2bKey, sandboxId: pcSandboxId }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not delete the computer.");

      await savePcSandboxId(null);
      setScreenUrl(null);
      setPcSteps([]);
      setPcStatus("idle");
    } catch (err) {
      setPcError(err instanceof Error ? err.message : "Could not delete the computer.");
      setPcStatus("error");
    }
  }

  async function handleRunPcTask(task: string) {
    if (!user || !activeChat || !e2bKey || !pcSandboxId) return;
    if (pcRunning) return; // one task at a time — it's the same mouse/keyboard for every chat
    const key = apiKeys[activeChat.provider];
    if (!key) {
      setSettingsOpen(true);
      return;
    }

    const chatId = activeChat.id;
    const baseMessages = activeChat.messages;
    const MAX_STEPS = 25;

    stopRequested.current = false;
    setPcRunning(true);
    setPcSteps([`▶ ${task}`]);

    const history: string[] = [];
    let summary = "";

    try {
      for (let i = 0; i < MAX_STEPS; i++) {
        if (stopRequested.current) {
          summary = "Stopped before finishing.";
          setPcSteps((prev) => [...prev, "■ Stopped."]);
          break;
        }

        // Reconnects to the sandbox fresh every step.
        const res = await fetch("/api/e2b/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            e2bKey,
            sandboxId: pcSandboxId,
            provider: activeChat.provider,
            apiKey: key,
            model: activeChat.model,
            task,
            history: history.slice(-12),
          }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data?.error || "A step failed.");

        if (data.done) {
          summary = data.summary || "Done.";
          setPcSteps((prev) => [...prev, `✓ ${summary}`]);
          break;
        }

        const line = `${i + 1}. ${data.thought ? data.thought + " → " : ""}${data.actionText}`;
        history.push(line);
        setPcSteps((prev) => [...prev, line]);

        if (i === MAX_STEPS - 1) {
          summary = "Hit the step limit before finishing — the screen shows where it got to.";
          setPcSteps((prev) => [...prev, `… ${summary}`]);
        }
      }
    } catch (err) {
      summary = `⚠️ ${err instanceof Error ? err.message : "The task failed."}`;
      setPcSteps((prev) => [...prev, summary]);
    } finally {
      setPcRunning(false);
    }

    // Leave a record in whichever chat kicked the task off.
    const record: ChatMessage[] = [
      ...baseMessages,
      { role: "user", content: `🖥️ Task on the computer: ${task}`, at: Date.now() },
      { role: "assistant", content: summary || "Finished.", at: Date.now() },
    ];
    patchChat(chatId, { messages: record });
    updateChatMessages(user.uid, chatId, record).catch(() => {});
  }

  // ---- Routines ----

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
      const data = await readJson(res);
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

      <div className="flex min-w-0 flex-1">
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
                  title={
                    pcOpen
                      ? "Hide the team's computer"
                      : pcSandboxId
                      ? "Show the team's computer"
                      : "Give the team a cloud computer"
                  }
                  className={`relative rounded-lg p-2 hover:bg-panel2 hover:text-ink ${
                    pcOpen ? "bg-panel2 text-ink" : "text-muted"
                  }`}
                >
                  <Monitor size={17} />
                  {pcSandboxId && (
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

        {pcOpen && (
          <PcPanel
            hasComputer={Boolean(pcSandboxId)}
            status={pcStatus}
            error={pcError}
            screenUrl={screenUrl}
            steps={pcSteps}
            running={pcRunning}
            onClose={() => setPcOpen(false)}
            onStart={handleStartPc}
            onReload={() => pcSandboxId && loadScreen(pcSandboxId)}
            onDelete={handleDeletePc}
            onRunTask={handleRunPcTask}
            onStop={() => {
              stopRequested.current = true;
            }}
          />
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