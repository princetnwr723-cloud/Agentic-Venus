"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { signOut } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useKeys, type SavedLogin } from "@/lib/keys-context";
import { listChats, createChat, updateChatMessages, updateChatModel, updateChatPc, updateChatConnectors, type Chat, type ChatMessage } from "@/lib/chats";
import { listCustomAgents, createCustomAgent, type CustomAgent } from "@/lib/agents";
import { listRoutinesForChat, createRoutine, setRoutineEnabled, deleteRoutine, recordManualRun, type Routine } from "@/lib/routines";
import { setModelPref } from "@/lib/model-pref";
import type { ProviderId } from "@/lib/providers";
import { addMemory, brainPrompt, forgetMemory, loadBrain, parseSkillMarkdown, reflect, saveSkill, skillFromText, type Brain } from "@/lib/brain";
import { runCodeAgent, type CodeHooks } from "@/lib/code-agent";
import { getCodeProject, newCodeProject, saveCodeProject } from "@/lib/code-store";
import type { VenusProject } from "@/lib/venus";
import { runPipeline, signedUrl, type PipelineEnv } from "@/lib/venus-pipeline";
import { personaOf, type Member } from "@/lib/team-catalog";
import { runTeamGoal, type TeamHost, type TMsg } from "@/lib/team";
import type { AvatarColor } from "@/lib/bots";
import { pickModel, fallbackChain, type Role } from "@/lib/router";
import { beginTrace, addUsage, traceOf } from "@/lib/trace";
import { verifyResult } from "@/lib/critic";
import { describeStep, listRecipes, markRecipe, matchRecipes, replayRecipe, saveRecipe, type RecipeStep } from "@/lib/recipes";
import { ensureNode, followPcJob, proofUrl, startPcJob, type HealCtx, type PcOutcome, type PcPending } from "@/lib/pc-agent";
import type { ToolSpec } from "@/lib/tools/types";
import { toolPrompt, extractToolCalls } from "@/lib/tools/prompt";
import {
  DEPLOY_PROMPT, EMPTY_SESSION, IDLE_PAUSE_MS, PC_PROMPT, RUN_CYCLE_MS, analyzePcMessage, defaultProviderAndModel, domainCount,
  extractCommands, guessVenusOptions, normSite, readJson, type Cmd, type PcSession,
} from "@/lib/dashboard/helpers";
import Sidebar from "@/components/dashboard/Sidebar";
import ChatThread from "@/components/dashboard/ChatThread";
import ChatHeader from "@/components/dashboard/ChatHeader";
import ChatComposer from "@/components/dashboard/ChatComposer";
import RunBars from "@/components/dashboard/RunBars";
import ModelPicker from "@/components/dashboard/ModelPicker";
import NewChatModal from "@/components/dashboard/NewChatModal";
import SettingsModal from "@/components/dashboard/SettingsModal";
import RoutinesPanel from "@/components/dashboard/RoutinesPanel";
import FirstKeyGate from "@/components/dashboard/FirstKeyGate";
import TeamPanel from "@/components/dashboard/TeamPanel";
import ConnectorsModal from "@/components/dashboard/ConnectorsModal";
import PcPanel, { type AgentRequest, type RequestReply } from "@/components/dashboard/PcPanel";

const toRequest = (p: PcPending): AgentRequest =>
  p.kind === "login" ? { kind: "login", site: p.site ?? "" }
  : p.kind === "choice" ? { kind: "choice", question: p.question ?? "", options: p.options ?? [] }
  : p.kind === "handoff" ? { kind: "handoff", message: p.message ?? "" }
  : { kind: "text", question: p.question ?? "" };

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
  const [streaming, setStreaming] = useState(false);
  const [attach, setAttach] = useState<{ name: string; text: string } | null>(null);
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
  const beatRef = useRef<Record<string, number>>({});
  const busyChats = useRef<Set<string>>(new Set());
  const chatsRef = useRef<Chat[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const venusBusyRef = useRef(false);
  const codeBusyRef = useRef(false);
  const teamBusyRef = useRef(false);
  const brainRef = useRef<Brain>({ memories: [], skills: [] });
  const toolCache = useRef<Record<string, { sig: string; specs: ToolSpec[] }>>({});

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

  // Re-attach to a background job that was started earlier (tab closed / reloaded).
  useEffect(() => {
    if (!user || !activeChat || !e2bKey || runningRef.current[activeChat.id]) return;
    const chat = activeChat;
    getDoc(doc(db, "users", user.uid, "pcJobs", chat.id)).then((s) => {
      const d = s.data() as { running?: boolean; task?: string; job?: { id: string; sandboxId: string } } | undefined;
      if (d?.running && d.job && !runningRef.current[chat.id]) void runPcTask(chat, d.task ?? "Background task", false, { resume: { jobId: d.job.id, sandboxId: d.job.sandboxId } });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeChat?.id, e2bKey]);

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
  const pushStep = (chatId: string, line: string) => {
    traceOf(chatId)?.add("step", line);
    patchSession(chatId, (s) => ({ steps: [...s.steps, line] }));
  };

  // Heartbeat: tells the server this computer is in use, so the idle reaper leaves it alone.
  const beat = (chatId: string) => {
    if (!user || Date.now() - (beatRef.current[chatId] ?? 0) < 50_000) return;
    beatRef.current[chatId] = Date.now();
    updateDoc(doc(db, "users", user.uid, "chats", chatId), { pcActiveAt: Date.now() }).catch(() => {});
  };
  const touch = (chatId: string) => { lastTouchRef.current[chatId] = Date.now(); beat(chatId); };

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

  // ---- This chat's computer (the ONLY E2B machine: Venus Code, Venus Pro and the background agent use it) ----

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
      if (data.persistence === "none") setPcMessage("ℹ️ This E2B version has no auto-pause. The server pauses idle computers for you (data stays safe).");
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

  // Client-side idle pause + heartbeat for work that only this tab drives (Venus Pro, Venus Code).
  useEffect(() => {
    if (!user || !e2bKey) return;
    const iv = setInterval(() => {
      busyChats.current.forEach((id) => beat(id));
      for (const [chatId, s] of Object.entries(sessionsRef.current)) {
        if (s.status !== "ready" || s.running || runningRef.current[chatId] || codeBusyRef.current || venusBusyRef.current) continue;
        const last = lastTouchRef.current[chatId] ?? 0;
        const started = runStartRef.current[chatId] ?? 0;
        if ((last > 0 && Date.now() - last > IDLE_PAUSE_MS) || (started > 0 && Date.now() - started > RUN_CYCLE_MS)) {
          void pausePc(chatId).then((r) => { if (r.ok) setPcMessage("💾 A computer was safe-paused. Your data is saved — press Turn on to continue."); });
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

  // ---- Models: router + fallback + streaming ----

  async function callLLM(chat: Chat, system: string, prompt: string, history: Array<{ role: "user" | "assistant"; content: string }> = [], role: Role = "act"): Promise<string> {
    const pick = pickModel(role, apiKeys, chat);
    if (!pick.apiKey) throw new Error("No API key saved for this chat's model.");
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: pick.provider, apiKey: pick.apiKey, model: pick.model, fallbacks: fallbackChain(apiKeys, pick.provider),
        systemPrompt: system || undefined, messages: [...history, { role: "user", content: prompt }],
      }),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data?.error || "Request failed.");
    const reply = String(data.reply ?? "").trim();
    addUsage(chat.id, pick.model, system.length + prompt.length + history.reduce((n, m) => n + m.content.length, 0), reply.length);
    return reply;
  }

  async function streamLLM(chat: Chat, system: string, prompt: string, history: Array<{ role: "user" | "assistant"; content: string }>, onText: (t: string) => void): Promise<string> {
    const key = apiKeys[chat.provider];
    if (!key) throw new Error("No API key saved for this chat's model.");
    const res = await fetch("/api/chat/stream", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: chat.provider, apiKey: key, model: chat.model, systemPrompt: system || undefined, messages: [...history, { role: "user", content: prompt }] }),
    });
    if (!res.ok || !res.body) throw new Error((await readJson(res))?.error || "Stream failed.");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      full += dec.decode(value, { stream: true });
      onText(full);
    }
    const i = full.indexOf("[[ERROR]]");
    if (i < 0) { addUsage(chat.id, chat.model, system.length + prompt.length, full.length); return full.trim(); }
    const partial = full.slice(0, i).trim();
    const msg = full.slice(i + 9).trim();
    if (!partial) throw new Error(msg);
    return `${partial}\n\n⚠️ ${msg}`;
  }

  async function composeReport(chat: Chat, m: { task: string; summary: string; steps: string[] }): Promise<string | null> {
    try {
      return await callLLM(chat, "", [
        "You are writing the FINAL message to the user after a computer agent finished their task.",
        "Rules: write in clear English. Use markdown. Start with ONE line for the outcome (✅ done / ⚠️ partly done / ❌ failed). Then short bullets of what was done. Then the concrete results: facts, names, numbers, versions, file paths, and links with their source names. If anything failed or is unfinished, say exactly what and the next step. Never invent anything that is not in the material below. Be concise — no filler.",
        "", `USER'S TASK:\n${m.task}`, "", `AGENT'S RESULT:\n${m.summary}`, "", `LAST STEPS:\n${m.steps.slice(-25).join("\n")}`,
      ].join("\n"), [], "report");
    } catch { return null; }
  }

  // ---- Tools (free pack + plugins + MCP + API) used from chat ----

  async function loadTools(chat: Chat): Promise<ToolSpec[]> {
    if (!user) return [];
    const conn = (chatsRef.current.find((c) => c.id === chat.id) ?? chat).connectors ?? {};
    const sig = JSON.stringify(conn);
    const hit = toolCache.current[chat.id];
    if (hit && hit.sig === sig) return hit.specs;
    try {
      const r = await readJson(await fetch("/api/tools", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
        body: JSON.stringify({ action: "list", uid: user.uid, chatId: chat.id, connectors: conn }),
      }));
      const specs = Array.isArray(r.specs) ? (r.specs as ToolSpec[]) : [];
      toolCache.current[chat.id] = { sig, specs };
      return specs;
    } catch { return []; }
  }

  async function execTool(chat: Chat, name: string, args: Record<string, unknown>): Promise<string> {
    if (!user) return "ERROR: not signed in.";
    const conn = (chatsRef.current.find((c) => c.id === chat.id) ?? chat).connectors ?? {};
    const post = async (approved: boolean) =>
      readJson(await fetch("/api/tools", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
        body: JSON.stringify({ action: "call", uid: user.uid, chatId: chat.id, connectors: conn, name, args, approved }),
      }));
    let r = await post(false);
    if (r.needsApproval) {
      if (!window.confirm(`Approve this action?\n\n${r.needsApproval.summary}`)) return "The user declined this action. Do not retry it.";
      r = await post(true);
    }
    return r.ok ? String(r.text) : `ERROR: ${r.text || r.error || "tool failed"}`;
  }

  // ---- Venus Code ----

  async function runCodeFor(chat: Chat, instruction: string, opts: { silent?: boolean; persona?: string; onLine?: (l: string) => void } = {}): Promise<string> {
    if (!user) return "";
    const out = (m: string) => { if (!opts.silent) say(chat.id, m); return m; };
    if (!e2bKey) return out("Venus Code needs an E2B key. Add it under API keys first.");
    if (!apiKeys[chat.provider]) return out("No API key is saved for this chat's model.");
    if (codeBusyRef.current) return out("Venus Code is already working on something. Wait for it to finish, then ask again.");
    codeBusyRef.current = true;
    busyChats.current.add(chat.id);
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
    } finally { codeBusyRef.current = false; busyChats.current.delete(chat.id); setCodeRun(null); }
  }

  // ---- The background computer agent ----

  async function finishPcRun(chat: Chat, task: string, out: PcOutcome, opts?: { quiet?: boolean; heal?: HealCtx }): Promise<string> {
    if (!user || !e2bKey) return out.summary;
    const chatId = chat.id;
    const env = { uid: user.uid, token: () => user.getIdToken(), e2bKey };
    const steps = sessionsRef.current[chatId]?.steps ?? [];
    const summary = out.summary || "Finished.";
    if (out.status === "stopped") { pushStep(chatId, "■ Stopped."); return "Stopped before finishing."; }
    if (out.status !== "done") return `⚠️ ${summary}`;

    let replay = "";
    if (out.proof) { const url = await proofUrl(env, out.proof).catch(() => ""); if (url) replay = `\n\n🎥 [Watch the replay](${url}) (link works for 6 hours)`; }
    if (opts?.quiet) return summary + replay;

    pushStep(chatId, "🔎 Verifier is checking the result…");
    const v = await verifyResult((s, p) => callLLM(chat, s, p, [], "verify"), { task, summary, evidence: [steps.slice(-25).join("\n")] });
    traceOf(chatId)?.add("verify", `${v.verdict}: ${v.reason}`);
    pushStep(chatId, `${v.verdict === "pass" ? "✅" : "⚠️"} Verifier: ${v.verdict} — ${v.reason}`);

    pushStep(chatId, "✍️ Writing the final report…");
    let text = (await composeReport(chat, { task, summary, steps })) ?? summary;
    if (v.verdict !== "pass") text = `⚠️ **Verifier (${v.verdict}):** ${v.reason}\n\n${text}`;
    text += replay;

    // Workflow compiler: a verified run becomes a recipe (browser + tool + shell steps) that replays with no AI.
    if (v.verdict === "pass" && out.recipe && out.recipe.length) {
      const all: RecipeStep[] = opts?.heal ? [...opts.heal.keep, ...out.recipe] : out.recipe;
      const first = all.find((s) => (s.kind ?? "browse") === "browse" && "url" in s && s.url) as { url?: string } | undefined;
      let site = "";
      try { site = new URL(/^https?:/i.test(first?.url ?? "") ? (first?.url as string) : `https://${first?.url}`).hostname; } catch { /* no site */ }
      const name = opts?.heal ? opts.heal.recipe.name : task.slice(0, 60);
      saveRecipe(user.uid, { name, task: opts?.heal ? opts.heal.recipe.task : task, site, steps: all })
        .then(() => say(chatId, opts?.heal ? `🩹 Recipe **${name}** repaired — only the broken part was re-learned.` : `💾 Saved as a recipe. Next time run it free (no AI): \`/recipe ${task.slice(0, 30)}\``))
        .catch(() => {});
    }
    if (steps.length >= 4) {
      reflect(user.uid, { apiKeys, provider: chat.provider, model: chat.model }, brainRef.current, { task, outcome: summary, steps: steps.join("\n") })
        .then((l) => { if (l.length) { say(chatId, "🧠 Learned: " + l.join("; ")); refreshBrain(); } }).catch(() => {});
    }
    return text;
  }

  async function runPcTask(
    chat: Chat, task: string, logTask: boolean,
    opts?: { stopAfter?: boolean; quiet?: boolean; heal?: HealCtx; resume?: { jobId: string; sandboxId: string } }
  ): Promise<string> {
    const chatId = chat.id;
    if (!user || !e2bKey) return "";
    if (runningRef.current[chatId]) { const m = "This chat's computer is already running a task — one at a time."; setPcMessage(m); return m; }
    const key = apiKeys[chat.provider];
    if (!key) { setSettingsOpen(true); return "No API key for this chat's model."; }

    runningRef.current[chatId] = true;
    stopRef.current[chatId] = false;
    busyChats.current.add(chatId);
    patchSession(chatId, { running: true, steps: [`▶ ${task}`], request: null });
    if (activeIdRef.current === chatId && !opts?.quiet) { setPcOpen(true); setTeamOpen(false); }
    const trace = beginTrace(user.uid, chatId, task.slice(0, 80), "computer");
    const env = { uid: user.uid, token: () => user.getIdToken(), e2bKey };
    let finalText = "";

    try {
      const sid = opts?.resume?.sandboxId ?? (await startOrResumePc(chatId));
      if (!sid) throw new Error(sessionsRef.current[chatId]?.error || "The computer could not be started — see the panel for the reason.");
      let jobId = opts?.resume?.jobId;
      if (!jobId) {
        pushStep(chatId, "⚙️ Preparing the computer…");
        await ensureNode(env, sid, (l) => pushStep(chatId, l));
        jobId = await startPcJob(env, { sandboxId: sid, chatId, task, provider: chat.provider, model: chat.model, apiKey: key, context: brainPrompt(brainRef.current, task), heal: opts?.heal });
        pushStep(chatId, "🚀 Working in the background — you can close this tab; I will report here.");
      } else pushStep(chatId, "🔗 Re-attached to the running task.");

      const out = await followPcJob({
        env, chatId, sandboxId: sid, jobId,
        onStep: (l) => { pushStep(chatId, l); touch(chatId); },
        cancelled: () => Boolean(stopRef.current[chatId]),
        onAsk: async (p) => {
          if (p.kind === "login" && findCredential(p.site ?? "")) return { type: "login_saved", site: p.site ?? "" };
          const reply = await askUser(chatId, toRequest(p));
          if (stopRef.current[chatId]) return { type: "answer", text: "" };
          if (reply.type === "login") {
            // The password goes to YOUR account document; the server injects it into the browser. The model never sees it.
            await savePcCredential(normSite(p.site ?? ""), { email: reply.email, password: reply.password });
            return { type: "login_saved", site: p.site ?? "" };
          }
          if (reply.type === "self") return { type: "self" };
          if (reply.type === "answer") return { type: "answer", text: reply.text };
          return { type: "handoff_done" };
        },
      });
      finalText = await finishPcRun(chat, task, out, opts);
    } catch (err) {
      finalText = `⚠️ ${err instanceof Error ? err.message : "The task failed."}`;
      pushStep(chatId, finalText);
    } finally {
      await trace.end(stopRef.current[chatId] ? "stopped" : finalText.startsWith("⚠️") ? "error" : "done");
      runningRef.current[chatId] = false;
      resolverRef.current[chatId] = null;
      busyChats.current.delete(chatId);
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

  // ---- Recipes: replay with no AI, heal only the broken part ----

  async function runRecipeCmd(chat: Chat, arg: string) {
    if (!user) return;
    const list = await listRecipes(user.uid);
    if (!arg.trim()) {
      return say(chat.id, list.length
        ? "📒 **Your recipes**\n" + list.map((r) => `- **${r.name}** — ${r.steps.length} steps · ran ${r.runs}×${r.fails ? ` · ${r.fails} broke` : ""}`).join("\n") + "\n\nRun one with `/recipe <name>`."
        : "No recipes yet. Finish a task on the computer and it is saved automatically.");
    }
    const hit = matchRecipes(list, arg)[0];
    if (!hit) return say(chat.id, "No recipe matches that. Send `/recipe` to see the list.");
    say(chat.id, `▶️ Running recipe **${hit.name}** (${hit.steps.length} steps) — no AI model used.`);
    try {
      const r = await replayRecipe({
        token: () => user.getIdToken(), uid: user.uid, chatId: chat.id,
        connectors: chatsRef.current.find((c) => c.id === chat.id)?.connectors ?? {},
        recipe: hit, creds: findCredential(hit.site) ?? undefined,
        shell: async (command) => {
          if (!e2bKey) return { ok: false, text: "Add an E2B key first." };
          const id = await startOrResumePc(chat.id);
          if (!id) return { ok: false, text: "The computer could not be started." };
          const res = await readJson(await fetch("/api/e2b/shell", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
            body: JSON.stringify({ uid: user.uid, e2bKey, sandboxId: id, command }),
          }));
          return { ok: !res.error && (res.done ? res.exitCode === 0 : true), text: String(res.error ?? res.output ?? "") };
        },
        approve: async (summary) => window.confirm(`Approve this recipe action?\n\n${summary}`),
      });
      await markRecipe(user.uid, hit, r.ok);
      if (r.ok) return say(chat.id, `✅ Recipe finished.\n\n${r.snapshot.slice(0, 1500)}`);

      const k = r.failedAt ?? 0;
      if (!e2bKey) return say(chat.id, `⚠️ Recipe broke at step ${k + 1}. Add an E2B key and I can repair it.\n\n${r.snapshot.slice(0, 400)}`);
      say(chat.id, `🩹 Step ${k + 1} of ${hit.steps.length} broke (${describeStep(hit.steps[k])}). I will re-learn only that part and keep the steps before it.`);
      const healTask =
        `A saved recipe "${hit.name}" (original goal: ${hit.task}) broke at step ${k + 1} of ${hit.steps.length} because the site changed.\n` +
        `The browser is already open${r.url ? ` on ${r.url}` : ""} with the login kept: do NOT start over and do NOT repeat the finished steps.\n` +
        `Do what the broken step intended, then finish the rest of the goal. Steps still to do, for reference:\n` +
        hit.steps.slice(k).map((s, i) => `${k + i + 1}. ${describeStep(s)}`).join("\n");
      await runPcTask(chat, healTask, true, { heal: { recipe: hit, keep: hit.steps.slice(0, k), session: r.session, snapshot: r.snapshot, url: r.url } });
    } catch (e) {
      say(chat.id, `⚠️ Recipe failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  // ---- Venus Pro ----

  async function startVenus(chat: Chat, brief: string, opts: { silent?: boolean } = {}): Promise<string> {
    if (!user) return "";
    const out = (m: string) => { if (!opts.silent) say(chat.id, m); return m; };
    if (!e2bKey) return out("Venus Pro needs an E2B key. Add it under API keys first.");
    if (cfg && !cfg.supabase) return out("Venus Pro needs Supabase for video storage. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy.");
    if (venusBusyRef.current) return out("Venus Pro is already making a video. Wait for it to finish, then ask again.");
    if (!apiKeys[chat.provider]) return out("No API key is saved for this chat's model.");

    venusBusyRef.current = true;
    busyChats.current.add(chat.id);
    const opt = guessVenusOptions(brief);
    setVenusRun({ title: brief.replace(/\s+/g, " ").slice(0, 48), label: "Starting the computer…", value: null });
    try {
      const sid = await startOrResumePc(chat.id);
      if (!sid) return out("This chat's computer could not be started — turn it on with the monitor button first.");
      if (!opts.silent) say(chat.id, `🎬 Venus Pro is making your video (${opt.seconds}s, ${opt.aspect}) on this chat's computer. Progress shows above the message box. The first video can take 15-30 minutes — keep this tab open.`);

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
    } finally { venusBusyRef.current = false; busyChats.current.delete(chat.id); setVenusRun(null); }
  }

  // ---- Connectors & deploy ----

  async function testConnector(kind: string, token: string): Promise<{ ok: boolean; label?: string; error?: string }> {
    if (!user) return { ok: false, error: "Not signed in." };
    const res = await fetch("/api/connectors/test", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
      body: JSON.stringify({ uid: user.uid, kind, token }),
    });
    return readJson(res);
  }

  async function saveConnector(kind: string, token: string) {
    if (!user || !activeChat) return;
    const next = { ...(chatsRef.current.find((c) => c.id === activeChat.id)?.connectors ?? activeChat.connectors ?? {}) };
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
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
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
      : who.tool === "email" ? "You draft emails (sending needs a Gmail MCP connector): write the full draft in your reply."
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

  async function handleAttach(f: File) {
    if (f.size > 200_000) { setPcMessage("File is too big (max 200 KB of text)."); return; }
    const t = await f.text();
    if (/[\u0000-\u0008]/.test(t.slice(0, 2000))) { setPcMessage("Only text-based files for now (txt, md, csv, json, code)."); return; }
    setAttach({ name: f.name, text: t });
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
    const recipe = /^\/recipe(?:\s+([\s\S]*))?$/i.exec(text);
    const forget = /^\/forget\s+([\s\S]+)/i.exec(text);
    const remember = /^\/remember\s+([\s\S]+)/i.exec(text) ?? /^(?:please\s+)?remember(?:\s+that)?[:\s]+([\s\S]{3,})/i.exec(text);
    const slash = Boolean(video || code || team || deploy || recipe);
    const analysis = e2bKey && !slash ? analyzePcMessage(text) : { pureCommand: null, compound: false, stopAfter: false };
    const key = apiKeys[chat.provider];
    if (!analysis.pureCommand && !forget && !remember && !deploy && !recipe && !key) { setSettingsOpen(true); return; }

    const payload = attach && !slash ? `${text}\n\n📎 File: ${attach.name}\n\`\`\`\n${attach.text}\n\`\`\`` : text;
    appendMessages(chat.id, [{ role: "user", content: payload, at: Date.now() }]);
    setDraft(""); setAttach(null);

    if (recipe) { void runRecipeCmd(chat, recipe[1] ?? ""); return; }
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

    if (e2bKey && text.length > 60 && domainCount(text) >= 2) { void runTeam(chat, text); return; }

    if (e2bKey && (computerMode || analysis.compound)) {
      say(chat.id, "On it — starting the computer and working on your task in the background. Progress shows in the panel.");
      void runPcTask(chat, text, false, { stopAfter: analysis.stopAfter });
      return;
    }

    setSending(true);
    let cmds: Cmd[] = [];
    try {
      const history = (chatsRef.current.find((c) => c.id === chat.id)?.messages ?? []).map((m) => ({ role: m.role, content: m.content }));
      const specs = await loadTools(chat);
      const system =
        `You are ${chat.agentName}, an AI teammate working inside AgenticVenus. Be direct and useful, and focus on getting real work done for the person you're talking to.` +
        brainPrompt(brainRef.current, text) + (e2bKey ? PC_PROMPT : "") + (chat.connectors?.vercel ? DEPLOY_PROMPT : "") + toolPrompt(specs) + extraSystem;
      const base = chatsRef.current.find((c) => c.id === chat.id)?.messages ?? [];
      const at = Date.now();
      const userPrompt = history.pop()?.content ?? text;

      setStreaming(true);
      let reply = await streamLLM(chat, system, userPrompt, history, (t) => {
        patchChat(chat.id, { messages: [...base, { role: "assistant", content: t.replace(/\[\[[\s\S]*$/, "").trim() || "…", at }] });
      });

      let convo: Array<{ role: "user" | "assistant"; content: string }> = [...history, { role: "user", content: userPrompt }];
      for (let round = 0; round < 3; round++) {
        const tc = extractToolCalls(reply);
        if (!tc.calls.length) break;
        const results: string[] = [];
        for (const c of tc.calls.slice(0, 4)) {
          patchChat(chat.id, { messages: [...base, { role: "assistant", content: `🔧 Using ${c.name}…`, at }] });
          results.push(`### ${c.name}\n${await execTool(chat, c.name, c.args)}`);
        }
        const resultsMsg = `TOOL RESULTS:\n${results.join("\n\n")}\n\nAnswer the user now using these results. Call another tool only if it is really needed.`;
        const prev = reply;
        reply = await callLLM(chat, system, resultsMsg, [...convo, { role: "assistant", content: prev }]);
        convo = [...convo, { role: "assistant", content: prev }, { role: "user", content: resultsMsg }];
      }

      const parsed = extractCommands(extractToolCalls(reply).clean);
      cmds = parsed.cmds;
      say(chat.id, parsed.clean || (cmds.length ? "On it." : "…"));
    } catch (err) {
      say(chat.id, `⚠️ ${err instanceof Error ? err.message : "Something went wrong."}`);
    } finally { setSending(false); setStreaming(false); }
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
            <ChatHeader
              name={activeChat.agentName} color={activeChat.agentColor} focusMode={focusMode} onToggleFocus={() => setFocusMode((v) => !v)}
              onCode={() => router.push(`/code?chat=${activeChat.id}`)} onVenus={() => router.push("/venus")} onSkills={() => router.push("/skills")} onRuns={() => router.push("/runs")}
              onConnectors={() => setConnectorsOpen(true)} hasConnectors={Object.keys(activeChat.connectors ?? {}).some((k) => !k.startsWith("auto:"))}
              onRoutines={() => setRoutinesOpen(true)} hasRoutines={routines.some((r) => r.enabled)}
              onTeam={handleTeamClick} teamOpen={teamOpen} teamRunning={Boolean(teamRun)}
              onPc={handlePcClick} pcOpen={pcOpen} hasComputer={Boolean(activeSandboxId)} pcPaused={session.status === "paused"}
            />
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
                <div className="mx-auto max-w-2xl"><ChatThread messages={activeChat.messages} pending={sending && !streaming} onSaveAsRoutine={(t) => { setRoutinePrefill(t); setRoutinesOpen(true); }} /></div>
              </div>
              <RunBars venusRun={venusRun} codeRun={codeRun} teamRun={teamRun} />
              <div className="mx-auto w-full max-w-2xl px-6 pb-2"><ModelPicker provider={activeChat.provider} model={activeChat.model} apiKeys={apiKeys} onChange={handleModelChange} /></div>
              <ChatComposer
                draft={draft} setDraft={setDraft} onSubmit={handleSend} sending={sending} agentName={activeChat.agentName}
                hasComputerKey={Boolean(e2bKey)} computerMode={computerMode} onToggleComputer={() => setComputerMode((v) => !v)}
                attach={attach} onPickFile={(f) => void handleAttach(f)} onClearAttach={() => setAttach(null)}
              />
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
