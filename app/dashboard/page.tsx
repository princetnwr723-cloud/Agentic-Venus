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
  updateChatPc,
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

// ---- Per-chat computer session ----

type PcSession = {
  status: PcStatus;
  error: string | null;
  screenUrl: string | null;
  steps: string[];
  running: boolean;
  request: AgentRequest | null;
};

const EMPTY_SESSION: PcSession = {
  status: "idle",
  error: null,
  screenUrl: null,
  steps: [],
  running: false,
  request: null,
};

const IDLE_PAUSE_MS = 50 * 60 * 1000; // pause before E2B's 1 hour limit so nothing is lost

// ---- Chat → computer commands ----

type PcCommand = { cmd: "start" | "stop" | "task"; arg?: string };

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

You can operate this chat's own cloud Linux computer (terminal + web browser) on the user's behalf. Whenever a request needs it — browsing, web research, news, installing software, running commands, logging into sites, working with files or apps — finish your reply with a line like:
[[PC:task|<a clear, complete instruction for the computer agent>]]
To turn the computer on: [[PC:start]]. To shut it down while keeping everything saved: [[PC:stop]].
Only use these tags when they are actually needed, and never explain the tag syntax to the user. The computer agent asks the user itself for logins and one-time codes, so don't ask for passwords in chat.`;

// ---- Understanding "pc on / pc band / pc start kro aur ... karo" ----

const PC_WORDS = new Set(["pc", "computer", "desktop", "sandbox", "comp", "system"]);
const START_WORDS = ["on", "start", "chalu", "chalao", "chala", "resume", "wake", "open", "kholo", "khol", "shuru", "launch", "boot"];
const STOP_WORDS = ["off", "stop", "shutdown", "pause", "close", "band", "bandh", "bund", "sleep"];
const FILLER = new Set([
  "ko", "kro", "kr", "karo", "kar", "karna", "kardo", "do", "de", "dena", "please", "plz", "pls",
  "the", "my", "apna", "apne", "mera", "meri", "ka", "ki", "ke", "liye", "ek", "bhai", "bro", "yrr",
  "yaar", "ab", "abhi", "now", "it", "hai", "hain", "hoga", "then", "phir", "fir", "and", "aur", "air",
  "se", "me", "mein", "par", "pe", "na", "to", "hi", "bhi", "a", "i",
]);

function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else {
        i++;
        j++;
      }
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const isWordOf = (w: string, list: string[]) =>
  list.includes(w) || (w.length >= 4 && list.some((x) => x.length >= 4 && lev1(w, x)));

function analyzePcMessage(text: string): {
  pureCommand: "start" | "stop" | null;
  compound: boolean;
  stopAfter: boolean;
} {
  const t = text.toLowerCase();
  const words = t.split(/[^a-z\u0900-\u097f]+/).filter(Boolean);
  const mentionsPc = words.some((w) => PC_WORDS.has(w)) || /कंप्यूटर|पीसी/.test(t);
  if (!mentionsPc) return { pureCommand: null, compound: false, stopAfter: false };

  const hasStop = words.some((w) => isWordOf(w, STOP_WORDS)) || /बंद/.test(t);
  const hasStart = words.some((w) => isWordOf(w, START_WORDS)) || /चालू|शुरू/.test(t);
  const rest = words.filter(
    (w) =>
      !PC_WORDS.has(w) && !FILLER.has(w) && !isWordOf(w, START_WORDS) && !isWordOf(w, STOP_WORDS)
  );

  if ((hasStart || hasStop) && rest.length <= 1) {
    return { pureCommand: hasStop && !hasStart ? "stop" : hasStart ? "start" : "stop", compound: false, stopAfter: false };
  }
  if (hasStart && rest.length >= 2) {
    return { pureCommand: null, compound: true, stopAfter: hasStop };
  }
  return { pureCommand: null, compound: false, stopAfter: false };
}

function stuckHint(history: string[]): string | undefined {
  const last = history.slice(-3).map((l) => l.split("→").pop()?.trim() ?? "");
  if (last.length === 3 && last[0] && last[0] === last[1] && last[1] === last[2]) {
    return "You repeated the same action 3 times with no progress. Do something different: use shell, web_search, search or open_url instead of clicking again.";
  }
  return undefined;
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const {
    apiKeys,
    e2bKey,
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
  const [computerMode, setComputerMode] = useState(false);

  const [pcOpen, setPcOpen] = useState(false);
  const [pcFullscreen, setPcFullscreen] = useState(false);
  const [sessions, setSessions] = useState<Record<string, PcSession>>({});

  const sessionsRef = useRef<Record<string, PcSession>>({});
  const sandboxRef = useRef<Record<string, string | null>>({});
  const runningRef = useRef<Record<string, boolean>>({});
  const stopRef = useRef<Record<string, boolean>>({});
  const resolverRef = useRef<Record<string, ((r: RequestReply) => void) | null>>({});
  const lastTouchRef = useRef<Record<string, number>>({});
  const chatsRef = useRef<Chat[]>([]);
  const activeIdRef = useRef<string | null>(null);

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [routinePrefill, setRoutinePrefill] = useState<string | null>(null);
  const [runningRoutineId, setRunningRoutineId] = useState<string | null>(null);

  useEffect(() => {
    chatsRef.current = chats;
    for (const c of chats) {
      if (!(c.id in sandboxRef.current)) sandboxRef.current[c.id] = c.pcSandboxId ?? null;
    }
  }, [chats]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

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

  // Appends to the LATEST version of a chat, so a long computer task finishing
  // never overwrites messages sent while it was running.
  function appendMessages(chatId: string, msgs: ChatMessage[]) {
    if (!user) return;
    const base = chatsRef.current.find((c) => c.id === chatId)?.messages ?? [];
    const next = [...base, ...msgs];
    chatsRef.current = chatsRef.current.map((c) =>
      c.id === chatId ? { ...c, messages: next } : c
    );
    patchChat(chatId, { messages: next });
    updateChatMessages(user.uid, chatId, next).catch(() => {});
  }

  function patchSession(
    chatId: string,
    patch: Partial<PcSession> | ((s: PcSession) => Partial<PcSession>)
  ) {
    const cur = sessionsRef.current[chatId] ?? EMPTY_SESSION;
    const p = typeof patch === "function" ? patch(cur) : patch;
    const next = { ...sessionsRef.current, [chatId]: { ...cur, ...p } };
    sessionsRef.current = next;
    setSessions(next);
  }

  function pushStep(chatId: string, line: string) {
    patchSession(chatId, (s) => ({ steps: [...s.steps, line] }));
  }

  function touch(chatId: string) {
    lastTouchRef.current[chatId] = Date.now();
  }

  function setSandboxId(chatId: string, id: string | null) {
    sandboxRef.current[chatId] = id;
    patchChat(chatId, { pcSandboxId: id });
    if (user) updateChatPc(user.uid, chatId, id).catch(() => {});
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

  // ---- This chat's computer ----

  async function loadScreen(chatId: string, sandboxId: string): Promise<"ok" | "gone" | "error"> {
    if (!e2bKey) {
      setSettingsOpen(true);
      return "error";
    }
    patchSession(chatId, { status: "loading", error: null });
    try {
      const res = await fetch("/api/e2b/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: e2bKey, sandboxId }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not open the computer's screen.");
      patchSession(chatId, { screenUrl: data.url, status: "ready" });
      touch(chatId);
      return "ok";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not open the computer's screen.";
      if (msg.includes("SANDBOX_GONE")) {
        setSandboxId(chatId, null);
        patchSession(chatId, {
          status: "error",
          screenUrl: null,
          error: "Is chat ka purana computer expire ho gaya tha. Naya bana lo (Create computer).",
        });
        return "gone";
      }
      patchSession(chatId, { status: "error", error: msg });
      return "error";
    }
  }

  async function createPc(chatId: string): Promise<string | null> {
    if (!user) return null;
    if (!e2bKey) {
      setSettingsOpen(true);
      return null;
    }
    if (sessionsRef.current[chatId]?.status === "creating") return null;
    if (activeIdRef.current === chatId) setPcOpen(true);
    patchSession(chatId, { status: "creating", error: null, screenUrl: null });
    try {
      const res = await fetch("/api/e2b/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: e2bKey }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not create a computer.");

      setSandboxId(chatId, data.sandboxId);
      if (data.persistence === "none") {
        setPcMessage(
          "ℹ️ Is E2B version mein auto-pause nahi mila. Computer 50 min idle rehne par app khud pause karegi (data safe), isliye tab khuli rakhna."
        );
      }
      const r = await loadScreen(chatId, data.sandboxId);
      return r === "ok" ? (data.sandboxId as string) : null;
    } catch (err) {
      patchSession(chatId, {
        status: "error",
        error: err instanceof Error ? err.message : "Could not create a computer.",
      });
      return null;
    }
  }

  async function startOrResumePc(chatId: string): Promise<string | null> {
    if (!e2bKey) {
      setSettingsOpen(true);
      return null;
    }
    if (activeIdRef.current === chatId) setPcOpen(true);
    const id = sandboxRef.current[chatId] ?? null;
    if (!id) return createPc(chatId);
    if (sessionsRef.current[chatId]?.status === "ready") return id;
    const r = await loadScreen(chatId, id);
    if (r === "ok") return id;
    if (r === "gone") return createPc(chatId);
    return null;
  }

  async function pausePc(chatId: string): Promise<{ ok: boolean; error?: string }> {
    const id = sandboxRef.current[chatId] ?? null;
    if (!user || !e2bKey || !id) return { ok: false, error: "Is chat ka computer abhi bana hi nahi hai." };
    if (runningRef.current[chatId]) {
      const error = "Pehle chalta hua task Stop karo, phir computer band hoga.";
      setPcMessage(error);
      return { ok: false, error };
    }
    const prev = sessionsRef.current[chatId]?.status ?? "idle";
    patchSession(chatId, { status: "loading", error: null });
    try {
      const res = await fetch("/api/e2b/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: e2bKey, sandboxId: id }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not turn the computer off.");
      patchSession(chatId, { screenUrl: null, status: "paused" });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not turn the computer off.";
      if (msg.includes("SANDBOX_GONE")) {
        setSandboxId(chatId, null);
        patchSession(chatId, { status: "idle", screenUrl: null, error: null });
        return { ok: true };
      }
      patchSession(chatId, { status: prev === "loading" ? "ready" : prev, error: msg });
      setPcMessage(`⚠️ Computer band nahi ho paya: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  async function deletePc(chatId: string) {
    const id = sandboxRef.current[chatId] ?? null;
    if (!user || !e2bKey || !id) return;
    if (!window.confirm("Is chat ka computer hamesha ke liye delete karein? Usme saved sab kuch chala jayega.")) {
      return;
    }
    patchSession(chatId, { status: "loading", error: null });
    try {
      const res = await fetch("/api/e2b/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: e2bKey, sandboxId: id }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not delete the computer.");

      setSandboxId(chatId, null);
      patchSession(chatId, { screenUrl: null, steps: [], status: "idle", error: null });
      setPcFullscreen(false);
    } catch (err) {
      patchSession(chatId, {
        status: "error",
        error: err instanceof Error ? err.message : "Could not delete the computer.",
      });
    }
  }

  function handlePcClick() {
    setPcMessage(null);
    if (pcOpen) {
      setPcOpen(false);
      setPcFullscreen(false);
      return;
    }
    if (!e2bKey) {
      setPcMessage("Pehle E2B API key add karo — settings khol raha hoon.");
      setSettingsOpen(true);
      return;
    }
    setPcOpen(true);
  }

  useEffect(() => {
    if (!pcOpen || !activeChat || !e2bKey) return;
    const id = activeChat.pcSandboxId ?? null;
    const s = sessionsRef.current[activeChat.id] ?? EMPTY_SESSION;
    if (id && s.status === "idle") void loadScreen(activeChat.id, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcOpen, activeChat?.id]);

  // Safety net: pause idle computers before E2B's 1 hour limit, so the data is kept.
  useEffect(() => {
    if (!user || !e2bKey) return;
    const iv = setInterval(() => {
      for (const [chatId, s] of Object.entries(sessionsRef.current)) {
        if (s.status !== "ready" || s.running || runningRef.current[chatId]) continue;
        const last = lastTouchRef.current[chatId] ?? 0;
        if (last && Date.now() - last > IDLE_PAUSE_MS) {
          void pausePc(chatId).then((r) => {
            if (r.ok) {
              setPcMessage(
                "💾 Computer 50 min se idle tha, isliye safe-pause kar diya. Data saved hai — panel mein Turn on dabao, wahin se chalega."
              );
            }
          });
        }
      }
    }, 60_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, e2bKey]);

  // ---- Agent asks the user something ----

  function askUser(chatId: string, req: AgentRequest): Promise<RequestReply> {
    return new Promise((resolve) => {
      resolverRef.current[chatId] = resolve;
      patchSession(chatId, { request: req });
    });
  }

  function handleReply(chatId: string, r: RequestReply) {
    const resolve = resolverRef.current[chatId];
    resolverRef.current[chatId] = null;
    patchSession(chatId, { request: null });
    resolve?.(r);
  }

  function handleStop(chatId: string) {
    stopRef.current[chatId] = true;
    handleReply(chatId, { type: "answer", text: "" });
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

  // Turns raw agent output into a clear final answer for the user.
  async function composeReport(
    chat: Chat,
    key: string,
    m: { task: string; summary: string; notes: string[]; steps: string[]; outputs: string[] }
  ): Promise<string | null> {
    try {
      const prompt = [
        "You are writing the FINAL message to the user after a computer agent finished their task.",
        "Rules: write in the same language and style as the user's task (Hinglish stays Hinglish). Use markdown. Start with ONE line for the outcome (✅ done / ⚠️ partly done / ❌ failed). Then short bullets of what was done on the computer. Then the concrete results: facts, names, numbers, versions, file paths, and links with their source names. If anything failed or is unfinished, say exactly what and the next step. Never invent anything that is not in the material below. Be concise — no filler.",
        "",
        `USER'S TASK:\n${m.task}`,
        "",
        `AGENT'S OWN SUMMARY:\n${m.summary}`,
        "",
        `NOTES THE AGENT SAVED:\n${m.notes.length ? m.notes.map((n) => `- ${n}`).join("\n") : "(none)"}`,
        "",
        `LAST STEPS:\n${m.steps.slice(-25).join("\n")}`,
        "",
        `KEY COMMAND / PAGE OUTPUTS:\n${m.outputs.length ? m.outputs.join("\n---\n") : "(none)"}`,
      ].join("\n");

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: chat.provider,
          apiKey: key,
          model: chat.model,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await readJson(res);
      if (!res.ok || !data.reply) return null;
      return String(data.reply).trim();
    } catch {
      return null;
    }
  }

  // ---- Running a task on this chat's computer ----

  async function runPcTask(
    chat: Chat,
    task: string,
    logTask: boolean,
    opts?: { stopAfter?: boolean }
  ) {
    const chatId = chat.id;
    if (!user || !e2bKey) return;
    if (runningRef.current[chatId]) {
      setPcMessage("Is chat ka computer abhi ek task chala raha hai — ek time pe ek hi task.");
      return;
    }
    const key = apiKeys[chat.provider];
    if (!key) {
      setSettingsOpen(true);
      return;
    }

    runningRef.current[chatId] = true;
    stopRef.current[chatId] = false;
    patchSession(chatId, { running: true, steps: [`▶ ${task}`], request: null });
    if (activeIdRef.current === chatId) setPcOpen(true);

    const MAX_ACTIONS = 50;
    const history: string[] = [];
    const notes: string[] = [];
    const outputs: string[] = [];
    let lastOutput = "";
    let creds: SavedLogin | null = null;
    let summary = "";
    let completed = false;
    let invalidStreak = 0;
    let finalText = "";

    try {
      const startedId = await startOrResumePc(chatId);
      if (!startedId) {
        throw new Error(
          sessionsRef.current[chatId]?.error || "Computer start nahi ho paya — panel mein wajah dekho."
        );
      }

      let actions = 0;
      let guard = 0;
      while (actions < MAX_ACTIONS && guard < 200) {
        guard++;
        if (stopRef.current[chatId]) {
          summary = "Stopped before finishing.";
          pushStep(chatId, "■ Stopped.");
          break;
        }

        const res = await fetch("/api/e2b/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            e2bKey,
            sandboxId: sandboxRef.current[chatId],
            provider: chat.provider,
            apiKey: key,
            model: chat.model,
            task,
            history: history.slice(-16),
            notes: notes.slice(-25),
            hint: stuckHint(history),
            stepNo: actions + 1,
            maxSteps: MAX_ACTIONS,
            lastOutput: lastOutput || undefined,
            creds: creds ?? undefined,
          }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data?.error || "A step failed.");
        touch(chatId);

        if (data.newSandboxId) {
          setSandboxId(chatId, data.newSandboxId);
          patchSession(chatId, { screenUrl: null });
          await loadScreen(chatId, data.newSandboxId);
          history.push(data.actionText);
          pushStep(chatId, `↻ ${data.actionText}`);
          continue;
        }

        if (data.invalid) {
          invalidStreak++;
          if (invalidStreak >= 4) {
            throw new Error(
              "Model baar-baar galat format mein jawab de raha hai. Chat ke model picker se koi strong vision model chuno (Claude Sonnet / GPT-4o)."
            );
          }
          continue;
        }
        invalidStreak = 0;

        if (data.done) {
          summary = data.summary || "Done.";
          completed = true;
          pushStep(chatId, `✓ ${summary}`);
          break;
        }

        if (data.ask) {
          lastOutput = "";
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
              const reply = await askUser(chatId, { kind: "login", site });
              if (stopRef.current[chatId]) continue;
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
              pushStep(chatId, `🔑 Login details ready for ${site}`);
            } else {
              pushStep(chatId, `✋ Waiting while you log in to ${site} yourself…`);
              await askUser(chatId, {
                kind: "handoff",
                message: `Computer pe ${site} mein login karo (control ab tumhare paas hai), phir Continue dabao.`,
              });
              if (stopRef.current[chatId]) continue;
              history.push(`The user logged in to ${site} themselves. Continue the task.`);
            }
          } else {
            const q = ask.question || "The agent needs your input.";
            const reply = await askUser(
              chatId,
              ask.kind === "choice"
                ? { kind: "choice", question: q, options: ask.options ?? [] }
                : { kind: "text", question: q }
            );
            if (stopRef.current[chatId]) continue;
            const answer = reply.type === "answer" ? reply.text : "";
            history.push(`Asked the user: "${q}" → the user answered: "${answer}"`);
            pushStep(chatId, `❓ ${q} → ${answer}`);
          }
          continue;
        }

        if (data.note) notes.push(String(data.note));

        if (typeof data.output === "string" && data.output) {
          lastOutput = data.output;
          outputs.push(`${data.actionText}\n${data.output.slice(0, 700)}`);
          if (outputs.length > 5) outputs.shift();
        } else {
          lastOutput = "";
        }

        actions++;
        const line = `${actions}. ${data.thought ? data.thought + " → " : ""}${data.actionText}`;
        history.push(line);
        pushStep(chatId, line);
      }

      if (!summary) {
        summary = "Step limit tak pahunch gaya — jitna hua utna steps mein dikh raha hai.";
        pushStep(chatId, `… ${summary}`);
      }

      finalText = summary;
      if (completed) {
        pushStep(chatId, "✍️ Final report bana raha hoon…");
        const report = await composeReport(chat, key, {
          task,
          summary,
          notes,
          steps: history,
          outputs,
        });
        if (report) finalText = report;
      }
    } catch (err) {
      finalText = `⚠️ ${err instanceof Error ? err.message : "The task failed."}`;
      pushStep(chatId, finalText);
    } finally {
      runningRef.current[chatId] = false;
      resolverRef.current[chatId] = null;
      patchSession(chatId, { running: false, request: null });
    }

    const at = Date.now();
    appendMessages(
      chatId,
      logTask
        ? [
            { role: "user", content: `🖥️ Task on the computer: ${task}`, at },
            { role: "assistant", content: finalText || "Finished.", at },
          ]
        : [{ role: "assistant", content: finalText || "Finished.", at }]
    );

    if (opts?.stopAfter) {
      const r = await pausePc(chatId);
      appendMessages(chatId, [
        {
          role: "assistant",
          content: r.ok
            ? "✅ Computer band kar diya. Sab kuch saved hai — dobara on karoge to wahin se chalega."
            : `⚠️ Computer band nahi ho paya: ${r.error ?? "unknown error"}`,
          at: Date.now(),
        },
      ]);
    }
  }

  async function runPcCommands(cmds: PcCommand[], chat: Chat) {
    for (const c of cmds) {
      if (c.cmd === "start") {
        await startOrResumePc(chat.id);
      } else if (c.cmd === "stop") {
        await pausePc(chat.id);
      } else if (c.cmd === "task" && c.arg) {
        await runPcTask(chat, c.arg, true);
      }
    }
  }

  // ---- Chat ----

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !user || !activeChat || sending) return;

    const chat = activeChat;
    const analysis = e2bKey
      ? analyzePcMessage(text)
      : { pureCommand: null, compound: false, stopAfter: false };
    const key = apiKeys[chat.provider];

    if (!analysis.pureCommand && !key) {
      setSettingsOpen(true);
      return;
    }

    appendMessages(chat.id, [{ role: "user", content: text, at: Date.now() }]);
    setDraft("");

    // 1) A plain "pc on" / "pc band kr do".
    if (analysis.pureCommand) {
      setSending(true);
      let reply: string;
      try {
        if (analysis.pureCommand === "start") {
          const id = await startOrResumePc(chat.id);
          reply = id
            ? "✅ Computer on hai — screen panel mein dikh rahi hai."
            : `⚠️ Computer on nahi ho paya: ${sessionsRef.current[chat.id]?.error ?? "unknown error"}`;
        } else {
          const r = await pausePc(chat.id);
          reply = r.ok
            ? sandboxRef.current[chat.id]
              ? "✅ Computer band kar diya. Files, apps aur logins saved hain — dobara on karoge to wahin se chalega."
              : "✅ Is chat ka computer already band/expire hai."
            : `⚠️ ${r.error ?? "Computer band nahi ho paya."}`;
        }
      } catch (err) {
        reply = `⚠️ ${err instanceof Error ? err.message : "Something went wrong."}`;
      } finally {
        setSending(false);
      }
      appendMessages(chat.id, [{ role: "assistant", content: reply, at: Date.now() }]);
      return;
    }

    // 2) Computer mode, or "pc start kro aur ... karo": the message is a task.
    if (e2bKey && (computerMode || analysis.compound)) {
      appendMessages(chat.id, [
        {
          role: "assistant",
          content: "On it — computer start karke kaam shuru kar raha hoon. Progress panel mein dikhega.",
          at: Date.now(),
        },
      ]);
      void runPcTask(chat, text, false, { stopAfter: analysis.stopAfter });
      return;
    }

    // 3) Normal chat; the model may add [[PC:...]] tags.
    setSending(true);
    let cmds: PcCommand[] = [];
    try {
      const history = (chatsRef.current.find((c) => c.id === chat.id)?.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: chat.provider,
          apiKey: key,
          model: chat.model,
          messages: history,
          systemPrompt:
            `You are ${chat.agentName}, an AI teammate working inside AgenticVenus. Be direct and useful, and focus on getting real work done for the person you're talking to.` +
            (e2bKey ? PC_PROMPT : ""),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Request failed.");

      const parsed = extractPcCommands(String(data.reply ?? ""));
      cmds = parsed.cmds;
      appendMessages(chat.id, [
        {
          role: "assistant",
          content: parsed.clean || (cmds.length ? "On it — computer pe kaam kar raha hoon." : "…"),
          at: Date.now(),
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      appendMessages(chat.id, [{ role: "assistant", content: `⚠️ ${message}`, at: Date.now() }]);
    } finally {
      setSending(false);
    }

    if (cmds.length > 0) void runPcCommands(cmds, chat);
  }

  function handleRunPcTask(task: string) {
    if (!activeChat) return;
    void runPcTask(activeChat, task, true);
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

      appendMessages(activeChat.id, [
        { role: "user", content: `🔁 Routine: ${routine.name}`, at: Date.now() },
        { role: "assistant", content: data.reply, at: Date.now() },
      ]);
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

  const session: PcSession = activeChat ? sessions[activeChat.id] ?? EMPTY_SESSION : EMPTY_SESSION;
  const activeSandboxId = activeChat?.pcSandboxId ?? null;

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
                      ? "Hide this chat's computer"
                      : activeSandboxId
                      ? "Show this chat's computer"
                      : "Give this chat a cloud computer"
                  }
                  className={`relative rounded-lg p-2 hover:bg-panel2 hover:text-ink ${
                    pcOpen ? "bg-panel2 text-ink" : "text-muted"
                  }`}
                >
                  <Monitor size={17} />
                  {activeSandboxId && (
                    <span
                      className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                        session.status === "paused" ? "bg-faint" : "bg-avatar-teal"
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
                {e2bKey && (
                  <button
                    type="button"
                    onClick={() => setComputerMode((v) => !v)}
                    aria-pressed={computerMode}
                    title={
                      computerMode
                        ? "Computer mode ON — your message goes straight to the computer as a task"
                        : "Computer mode — send your message straight to the computer as a task"
                    }
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-2 text-xs ${
                      computerMode
                        ? "bg-gold font-medium text-bg"
                        : "text-muted hover:bg-panel2 hover:text-ink"
                    }`}
                  >
                    <Monitor size={15} />
                    {computerMode && "Computer"}
                  </button>
                )}
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    computerMode ? "Computer ko task do…" : `Message ${activeChat.agentName}`
                  }
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

        {pcOpen && activeChat && (
          <PcPanel
            key={activeChat.id}
            hasComputer={Boolean(activeSandboxId)}
            status={session.status}
            error={session.error}
            screenUrl={session.screenUrl}
            steps={session.steps}
            running={session.running}
            request={session.request}
            fullscreen={pcFullscreen}
            wide={focusMode}
            onClose={() => {
              setPcOpen(false);
              setPcFullscreen(false);
            }}
            onStart={() => void createPc(activeChat.id)}
            onReload={() => {
              const id = sandboxRef.current[activeChat.id];
              if (id) void loadScreen(activeChat.id, id);
            }}
            onPause={() => void pausePc(activeChat.id)}
            onDelete={() => void deletePc(activeChat.id)}
            onRunTask={handleRunPcTask}
            onStop={() => handleStop(activeChat.id)}
            onReply={(r) => handleReply(activeChat.id, r)}
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