"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Clock,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useKeys, type SavedLogin } from "@/lib/keys-context";
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
import PcPanel, {
  type PcStatus,
  type AgentRequest,
  type RequestReply,
} from "@/components/dashboard/PcPanel";
import BotAvatar from "@/components/BotAvatar";

// Reads a response body safely, so a crashed server shows a readable error
// instead of Safari's "The string did not match the expected pattern."
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

const normSite = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type PcCommand = { cmd: "start" | "stop" | "task"; arg?: string };

// The chat agent controls the computer by ending its reply with tags like
// [[PC:task|open Chrome and research X]]. We run them and hide them.
function extractPcCommands(text: string): { clean: string; cmds: PcCommand[] } {
  const cmds: PcCommand[] = [];
  const clean = text
    .replace(/\[\[PC:(start|stop|task)(?:\|([\s\S]*?))?\]\]/gi, (_m, cmd, arg) => {
      cmds.push({ cmd: String(cmd).toLowerCase() as PcCommand["cmd"], arg: arg?.trim() });
      return "";
    })
    .trim();
  return { clean, cmds };
}

const PC_PROMPT = `

You can operate a shared cloud Linux computer (web browser, VS Code) on the user's behalf. Whenever a request needs it — browsing, web research, logging into sites, working with files or apps — finish your reply with a line like:
[[PC:task|<a clear, complete instruction for the computer agent>]]
To turn the computer on: [[PC:start]]. To shut it down while keeping everything saved: [[PC:stop]].
Only use these tags when they are actually needed, and never explain the tag syntax to the user. The computer agent asks the user itself for logins and one-time codes, so don't ask for passwords in chat.`;

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const {
    apiKeys,
    e2bKey,
    pcSandboxId,
    savePcSandboxId,
    pcCredentials,
    savePcCredential,
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
  const [focusMode, setFocusMode] = useState(false);

  // ONE shared computer for the whole account.
  const [pcOpen, setPcOpen] = useState(false);
  const [pcFullscreen, setPcFullscreen] = useState(false);
  const [pcStatus, setPcStatus] = useState<PcStatus>("idle");
  const [pcError, setPcError] = useState<string | null>(null);
  const [screenUrl, setScreenUrl] = useState<string | null>(null);
  const [pcSteps, setPcSteps] = useState<string[]>([]);
  const [pcRunning, setPcRunning] = useState(false);
  const [pcRequest, setPcRequest] = useState<AgentRequest | null>(null);

  const stopRequested = useRef(false);
  const pcRunningRef = useRef(false);
  const sandboxIdRef = useRef<string | null>(null);
  const statusRef = useRef<PcStatus>("idle");
  const resolverRef = useRef<((r: RequestReply) => void) | null>(null);

  useEffect(() => {
    sandboxIdRef.current = pcSandboxId;
  }, [pcSandboxId]);
  useEffect(() => {
    statusRef.current = pcStatus;
  }, [pcStatus]);

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [routinePrefill, setRoutinePrefill] = useState<string | null>(null);
  const [runningRoutineId, setRunningRoutineId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, user, router]);

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

  // ---- The shared computer ----

  async function loadScreen(sandboxId: string): Promise<boolean> {
    if (!e2bKey) {
      setSettingsOpen(true);
      return false;
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
      return true;
    } catch (err) {
      setPcError(err instanceof Error ? err.message : "Could not open the computer's screen.");
      setPcStatus("error");
      return false;
    }
  }

  async function createPc(): Promise<string | null> {
    if (!user) return null;
    if (!e2bKey) {
      setSettingsOpen(true);
      return null;
    }
    setPcOpen(true);
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

      sandboxIdRef.current = data.sandboxId;
      await savePcSandboxId(data.sandboxId);
      const ok = await loadScreen(data.sandboxId);
      return ok ? (data.sandboxId as string) : null;
    } catch (err) {
      setPcError(err instanceof Error ? err.message : "Could not create a computer.");
      setPcStatus("error");
      return null;
    }
  }

  // Creates the computer if there is none, wakes it if it's off.
  async function startOrResumePc(): Promise<string | null> {
    if (!e2bKey) {
      setSettingsOpen(true);
      return null;
    }
    setPcOpen(true);
    const id = sandboxIdRef.current;
    if (!id) return createPc();
    if (statusRef.current === "ready") return id;
    const ok = await loadScreen(id);
    return ok ? id : null;
  }

  async function pausePc() {
    const id = sandboxIdRef.current;
    if (!user || !e2bKey || !id) return;
    if (pcRunningRef.current) {
      setPcMessage("Stop the running task first, then turn the computer off.");
      return;
    }
    setPcStatus("loading");
    setPcError(null);
    try {
      const res = await fetch("/api/e2b/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: e2bKey, sandboxId: id }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not turn the computer off.");
      setScreenUrl(null);
      setPcStatus("paused");
    } catch (err) {
      setPcError(err instanceof Error ? err.message : "Could not turn the computer off.");
      setPcStatus("error");
    }
  }

  async function handlePcClick() {
    if (!user) return;
    setPcMessage(null);

    if (pcOpen) {
      setPcOpen(false);
      setPcFullscreen(false);
      return;
    }
    if (!e2bKey) {
      setPcMessage("Add an E2B API key first — opening settings.");
      setSettingsOpen(true);
      return;
    }
    setPcOpen(true);
    if (pcSandboxId && !screenUrl && pcStatus !== "paused") {
      await loadScreen(pcSandboxId);
    }
  }

  async function handleDeletePc() {
    if (!user || !e2bKey || !pcSandboxId) return;
    if (!window.confirm("Delete the shared computer for good? Anything saved on it will be lost.")) {
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

      sandboxIdRef.current = null;
      await savePcSandboxId(null);
      setScreenUrl(null);
      setPcSteps([]);
      setPcFullscreen(false);
      setPcStatus("idle");
    } catch (err) {
      setPcError(err instanceof Error ? err.message : "Could not delete the computer.");
      setPcStatus("error");
    }
  }

  // ---- Agent asks the user something (login box, OTP, choices) ----

  function askUser(req: AgentRequest): Promise<RequestReply> {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPcRequest(req);
    });
  }

  function handleReply(r: RequestReply) {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPcRequest(null);
    resolve?.(r);
  }

  function handleStop() {
    stopRequested.current = true;
    handleReply({ type: "answer", text: "" }); // unblocks a pending question
  }

  function findCredential(site: string): SavedLogin | null {
    const n = normSite(site);
    if (n.length < 2) return null;
    for (const [k, v] of Object.entries(pcCredentials)) {
      if (k === n || (k.length >= 3 && n.includes(k)) || (n.length >= 3 && k.includes(n))) {
        return v;
      }
    }
    return null;
  }

  // ---- Running a task on the computer ----

  async function runPcTask(
    task: string,
    chat: Chat,
    baseMessages: ChatMessage[]
  ): Promise<ChatMessage[]> {
    if (!user || !e2bKey) return baseMessages;
    if (pcRunningRef.current) {
      setPcMessage("The computer is busy with another task — one at a time.");
      return baseMessages;
    }
    const key = apiKeys[chat.provider];
    if (!key) {
      setSettingsOpen(true);
      return baseMessages;
    }

    pcRunningRef.current = true;
    stopRequested.current = false;
    setPcRunning(true);
    setPcOpen(true);
    setPcSteps([`▶ ${task}`]);

    const MAX_ACTIONS = 40;
    const history: string[] = [];
    let creds: SavedLogin | null = null;
    let summary = "";

    try {
      if (!sandboxIdRef.current || statusRef.current !== "ready") {
        const id = await startOrResumePc();
        if (!id) throw new Error("The computer couldn't be started — see the panel for the reason.");
      }

      let actions = 0;
      let guard = 0;
      while (actions < MAX_ACTIONS && guard < 150) {
        guard++;
        if (stopRequested.current) {
          summary = "Stopped before finishing.";
          setPcSteps((prev) => [...prev, "■ Stopped."]);
          break;
        }

        const res = await fetch("/api/e2b/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            e2bKey,
            sandboxId: sandboxIdRef.current,
            provider: chat.provider,
            apiKey: key,
            model: chat.model,
            task,
            history: history.slice(-14),
            creds: creds ?? undefined,
          }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data?.error || "A step failed.");

        // The old computer expired (1h limit) and a fresh one was started.
        if (data.newSandboxId) {
          sandboxIdRef.current = data.newSandboxId;
          await savePcSandboxId(data.newSandboxId);
          setScreenUrl(null);
          await loadScreen(data.newSandboxId);
          history.push(data.actionText);
          setPcSteps((prev) => [...prev, `↻ ${data.actionText}`]);
          continue;
        }

        if (data.done) {
          summary = data.summary || "Done.";
          setPcSteps((prev) => [...prev, `✓ ${summary}`]);
          break;
        }

        if (data.ask) {
          const ask = data.ask as {
            kind: "login" | "choice" | "text";
            site?: string;
            question?: string;
            options?: string[];
          };

          if (ask.kind === "login") {
            const site = ask.site || "this site";
            let cred = findCredential(site);
            if (!cred) {
              const reply = await askUser({ kind: "login", site });
              if (stopRequested.current) continue;
              if (reply.type === "login") {
                cred = { email: reply.email, password: reply.password };
                if (reply.remember) {
                  savePcCredential(normSite(site), cred).catch(() => {});
                }
              }
            }
            if (cred) {
              creds = cred;
              history.push(
                `Login details for ${site} are ready. Click the email/username field and use type_secret with field "email", then click the password field and use type_secret with field "password", then submit.`
              );
              setPcSteps((prev) => [...prev, `🔑 Login details ready for ${site}`]);
            } else {
              setPcSteps((prev) => [...prev, `✋ Waiting while you log in to ${site} yourself…`]);
              await askUser({
                kind: "handoff",
                message: `Log in to ${site} on the computer (you have control now), then press continue.`,
              });
              if (stopRequested.current) continue;
              history.push(`The user logged in to ${site} themselves. Continue the task.`);
            }
          } else {
            const q = ask.question || "The agent needs your input.";
            const reply = await askUser(
              ask.kind === "choice"
                ? { kind: "choice", question: q, options: ask.options ?? [] }
                : { kind: "text", question: q }
            );
            if (stopRequested.current) continue;
            const answer = reply.type === "answer" ? reply.text : "";
            history.push(`Asked the user: "${q}" → the user answered: "${answer}"`);
            setPcSteps((prev) => [...prev, `❓ ${q} → ${answer}`]);
          }
          continue;
        }

        actions++;
        const line = `${actions}. ${data.thought ? data.thought + " → " : ""}${data.actionText}`;
        history.push(line);
        setPcSteps((prev) => [...prev, line]);
      }

      if (!summary) {
        summary = "Hit the step limit before finishing — the screen shows where it got to.";
        setPcSteps((prev) => [...prev, `… ${summary}`]);
      }
    } catch (err) {
      summary = `⚠️ ${err instanceof Error ? err.message : "The task failed."}`;
      setPcSteps((prev) => [...prev, summary]);
    } finally {
      pcRunningRef.current = false;
      setPcRunning(false);
      resolverRef.current = null;
      setPcRequest(null);
    }

    const record: ChatMessage[] = [
      ...baseMessages,
      { role: "user", content: `🖥️ Task on the computer: ${task}`, at: Date.now() },
      { role: "assistant", content: summary || "Finished.", at: Date.now() },
    ];
    patchChat(chat.id, { messages: record });
    updateChatMessages(user.uid, chat.id, record).catch(() => {});
    return record;
  }

  async function runPcCommands(cmds: PcCommand[], chat: Chat, base: ChatMessage[]) {
    let msgs = base;
    for (const c of cmds) {
      if (c.cmd === "start") {
        await startOrResumePc();
      } else if (c.cmd === "stop") {
        await pausePc();
      } else if (c.cmd === "task" && c.arg) {
        msgs = await runPcTask(c.arg, chat, msgs);
      }
    }
  }

  // ---- Chat ----

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !user || !activeChat || sending) return;

    const key = apiKeys[activeChat.provider];
    if (!key) {
      setSettingsOpen(true);
      return;
    }

    const chat = activeChat;
    const userMsg: ChatMessage = { role: "user", content: text, at: Date.now() };
    const afterUser = [...chat.messages, userMsg];
    patchChat(chat.id, { messages: afterUser });
    setDraft("");
    setSending(true);
    updateChatMessages(user.uid, chat.id, afterUser).catch(() => {});

    let pending: { cmds: PcCommand[]; base: ChatMessage[] } | null = null;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: chat.provider,
          apiKey: key,
          model: chat.model,
          messages: afterUser.map((m) => ({ role: m.role, content: m.content })),
          systemPrompt:
            `You are ${chat.agentName}, an AI teammate working inside AgenticVenus. Be direct and useful, and focus on getting real work done for the person you're talking to.` +
            (e2bKey ? PC_PROMPT : ""),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Request failed.");

      const { clean, cmds } = extractPcCommands(String(data.reply ?? ""));
      const botMsg: ChatMessage = {
        role: "assistant",
        content: clean || (cmds.length ? "On it — working on the computer." : "…"),
        at: Date.now(),
      };
      const afterReply = [...afterUser, botMsg];
      patchChat(chat.id, { messages: afterReply });
      await updateChatMessages(user.uid, chat.id, afterReply);
      if (cmds.length > 0) pending = { cmds, base: afterReply };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      const errMsg: ChatMessage = {
        role: "assistant",
        content: `⚠️ ${message}`,
        at: Date.now(),
      };
      const afterError = [...afterUser, errMsg];
      patchChat(chat.id, { messages: afterError });
      await updateChatMessages(user.uid, chat.id, afterError);
    } finally {
      setSending(false);
    }

    // Run the computer commands after the chat reply is shown (not awaited,
    // so the chat stays usable while the agent works).
    if (pending) void runPcCommands(pending.cmds, chat, pending.base);
  }

  // Manual task typed into the computer panel.
  function handleRunPcTask(task: string) {
    if (!activeChat) return;
    void runPcTask(task, activeChat, activeChat.messages);
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
      {!focusMode && (
        <Sidebar
          chats={chats}
          activeId={activeId}
          onSelect={setActiveId}
          onNewChat={() => setNewChatOpen(true)}
          userLabel={user.email ?? "Account"}
          onOpenApiKeys={() => setSettingsOpen(true)}
          onSignOut={() => signOut(auth)}
        />
      )}

      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {activeChat && (
            <header className="flex items-center justify-between border-b border-line px-6 py-3.5">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setFocusMode((v) => !v)}
                  title={focusMode ? "Show chat list" : "Focus mode — hide the chat list"}
                  className="rounded-lg p-1.5 text-muted hover:bg-panel2 hover:text-ink"
                >
                  {focusMode ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
                </button>
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
                    <span
                      className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                        pcStatus === "paused" ? "bg-faint" : "bg-avatar-teal"
                      }`}
                    />
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
            request={pcRequest}
            fullscreen={pcFullscreen}
            wide={focusMode}
            onClose={() => {
              setPcOpen(false);
              setPcFullscreen(false);
            }}
            onStart={() => void createPc()}
            onReload={() => {
              if (pcSandboxId) void loadScreen(pcSandboxId);
            }}
            onPause={() => void pausePc()}
            onDelete={handleDeletePc}
            onRunTask={handleRunPcTask}
            onStop={handleStop}
            onReply={handleReply}
            onToggleFullscreen={() => setPcFullscreen((v) => !v)}
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