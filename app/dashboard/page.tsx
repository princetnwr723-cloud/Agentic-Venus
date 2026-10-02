"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Clock, Monitor, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useKeys, type SavedLogin } from "@/lib/keys-context";
import {
  listChats, createChat, updateChatMessages, updateChatModel, updateChatPc, updateChatCode,
  type Chat, type ChatMessage,
} from "@/lib/chats";
import { listCustomAgents, createCustomAgent, type CustomAgent } from "@/lib/agents";
import {
  listRoutinesForChat, createRoutine, setRoutineEnabled, deleteRoutine, recordManualRun, type Routine,
} from "@/lib/routines";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import { getModelPref, setModelPref } from "@/lib/model-pref";
import {
  addMemory, brainPrompt, forgetMemory, loadBrain, parseSkillMarkdown, reflect, saveSkill, skillFromText,
  type Brain,
} from "@/lib/brain";
import { runCodeAgent, type CodeHooks } from "@/lib/code-agent";
import { getCodeProject, newCodeProject, saveCodeProject } from "@/lib/code-store";
import type { VenusProject } from "@/lib/venus";
import { runPipeline, signedUrl, type PipelineEnv } from "@/lib/venus-pipeline";
import type { AvatarColor } from "@/lib/bots";
import Sidebar from "@/components/dashboard/Sidebar";
import ChatThread from "@/components/dashboard/ChatThread";
import ModelPicker from "@/components/dashboard/ModelPicker";
import NewChatModal from "@/components/dashboard/NewChatModal";
import SettingsModal from "@/components/dashboard/SettingsModal";
import RoutinesPanel from "@/components/dashboard/RoutinesPanel";
import FirstKeyGate from "@/components/dashboard/FirstKeyGate";
import PcPanel, { type PcStatus, type AgentRequest, type RequestReply } from "@/components/dashboard/PcPanel";
import BotAvatar from "@/components/BotAvatar";

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Server returned ${res.status}: ${text.slice(0, 200) || "(empty response)"}` };
  }
}

function defaultProviderAndModel(apiKeys: Partial<Record<ProviderId, string>>): { provider: ProviderId; model: string } {
  const pref = getModelPref();
  if (pref && apiKeys[pref.provider]) return pref;
  const found = PROVIDERS.find((p) => apiKeys[p.id]);
  const provider = found?.id ?? PROVIDERS[0].id;
  return { provider, model: providerMeta(provider).models[0] };
}

const normSite = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type PcSession = {
  status: PcStatus; error: string | null; screenUrl: string | null; steps: string[]; running: boolean; request: AgentRequest | null;
};
const EMPTY_SESSION: PcSession = { status: "idle", error: null, screenUrl: null, steps: [], running: false, request: null };

const IDLE_PAUSE_MS = 50 * 60 * 1000;
const RUN_CYCLE_MS = 55 * 60 * 1000;

type Cmd = { cmd: "start" | "stop" | "task" | "venus" | "code" | "skill" | "memory"; arg?: string };

function extractCommands(text: string): { clean: string; cmds: Cmd[] } {
  const cmds: Cmd[] = [];
  const clean = text
    .replace(/\[\[(PC|VENUS|CODE|SKILL|MEMORY):([\s\S]*?)\]\]/gi, (_m, tag: string, inner: string) => {
      const t = String(inner).trim();
      const T = tag.toUpperCase();
      if (T === "VENUS" && t) cmds.push({ cmd: "venus", arg: t });
      else if (T === "CODE" && t) cmds.push({ cmd: "code", arg: t });
      else if (T === "SKILL") cmds.push({ cmd: "skill", arg: t.replace(/^install\s*\|?\s*/i, "") });
      else if (T === "MEMORY") cmds.push({ cmd: "memory", arg: t });
      else if (T === "PC") {
        const lower = t.toLowerCase();
        if (lower === "start" || lower === "stop") cmds.push({ cmd: lower as "start" | "stop" });
        else {
          const m = /^task\s*[|:]\s*([\s\S]*)$/i.exec(t);
          const arg = (m ? m[1] : t.replace(/^\|/, "")).trim();
          if (arg) cmds.push({ cmd: "task", arg });
        }
      }
      return "";
    })
    .trim();
  return { clean, cmds };
}

const PC_PROMPT = `

You work through tools that you trigger by ending your reply with tags (never explain the tag syntax to the user, and only use a tag when it is really needed):
- Cloud computer (browser + terminal): [[PC:task|<clear, complete instruction for the computer agent>]]. Turn it on: [[PC:start]]. Shut it down (everything stays saved): [[PC:stop]].
- Coding (build or change websites, apps, scripts; debug; run projects): [[CODE:<detailed instruction>]] — Venus Code, a full coding agent with its own workspace.
- Video, reel, animation or motion graphics: [[VENUS:<detailed brief: topic, key points, tone, length in seconds, format 16:9, 9:16 or 1:1>]].
- Save a durable fact about the user: [[MEMORY:add|<fact>]]. Forget something: [[MEMORY:forget|<keyword>]].
- Install a skill the user shared (link or pasted text): [[SKILL:install|<link or text>]].
The computer agent asks the user itself for logins and one-time codes, so never ask for passwords in chat.`;

const PC_WORDS = new Set(["pc", "computer", "desktop", "sandbox", "comp", "system"]);
const START_WORDS = ["on", "start", "chalu", "chalao", "chala", "resume", "wake", "open", "kholo", "khol", "shuru", "launch", "boot"];
const STOP_WORDS = ["off", "stop", "shutdown", "pause", "close", "band", "bandh", "bund", "sleep"];
const FILLER = new Set([
  "ko", "kro", "kr", "karo", "kar", "karna", "kardo", "do", "de", "dena", "please", "plz", "pls", "the", "my",
  "apna", "apne", "mera", "meri", "ka", "ki", "ke", "liye", "ek", "bhai", "bro", "yrr", "yaar", "ab", "abhi",
  "now", "it", "hai", "hain", "hoga", "then", "phir", "fir", "and", "aur", "air", "se", "me", "mein", "par",
  "pe", "na", "to", "hi", "bhi", "a", "i",
]);

function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; }
    else {
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else { i++; j++; }
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const isWordOf = (w: string, list: string[]) => list.includes(w) || (w.length >= 4 && list.some((x) => x.length >= 4 && lev1(w, x)));

function analyzePcMessage(text: string): { pureCommand: "start" | "stop" | null; compound: boolean; stopAfter: boolean } {
  const t = text.toLowerCase();
  const words = t.split(/[^a-z\u0900-\u097f]+/).filter(Boolean);
  const mentionsPc = words.some((w) => PC_WORDS.has(w)) || /कंप्यूटर|पीसी/.test(t);
  if (!mentionsPc) return { pureCommand: null, compound: false, stopAfter: false };
  const hasStop = words.some((w) => isWordOf(w, STOP_WORDS)) || /बंद/.test(t);
  const hasStart = words.some((w) => isWordOf(w, START_WORDS)) || /चालू|शुरू/.test(t);
  const rest = words.filter((w) => !PC_WORDS.has(w) && !FILLER.has(w) && !isWordOf(w, START_WORDS) && !isWordOf(w, STOP_WORDS));
  if ((hasStart || hasStop) && rest.length <= 1) {
    return { pureCommand: hasStop && !hasStart ? "stop" : hasStart ? "start" : "stop", compound: false, stopAfter: false };
  }
  if (hasStart && rest.length >= 2) return { pureCommand: null, compound: true, stopAfter: hasStop };
  return { pureCommand: null, compound: false, stopAfter: false };
}

function stuckHint(history: string[]): string | undefined {
  const last = history.slice(-3).map((l) => l.split("→").pop()?.trim() ?? "");
  if (last.length === 3 && last[0] && last[0] === last[1] && last[1] === last[2]) {
    return "You repeated the same action 3 times with no progress. Do something different: use another tool instead of repeating this one.";
  }
  return undefined;
}

function guessVenusOptions(brief: string): { seconds: number; aspect: "16:9" | "9:16" | "1:1" } {
  const b = brief.toLowerCase();
  const aspect = /9:16|reel|shorts?|tiktok|vertical|story/.test(b) ? "9:16" : /1:1|square/.test(b) ? "1:1" : "16:9";
  let seconds = 30;
  const m = /(\d{2})\s*(?:s\b|sec|second)/.exec(b);
  if (m) seconds = Number(m[1]);
  else if (/(1|one|a)\s*minute|60\s*s/.test(b)) seconds = 60;
  return { seconds: Math.min(60, Math.max(15, seconds)), aspect };
}

type PlanStep = { title: string; goal: string; tool?: string };

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const { apiKeys, e2bKey, pcCredentials, savePcCredential, loading: keysLoading } = useKeys();
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
  const [cfg, setCfg] = useState<{ supabase: boolean; pexels: boolean } | null>(null);
  const [venusRun, setVenusRun] = useState<{ title: string; label: string; value: number | null } | null>(null);
  const [codeRun, setCodeRun] = useState<{ title: string; label: string } | null>(null);

  const [pcOpen, setPcOpen] = useState(false);
  const [pcFullscreen, setPcFullscreen] = useState(false);
  const [sessions, setSessions] = useState<Record<string, PcSession>>({});

  const sessionsRef = useRef<Record<string, PcSession>>({});
  const sandboxRef = useRef<Record<string, string | null>>({});
  const runningRef = useRef<Record<string, boolean>>({});
  const stopRef = useRef<Record<string, boolean>>({});
  const resolverRef = useRef<Record<string, ((r: RequestReply) => void) | null>>({});
  const lastTouchRef = useRef<Record<string, number>>({});
  const runStartRef = useRef<Record<string, number>>({});
  const chatsRef = useRef<Chat[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const venusBusyRef = useRef(false);
  const codeBusyRef = useRef(false);
  const brainRef = useRef<Brain>({ memories: [], skills: [] });

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [routinePrefill, setRoutinePrefill] = useState<string | null>(null);
  const [runningRoutineId, setRunningRoutineId] = useState<string | null>(null);

  useEffect(() => {
    chatsRef.current = chats;
    for (const c of chats) if (!(c.id in sandboxRef.current)) sandboxRef.current[c.id] = c.pcSandboxId ?? null;
  }, [chats]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { if (!authLoading && !user) router.replace("/"); }, [authLoading, user, router]);
  useEffect(() => { fetch("/api/venus/media").then((r) => r.json()).then(setCfg).catch(() => {}); }, []);

  async function refreshBrain() {
    if (!user) return;
    brainRef.current = await loadBrain(user.uid).catch(() => brainRef.current);
  }

  useEffect(() => {
    if (!user) return;
    refreshBrain();
    Promise.all([listChats(user.uid), listCustomAgents(user.uid)]).then(([loadedChats, loadedAgents]) => {
      setChats(loadedChats);
      setCustomAgents(loadedAgents);
      setChatsLoaded(true);
      if (loadedChats.length > 0) setActiveId(loadedChats[0].id);
      for (const c of loadedChats) if (c.pcSandboxId && c.pcPaused) patchSession(c.id, { status: "paused" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const activeChat = useMemo(() => chats.find((c) => c.id === activeId) ?? null, [chats, activeId]);

  useEffect(() => {
    if (!user || !activeChat) { setRoutines([]); return; }
    listRoutinesForChat(user.uid, activeChat.id).then(setRoutines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeChat?.id]);

  const hasAnyKey = Object.values(apiKeys).some(Boolean);

  function patchChat(id: string, patch: Partial<Chat>) {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function appendMessages(chatId: string, msgs: ChatMessage[]) {
    if (!user) return;
    const base = chatsRef.current.find((c) => c.id === chatId)?.messages ?? [];
    const next = [...base, ...msgs];
    chatsRef.current = chatsRef.current.map((c) => (c.id === chatId ? { ...c, messages: next } : c));
    patchChat(chatId, { messages: next });
    updateChatMessages(user.uid, chatId, next).catch(() => {});
  }
  const say = (chatId: string, content: string) => appendMessages(chatId, [{ role: "assistant", content, at: Date.now() }]);

  function patchSession(chatId: string, patch: Partial<PcSession> | ((s: PcSession) => Partial<PcSession>)) {
    const cur = sessionsRef.current[chatId] ?? EMPTY_SESSION;
    const p = typeof patch === "function" ? patch(cur) : patch;
    const next = { ...sessionsRef.current, [chatId]: { ...cur, ...p } };
    sessionsRef.current = next;
    setSessions(next);
  }
  const pushStep = (chatId: string, line: string) => patchSession(chatId, (s) => ({ steps: [...s.steps, line] }));
  const touch = (chatId: string) => { lastTouchRef.current[chatId] = Date.now(); };

  function setSandboxId(chatId: string, id: string | null, paused = false) {
    sandboxRef.current[chatId] = id;
    patchChat(chatId, { pcSandboxId: id, pcPaused: paused });
    if (user) updateChatPc(user.uid, chatId, id, paused).catch(() => {});
  }
  function setPausedFlag(chatId: string, paused: boolean) {
    const id = sandboxRef.current[chatId] ?? null;
    patchChat(chatId, { pcPaused: paused });
    if (user && id) updateChatPc(user.uid, chatId, id, paused).catch(() => {});
  }

  async function handlePickAgent(agent: { name: string; color: AvatarColor }) {
    if (!user) return;
    const { provider, model } = defaultProviderAndModel(apiKeys);
    const chat = await createChat(user.uid, { agentName: agent.name, agentColor: agent.color, provider, model });
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
    setModelPref(provider, model);
    await updateChatModel(user.uid, activeChat.id, provider, model);
  }

  // ---- This chat's computer ----

  async function loadScreen(chatId: string, sandboxId: string): Promise<"ok" | "gone" | "error"> {
    if (!e2bKey) { setSettingsOpen(true); return "error"; }
    const wasPaused = sessionsRef.current[chatId]?.status === "paused";
    patchSession(chatId, { status: "loading", error: null });
    try {
      const res = await fetch("/api/e2b/screen", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: e2bKey, sandboxId }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not open the computer's screen.");
      patchSession(chatId, { screenUrl: data.url, status: "ready" });
      touch(chatId);
      if (chatsRef.current.find((c) => c.id === chatId)?.pcPaused) setPausedFlag(chatId, false);
      if (wasPaused || !runStartRef.current[chatId]) runStartRef.current[chatId] = Date.now();
      return "ok";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not open the computer's screen.";
      if (msg.includes("SANDBOX_GONE")) {
        setSandboxId(chatId, null);
        patchSession(chatId, { status: "error", screenUrl: null, error: "This chat's old computer has expired. Create a new one." });
        return "gone";
      }
      patchSession(chatId, { status: "error", error: msg });
      return "error";
    }
  }

  async function createPc(chatId: string): Promise<string | null> {
    if (!user) return null;
    if (!e2bKey) { setSettingsOpen(true); return null; }
    if (sessionsRef.current[chatId]?.status === "creating") return null;
    if (activeIdRef.current === chatId) setPcOpen(true);
    patchSession(chatId, { status: "creating", error: null, screenUrl: null });
    try {
      const res = await fetch("/api/e2b/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: e2bKey }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not create a computer.");
      setSandboxId(chatId, data.sandboxId);
      runStartRef.current[chatId] = Date.now();
      if (data.persistence === "none") {
        setPcMessage("ℹ️ This E2B version has no auto-pause. The app will pause/resume the computer for you (data stays safe), so keep this tab open.");
      }
      const r = await loadScreen(chatId, data.sandboxId);
      return r === "ok" ? (data.sandboxId as string) : null;
    } catch (err) {
      patchSession(chatId, { status: "error", error: err instanceof Error ? err.message : "Could not create a computer." });
      return null;
    }
  }

  async function startOrResumePc(chatId: string): Promise<string | null> {
    if (!e2bKey) { setSettingsOpen(true); return null; }
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
    if (!user || !e2bKey || !id) return { ok: false, error: "This chat has no computer yet." };
    if (runningRef.current[chatId]) {
      const error = "Stop the running task first, then turn the computer off.";
      setPcMessage(error);
      return { ok: false, error };
    }
    const prev = sessionsRef.current[chatId]?.status ?? "idle";
    patchSession(chatId, { status: "loading", error: null });
    try {
      const res = await fetch("/api/e2b/pause", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: e2bKey, sandboxId: id }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not turn the computer off.");
      patchSession(chatId, { screenUrl: null, status: "paused" });
      setPausedFlag(chatId, true);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not turn the computer off.";
      if (msg.includes("SANDBOX_GONE")) {
        setSandboxId(chatId, null);
        patchSession(chatId, { status: "idle", screenUrl: null, error: null });
        return { ok: true };
      }
      patchSession(chatId, { status: prev === "loading" ? "ready" : prev, error: msg });
      setPcMessage(`⚠️ Could not turn the computer off: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  async function cyclePc(chatId: string): Promise<boolean> {
    const id = sandboxRef.current[chatId] ?? null;
    if (!id || !e2bKey) return false;
    try {
      const res = await fetch("/api/e2b/pause", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: e2bKey, sandboxId: id }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "pause failed");
      patchSession(chatId, { screenUrl: null, status: "paused" });
      return (await loadScreen(chatId, id)) === "ok";
    } catch {
      return false;
    }
  }

  async function deletePc(chatId: string) {
    const id = sandboxRef.current[chatId] ?? null;
    if (!user || !e2bKey || !id) return;
    if (!window.confirm("Delete this chat's computer for good? Everything saved on it will be lost.")) return;
    patchSession(chatId, { status: "loading", error: null });
    try {
      const res = await fetch("/api/e2b/delete", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: e2bKey, sandboxId: id }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not delete the computer.");
      setSandboxId(chatId, null);
      patchSession(chatId, { screenUrl: null, steps: [], status: "idle", error: null });
      setPcFullscreen(false);
    } catch (err) {
      patchSession(chatId, { status: "error", error: err instanceof Error ? err.message : "Could not delete the computer." });
    }
  }

  function handlePcClick() {
    setPcMessage(null);
    if (pcOpen) { setPcOpen(false); setPcFullscreen(false); return; }
    if (!e2bKey) {
      setPcMessage("Add an E2B API key first — opening settings.");
      setSettingsOpen(true);
      return;
    }
    setPcOpen(true);
  }

  useEffect(() => {
    if (!pcOpen || !activeChat || !e2bKey) return;
    const id = activeChat.pcSandboxId ?? null;
    const s = sessionsRef.current[activeChat.id] ?? EMPTY_SESSION;
    if (id && s.status === "idle" && !activeChat.pcPaused) void loadScreen(activeChat.id, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcOpen, activeChat?.id]);

  useEffect(() => {
    if (!user || !e2bKey) return;
    const iv = setInterval(() => {
      for (const [chatId, s] of Object.entries(sessionsRef.current)) {
        if (s.status !== "ready" || s.running || runningRef.current[chatId]) continue;
        const last = lastTouchRef.current[chatId] ?? 0;
        const started = runStartRef.current[chatId] ?? 0;
        if ((last > 0 && Date.now() - last > IDLE_PAUSE_MS) || (started > 0 && Date.now() - started > RUN_CYCLE_MS)) {
          void pausePc(chatId).then((r) => {
            if (r.ok) setPcMessage("💾 A computer was safe-paused before E2B's 1-hour limit. Your data is saved — press Turn on to continue.");
          });
        }
      }
    }, 60_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, e2bKey]);

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
      if (k === n || (k.length >= 3 && n.includes(k)) || (n.length >= 3 && k.includes(n))) return v;
    }
    return null;
  }

  async function composeReport(
    chat: Chat, key: string,
    m: { task: string; summary: string; notes: string[]; steps: string[]; outputs: string[] }
  ): Promise<string | null> {
    try {
      const prompt = [
        "You are writing the FINAL message to the user after a computer agent finished their task.",
        "Rules: write in clear English. Use markdown. Start with ONE line for the outcome (✅ done / ⚠️ partly done / ❌ failed). Then short bullets of what was done. Then the concrete results: facts, names, numbers, versions, file paths, and links with their source names. If anything failed or is unfinished, say exactly what and the next step. Never invent anything that is not in the material below. Be concise — no filler.",
        "", `USER'S TASK:\n${m.task}`, "", `RESULT PER STEP:\n${m.summary}`, "",
        `NOTES THE AGENT SAVED:\n${m.notes.length ? m.notes.map((n) => `- ${n}`).join("\n") : "(none)"}`, "",
        `LAST STEPS:\n${m.steps.slice(-25).join("\n")}`, "",
        `KEY COMMAND / PAGE OUTPUTS:\n${m.outputs.length ? m.outputs.join("\n---\n") : "(none)"}`,
      ].join("\n");
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: chat.provider, apiKey: key, model: chat.model, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await readJson(res);
      return res.ok && data.reply ? String(data.reply).trim() : null;
    } catch {
      return null;
    }
  }

  async function makePlan(chat: Chat, key: string, task: string, ctx: string): Promise<PlanStep[]> {
    const single: PlanStep[] = [{ title: "Do the task", goal: task }];
    if (task.length < 70 && !/\b(and then|then|after that|also|next)\b|\d\./i.test(task)) return single;
    try {
      const res = await fetch("/api/e2b/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: chat.provider, apiKey: key, model: chat.model, task, context: ctx }),
      });
      const data = await readJson(res);
      return Array.isArray(data.subtasks) && data.subtasks.length ? (data.subtasks as PlanStep[]) : single;
    } catch {
      return single;
    }
  }

  // ---- Venus Code (coding agent) ----

  async function runCodeFor(chat: Chat, instruction: string, opts: { silent?: boolean; onLine?: (l: string) => void } = {}): Promise<string> {
    if (!user) return "";
    const out = (m: string) => { if (!opts.silent) say(chat.id, m); return m; };
    if (!e2bKey) return out("Venus Code needs an E2B key. Add it under API keys first.");
    if (!apiKeys[chat.provider]) return out("No API key is saved for this chat's model.");
    if (codeBusyRef.current) return out("Venus Code is already working on something. Wait for it to finish, then ask again.");
    codeBusyRef.current = true;
    try {
      const wsId = chatsRef.current.find((c) => c.id === chat.id)?.codeWs ?? null;
      let project = wsId ? await getCodeProject(user.uid, wsId) : null;
      if (!project) {
        project = newCodeProject(`${chat.agentName} workspace`);
        await saveCodeProject(user.uid, project);
        patchChat(chat.id, { codeWs: project.id });
        updateChatCode(user.uid, chat.id, project.id).catch(() => {});
      }
      setCodeRun({ title: project.name, label: "Starting…" });
      if (!opts.silent) say(chat.id, `💻 Venus Code is working on it. Watch it live in [the workspace](/code?project=${project.id}).`);
      const hooks: CodeHooks = {
        event: (e) => {
          if (e.kind === "tool" || e.kind === "info" || e.kind === "thought") {
            setCodeRun((prev) => (prev ? { ...prev, label: e.text.slice(0, 100) } : prev));
            if (e.kind === "tool" && (e.depth ?? 0) === 0) opts.onLine?.("💻 " + e.text.slice(0, 120));
          }
        },
        ask: async (_q, options) => options.find((o) => /^approve/i.test(o)) ?? "Proceed with your best judgment.",
        cancelled: () => false,
      };
      const res = await runCodeAgent(
        { uid: user.uid, token: () => user.getIdToken(), e2bKey, apiKeys, provider: chat.provider, model: chat.model },
        hooks, project, instruction, { brain: brainRef.current }
      );
      if (!opts.silent) {
        say(chat.id, res.ok ? `✅ Venus Code finished.\n\n${res.summary}\n\n[Open the workspace](/code?project=${project.id})` : `⚠️ Venus Code stopped: ${res.summary}\n\n[Open the workspace](/code?project=${project.id})`);
      }
      return res.summary;
    } catch (err) {
      return out(`⚠️ Venus Code failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      codeBusyRef.current = false;
      setCodeRun(null);
    }
  }

  // ---- Running a task on this chat's computer (plan → steps) ----

  async function runPcTask(chat: Chat, task: string, logTask: boolean, opts?: { stopAfter?: boolean }) {
    const chatId = chat.id;
    if (!user || !e2bKey) return;
    if (runningRef.current[chatId]) {
      setPcMessage("This chat's computer is already running a task — one at a time.");
      return;
    }
    const key = apiKeys[chat.provider];
    if (!key) { setSettingsOpen(true); return; }

    runningRef.current[chatId] = true;
    stopRef.current[chatId] = false;
    patchSession(chatId, { running: true, steps: [`▶ ${task}`], request: null });
    if (activeIdRef.current === chatId) setPcOpen(true);

    const PER_STEP = 25;
    const TOTAL_CAP = 90;
    const history: string[] = [];
    const notes: string[] = [];
    const outputs: string[] = [];
    const subResults: Array<{ title: string; ok: boolean; summary: string }> = [];
    let lastOutput = "";
    let activeJob: { id: string; command: string } | null = null;
    let creds: SavedLogin | null = null;
    let summary = "";
    let totalActions = 0;
    let invalidStreak = 0;
    let finalText = "";
    let completed = false;
    const ctxText = brainPrompt(brainRef.current, task);

    try {
      const startedId = await startOrResumePc(chatId);
      if (!startedId) throw new Error(sessionsRef.current[chatId]?.error || "The computer could not be started — see the panel for the reason.");

      const plan = await makePlan(chat, key, task, ctxText);
      if (plan.length > 1) pushStep(chatId, "🗺️ Plan:\n" + plan.map((s, i) => `${i + 1}. ${s.title}`).join("\n"));

      outer: for (let si = 0; si < plan.length; si++) {
        const sub = plan[si];
        if (plan.length > 1) pushStep(chatId, `📌 Step ${si + 1}/${plan.length}: ${sub.title}`);
        const subTask =
          plan.length > 1
            ? `OVERALL GOAL: ${task}\nPLAN:\n${plan.map((s, i) => `${i + 1}. ${s.title}`).join("\n")}\nCURRENT STEP (${si + 1}/${plan.length}): ${sub.goal}${sub.tool ? `\nSuggested tool: ${sub.tool}` : ""}\nWork ONLY on the current step and call done when it is complete.`
            : task;
        history.length = 0;
        subResults.forEach((r) => history.push(`Finished step "${r.title}": ${r.summary.slice(0, 200)}`));
        let actions = 0;
        let guard = 0;
        let subDone = false;
        let subSummary = "";

        while (actions < PER_STEP && guard < 120 && totalActions < TOTAL_CAP) {
          guard++;
          if (stopRef.current[chatId]) break outer;

          const startedAt = runStartRef.current[chatId] ?? Date.now();
          if (Date.now() - startedAt > RUN_CYCLE_MS) {
            pushStep(chatId, "♻️ Close to the 1-hour limit — saving and restarting the computer (data stays safe)…");
            const ok = await cyclePc(chatId);
            pushStep(chatId, ok ? "✅ Computer is back on, continuing." : "⚠️ Could not refresh it — continuing anyway.");
            if (!ok) runStartRef.current[chatId] = Date.now();
          }

          const res = await fetch("/api/e2b/step", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              e2bKey, sandboxId: sandboxRef.current[chatId], provider: chat.provider, apiKey: key, model: chat.model,
              task: subTask, history: history.slice(-16), notes: notes.slice(-25), hint: stuckHint(history),
              stepNo: actions + 1, maxSteps: PER_STEP, lastOutput: lastOutput || undefined,
              runningJob: activeJob ?? undefined, context: ctxText || undefined, creds: creds ?? undefined,
            }),
          });
          const data = await readJson(res);
          if (!res.ok) throw new Error(data?.error || "A step failed.");
          touch(chatId);

          if (data.newSandboxId) {
            setSandboxId(chatId, data.newSandboxId);
            runStartRef.current[chatId] = Date.now();
            activeJob = null;
            patchSession(chatId, { screenUrl: null });
            await loadScreen(chatId, data.newSandboxId);
            history.push(data.actionText);
            pushStep(chatId, `↻ ${data.actionText}`);
            continue;
          }
          if (data.invalid) {
            if (++invalidStreak >= 4) throw new Error("The model keeps answering in the wrong format. Pick a stronger vision model in the model picker (Claude Sonnet / GPT-4o).");
            continue;
          }
          invalidStreak = 0;

          if (data.done) {
            subSummary = data.summary || "Done.";
            subDone = true;
            pushStep(chatId, `✓ ${subSummary}`);
            break;
          }

          if (data.ask) {
            lastOutput = "";
            const ask = data.ask as { kind: "login" | "choice" | "text"; site?: string; question?: string; options?: string[] };
            if (ask.kind === "login") {
              const site = ask.site || "this site";
              let cred = findCredential(site);
              if (!cred) {
                const reply = await askUser(chatId, { kind: "login", site });
                if (stopRef.current[chatId]) break outer;
                if (reply.type === "login") {
                  cred = { email: reply.email, password: reply.password };
                  if (reply.remember) savePcCredential(normSite(site), cred).catch(() => {});
                }
              }
              if (cred) {
                creds = cred;
                history.push(`Login details for ${site} are ready. Click the email/username field and use type_secret with field "email", then click the password field and use type_secret with field "password", then submit.`);
                pushStep(chatId, `🔑 Login details ready for ${site}`);
              } else {
                pushStep(chatId, `✋ Waiting while you log in to ${site} yourself…`);
                await askUser(chatId, { kind: "handoff", message: `Log in to ${site} on the computer (you have control now), then press Continue.` });
                if (stopRef.current[chatId]) break outer;
                history.push(`The user logged in to ${site} themselves. Continue the task.`);
              }
            } else {
              const q = ask.question || "The agent needs your input.";
              const reply = await askUser(chatId, ask.kind === "choice" ? { kind: "choice", question: q, options: ask.options ?? [] } : { kind: "text", question: q });
              if (stopRef.current[chatId]) break outer;
              const answer = reply.type === "answer" ? reply.text : "";
              history.push(`Asked the user: "${q}" → the user answered: "${answer}"`);
              pushStep(chatId, `❓ ${q} → ${answer}`);
            }
            continue;
          }

          if (data.delegate?.kind === "code") {
            pushStep(chatId, `💻 Handing this to Venus Code: ${String(data.delegate.instruction).slice(0, 100)}`);
            const sum = await runCodeFor(chat, String(data.delegate.instruction), { silent: true, onLine: (l) => pushStep(chatId, l) });
            lastOutput = sum;
            outputs.push(`code → ${sum.slice(0, 600)}`);
            if (outputs.length > 5) outputs.shift();
            actions++;
            totalActions++;
            history.push(`${actions}. code → ${sum.slice(0, 200)}`);
            pushStep(chatId, `💻 ${sum.slice(0, 200)}`);
            continue;
          }

          if (data.note) notes.push(String(data.note));
          if (data.job) activeJob = data.job.done ? null : { id: data.job.id, command: data.job.command };
          if (typeof data.output === "string" && data.output) {
            lastOutput = data.output;
            outputs.push(`${data.actionText}\n${data.output.slice(0, 700)}`);
            if (outputs.length > 5) outputs.shift();
          } else {
            lastOutput = "";
          }

          actions++;
          totalActions++;
          const line = `${actions}. ${data.thought ? data.thought + " → " : ""}${data.actionText}`;
          history.push(line);
          pushStep(chatId, line);
        }

        subResults.push({ title: sub.title, ok: subDone, summary: subSummary || "Step limit reached before finishing." });
        if (!subDone) notes.push(`Step "${sub.title}" did not finish.`);
      }

      if (stopRef.current[chatId]) {
        summary = "Stopped before finishing.";
        pushStep(chatId, "■ Stopped.");
      } else {
        summary =
          plan.length > 1
            ? subResults.map((r, i) => `${r.ok ? "✓" : "✗"} ${i + 1}. ${r.title}: ${r.summary}`).join("\n")
            : subResults[0]?.summary || "Step limit reached.";
        completed = subResults.some((r) => r.ok);
      }

      finalText = summary;
      if (completed) {
        pushStep(chatId, "✍️ Writing the final report…");
        const report = await composeReport(chat, key, { task, summary, notes, steps: history, outputs });
        if (report) finalText = report;
        if (totalActions >= 4) {
          reflect(user.uid, { apiKeys, provider: chat.provider, model: chat.model }, brainRef.current, { task, outcome: summary, steps: history.join("\n") })
            .then((l) => {
              if (l.length) { appendMessages(chatId, [{ role: "assistant", content: "🧠 Learned: " + l.join("; "), at: Date.now() }]); refreshBrain(); }
            })
            .catch(() => {});
        }
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
        ? [{ role: "user", content: `🖥️ Task on the computer: ${task}`, at }, { role: "assistant", content: finalText || "Finished.", at }]
        : [{ role: "assistant", content: finalText || "Finished.", at }]
    );

    if (opts?.stopAfter) {
      const r = await pausePc(chatId);
      say(chatId, r.ok
        ? "✅ Computer turned off. Everything is saved — turn it on again and it continues where it stopped."
        : `⚠️ Could not turn the computer off: ${r.error ?? "unknown error"}`);
    }
  }

  // ---- Venus Pro from chat ----

  async function startVenus(chat: Chat, brief: string) {
    if (!user) return;
    if (!e2bKey) return say(chat.id, "Venus Pro needs an E2B key. Add it under API keys first.");
    if (cfg && !cfg.supabase) return say(chat.id, "Venus Pro needs Supabase for video storage. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy.");
    if (venusBusyRef.current) return say(chat.id, "Venus Pro is already making a video. Wait for it to finish, then ask again.");
    if (!apiKeys[chat.provider]) return say(chat.id, "No API key is saved for this chat's model.");

    const opt = guessVenusOptions(brief);
    const project: VenusProject = {
      id: "v" + Date.now().toString(36), title: brief.replace(/\s+/g, " ").slice(0, 48), brief,
      seconds: opt.seconds, aspect: opt.aspect, theme: "midnight", voice: Boolean(apiKeys.openai), voiceName: "nova",
      captions: true, quality: "720p", review: true, design: "ai", music: true, origin: "chat",
      provider: chat.provider, model: chat.model, stage: "studio", status: "idle", createdAt: Date.now(), updatedAt: Date.now(),
    };

    venusBusyRef.current = true;
    setVenusRun({ title: project.title, label: "Starting…", value: null });
    say(chat.id, `🎬 Venus Pro is making your video (${opt.seconds}s, ${opt.aspect}). Progress shows above the message box, or open it in [Venus Pro](/venus?project=${project.id}). The first video can take 15-30 minutes.`);

    const env: PipelineEnv = { uid: user.uid, token: () => user.getIdToken(), e2bKey, apiKeys, pexels: Boolean(cfg?.pexels) };
    try {
      const final = await runPipeline(
        env,
        {
          log: (m) => setVenusRun((prev) => (prev ? { ...prev, label: m.slice(0, 100) } : prev)),
          progress: (p) => setVenusRun((prev) => (prev ? { ...prev, label: p?.label ?? prev.label, value: p ? p.value : null } : prev)),
          update: () => {},
          cancelled: () => false,
        },
        project, "studio"
      );
      if (final.status === "done" && final.finalPath) {
        const url = await signedUrl(env, final.finalPath, "venus-video.mp4").catch(() => "");
        say(chat.id, `✅ Your video is ready: **${final.title}**.\n\n- [Open and edit it in Venus Pro](/venus?project=${final.id})${url ? `\n- [Download the video](${url})` : ""}`);
      } else {
        say(chat.id, `⚠️ The video could not be finished: ${final.error ?? "unknown error"}\n\n[Open it in Venus Pro](/venus?project=${final.id}) to retry from the failed step.`);
      }
    } catch (err) {
      say(chat.id, `⚠️ Venus Pro failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      venusBusyRef.current = false;
      setVenusRun(null);
    }
  }

  // ---- Skills & memory from chat ----

  async function installSkillFrom(chat: Chat, input: string): Promise<{ names: string[]; message: string }> {
    if (!user) return { names: [], message: "" };
    const env = { apiKeys, provider: chat.provider, model: chat.model };
    const urls = input.match(/https?:\/\/[^\s)>\]]+/g) ?? [];
    const sources: Array<{ text: string; src: string }> = [];
    for (const url of urls.slice(0, 3)) {
      try {
        const r = await fetch("/api/skills/fetch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
        const d = await readJson(r);
        if (r.ok && d.text) sources.push({ text: d.text, src: url });
      } catch { /* skip */ }
    }
    if (sources.length === 0 && input.length > 200) {
      sources.push({ text: input.replace(/^[\s\S]{0,80}?\bskill\b[:\s-]*/i, ""), src: "pasted" });
    }
    const names: string[] = [];
    for (const s of sources) {
      const parsed = parseSkillMarkdown(s.text) ?? (await skillFromText(env, s.text));
      if (parsed) {
        const saved = await saveSkill(user.uid, { ...parsed, source: s.src });
        names.push(saved.name);
      }
    }
    await refreshBrain();
    return {
      names,
      message: names.length
        ? `🧩 Skill saved: **${names.join(", ")}**. I'll use it automatically whenever it fits a task (manage skills on the [Skills page](/skills)).`
        : "⚠️ I could not read that as a skill. Send a link to a SKILL.md or paste its text.",
    };
  }

  async function applyMemoryCommand(chat: Chat, arg: string) {
    if (!user) return;
    const m = /^(add|forget)\s*\|\s*([\s\S]+)$/i.exec(arg);
    if (!m) return;
    if (m[1].toLowerCase() === "add") {
      const saved = await addMemory(user.uid, m[2]);
      if (saved) say(chat.id, `🧠 Remembered: ${saved.text}`);
    } else {
      const n = await forgetMemory(user.uid, m[2]);
      say(chat.id, n ? `🧠 Forgot ${n} item${n > 1 ? "s" : ""} about “${m[2]}”.` : `I had nothing saved about “${m[2]}”.`);
    }
    await refreshBrain();
  }

  async function runCommands(cmds: Cmd[], chat: Chat) {
    for (const c of cmds) {
      if (c.cmd === "start") await startOrResumePc(chat.id);
      else if (c.cmd === "stop") await pausePc(chat.id);
      else if (c.cmd === "task" && c.arg) await runPcTask(chat, c.arg, true);
      else if (c.cmd === "venus" && c.arg) await startVenus(chat, c.arg);
      else if (c.cmd === "code" && c.arg) await runCodeFor(chat, c.arg);
      else if (c.cmd === "skill" && c.arg) say(chat.id, (await installSkillFrom(chat, c.arg)).message);
      else if (c.cmd === "memory" && c.arg) await applyMemoryCommand(chat, c.arg);
    }
  }

  // ---- Chat ----

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !user || !activeChat || sending) return;

    const chat = activeChat;
    const video = /^\/video\s+([\s\S]+)/i.exec(text);
    const code = /^\/code\s+([\s\S]+)/i.exec(text);
    const forget = /^\/forget\s+([\s\S]+)/i.exec(text);
    const remember = /^\/remember\s+([\s\S]+)/i.exec(text) ?? /^(?:please\s+)?remember(?:\s+that)?[:\s]+([\s\S]{3,})/i.exec(text);
    const analysis = e2bKey && !video && !code ? analyzePcMessage(text) : { pureCommand: null, compound: false, stopAfter: false };
    const key = apiKeys[chat.provider];
    const needsModel = !analysis.pureCommand && !forget && !remember;
    if (needsModel && !key) { setSettingsOpen(true); return; }

    appendMessages(chat.id, [{ role: "user", content: text, at: Date.now() }]);
    setDraft("");

    if (video) { void startVenus(chat, video[1].trim()); return; }
    if (code) { void runCodeFor(chat, code[1].trim()); return; }
    if (forget) { await applyMemoryCommand(chat, `forget|${forget[1].trim()}`); return; }
    if (remember) { await applyMemoryCommand(chat, `add|${remember[1].trim()}`); return; }

    if (analysis.pureCommand) {
      setSending(true);
      let reply: string;
      try {
        if (analysis.pureCommand === "start") {
          const id = await startOrResumePc(chat.id);
          reply = id ? "✅ Computer is on — its screen is in the panel." : `⚠️ The computer could not be turned on: ${sessionsRef.current[chat.id]?.error ?? "unknown error"}`;
        } else {
          const r = await pausePc(chat.id);
          reply = r.ok
            ? sandboxRef.current[chat.id]
              ? "✅ Computer turned off. Files, apps and logins are saved — turn it on again and it continues where it stopped."
              : "✅ This chat's computer is already off or expired."
            : `⚠️ ${r.error ?? "Could not turn the computer off."}`;
        }
      } catch (err) {
        reply = `⚠️ ${err instanceof Error ? err.message : "Something went wrong."}`;
      } finally {
        setSending(false);
      }
      say(chat.id, reply);
      return;
    }

    // Skill installs: save first, then let the model carry out any remaining request.
    let extraSystem = "";
    const hasUrl = /https?:\/\//.test(text);
    if (/\b(install|add|save|learn|import)\b[\s\S]*\bskills?\b/i.test(text) && (hasUrl || text.length > 300)) {
      setSending(true);
      const r = await installSkillFrom(chat, text);
      setSending(false);
      say(chat.id, r.message);
      if (r.names.length) extraSystem = `\n\nThe user just installed the skill(s): ${r.names.join(", ")}. Acknowledge briefly and carry out any remaining part of the request using the skill.`;
      if (text.replace(/https?:\/\/\S+/g, "").length < 90) return;
    }

    if (e2bKey && (computerMode || analysis.compound)) {
      say(chat.id, "On it — starting the computer and working on your task. Progress shows in the panel.");
      void runPcTask(chat, text, false, { stopAfter: analysis.stopAfter });
      return;
    }

    setSending(true);
    let cmds: Cmd[] = [];
    try {
      const history = (chatsRef.current.find((c) => c.id === chat.id)?.messages ?? []).map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: chat.provider, apiKey: key, model: chat.model, messages: history,
          systemPrompt:
            `You are ${chat.agentName}, an AI teammate working inside AgenticVenus. Be direct and useful, and focus on getting real work done for the person you're talking to.` +
            brainPrompt(brainRef.current, text) + (e2bKey ? PC_PROMPT : "") + extraSystem,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Request failed.");
      const parsed = extractCommands(String(data.reply ?? ""));
      cmds = parsed.cmds;
      say(chat.id, parsed.clean || (cmds.length ? "On it." : "…"));
    } catch (err) {
      say(chat.id, `⚠️ ${err instanceof Error ? err.message : "Something went wrong."}`);
    } finally {
      setSending(false);
    }
    if (cmds.length > 0) void runCommands(cmds, chat);
  }

  function handleRunPcTask(task: string) {
    if (!activeChat) return;
    void runPcTask(activeChat, task, true);
  }

  // ---- Routines ----

  async function handleCreateRoutine(input: { name: string; instructions: string; everyMinutes: number; startAt: number }) {
    if (!user || !activeChat) return;
    const routine = await createRoutine(user.uid, { chatId: activeChat.id, ...input });
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
    if (!key) { setSettingsOpen(true); return; }
    setRunningRoutineId(routine.id);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: activeChat.provider, apiKey: key, model: activeChat.model, messages: [{ role: "user", content: routine.instructions }] }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Routine run failed.");
      appendMessages(activeChat.id, [
        { role: "user", content: `🔁 Routine: ${routine.name}`, at: Date.now() },
        { role: "assistant", content: data.reply, at: Date.now() },
      ]);
      await recordManualRun(user.uid, routine.id, data.reply);
      setRoutines((prev) => prev.map((r) => (r.id === routine.id ? { ...r, lastRunAt: Date.now(), lastResult: data.reply.slice(0, 200) } : r)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Routine run failed.";
      await recordManualRun(user.uid, routine.id, `⚠️ ${message}`);
      setRoutines((prev) => prev.map((r) => (r.id === routine.id ? { ...r, lastRunAt: Date.now(), lastResult: `⚠️ ${message}` } : r)));
    } finally {
      setRunningRoutineId(null);
    }
  }

  if (authLoading || !user) {
    return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;
  }

  const session: PcSession = activeChat ? sessions[activeChat.id] ?? EMPTY_SESSION : EMPTY_SESSION;
  const activeSandboxId = activeChat?.pcSandboxId ?? null;

  return (
    <div className="flex h-screen bg-bg">
      {!focusMode && (
        <Sidebar
          chats={chats} activeId={activeId} onSelect={setActiveId} onNewChat={() => setNewChatOpen(true)}
          userLabel={user.email ?? "Account"} onOpenApiKeys={() => setSettingsOpen(true)} onSignOut={() => signOut(auth)}
        />
      )}

      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {activeChat && (
            <header className="flex items-center justify-between border-b border-line px-6 py-3.5">
              <div className="flex items-center gap-2.5">
                <button onClick={() => setFocusMode((v) => !v)} title={focusMode ? "Show chat list" : "Focus mode — hide the chat list"} className="rounded-lg p-1.5 text-muted hover:bg-panel2 hover:text-ink">
                  {focusMode ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
                </button>
                <BotAvatar color={activeChat.agentColor} size={26} />
                <span className="text-sm font-medium text-ink">{activeChat.agentName}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => router.push("/code")} title="Venus Code — coding agent" className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gold hover:bg-panel2">Code</button>
                <button onClick={() => router.push("/venus")} title="Venus Pro — AI video editor" className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gold hover:bg-panel2">Venus Pro</button>
                <button onClick={() => router.push("/skills")} title="Memory & skills" className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gold hover:bg-panel2">Skills</button>
                <button onClick={() => setRoutinesOpen(true)} title="Routines" className="relative rounded-lg p-2 text-muted hover:bg-panel2 hover:text-ink">
                  <Clock size={17} />
                  {routines.some((r) => r.enabled) && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-avatar-teal" />}
                </button>
                <button
                  onClick={handlePcClick}
                  title={pcOpen ? "Hide this chat's computer" : activeSandboxId ? "Show this chat's computer" : "Give this chat a cloud computer"}
                  className={`relative rounded-lg p-2 hover:bg-panel2 hover:text-ink ${pcOpen ? "bg-panel2 text-ink" : "text-muted"}`}
                >
                  <Monitor size={17} />
                  {activeSandboxId && <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${session.status === "paused" ? "bg-faint" : "bg-avatar-teal"}`} />}
                </button>
              </div>
            </header>
          )}

          {pcMessage && (
            <div className="flex items-center justify-between border-b border-line bg-panel px-6 py-2 text-xs text-muted">
              {pcMessage}
              <button onClick={() => setPcMessage(null)} className="text-faint hover:text-ink">Dismiss</button>
            </div>
          )}

          {!chatsLoaded ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading your chats…</div>
          ) : !hasAnyKey && !keysLoading ? (
            <FirstKeyGate />
          ) : !activeChat ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-ink">Pick a chat, or start a new one.</p>
              <button onClick={() => setNewChatOpen(true)} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-bg hover:opacity-90">
                <Plus size={16} /> New chat
              </button>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <div className="mx-auto max-w-2xl">
                  <ChatThread messages={activeChat.messages} pending={sending} onSaveAsRoutine={(t) => { setRoutinePrefill(t); setRoutinesOpen(true); }} />
                </div>
              </div>

              {(venusRun || codeRun) && (
                <div className="mx-auto w-full max-w-2xl space-y-2 px-6 pb-2">
                  {venusRun && (
                    <div className="rounded-lg border border-line bg-panel p-3 text-xs text-muted">
                      <div className="flex justify-between"><span className="text-ink">🎬 Venus Pro · {venusRun.title}</span><span>{venusRun.value === null ? "…" : Math.round(venusRun.value * 100) + "%"}</span></div>
                      <p className="mt-1 truncate">{venusRun.label}</p>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel2">
                        <div className={`h-full rounded-full bg-gold ${venusRun.value === null ? "w-1/3 animate-pulse" : ""}`} style={venusRun.value === null ? undefined : { width: Math.round(venusRun.value * 100) + "%" }} />
                      </div>
                    </div>
                  )}
                  {codeRun && (
                    <div className="rounded-lg border border-line bg-panel p-3 text-xs text-muted">
                      <span className="text-ink">💻 Venus Code · {codeRun.title}</span>
                      <p className="mt-1 truncate">{codeRun.label}</p>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel2"><div className="h-full w-1/3 animate-pulse rounded-full bg-gold" /></div>
                    </div>
                  )}
                </div>
              )}

              <div className="mx-auto w-full max-w-2xl px-6 pb-2">
                <ModelPicker provider={activeChat.provider} model={activeChat.model} apiKeys={apiKeys} onChange={handleModelChange} />
              </div>

              <form onSubmit={handleSend} className="mx-auto flex w-full max-w-2xl items-center gap-2 border-t border-line px-6 py-4">
                <button type="button" aria-label="Attach" className="rounded-full p-2 text-muted hover:bg-panel2"><Plus size={18} /></button>
                {e2bKey && (
                  <button
                    type="button" onClick={() => setComputerMode((v) => !v)} aria-pressed={computerMode}
                    title={computerMode ? "Computer mode ON — your message goes straight to the computer as a task" : "Computer mode — send your message straight to the computer as a task"}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-2 text-xs ${computerMode ? "bg-gold font-medium text-bg" : "text-muted hover:bg-panel2 hover:text-ink"}`}
                  >
                    <Monitor size={15} />
                    {computerMode && "Computer"}
                  </button>
                )}
                <input
                  value={draft} onChange={(e) => setDraft(e.target.value)}
                  placeholder={computerMode ? "Give the computer a task…" : `Message ${activeChat.agentName}  ·  try /code or /video`}
                  className="flex-1 rounded-full border border-line bg-panel px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-gold"
                />
                <button type="submit" aria-label="Send" disabled={!draft.trim() || sending} className="rounded-full bg-white p-2.5 text-bg hover:opacity-90 disabled:opacity-40">
                  <ArrowUp size={16} />
                </button>
              </form>
            </>
          )}
        </div>

        {pcOpen && activeChat && (
          <PcPanel
            key={activeChat.id}
            hasComputer={Boolean(activeSandboxId)} status={session.status} error={session.error} screenUrl={session.screenUrl}
            steps={session.steps} running={session.running} request={session.request} fullscreen={pcFullscreen} wide={focusMode}
            onClose={() => { setPcOpen(false); setPcFullscreen(false); }}
            onStart={() => void createPc(activeChat.id)}
            onReload={() => { const id = sandboxRef.current[activeChat.id]; if (id) void loadScreen(activeChat.id, id); }}
            onPause={() => void pausePc(activeChat.id)}
            onDelete={() => void deletePc(activeChat.id)}
            onRunTask={handleRunPcTask}
            onStop={() => handleStop(activeChat.id)}
            onReply={(r) => handleReply(activeChat.id, r)}
            onToggleFullscreen={() => setPcFullscreen((v) => !v)}
          />
        )}
      </div>

      <NewChatModal open={newChatOpen} onClose={() => setNewChatOpen(false)} customAgents={customAgents} onPick={handlePickAgent} onCreateAgent={handleCreateAgent} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {activeChat && (
        <RoutinesPanel
          open={routinesOpen} onClose={() => { setRoutinesOpen(false); setRoutinePrefill(null); }}
          chatName={activeChat.agentName} routines={routines} prefillInstructions={routinePrefill} busyId={runningRoutineId}
          onCreate={handleCreateRoutine} onToggle={handleToggleRoutine} onDelete={handleDeleteRoutine} onRunNow={handleRunRoutineNow}
        />
      )}
    </div>
  );
}