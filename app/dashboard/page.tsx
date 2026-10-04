"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Clock, Monitor, PanelLeftClose, PanelLeftOpen, Plug, Plus, Users } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useKeys, type SavedLogin } from "@/lib/keys-context";
import { listChats, createChat, updateChatMessages, updateChatModel, updateChatPc, updateChatConnectors, type Chat, type ChatMessage } from "@/lib/chats";
import { listCustomAgents, createCustomAgent, type CustomAgent } from "@/lib/agents";
import { listRoutinesForChat, createRoutine, setRoutineEnabled, deleteRoutine, recordManualRun, type Routine } from "@/lib/routines";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import { getModelPref, setModelPref } from "@/lib/model-pref";
import { addMemory, brainPrompt, forgetMemory, loadBrain, parseSkillMarkdown, reflect, saveSkill, skillFromText, type Brain } from "@/lib/brain";
import { runCodeAgent, type CodeHooks } from "@/lib/code-agent";
import { getCodeProject, newCodeProject, saveCodeProject } from "@/lib/code-store";
import type { VenusProject } from "@/lib/venus";
import { runPipeline, signedUrl, type PipelineEnv } from "@/lib/venus-pipeline";
import { personaOf, type Member } from "@/lib/team-catalog";
import { runTeamGoal, type TeamHost, type TMsg } from "@/lib/team";
import type { AvatarColor } from "@/lib/bots";
import Sidebar from "@/components/dashboard/Sidebar";
import ChatThread from "@/components/dashboard/ChatThread";
import ModelPicker from "@/components/dashboard/ModelPicker";
import NewChatModal from "@/components/dashboard/NewChatModal";
import SettingsModal from "@/components/dashboard/SettingsModal";
import RoutinesPanel from "@/components/dashboard/RoutinesPanel";
import FirstKeyGate from "@/components/dashboard/FirstKeyGate";
import TeamPanel from "@/components/dashboard/TeamPanel";
import ConnectorsModal from "@/components/dashboard/ConnectorsModal";
import PcPanel, { type PcStatus, type AgentRequest, type RequestReply } from "@/components/dashboard/PcPanel";
import BotAvatar from "@/components/BotAvatar";

async function readJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: `Server returned ${res.status}: ${text.slice(0, 200) || "(empty response)"}` }; }
}

function defaultProviderAndModel(apiKeys: Partial<Record<ProviderId, string>>): { provider: ProviderId; model: string } {
  const pref = getModelPref();
  if (pref && apiKeys[pref.provider]) return pref;
  const found = PROVIDERS.find((p) => apiKeys[p.id]);
  const provider = found?.id ?? PROVIDERS[0].id;
  return { provider, model: providerMeta(provider).models[0] };
}

const normSite = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type PcSession = { status: PcStatus; error: string | null; screenUrl: string | null; steps: string[]; running: boolean; request: AgentRequest | null };
const EMPTY_SESSION: PcSession = { status: "idle", error: null, screenUrl: null, steps: [], running: false, request: null };
const IDLE_PAUSE_MS = 50 * 60 * 1000;
const RUN_CYCLE_MS = 55 * 60 * 1000;

type Cmd = { cmd: "start" | "stop" | "task" | "venus" | "code" | "skill" | "memory" | "team" | "deploy"; arg?: string };

function extractCommands(text: string): { clean: string; cmds: Cmd[] } {
  const cmds: Cmd[] = [];
  const clean = text
    .replace(/\[\[(PC|VENUS|CODE|SKILL|MEMORY|TEAM|DEPLOY):([\s\S]*?)\]\]/gi, (_m, tag: string, inner: string) => {
      const t = String(inner).trim();
      const T = tag.toUpperCase();
      if (T === "VENUS" && t) cmds.push({ cmd: "venus", arg: t });
      else if (T === "CODE" && t) cmds.push({ cmd: "code", arg: t });
      else if (T === "TEAM" && t) cmds.push({ cmd: "team", arg: t });
      else if (T === "DEPLOY") cmds.push({ cmd: "deploy", arg: t });
      else if (T === "SKILL") cmds.push({ cmd: "skill", arg: t.replace(/^install\s*\|?\s*/i, "") });
      else if (T === "MEMORY") cmds.push({ cmd: "memory", arg: t });
      else if (T === "PC") {
        const lower = t.toLowerCase();
        if (lower === "start" || lower === "stop") cmds.push({ cmd: lower as "start" | "stop" });
        else {
          const mm = /^task\s*[|:]\s*([\s\S]*)$/i.exec(t);
          const arg = (mm ? mm[1] : t.replace(/^\|/, "")).trim();
          if (arg) cmds.push({ cmd: "task", arg });
        }
      }
      return "";
    })
    .trim();
  return { clean, cmds };
}

const PC_PROMPT = `

You work through tools that you trigger by ending your reply with tags (never explain the tag syntax to the user; only use a tag when it is really needed):
- Cloud computer (browser + terminal; also finds and downloads files/assets): [[PC:task|<clear, complete instruction>]]. Turn it on: [[PC:start]]. Shut it down (everything stays saved): [[PC:stop]].
- Coding (build or change websites/apps/scripts; debug): [[CODE:<detailed instruction>]] — Venus Code. Every chat has ONE codespace; continue in it.
- Motion-graphics video, reel, animation: [[VENUS:<detailed brief: topic, key points, tone, length in seconds, format 16:9, 9:16 or 1:1>]].
- A big goal that spans several areas (e.g. build a site AND find leads AND email them): [[TEAM:<the full goal with every detail>]] — Chief assembles specialists and they work in parallel.
- Save a durable fact about the user: [[MEMORY:add|<fact>]]. Forget something: [[MEMORY:forget|<keyword>]].
- Install a skill the user shared (link or pasted text): [[SKILL:install|<link or text>]].
The computer agent asks the user itself for logins and one-time codes, so never ask for passwords in chat.`;

const DEPLOY_PROMPT = `

Deploy: when the user wants their site/app live, end your reply with [[DEPLOY:]] (optionally a project name after the colon). The link is posted in chat automatically.`;

const PC_WORDS = new Set(["pc", "computer", "desktop", "sandbox", "comp", "system"]);
const START_WORDS = ["on", "start", "chalu", "chalao", "chala", "resume", "wake", "open", "kholo", "khol", "shuru", "launch", "boot"];
const STOP_WORDS = ["off", "stop", "shutdown", "pause", "close", "band", "bandh", "bund", "sleep"];
const FILLER = new Set(["ko", "kro", "kr", "karo", "kar", "karna", "kardo", "do", "de", "dena", "please", "plz", "pls", "the", "my", "apna", "apne", "mera", "meri", "ka", "ki", "ke", "liye", "ek", "bhai", "bro", "yrr", "yaar", "ab", "abhi", "now", "it", "hai", "hain", "hoga", "then", "phir", "fir", "and", "aur", "air", "se", "me", "mein", "par", "pe", "na", "to", "hi", "bhi", "a", "i"]);

function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; }
    else { if (++edits > 1) return false; if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; } }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const isWordOf = (w: string, list: string[]) => list.includes(w) || (w.length >= 4 && list.some((x) => x.length >= 4 && lev1(w, x)));

function analyzePcMessage(text: string): { pureCommand: "start" | "stop" | null; compound: boolean; stopAfter: boolean } {
  const t = text.toLowerCase();
  const words = t.split(/[^a-z\u0900-\u097f]+/).filter(Boolean);
  if (!(words.some((w) => PC_WORDS.has(w)) || /कंप्यूटर|पीसी/.test(t))) return { pureCommand: null, compound: false, stopAfter: false };
  const hasStop = words.some((w) => isWordOf(w, STOP_WORDS)) || /बंद/.test(t);
  const hasStart = words.some((w) => isWordOf(w, START_WORDS)) || /चालू|शुरू/.test(t);
  const rest = words.filter((w) => !PC_WORDS.has(w) && !FILLER.has(w) && !isWordOf(w, START_WORDS) && !isWordOf(w, STOP_WORDS));
  if ((hasStart || hasStop) && rest.length <= 1) return { pureCommand: hasStop && !hasStart ? "stop" : hasStart ? "start" : "stop", compound: false, stopAfter: false };
  if (hasStart && rest.length >= 2) return { pureCommand: null, compound: true, stopAfter: hasStop };
  return { pureCommand: null, compound: false, stopAfter: false };
}

const DOMAINS: RegExp[] = [/\b(build|code|website|web ?site|landing|app|script|api)\b/i, /\b(leads?|prospects?|scrape|research|find (me )?(companies|contacts))\b/i, /\b(e-?mail|mail|outreach|newsletter)\b/i, /\b(video|reel|animation|motion)\b/i];
const domainCount = (t: string) => DOMAINS.filter((r) => r.test(t)).length;

function stuckHint(history: string[]): string | undefined {
  const last = history.slice(-3).map((l) => l.split("→").pop()?.trim() ?? "");
  if (last.length === 3 && last[0] && last[0] === last[1] && last[1] === last[2]) return "You repeated the same action 3 times with no progress. Do something different: use another tool instead of repeating this one.";
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
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [pcMessage, setPcMessage] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [computerMode, setComputerMode] = useState(false);
  const [cfg, setCfg] = useState<{ supabase: boolean; pexels: boolean } | null>(null);
  const [venusRun, setVenusRun] = useState<{ title: string; label: string; value: number | null } | null>(null);
  const [codeRun, setCodeRun] = useState<{ title: string; label: string } | null>(null);
  const [teamRun, setTeamRun] = useState<string | null>(null);
  const [pcOpen, setPcOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
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
  const teamBusyRef = useRef(false);
  const brainRef = useRef<Brain>({ memories: [], skills: [] });

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [routinePrefill, setRoutinePrefill] = useState<string | null>(null);
  const [runningRoutineId, setRunningRoutineId] = useState<string | null>(null);

  useEffect(() => { chatsRef.current = chats; for (const c of chats) if (!(c.id in sandboxRef.current)) sandboxRef.current[c.id] = c.pcSandboxId ?? null; }, [chats]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { if (!authLoading && !user) router.replace("/"); }, [authLoading, user, router]);
  useEffect(() => { fetch("/api/venus/media").then((r) => r.json()).then(setCfg).catch(() => {}); }, []);

  async function refreshBrain() { if (user) brainRef.current = await loadBrain(user.uid).catch(() => brainRef.current); }

  useEffect(() => {
    if (!user) return;
    refreshBrain();
    Promise.all([listChats(user.uid), listCustomAgents(user.uid)]).then(([loadedChats, loadedAgents]) => {
      setChats(loadedChats); setCustomAgents(loadedAgents); setChatsLoaded(true);
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
  const patchChat = (id: string, patch: Partial<Chat>) => setChats((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

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
    setChats((prev) => [chat, ...prev]); setActiveId(chat.id); setNewChatOpen(false);
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

  // ---- This chat's computer (the ONLY E2B machine: Venus Code and Venus Pro run on it too) ----

  async function loadScreen(chatId: string, sandboxId: string): Promise<"ok" | "gone" | "error"> {
    if (!e2bKey) { setSettingsOpen(true); return "error"; }
    const wasPaused = sessionsRef.current[chatId]?.status === "paused";
    patchSession(chatId, { status: "loading", error: null });
    try {
      const res = await fetch("/api/e2b/screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: e2bKey, sandboxId }) });
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
    if (activeIdRef.current === chatId) { setPcOpen(true); setTeamOpen(false); }
    patchSession(chatId, { status: "creating", error: null, screenUrl: null });
    try {
      const res = await fetch("/api/e2b/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: e2bKey }) });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not create a computer.");
      setSandboxId(chatId, data.sandboxId);
      runStartRef.current[chatId] = Date.now();
      if (data.persistence === "none") setPcMessage("ℹ️ This E2B version has no auto-pause. The app will pause/resume the computer for you (data stays safe), so keep this tab open.");
      const r = await loadScreen(chatId, data.sandboxId);
      return r === "ok" ? (data.sandboxId as string) : null;
    } catch (err) {
      patchSession(chatId, { status: "error", error: err instanceof Error ? err.message : "Could not create a computer." });
      return null;
    }
  }

  async function startOrResumePc(chatId: string): Promise<string | null> {
    if (!e2bKey) { setSettingsOpen(true); return null; }
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
    if (runningRef.current[chatId]) { const error = "Stop the running task first, then turn the computer off."; setPcMessage(error); return { ok: false, error }; }
    const prev = sessionsRef.current[chatId]?.status ?? "idle";
    patchSession(chatId, { status: "loading", error: null });
    try {
      const res = await fetch("/api/e2b/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: e2bKey, sandboxId: id }) });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not turn the computer off.");
      patchSession(chatId, { screenUrl: null, status: "paused" });
      setPausedFlag(chatId, true);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not turn the computer off.";
      if (msg.includes("SANDBOX_GONE")) { setSandboxId(chatId, null); patchSession(chatId, { status: "idle", screenUrl: null, error: null }); return { ok: true }; }
      patchSession(chatId, { status: prev === "loading" ? "ready" : prev, error: msg });
      setPcMessage(`⚠️ Could not turn the computer off: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  async function cyclePc(chatId: string): Promise<boolean> {
    const id = sandboxRef.current[chatId] ?? null;
    if (!id || !e2bKey) return false;
    try {
      const res = await fetch("/api/e2b/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: e2bKey, sandboxId: id }) });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "pause failed");
      patchSession(chatId, { screenUrl: null, status: "paused" });
      return (await loadScreen(chatId, id)) === "ok";
    } catch { return false; }
  }

  async function deletePc(chatId: string) {
    const id = sandboxRef.current[chatId] ?? null;
    if (!user || !e2bKey || !id) return;
    if (!window.confirm("Delete this chat's computer for good? Everything saved on it (code, videos' working files) will be lost.")) return;
    patchSession(chatId, { status: "loading", error: null });
    try {
      const res = await fetch("/api/e2b/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: e2bKey, sandboxId: id }) });
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
    if (!e2bKey) { setPcMessage("Add an E2B API key first — opening settings."); setSettingsOpen(true); return; }
    setPcOpen(true); setTeamOpen(false);
  }
  function handleTeamClick() { setTeamOpen((v) => !v); setPcOpen(false); setPcFullscreen(false); }

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
        if (s.status !== "ready" || s.running || runningRef.current[chatId] || codeBusyRef.current || venusBusyRef.current) continue;
        const last = lastTouchRef.current[chatId] ?? 0;
        const started = runStartRef.current[chatId] ?? 0;
        if ((last > 0 && Date.now() - last > IDLE_PAUSE_MS) || (started > 0 && Date.now() - started > RUN_CYCLE_MS)) {
          void pausePc(chatId).then((r) => { if (r.ok) setPcMessage("💾 A computer was safe-paused before E2B's 1-hour limit. Your data is saved — press Turn on to continue."); });
        }
      }
    }, 60_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, e2bKey]);

  function askUser(chatId: string, req: AgentRequest): Promise<RequestReply> {
    return new Promise((resolve) => { resolverRef.current[chatId] = resolve; patchSession(chatId, { request: req }); });
  }
  function handleReply(chatId: string, r: RequestReply) {
    const resolve = resolverRef.current[chatId];
    resolverRef.current[chatId] = null;
    patchSession(chatId, { request: null });
    resolve?.(r);
  }
  function handleStop(chatId: string) { stopRef.current[chatId] = true; handleReply(chatId, { type: "answer", text: "" }); }
  function findCredential(site: string): SavedLogin | null {
    const n = normSite(site);
    if (n.length < 2) return null;
    for (const [k, v] of Object.entries(pcCredentials)) if (k === n || (k.length >= 3 && n.includes(k)) || (n.length >= 3 && k.includes(n))) return v;
    return null;
  }

  async function callLLM(chat: Chat, system: string, prompt: string, history: Array<{ role: "user" | "assistant"; content: string }> = []): Promise<string> {
    const key = apiKeys[chat.provider];
    if (!key) throw new Error("No API key saved for this chat's model.");
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: chat.provider, apiKey: key, model: chat.model, systemPrompt: system || undefined, messages: [...history, { role: "user", content: prompt }] }),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data?.error || "Request failed.");
    return String(data.reply ?? "").trim();
  }

  async function composeReport(chat: Chat, m: { task: string; summary: string; notes: string[]; steps: string[]; outputs: string[] }): Promise<string | null> {
    try {
      return await callLLM(chat, "", [
        "You are writing the FINAL message to the user after a computer agent finished their task.",
        "Rules: write in clear English. Use markdown. Start with ONE line for the outcome (✅ done / ⚠️ partly done / ❌ failed). Then short bullets of what was done. Then the concrete results: facts, names, numbers, versions, file paths, and links with their source names. If anything failed or is unfinished, say exactly what and the next step. Never invent anything that is not in the material below. Be concise — no filler.",
        "", `USER'S TASK:\n${m.task}`, "", `RESULT PER STEP:\n${m.summary}`, "",
        `NOTES THE AGENT SAVED:\n${m.notes.length ? m.notes.map((n) => `- ${n}`).join("\n") : "(none)"}`, "",
        `LAST STEPS:\n${m.steps.slice(-25).join("\n")}`, "",
        `KEY COMMAND / PAGE OUTPUTS:\n${m.outputs.length ? m.outputs.join("\n---\n") : "(none)"}`,
      ].join("\n"));
    } catch { return null; }
  }

  async function makePlan(chat: Chat, key: string, task: string, ctx: string): Promise<PlanStep[]> {
    const single: PlanStep[] = [{ title: "Do the task", goal: task }];
    if (task.length < 70 && !/\b(and then|then|after that|also|next)\b|\d\./i.test(task)) return single;
    try {
      const res = await fetch("/api/e2b/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: chat.provider, apiKey: key, model: chat.model, task, context: ctx }) });
      const data = await readJson(res);
      return Array.isArray(data.subtasks) && data.subtasks.length ? (data.subtasks as PlanStep[]) : single;
    } catch { return single; }
  }

  // ---- Venus Code: ONE codespace per chat, runs on the chat's computer ----

  async function runCodeFor(chat: Chat, instruction: string, opts: { silent?: boolean; persona?: string; onLine?: (l: string) => void } = {}): Promise<string> {
    if (!user) return "";
    const out = (m: string) => { if (!opts.silent) say(chat.id, m); return m; };
    if (!e2bKey) return out("Venus Code needs an E2B key. Add it under API keys first.");
    if (!apiKeys[chat.provider]) return out("No API key is saved for this chat's model.");
    if (codeBusyRef.current) return out("Venus Code is already working on something. Wait for it to finish, then ask again.");
    codeBusyRef.current = true;
    try {
      const sid = await startOrResumePc(chat.id);
      if (!sid) return out("This chat's computer could not be started — turn it on with the monitor button first.");
      let project = await getCodeProject(user.uid, chat.id);
      if (!project) { project = newCodeProject(chat.id, `${chat.agentName} codespace`); await saveCodeProject(user.uid, project); }
      setCodeRun({ title: project.name, label: "Starting…" });
      if (!opts.silent) say(chat.id, `💻 Venus Code is working on it. Watch it live on the [Code page](/code?chat=${chat.id}).`);
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
        { uid: user.uid, token: () => user.getIdToken(), e2bKey, apiKeys, provider: chat.provider, model: chat.model, chatId: chat.id, sandboxId: sid },
        hooks, project, instruction, { brain: brainRef.current, persona: opts.persona }
      );
      if (!opts.silent) say(chat.id, res.ok ? `✅ Venus Code finished.\n\n${res.summary}\n\n[Open the Code page](/code?chat=${chat.id})` : `⚠️ Venus Code stopped: ${res.summary}\n\n[Open the Code page](/code?chat=${chat.id})`);
      return res.summary;
    } catch (err) {
      return out(`⚠️ Venus Code failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally { codeBusyRef.current = false; setCodeRun(null); }
  }

  // ---- Running a task on this chat's computer (plan → steps) ----

  async function runPcTask(chat: Chat, task: string, logTask: boolean, opts?: { stopAfter?: boolean; quiet?: boolean }): Promise<string> {
    const chatId = chat.id;
    if (!user || !e2bKey) return "";
    if (runningRef.current[chatId]) { const m = "This chat's computer is already running a task — one at a time."; setPcMessage(m); return m; }
    const key = apiKeys[chat.provider];
    if (!key) { setSettingsOpen(true); return "No API key for this chat's model."; }

    runningRef.current[chatId] = true;
    stopRef.current[chatId] = false;
    patchSession(chatId, { running: true, steps: [`▶ ${task}`], request: null });
    if (activeIdRef.current === chatId && !opts?.quiet) { setPcOpen(true); setTeamOpen(false); }

    const PER_STEP = 25, TOTAL_CAP = 90;
    const history: string[] = [], notes: string[] = [], outputs: string[] = [];
    const subResults: Array<{ title: string; ok: boolean; summary: string }> = [];
    let lastOutput = "", summary = "", finalText = "";
    let activeJob: { id: string; command: string } | null = null;
    let creds: SavedLogin | null = null;
    let browserState: unknown = null;
    let totalActions = 0, invalidStreak = 0, completed = false;
    const ctxText = brainPrompt(brainRef.current, task);

    try {
      const startedId = await startOrResumePc(chatId);
      if (!startedId) throw new Error(sessionsRef.current[chatId]?.error || "The computer could not be started — see the panel for the reason.");
      const plan = await makePlan(chat, key, task, ctxText);
      if (plan.length > 1) pushStep(chatId, "🗺️ Plan:\n" + plan.map((s, i) => `${i + 1}. ${s.title}`).join("\n"));

      outer: for (let si = 0; si < plan.length; si++) {
        const sub = plan[si];
        if (plan.length > 1) pushStep(chatId, `📌 Step ${si + 1}/${plan.length}: ${sub.title}`);
        const subTask = plan.length > 1
          ? `OVERALL GOAL: ${task}\nPLAN:\n${plan.map((s, i) => `${i + 1}. ${s.title}`).join("\n")}\nCURRENT STEP (${si + 1}/${plan.length}): ${sub.goal}${sub.tool ? `\nSuggested tool: ${sub.tool}` : ""}\nWork ONLY on the current step and call done when it is complete.`
          : task;
        history.length = 0;
        subResults.forEach((r) => history.push(`Finished step "${r.title}": ${r.summary.slice(0, 200)}`));
        let actions = 0, guard = 0, subDone = false, subSummary = "";

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
          if (data.done) { subSummary = data.summary || "Done."; subDone = true; pushStep(chatId, `✓ ${subSummary}`); break; }

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
                history.push(`Login details for ${site} are ready. Use browse with op "secret" (field "email" then "password") on the login inputs, or on the screen click the email field and use type_secret "email", click the password field and use type_secret "password", then submit.`);
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

          if (data.delegate?.kind === "browse") {
            const d = data.delegate as { url?: string; ops?: unknown[] };
            pushStep(chatId, `🌐 browse ${(d.url || "same page").slice(0, 80)}`);
            let out: string;
            try {
              const br = await readJson(await fetch("/api/browser", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
                body: JSON.stringify({ uid: user.uid, url: d.url, ops: d.ops, session: browserState, creds }),
              }));
              if (br.error) throw new Error(br.error);
              browserState = br.session;
              out = String(br.snapshot);
            } catch (e) {
              out = `ERROR: ${e instanceof Error ? e.message : "browse failed"} — try again, or use the screen browser.`;
            }
            lastOutput = out;
            outputs.push(`browse\n${out.slice(0, 700)}`);
            if (outputs.length > 5) outputs.shift();
            actions++; totalActions++;
            history.push(`${actions}. browse ${(d.url || "").slice(0, 60)} → ${out.split("\n")[0].slice(0, 100)}`);
            pushStep(chatId, `${actions}. 🌐 ${out.split("\n").find((l) => l.startsWith("URL:")) ?? out.slice(0, 100)}`);
            continue;
          }

          if (data.delegate?.kind === "code") {
            pushStep(chatId, `💻 Handing this to Venus Code: ${String(data.delegate.instruction).slice(0, 100)}`);
            const sum = await runCodeFor(chat, String(data.delegate.instruction), { silent: true, onLine: (l) => pushStep(chatId, l) });
            lastOutput = sum;
            outputs.push(`code → ${sum.slice(0, 600)}`);
            if (outputs.length > 5) outputs.shift();
            actions++; totalActions++;
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
          } else lastOutput = "";

          actions++; totalActions++;
          const line = `${actions}. ${data.thought ? data.thought + " → " : ""}${data.actionText}`;
          history.push(line);
          pushStep(chatId, line);
        }
        subResults.push({ title: sub.title, ok: subDone, summary: subSummary || "Step limit reached before finishing." });
        if (!subDone) notes.push(`Step "${sub.title}" did not finish.`);
      }

      if (stopRef.current[chatId]) { summary = "Stopped before finishing."; pushStep(chatId, "■ Stopped."); }
      else {
        summary = plan.length > 1 ? subResults.map((r, i) => `${r.ok ? "✓" : "✗"} ${i + 1}. ${r.title}: ${r.summary}`).join("\n") : subResults[0]?.summary || "Step limit reached.";
        completed = subResults.some((r) => r.ok);
      }
      finalText = summary;
      if (completed) {
        pushStep(chatId, "✍️ Writing the final report…");
        const report = await composeReport(chat, { task, summary, notes, steps: history, outputs });
        if (report) finalText = report;
        if (totalActions >= 4 && !opts?.quiet) {
          reflect(user.uid, { apiKeys, provider: chat.provider, model: chat.model }, brainRef.current, { task, outcome: summary, steps: history.join("\n") })
            .then((l) => { if (l.length) { say(chatId, "🧠 Learned: " + l.join("; ")); refreshBrain(); } }).catch(() => {});
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

    if (!opts?.quiet) {
      const at = Date.now();
      appendMessages(chatId, logTask
        ? [{ role: "user", content: `🖥️ Task on the computer: ${task}`, at }, { role: "assistant", content: finalText || "Finished.", at }]
        : [{ role: "assistant", content: finalText || "Finished.", at }]);
    }
    if (opts?.stopAfter) {
      const r = await pausePc(chatId);
      say(chatId, r.ok ? "✅ Computer turned off. Everything is saved — turn it on again and it continues where it stopped." : `⚠️ Could not turn the computer off: ${r.error ?? "unknown error"}`);
    }
    return finalText;
  }

  // ---- Venus Pro: runs on the chat's computer; the PC agent can download assets first ----

  async function startVenus(chat: Chat, brief: string, opts: { silent?: boolean } = {}): Promise<string> {
    if (!user) return "";
    const out = (m: string) => { if (!opts.silent) say(chat.id, m); return m; };
    if (!e2bKey) return out("Venus Pro needs an E2B key. Add it under API keys first.");
    if (cfg && !cfg.supabase) return out("Venus Pro needs Supabase for video storage. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy.");
    if (venusBusyRef.current) return out("Venus Pro is already making a video. Wait for it to finish, then ask again.");
    if (!apiKeys[chat.provider]) return out("No API key is saved for this chat's model.");

    venusBusyRef.current = true;
    const opt = guessVenusOptions(brief);
    setVenusRun({ title: brief.replace(/\s+/g, " ").slice(0, 48), label: "Starting the computer…", value: null });
    try {
      const sid = await startOrResumePc(chat.id);
      if (!sid) return out("This chat's computer could not be started — turn it on with the monitor button first.");
      if (!opts.silent) say(chat.id, `🎬 Venus Pro is making your video (${opt.seconds}s, ${opt.aspect}) on this chat's computer. Progress shows above the message box. The first video can take 15-30 minutes.`);

      // The PC agent can fetch real assets first (images, clips, logos…).
      if (/\b(assets?|footage|stock|photos?|images?|logos?|clips?|b-?roll|download)\b/i.test(brief)) {
        setVenusRun((p) => (p ? { ...p, label: "The computer is downloading assets…" } : p));
        await runPcTask(chat, `Find and download 5-10 royalty-free images or short video clips (and logos if the brief names a brand) for a video about: ${brief.slice(0, 400)}. Save them into the folder ~/venus-assets (create it if needed) with short file names using only letters, numbers and dashes (e.g. skyline-night.jpg). Use free sources (Pexels, Pixabay, Unsplash, Wikimedia). Finish by listing the file names you saved.`, false, { quiet: true });
      }

      const project: VenusProject = {
        id: "v" + Date.now().toString(36), title: brief.replace(/\s+/g, " ").slice(0, 48), brief,
        seconds: opt.seconds, aspect: opt.aspect, theme: "midnight", voice: Boolean(apiKeys.openai), voiceName: "nova",
        captions: true, quality: "720p", review: true, design: "ai", music: true, origin: "chat", chatId: chat.id,
        provider: chat.provider, model: chat.model, stage: "studio", status: "idle", createdAt: Date.now(), updatedAt: Date.now(),
      };
      const env: PipelineEnv = { uid: user.uid, token: () => user.getIdToken(), e2bKey, apiKeys, pexels: Boolean(cfg?.pexels), sandboxId: sid };
      const final = await runPipeline(env, {
        log: (m) => setVenusRun((prev) => (prev ? { ...prev, label: m.slice(0, 100) } : prev)),
        progress: (p) => setVenusRun((prev) => (prev ? { ...prev, label: p?.label ?? prev.label, value: p ? p.value : null } : prev)),
        update: () => {}, cancelled: () => false,
      }, project, "studio");
      if (final.status === "done" && final.finalPath) {
        const url = await signedUrl(env, final.finalPath, "venus-video.mp4").catch(() => "");
        return out(`✅ Your video is ready: **${final.title}**.\n\n- [Open and edit it in Venus Pro](/venus?project=${final.id})${url ? `\n- [Download the video](${url})` : ""}`);
      }
      return out(`⚠️ The video could not be finished: ${final.error ?? "unknown error"}\n\n[Open it in Venus Pro](/venus?project=${final.id}) to retry from the failed step.`);
    } catch (err) {
      return out(`⚠️ Venus Pro failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally { venusBusyRef.current = false; setVenusRun(null); }
  }

  // ---- Connectors & deploy ----

  async function testConnector(kind: string, token: string): Promise<{ ok: boolean; label?: string; error?: string }> {
    if (!user) return { ok: false, error: "Not signed in." };
    const res = await fetch("/api/connectors/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
      body: JSON.stringify({ uid: user.uid, kind, token }),
    });
    return readJson(res);
  }

  async function saveConnector(kind: string, token: string) {
    if (!user || !activeChat) return;
    const next = { ...(activeChat.connectors ?? {}) };
    if (token) next[kind] = token; else delete next[kind];
    patchChat(activeChat.id, { connectors: next });
    await updateChatConnectors(user.uid, activeChat.id, next).catch(() => {});
  }

  async function runDeploy(chat: Chat, name?: string): Promise<string> {
    if (!user) return "";
    const live = chatsRef.current.find((c) => c.id === chat.id) ?? chat;
    const token = live.connectors?.vercel;
    const out = (m: string) => { say(chat.id, m); return m; };
    if (!token) return out("Vercel is not connected for this chat. Open the **Connectors** button (plug icon), add your Vercel token, then ask again.");
    if (!e2bKey) return out("Deploy needs the computer (E2B key). Add it under API keys first.");
    const sid = await startOrResumePc(chat.id);
    if (!sid) return out("This chat's computer could not be started — turn it on with the monitor button first.");
    say(chat.id, "🚀 Deploying to Vercel… this takes up to a minute.");
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
        body: JSON.stringify({ uid: user.uid, e2bKey, sandboxId: sid, ws: chat.id, vercelToken: token, name: name?.trim() || undefined }),
      });
      const data = await readJson(res);
      if (!res.ok) return out(`⚠️ Deploy failed: ${data?.error ?? "unknown error"}`);
      return out(`✅ Live: [${data.url}](${data.url})${data.state && data.state !== "READY" ? `\n\nVercel is still finishing the build (${data.state}) — the link works in a minute.` : ""}`);
    } catch (err) {
      return out(`⚠️ Deploy failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  // ---- Team ----

  function teamHost(chat: Chat): TeamHost {
    return {
      llm: (system, prompt) => callLLM(chat, system, prompt),
      runPc: (task) => runPcTask(chat, task, false, { quiet: true }),
      runCode: (task, who) => runCodeFor(chat, task, { silent: true, persona: personaOf(who) }),
      runVideo: (task) => startVenus(chat, task, { silent: true }),
    };
  }

  async function runTeam(chat: Chat, goal: string) {
    if (!user) return;
    if (teamBusyRef.current) return say(chat.id, "The team is already working on a goal. Wait for the report, then ask again.");
    teamBusyRef.current = true;
    setTeamRun(goal.slice(0, 60));
    if (activeIdRef.current === chat.id) { setTeamOpen(true); setPcOpen(false); }
    say(chat.id, "👥 Chief is assembling a team for this. Open the **Team** panel (people icon) to watch who does what — I'll post one final report here.");
    try {
      const report = await runTeamGoal({ uid: user.uid, chatId: chat.id, goal, ctx: brainPrompt(brainRef.current, goal, { noSkills: true }), host: teamHost(chat) });
      say(chat.id, report);
    } catch (err) {
      say(chat.id, `⚠️ The team could not finish: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally { teamBusyRef.current = false; setTeamRun(null); }
  }

  async function runMemberCommands(cmds: Cmd[], chat: Chat, who: Member): Promise<string> {
    const outs: string[] = [];
    for (const c of cmds) {
      if (c.cmd === "task" && c.arg) outs.push("🖥️ " + (await runPcTask(chat, c.arg, false, { quiet: true })));
      else if (c.cmd === "code" && c.arg) outs.push("💻 " + (await runCodeFor(chat, c.arg, { silent: true, persona: personaOf(who) })));
      else if (c.cmd === "venus" && c.arg) outs.push("🎬 " + (await startVenus(chat, c.arg, { silent: true })));
      else if (c.cmd === "memory" && c.arg) await applyMemoryCommand(chat, c.arg, true);
    }
    return outs.join("\n\n");
  }

  async function talkMember(chat: Chat, who: Member, history: TMsg[], text: string): Promise<string> {
    const hint =
      who.tool === "pc" ? "To do work on the computer (browse, search, download, terminal), end your reply with [[PC:task|<clear instruction>]]."
      : who.tool === "code" ? "To build or change code, end your reply with [[CODE:<detailed instruction>]]."
      : who.tool === "video" ? "To make a video, end your reply with [[VENUS:<detailed brief>]]."
      : who.tool === "email" ? "You draft emails (sending needs the Gmail connector, which is not connected yet): write the full draft in your reply."
      : "Answer directly and concretely.";
    const reply = await callLLM(chat, `${personaOf(who)}\n${hint}${brainPrompt(brainRef.current, text)}`, text, history.slice(-12).map((m) => ({ role: m.role, content: m.content })));
    const parsed = extractCommands(reply);
    const extra = parsed.cmds.length ? await runMemberCommands(parsed.cmds, chat, who) : "";
    return [parsed.clean, extra].filter(Boolean).join("\n\n") || "Done.";
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
    if (sources.length === 0 && input.length > 200) sources.push({ text: input.replace(/^[\s\S]{0,80}?\bskill\b[:\s-]*/i, ""), src: "pasted" });
    const names: string[] = [];
    for (const s of sources) {
      const parsed = parseSkillMarkdown(s.text) ?? (await skillFromText(env, s.text));
      if (parsed) names.push((await saveSkill(user.uid, { ...parsed, source: s.src })).name);
    }
    await refreshBrain();
    return { names, message: names.length ? `🧩 Skill saved: **${names.join(", ")}**. I'll use it automatically whenever it fits a task (manage skills on the [Skills page](/skills)).` : "⚠️ I could not read that as a skill. Send a link to a SKILL.md or paste its text." };
  }

  async function applyMemoryCommand(chat: Chat, arg: string, quiet = false) {
    if (!user) return;
    const m = /^(add|forget)\s*\|\s*([\s\S]+)$/i.exec(arg);
    if (!m) return;
    if (m[1].toLowerCase() === "add") {
      const saved = await addMemory(user.uid, m[2]);
      if (saved && !quiet) say(chat.id, `🧠 Remembered: ${saved.text}`);
    } else {
      const n = await forgetMemory(user.uid, m[2]);
      if (!quiet) say(chat.id, n ? `🧠 Forgot ${n} item${n > 1 ? "s" : ""} about “${m[2]}”.` : `I had nothing saved about “${m[2]}”.`);
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
      else if (c.cmd === "team" && c.arg) await runTeam(chat, c.arg);
      else if (c.cmd === "deploy") await runDeploy(chat, c.arg);
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
    const team = /^\/team\s+([\s\S]+)/i.exec(text);
    const deploy = /^\/deploy(?:\s+([\s\S]+))?$/i.exec(text);
    const forget = /^\/forget\s+([\s\S]+)/i.exec(text);
    const remember = /^\/remember\s+([\s\S]+)/i.exec(text) ?? /^(?:please\s+)?remember(?:\s+that)?[:\s]+([\s\S]{3,})/i.exec(text);
    const slash = Boolean(video || code || team || deploy);
    const analysis = e2bKey && !slash ? analyzePcMessage(text) : { pureCommand: null, compound: false, stopAfter: false };
    const key = apiKeys[chat.provider];
    if (!analysis.pureCommand && !forget && !remember && !deploy && !key) { setSettingsOpen(true); return; }

    appendMessages(chat.id, [{ role: "user", content: text, at: Date.now() }]);
    setDraft("");

    if (deploy) { void runDeploy(chat, deploy[1]); return; }
    if (video) { void startVenus(chat, video[1].trim()); return; }
    if (code) { void runCodeFor(chat, code[1].trim()); return; }
    if (team) { void runTeam(chat, team[1].trim()); return; }
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
          reply = r.ok ? (sandboxRef.current[chat.id] ? "✅ Computer turned off. Files, apps and logins are saved — turn it on again and it continues where it stopped." : "✅ This chat's computer is already off or expired.") : `⚠️ ${r.error ?? "Could not turn the computer off."}`;
        }
      } catch (err) { reply = `⚠️ ${err instanceof Error ? err.message : "Something went wrong."}`; }
      finally { setSending(false); }
      say(chat.id, reply);
      return;
    }

    let extraSystem = "";
    if (/\b(install|add|save|learn|import)\b[\s\S]*\bskills?\b/i.test(text) && (/https?:\/\//.test(text) || text.length > 300)) {
      setSending(true);
      const r = await installSkillFrom(chat, text);
      setSending(false);
      say(chat.id, r.message);
      if (r.names.length) extraSystem = `\n\nThe user just installed the skill(s): ${r.names.join(", ")}. Acknowledge briefly and carry out any remaining part of the request using the skill.`;
      if (text.replace(/https?:\/\/\S+/g, "").length < 90) return;
    }

    // A goal that spans several areas goes to the team.
    if (e2bKey && text.length > 60 && domainCount(text) >= 2) { void runTeam(chat, text); return; }

    if (e2bKey && (computerMode || analysis.compound)) {
      say(chat.id, "On it — starting the computer and working on your task. Progress shows in the panel.");
      void runPcTask(chat, text, false, { stopAfter: analysis.stopAfter });
      return;
    }

    setSending(true);
    let cmds: Cmd[] = [];
    try {
      const history = (chatsRef.current.find((c) => c.id === chat.id)?.messages ?? []).map((m) => ({ role: m.role, content: m.content }));
      const reply = await callLLM(
        chat,
        `You are ${chat.agentName}, an AI teammate working inside AgenticVenus. Be direct and useful, and focus on getting real work done for the person you're talking to.` + brainPrompt(brainRef.current, text) + (e2bKey ? PC_PROMPT : "") + (chat.connectors?.vercel ? DEPLOY_PROMPT : "") + extraSystem,
        history.pop()?.content ?? text,
        history
      );
      const parsed = extractCommands(reply);
      cmds = parsed.cmds;
      say(chat.id, parsed.clean || (cmds.length ? "On it." : "…"));
    } catch (err) {
      say(chat.id, `⚠️ ${err instanceof Error ? err.message : "Something went wrong."}`);
    } finally { setSending(false); }
    if (cmds.length > 0) void runCommands(cmds, chat);
  }

  function handleRunPcTask(task: string) { if (activeChat) void runPcTask(activeChat, task, true); }

  // ---- Routines ----

  async function handleCreateRoutine(input: { name: string; instructions: string; everyMinutes: number; startAt: number }) {
    if (!user || !activeChat) return;
    const routine = await createRoutine(user.uid, { chatId: activeChat.id, ...input });
    setRoutines((prev) => [...prev, routine]); setRoutinePrefill(null);
  }
  function handleToggleRoutine(id: string, enabled: boolean) {
    if (!user) return;
    setRoutines((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
    setRoutineEnabled(user.uid, id, enabled);
  }
  function handleDeleteRoutine(id: string) { if (!user) return; setRoutines((prev) => prev.filter((r) => r.id !== id)); deleteRoutine(user.uid, id); }
  async function handleRunRoutineNow(routine: Routine) {
    if (!user || !activeChat) return;
    if (!apiKeys[activeChat.provider]) { setSettingsOpen(true); return; }
    setRunningRoutineId(routine.id);
    try {
      const reply = await callLLM(activeChat, "", routine.instructions);
      appendMessages(activeChat.id, [{ role: "user", content: `🔁 Routine: ${routine.name}`, at: Date.now() }, { role: "assistant", content: reply, at: Date.now() }]);
      await recordManualRun(user.uid, routine.id, reply);
      setRoutines((prev) => prev.map((r) => (r.id === routine.id ? { ...r, lastRunAt: Date.now(), lastResult: reply.slice(0, 200) } : r)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Routine run failed.";
      await recordManualRun(user.uid, routine.id, `⚠️ ${message}`);
      setRoutines((prev) => prev.map((r) => (r.id === routine.id ? { ...r, lastRunAt: Date.now(), lastResult: `⚠️ ${message}` } : r)));
    } finally { setRunningRoutineId(null); }
  }

  if (authLoading || !user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;

  const session: PcSession = activeChat ? sessions[activeChat.id] ?? EMPTY_SESSION : EMPTY_SESSION;
  const activeSandboxId = activeChat?.pcSandboxId ?? null;

  return (
    <div className="flex h-screen bg-bg">
      {!focusMode && <Sidebar chats={chats} activeId={activeId} onSelect={setActiveId} onNewChat={() => setNewChatOpen(true)} userLabel={user.email ?? "Account"} onOpenApiKeys={() => setSettingsOpen(true)} onSignOut={() => signOut(auth)} />}

      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {activeChat && (
            <header className="flex items-center justify-between border-b border-line px-6 py-3.5">
              <div className="flex items-center gap-2.5">
                <button onClick={() => setFocusMode((v) => !v)} title={focusMode ? "Show chat list" : "Focus mode — hide the chat list"} className="rounded-lg p-1.5 text-muted hover:bg-panel2 hover:text-ink">{focusMode ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
                <BotAvatar color={activeChat.agentColor} size={26} />
                <span className="text-sm font-medium text-ink">{activeChat.agentName}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => router.push(`/code?chat=${activeChat.id}`)} title="Venus Code — this chat's codespace" className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gold hover:bg-panel2">Code</button>
                <button onClick={() => router.push("/venus")} title="Venus Pro — motion graphics" className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gold hover:bg-panel2">Venus Pro</button>
                <button onClick={() => router.push("/skills")} title="Memory & skills" className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gold hover:bg-panel2">Skills</button>
                <button onClick={() => setConnectorsOpen(true)} title="Connectors" className="relative rounded-lg p-2 text-muted hover:bg-panel2 hover:text-ink">
                  <Plug size={17} />
                  {Object.keys(activeChat.connectors ?? {}).length > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-avatar-teal" />}
                </button>
                <button onClick={() => setRoutinesOpen(true)} title="Routines" className="relative rounded-lg p-2 text-muted hover:bg-panel2 hover:text-ink">
                  <Clock size={17} />
                  {routines.some((r) => r.enabled) && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-avatar-teal" />}
                </button>
                <button onClick={handleTeamClick} title="Team — specialists working for this chat" className={`relative rounded-lg p-2 hover:bg-panel2 hover:text-ink ${teamOpen ? "bg-panel2 text-ink" : "text-muted"}`}>
                  <Users size={17} />
                  {teamRun && <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />}
                </button>
                <button onClick={handlePcClick} title={pcOpen ? "Hide this chat's computer" : activeSandboxId ? "Show this chat's computer" : "Give this chat a cloud computer"} className={`relative rounded-lg p-2 hover:bg-panel2 hover:text-ink ${pcOpen ? "bg-panel2 text-ink" : "text-muted"}`}>
                  <Monitor size={17} />
                  {activeSandboxId && <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${session.status === "paused" ? "bg-faint" : "bg-avatar-teal"}`} />}
                </button>
              </div>
            </header>
          )}

          {pcMessage && <div className="flex items-center justify-between border-b border-line bg-panel px-6 py-2 text-xs text-muted">{pcMessage}<button onClick={() => setPcMessage(null)} className="text-faint hover:text-ink">Dismiss</button></div>}

          {!chatsLoaded ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading your chats…</div>
          ) : !hasAnyKey && !keysLoading ? (
            <FirstKeyGate />
          ) : !activeChat ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-ink">Pick a chat, or start a new one.</p>
              <button onClick={() => setNewChatOpen(true)} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-bg hover:opacity-90"><Plus size={16} /> New chat</button>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <div className="mx-auto max-w-2xl"><ChatThread messages={activeChat.messages} pending={sending} onSaveAsRoutine={(t) => { setRoutinePrefill(t); setRoutinesOpen(true); }} /></div>
              </div>

              {(venusRun || codeRun || teamRun) && (
                <div className="mx-auto w-full max-w-2xl space-y-2 px-6 pb-2">
                  {venusRun && (
                    <div className="rounded-lg border border-line bg-panel p-3 text-xs text-muted">
                      <div className="flex justify-between"><span className="text-ink">🎬 Venus Pro · {venusRun.title}</span><span>{venusRun.value === null ? "…" : Math.round(venusRun.value * 100) + "%"}</span></div>
                      <p className="mt-1 truncate">{venusRun.label}</p>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel2"><div className={`h-full rounded-full bg-gold ${venusRun.value === null ? "w-1/3 animate-pulse" : ""}`} style={venusRun.value === null ? undefined : { width: Math.round(venusRun.value * 100) + "%" }} /></div>
                    </div>
                  )}
                  {codeRun && (
                    <div className="rounded-lg border border-line bg-panel p-3 text-xs text-muted">
                      <span className="text-ink">💻 Venus Code · {codeRun.title}</span><p className="mt-1 truncate">{codeRun.label}</p>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel2"><div className="h-full w-1/3 animate-pulse rounded-full bg-gold" /></div>
                    </div>
                  )}
                  {teamRun && <div className="rounded-lg border border-line bg-panel p-3 text-xs text-muted"><span className="text-ink">👥 Team working · {teamRun}</span> — open the Team panel to follow along.</div>}
                </div>
              )}

              <div className="mx-auto w-full max-w-2xl px-6 pb-2"><ModelPicker provider={activeChat.provider} model={activeChat.model} apiKeys={apiKeys} onChange={handleModelChange} /></div>

              <form onSubmit={handleSend} className="mx-auto flex w-full max-w-2xl items-center gap-2 border-t border-line px-6 py-4">
                <button type="button" aria-label="Attach" className="rounded-full p-2 text-muted hover:bg-panel2"><Plus size={18} /></button>
                {e2bKey && (
                  <button type="button" onClick={() => setComputerMode((v) => !v)} aria-pressed={computerMode} title={computerMode ? "Computer mode ON — your message goes straight to the computer as a task" : "Computer mode — send your message straight to the computer as a task"} className={`flex items-center gap-1.5 rounded-full px-2.5 py-2 text-xs ${computerMode ? "bg-gold font-medium text-bg" : "text-muted hover:bg-panel2 hover:text-ink"}`}>
                    <Monitor size={15} />{computerMode && "Computer"}
                  </button>
                )}
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={computerMode ? "Give the computer a task…" : `Message ${activeChat.agentName}  ·  /code  /video  /team  /deploy`} className="flex-1 rounded-full border border-line bg-panel px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-gold" />
                <button type="submit" aria-label="Send" disabled={!draft.trim() || sending} className="rounded-full bg-white p-2.5 text-bg hover:opacity-90 disabled:opacity-40"><ArrowUp size={16} /></button>
              </form>
            </>
          )}
        </div>

        {teamOpen && activeChat && (
          <TeamPanel key={activeChat.id} uid={user.uid} chatId={activeChat.id} chatName={activeChat.agentName} onClose={() => setTeamOpen(false)} onTalk={(m, h, t) => talkMember(activeChat, m, h, t)} />
        )}
        {pcOpen && !teamOpen && activeChat && (
          <PcPanel
            key={activeChat.id} hasComputer={Boolean(activeSandboxId)} status={session.status} error={session.error} screenUrl={session.screenUrl}
            steps={session.steps} running={session.running} request={session.request} fullscreen={pcFullscreen} wide={focusMode}
            onClose={() => { setPcOpen(false); setPcFullscreen(false); }}
            onStart={() => void createPc(activeChat.id)}
            onReload={() => { const id = sandboxRef.current[activeChat.id]; if (id) void loadScreen(activeChat.id, id); }}
            onPause={() => void pausePc(activeChat.id)} onDelete={() => void deletePc(activeChat.id)}
            onRunTask={handleRunPcTask} onStop={() => handleStop(activeChat.id)} onReply={(r) => handleReply(activeChat.id, r)}
            onToggleFullscreen={() => setPcFullscreen((v) => !v)}
          />
        )}
      </div>

      <NewChatModal open={newChatOpen} onClose={() => setNewChatOpen(false)} customAgents={customAgents} onPick={handlePickAgent} onCreateAgent={handleCreateAgent} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {activeChat && (
        <RoutinesPanel open={routinesOpen} onClose={() => { setRoutinesOpen(false); setRoutinePrefill(null); }} chatName={activeChat.agentName} routines={routines} prefillInstructions={routinePrefill} busyId={runningRoutineId} onCreate={handleCreateRoutine} onToggle={handleToggleRoutine} onDelete={handleDeleteRoutine} onRunNow={handleRunRoutineNow} />
      )}
      {activeChat && (
        <ConnectorsModal open={connectorsOpen} onClose={() => setConnectorsOpen(false)} chatName={activeChat.agentName} connectors={activeChat.connectors ?? {}} onTest={testConnector} onSave={saveConnector} />
      )}
    </div>
  );
}