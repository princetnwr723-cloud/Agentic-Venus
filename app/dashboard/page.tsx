"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { signOut } from "firebase/auth";
import { FieldPath, deleteField, doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useKeys, type SavedLogin } from "@/lib/keys-context";
import { listChats, createChat, appendChatMessages, updateChatModel, updateChatPc, type Chat, type ChatMessage } from "@/lib/chats";
import { listCustomAgents, createCustomAgent, type CustomAgent } from "@/lib/agents";
import { listRoutinesForChat, createRoutine, setRoutineEnabled, deleteRoutine, recordManualRun, type Routine } from "@/lib/routines";
import { setModelPref } from "@/lib/model-pref";
import { PRESET_AGENTS, type AvatarColor } from "@/lib/bots";
import type { ProviderId } from "@/lib/providers";
import { addMemory, brainPrompt, forgetMemory, loadBrain, rankSkills, reflect, setRole, type Brain, type Verdict } from "@/lib/brain";
import { runCodeAgent, type CodeHooks } from "@/lib/code-agent";
import { getCodeProject, newCodeProject, saveCodeProject } from "@/lib/code-store";
import { acquire, releaseNow } from "@/lib/computers";
import type { VenusProject } from "@/lib/venus";
import { runPipeline, signedUrl, type PipelineEnv } from "@/lib/venus-pipeline";
import { personaOf, type Member } from "@/lib/team-catalog";
import { assembleTeam, runTeamGoal, type TeamHost, type TMsg } from "@/lib/team";
import { pickModel, fallbackChain, type Role } from "@/lib/router";
import { beginTrace, addUsage, traceOf } from "@/lib/trace";
import { verifyResult } from "@/lib/critic";
import { understand, type Understanding } from "@/lib/intent";
import { attachmentBlock, attachmentIdsIn, MAX_ATTACH_FILES, type Attachment } from "@/lib/attachments";
import { attachmentLinks, localAttachment, rememberPreview, revokePreview, uploadAttachment } from "@/lib/attach-client";
import { describeStep, listRecipes, markRecipe, matchRecipes, replayRecipe, saveRecipe, type RecipeStep } from "@/lib/recipes";
import { ensureNode, followPcJob, proofUrl, startPcJob, type HealCtx, type PcOutcome, type PcPending } from "@/lib/pc-agent";
import { SUGGEST_PROMPT, splitSuggestions, withNext } from "@/lib/suggest";
import { looksLikeSkillInstall } from "@/lib/skills-core";
import { repoFileIntent, repoIntent, type RepoIntent } from "@/lib/repo-intent";
import type { ToolSpec } from "@/lib/tools/types";
import { toolPrompt, extractToolCalls } from "@/lib/tools/prompt";
import {
  DEPLOY_PROMPT, EMPTY_SESSION, IDLE_PAUSE_MS, RUN_CYCLE_MS, analyzePcMessage, defaultProviderAndModel,
  extractCommands, guessVenusOptions, normSite, readJson, type Cmd, type PcSession,
} from "@/lib/dashboard/helpers";
import Sidebar from "@/components/dashboard/Sidebar";
import ChatThread from "@/components/dashboard/ChatThread";
import ChatHeader from "@/components/dashboard/ChatHeader";
import ChatComposer, { type Mentionable } from "@/components/dashboard/ChatComposer";
import RunBars from "@/components/dashboard/RunBars";
import WorkingBar from "@/components/dashboard/WorkingBar";
import IdentityPanel from "@/components/dashboard/IdentityPanel";
import ModelPicker from "@/components/dashboard/ModelPicker";
import { fountBegin } from "@/lib/fount/client";
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

// Chat mode can only do light things. Heavy work (computer, code, video, team) goes through "understand first".
const MEMORY_PROMPT = `

To save a durable fact about the user for THIS chat, end your reply with [[MEMORY:add|<fact>]]. To forget something: [[MEMORY:forget|<keyword>]]. To install a skill the user shared: [[SKILL:install|<link or text>]]. Use these only when really needed and never explain the syntax.
If a connected tool can answer or do the request, call the tool instead of guessing.`;

const INTENT_LABEL: Record<string, string> = {
  chat: "jawab dena", set_role: "role save karna", assemble: "team banana", pc: "computer ka kaam", code: "coding project",
  video: "video banana", team: "team ka kaam", remember: "yaad rakhna", forget: "bhoolna", clarify: "ek sawaal puchna",
};

// A chat also carries the "Agent cooperation" switch (stored on the chat document).
type ChatX = Chat & { cooperation?: boolean };
type AgentInfo = { id: string; name: string; role: string; last: string; code: boolean };

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g, "");

/** What the model sees for a message: a user message that replies to an earlier agent reply carries that reply with it. */
const histText = (m: ChatMessage) => {
  const body = splitSuggestions(m.content).body;
  return m.role === "user" && m.replyTo ? `[In reply to this earlier message of yours: "${m.replyTo.preview}"]\n${body}` : body;
};

type Work = { label: string; startedAt: number; steps: string[]; owner: string };

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
  const [attach, setAttach] = useState<Attachment[]>([]);
  useEffect(() => { setAttach((cur) => { cur.forEach(revokePreview); return []; }); }, [activeId]);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
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
  const [work, setWork] = useState<Record<string, Work>>({});
  const [, setBrainTick] = useState(0);
  const [approval, setApproval] = useState<{ summary: string; warn: string; resolve: (ok: boolean) => void } | null>(null);
  // the agent reply the owner clicked the reply icon on (the next message is about THAT reply)
  const [replyTo, setReplyTo] = useState<{ at: number; preview: string } | null>(null);

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
  // Locks are scoped per chat so one conversation cannot block unrelated work in another.
  const venusBusyRef = useRef<Set<string>>(new Set());
  const codeBusyRef = useRef<Set<string>>(new Set());
  const teamBusyRef = useRef<Set<string>>(new Set());
  const brains = useRef<Record<string, Brain>>({});
  const toolCache = useRef<Record<string, { sig: string; specs: ToolSpec[] }>>({});
  const pickedRef = useRef<Record<string, string>>({}); // "@UI_Agent" -> chat id (chosen in the @ menu)
  const coopCache = useRef<Record<string, { t: number; list: AgentInfo[] }>>({});

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [routinePrefill, setRoutinePrefill] = useState<string | null>(null);
  const [runningRoutineId, setRunningRoutineId] = useState<string | null>(null);

  // ---- "Working…" bar: what the agent is doing right now + timer (one owner per chat; only the owner can end it) ----
  const workStart = (chatId: string, label: string, owner: string) =>
    setWork((w) => ({ ...w, [chatId]: { label, startedAt: Date.now(), steps: [label], owner } }));
  const workSet = (chatId: string, label: string, owner: string) =>
    setWork((w) => {
      const c = w[chatId];
      if (!c || c.owner !== owner) return w;
      const last = c.steps[c.steps.length - 1];
      return { ...w, [chatId]: { ...c, label, steps: last === label ? c.steps : [...c.steps.slice(-60), label] } };
    });
  const workEnd = (chatId: string, owner: string) =>
    setWork((w) => {
      if (!w[chatId] || w[chatId].owner !== owner) return w;
      const n = { ...w };
      delete n[chatId];
      return n;
    });

  useEffect(() => { chatsRef.current = chats; for (const c of chats) if (!(c.id in sandboxRef.current)) sandboxRef.current[c.id] = c.pcSandboxId ?? null; }, [chats]);
  useEffect(() => { activeIdRef.current = activeId; setReplyTo(null); }, [activeId]);

  // Messages posted by the server (agent updates, mission reports, call summaries) appear live and are never overwritten.
  useEffect(() => {
    if (!user || !activeId) return;
    return onSnapshot(doc(db, "users", user.uid, "chats", activeId), (s) => {
      const d = s.data() as { messages?: ChatMessage[] } | undefined;
      if (!d?.messages || s.metadata.hasPendingWrites) return;
      const cur = chatsRef.current.find((c) => c.id === activeId);
      if (cur && d.messages.length > cur.messages.length) {
        chatsRef.current = chatsRef.current.map((c) => (c.id === activeId ? { ...c, messages: d.messages as ChatMessage[] } : c));
        patchChat(activeId, { messages: d.messages });
      }
    }, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeId]);

  useEffect(() => { if (!authLoading && !user) router.replace("/"); }, [authLoading, user, router]);
  useEffect(() => { fetch("/api/venus/media").then((r) => r.json()).then(setCfg).catch(() => {}); }, []);

  // ---- every chat has its OWN memory + skills (nothing is shared between chats) ----
  const brainOf = (id: string): Brain => brains.current[id] ?? { memories: [], skills: [] };
  async function loadChatBrain(chatId: string) {
    if (!user) return;
    brains.current[chatId] = await loadBrain({ uid: user.uid, chatId }).catch(() => brainOf(chatId));
    setBrainTick((n) => n + 1);
  }
  const roleOf = (id: string) => brainOf(id).memories.find((m) => m.kind === "role")?.text ?? "";
  useEffect(() => { if (activeId && user) void loadChatBrain(activeId); /* eslint-disable-next-line */ }, [activeId, user]);

  useEffect(() => {
    if (!user) return;
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("Firestore did not answer in 12s (database missing, rules, or wrong env vars).")), 12000)
    );
    Promise.race([Promise.all([listChats(user.uid), listCustomAgents(user.uid)]), timeout])
      .then(([loadedChats, loadedAgents]) => {
        setChats(loadedChats); setCustomAgents(loadedAgents); setChatsLoaded(true);
        if (loadedChats.length > 0) setActiveId(loadedChats[0].id);
        for (const c of loadedChats) if (c.pcSandboxId && c.pcPaused) patchSession(c.id, { status: "paused" });
      })
      .catch((err) => {
        setChatsLoaded(true);
        setPcMessage(`⚠️ Could not load chats: ${err?.code ?? ""} ${err?.message ?? err}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const activeChat = useMemo(() => chats.find((c) => c.id === activeId) ?? null, [chats, activeId]);

  // The other agents the @ menu can offer (every other chat of this account).
  const mentionables = useMemo<Mentionable[]>(
    () =>
      chats.filter((c) => c.id !== activeId).map((c) => {
        const last = [...c.messages].reverse().find((m) => m.role === "assistant");
        const preview = last ? splitSuggestions(last.content).body.replace(/\s+/g, " ").slice(0, 80) : "No messages yet";
        return { id: c.id, name: c.agentName, color: c.agentColor, hint: PRESET_AGENTS.find((a) => a.name === c.agentName)?.role ?? "", preview: preview || "No messages yet" };
      }),
    [chats, activeId]
  );

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
  const patchChat = (id: string, patch: Partial<Chat> & { cooperation?: boolean }) => setChats((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  function appendMessages(chatId: string, msgs: ChatMessage[]) {
    if (!user) return;
    const base = chatsRef.current.find((c) => c.id === chatId)?.messages ?? [];
    const next = [...base, ...msgs];
    chatsRef.current = chatsRef.current.map((c) => (c.id === chatId ? { ...c, messages: next } : c));
    patchChat(chatId, { messages: next });
    appendChatMessages(user.uid, chatId, msgs).catch(() => {});
  }
  const say = (chatId: string, content: string) => appendMessages(chatId, [{ role: "assistant", content, at: Date.now() }]);

  // ---- Two tappable next steps under every agent reply ----
  async function suggestNext(chat: Chat, text: string): Promise<string[]> {
    try {
      const raw = await Promise.race([
        callLLM(chat, "", `Here is what an AI agent just told its owner:\n\n${text.slice(0, 1500)}\n\nWrite exactly two SHORT follow-up commands (max 8 words each) the owner could tap next, as direct commands in the owner's language. Reply with JSON only: {"next":["...","..."]}`, [], "report"),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error("slow")), 7000)),
      ]);
      const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
      const j = JSON.parse(raw.slice(a, b + 1)) as { next?: unknown };
      return (Array.isArray(j.next) ? j.next : []).map((x) => String(x).replace(/[|[\]]/g, " ").trim().slice(0, 80)).filter((x) => x.length >= 3).slice(0, 2);
    } catch { return []; }
  }
  /** Posts a reply with its next-step buttons. `fixed` = suggestions we already know; otherwise a fast model writes them. */
  async function sayNext(chat: Chat, text: string, fixed?: string[]) {
    const next = fixed && fixed.length ? fixed : await suggestNext(chat, text);
    say(chat.id, withNext(text, next));
  }

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
    workSet(chatId, line.replace(/^\d+\.\s*/, "").slice(0, 120), "pc");
  };

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

  // ---- Agent cooperation: use the work of the other agents (chats) ----

  async function setCooperation(on: boolean) {
    if (!user || !activeChat) return;
    const id = activeChat.id;
    patchChat(id, { cooperation: on });
    delete coopCache.current[id];
    try {
      await updateDoc(doc(db, "users", user.uid, "chats", id), { cooperation: on });
      say(id, on
        ? "🤝 **Agent cooperation is ON.** From now on I can use the work of your other agents by myself (their notes, skills, results and code files) whenever it helps. You don't need to type @."
        : "🤝 **Agent cooperation is OFF.** I work alone again. You can still type @ to pick one agent.");
    } catch (e) {
      patchChat(id, { cooperation: !on });
      setPcMessage(`⚠️ Could not change agent cooperation: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  /** The agents named with @ in the message ("@UI_Agent"). A name picked in the @ menu wins; otherwise the name is matched. */
  function resolveMentions(chat: Chat, text: string): Chat[] {
    const out: Chat[] = [];
    const others = chatsRef.current.filter((c) => c.id !== chat.id);
    const re = /(^|\s)@([\w\u0900-\u097f-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const tok = "@" + m[2];
      const n = normName(m[2]);
      let t = pickedRef.current[tok] ? others.find((c) => c.id === pickedRef.current[tok]) : undefined;
      if (!t && n) t = others.find((c) => normName(c.agentName) === n) ?? (n.length >= 2 ? others.find((c) => normName(c.agentName).startsWith(n)) : undefined);
      if (t && !out.some((x) => x.id === t!.id)) out.push(t);
    }
    return out.slice(0, 4);
  }

  /** Reads the work of the mentioned agents on the server and turns it into a block the working agent receives. */
  async function collabBlock(chat: Chat, targets: Chat[], query: string): Promise<string> {
    if (!targets.length) return "";
    const names = targets.map((t) => "@" + t.agentName).join(", ");
    try {
      const r = await readJson(await fetch("/api/collab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "brief", chatId: chat.id, targets: targets.map((t) => t.id), query }) }));
      if (r.error) throw new Error(String(r.error));
      const briefs: Array<{ id: string; name: string; text: string }> = Array.isArray(r.briefs) ? r.briefs : [];
      if (!briefs.length) return `\n\n(COLLABORATION: the owner mentioned ${names}, but nothing could be read from them.)`;
      return (
        `\n\n=== COLLABORATION CONTEXT ===\nThe owner @-mentioned other agents of their team for this task. Their work is below. Treat it as the owner's own team material: reuse their components, decisions, wording and results, follow their style, and say which agent each part came from. ` +
        `Do not change their files. To read more of an agent's files use the tool collab.read_file (agent, path); to ask for different material use collab.ask (agent, query).\n\n` +
        briefs.map((b) => `--- @${b.name} ---\n${b.text}`).join("\n\n") +
        `\n=== END COLLABORATION CONTEXT ===`
      );
    } catch (e) {
      return `\n\n(COLLABORATION: could not read ${names}: ${e instanceof Error ? e.message : "unknown error"}. Tell the owner and continue without it.)`;
    }
  }

  /** When "Agent cooperation" is ON the agent is told who its colleagues are and how to use them by itself. */
  async function coopPrompt(chat: Chat): Promise<string> {
    const hit = coopCache.current[chat.id];
    let list: AgentInfo[] | null = hit && Date.now() - hit.t < 60_000 ? hit.list : null;
    if (!list) {
      try {
        const r = await readJson(await fetch("/api/collab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "agents", chatId: chat.id }) }));
        list = Array.isArray(r.agents) ? (r.agents as AgentInfo[]) : [];
        coopCache.current[chat.id] = { t: Date.now(), list };
      } catch { list = []; }
    }
    if (!list.length) return "";
    return (
      `\n\nAGENT COOPERATION IS ON. The owner runs several agents and you may use their work by yourself, without being asked, whenever it makes your result better (UI components, research, copy, leads, code, decisions already made). Your colleagues:\n` +
      list.slice(0, 12).map((a) => `- ${a.name}${a.role ? ` (${a.role})` : ""}${a.code ? " [has code workspace]" : ""}${a.last ? ` — last: ${a.last.slice(0, 100)}` : ""}`).join("\n") +
      `\nBefore starting work that overlaps a colleague's area, call collab.ask (agent, query) to read their work and collab.read_file (agent, path) for a specific file, then reuse it and say which agent helped. Never change their files; never mention an agent that did not help.`
    );
  }

  // ---- This chat's computer (for computer tasks). Venus Code and Venus Pro get their OWN computers. ----

  async function backupPc(chatId: string, force = false): Promise<string | null> {
    if (!user || !e2bKey) return null;
    const chat = chatsRef.current.find((c) => c.id === chatId);
    const sandboxId = sandboxRef.current[chatId] ?? chat?.pcSandboxId ?? null;
    if (!sandboxId) return null;
    if (!force && chat?.pcLastBackupAt && Date.now() - chat.pcLastBackupAt < 45_000) return chat.pcRecoveryPath ?? null;
    try {
      const res = await fetch("/api/e2b/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: e2bKey, sandboxId, uid: user.uid, chatId }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Backup failed.");
      const path = String(data.path || "");
      patchChat(chatId, { pcRecoveryPath: path, pcLastBackupAt: Date.now() });
      await updateChatPc(user.uid, chatId, sandboxId, Boolean(chat?.pcPaused), { recoveryPath: path, backup: true });
      return path || null;
    } catch (err) {
      // Backup is a resilience layer; never turn a successful user task into a failure.
      patchSession(chatId, { error: `Durable backup skipped: ${err instanceof Error ? err.message : "backup unavailable"}` });
      return null;
    }
  }

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
      const recoveryPath = chatsRef.current.find((c) => c.id === chatId)?.pcRecoveryPath ?? "";
      const res = await fetch("/api/e2b/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: e2bKey, uid: user.uid, recoveryPath: recoveryPath || undefined }) });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "Could not create a computer.");
      setSandboxId(chatId, data.sandboxId);
      if (user) {
        updateChatPc(user.uid, chatId, data.sandboxId as string, false, { persistence: data.persistence, recoveryPath: recoveryPath || undefined }).catch(() => {});
        patchChat(chatId, { pcPersistence: data.persistence, pcRecoveryPath: recoveryPath || (chatsRef.current.find((c) => c.id === chatId)?.pcRecoveryPath ?? null) });
      }
      runStartRef.current[chatId] = Date.now();
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
    if (r === "ok") {
      if (user && chatsRef.current.find((c) => c.id === chatId)?.pcPaused) {
        updateChatPc(user.uid, chatId, id, false, { recovery: true }).catch(() => {});
      }
      return id;
    }
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
      await backupPc(chatId, true);
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

  /** The agent switches the computer off as soon as its work is finished (saves your E2B credits). */
  async function autoOff(chatId: string) {
    if (!user || !e2bKey || !sandboxRef.current[chatId]) return;
    const busy = () => runningRef.current[chatId] || teamBusyRef.current.has(chatId);
    if (busy() || sessionsRef.current[chatId]?.status === "paused") return;
    await new Promise((r) => setTimeout(r, 4000)); // let you see the final screen
    if (busy()) return;
    const r = await pausePc(chatId);
    if (r.ok) say(chatId, "🔌 Task finished — I turned the computer off to save credits. Everything is saved; it switches on by itself for the next task.");
  }

  async function deletePc(chatId: string) {
    const id = sandboxRef.current[chatId] ?? null;
    if (!user || !e2bKey || !id) return;
    if (!window.confirm("Delete this chat's computer for good? Everything saved on it will be lost.")) return;
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
      busyChats.current.forEach((id) => beat(id));
      for (const [chatId, s] of Object.entries(sessionsRef.current)) {
        if (s.status !== "ready" || s.running || runningRef.current[chatId]) continue;
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
    const run = async (pick: ReturnType<typeof pickModel>) => {
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
    };
    const pick = pickModel(role, apiKeys, chat);
    try {
      return await run(pick);
    } catch (e) {
      const own = pickModel("act", apiKeys, chat);
      if (pick.provider === own.provider && pick.model === own.model) throw e;
      return run(own); // a helper model your key cannot use must never break the agent
    }
  }

  async function streamLLM(chat: Chat, system: string, prompt: string, history: Array<{ role: "user" | "assistant"; content: string }>, onText: (t: string) => void, image?: { mediaType: string; data: string }): Promise<string> {
    const key = apiKeys[chat.provider];
    if (!key) throw new Error("No API key saved for this chat's model.");
    const res = await fetch("/api/chat/stream", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: chat.provider, apiKey: key, model: chat.model, systemPrompt: system || undefined, messages: [...history, { role: "user", content: prompt, ...(image ? { image } : {}) }] }),
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
        "Rules: write in clear English. Use markdown. Start with ONE line for the outcome (✅ done / ⚠️ partly done / ❌ failed). Then short bullets of what was done. Then the concrete results: facts, names, numbers, versions, file paths, and links with their source names. If anything failed or is unfinished, say exactly what and the next step. Never invent anything that is not in the material below. Be concise — no filler. If the agent's result starts with a VERIFIED line, keep that line, the table and the download link exactly as they are.",
        "", `USER'S TASK:\n${m.task}`, "", `AGENT'S RESULT:\n${m.summary}`, "", `LAST STEPS:\n${m.steps.slice(-25).join("\n")}`,
      ].join("\n"), [], "report");
    } catch { return null; }
  }

  function learnFrom(chat: Chat, input: { task: string; outcome: string; steps: string; verdict: Verdict; skillsUsed: string[] }) {
    if (!user) return;
    const rp = pickModel("act", apiKeys, chat);
    reflect({ uid: user.uid, chatId: chat.id }, { apiKeys, provider: rp.provider, model: rp.model }, brainOf(chat.id), input)
      .then(async (l) => { if (l.length) { say(chat.id, "🧠 Learned: " + l.join("; ")); await loadChatBrain(chat.id); } })
      .catch(() => {});
  }

  // ---- Tools (free pack + plugins + MCP + API) ----

  async function loadTools(chat: Chat): Promise<ToolSpec[]> {
    if (!user) return [];
    const sig = JSON.stringify(Object.keys((chatsRef.current.find((c) => c.id === chat.id) ?? chat).connectors ?? {}).sort());
    const hit = toolCache.current[chat.id];
    if (hit && hit.sig === sig) return hit.specs;
    try {
      const r = await readJson(await fetch("/api/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list", chatId: chat.id }) }));
      const specs = Array.isArray(r.specs) ? (r.specs as ToolSpec[]) : [];
      toolCache.current[chat.id] = { sig, specs };
      return specs;
    } catch { return []; }
  }

  async function execTool(chat: Chat, name: string, args: Record<string, unknown>, force: boolean): Promise<{ text: string; flagged: boolean }> {
    if (!user) return { text: "ERROR: not signed in.", flagged: false };
    const post = async (approved: boolean) =>
      readJson(await fetch("/api/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "call", chatId: chat.id, name, args, approved, force }) }));
    let r = await post(false);
    if (r.needsApproval) {
      const why = force ? "\n\n⚠️ Something the agent just read tried to give it instructions, so even auto-approved actions need your OK." : "";
      const summary = String(r.needsApproval.summary);
      const okay = await new Promise<boolean>((resolve) => setApproval({ summary, warn: why.trim(), resolve }));
      if (!okay) return { text: "The user declined this action. Do not retry it.", flagged: false };
      r = await post(true);
    }
    return { text: r.ok ? String(r.text) : `ERROR: ${r.text || r.error || "tool failed"}`, flagged: Array.isArray(r.flagged) && r.flagged.length > 0 };
  }

  /** An unfinished checklist from earlier (the server keeps it), so "continue" resumes exactly where it stopped. */
  async function openPlanNote(chat: Chat): Promise<string> {
    try {
      const r = await readJson(await fetch("/api/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "call", chatId: chat.id, name: "plan.status", args: {}, approved: false, force: false }) }));
      const t = String(r.text ?? "").replace(/<\/?untrusted[^>]*>/g, "").trim();
      return /PLAN OPEN:\s*\d+/.test(t) ? `\n\nUNFINISHED PLAN from earlier. Continue it if the owner's message is about it; if it is a different task or the steps are obsolete, call plan.clear first:\n${t}` : "";
    } catch { return ""; }
  }

  // ---- Venus Code: ONLY for software projects, on its OWN computer ----

  async function runCodeFor(chat: Chat, instruction: string, opts: { silent?: boolean; persona?: string; onLine?: (l: string) => void } = {}): Promise<string> {
    if (!user) return "";
    const out = (m: string) => { if (!opts.silent) say(chat.id, m); return m; };
    if (!e2bKey) return out("Venus Code needs an E2B key. Add it under API keys first.");
    if (!apiKeys[chat.provider]) return out("No API key is saved for this chat's model.");
    if (codeBusyRef.current.has(chat.id)) return out("Venus Code is already working on something in this chat. Wait for it to finish, then ask again.");
    codeBusyRef.current.add(chat.id);
    busyChats.current.add(chat.id);
    const showWork = !opts.silent;
    if (showWork) workStart(chat.id, "Venus Code ke liye apna computer chalu kar raha hoon…", "code");
    let sid: string | null = null;
    try {
      sid = await acquire({ uid: user.uid, e2bKey }, chat.id, "code"); // its own computer: it never waits for the chat's computer
      let project = await getCodeProject(user.uid, chat.id);
      if (!project) { project = newCodeProject(chat.id, `${chat.agentName} codespace`); await saveCodeProject(user.uid, project); }
      setCodeRun({ title: project.name, label: "Starting…" });
      if (!opts.silent) say(chat.id, `💻 Venus Code is working on it (on its own computer). Watch it live on the [Code page](/code?chat=${chat.id}).`);
      const hooks: CodeHooks = {
        event: (e) => {
          if (e.kind === "tool" || e.kind === "info" || e.kind === "thought") {
            setCodeRun((prev) => (prev ? { ...prev, label: e.text.slice(0, 100) } : prev));
            workSet(chat.id, e.text.replace(/\s+/g, " ").slice(0, 110), "code");
            if (e.kind === "tool" && (e.depth ?? 0) === 0) opts.onLine?.("💻 " + e.text.slice(0, 120));
          }
        },
        ask: async (_q, options) => options.find((o) => /^approve/i.test(o)) ?? "Proceed with your best judgment.",
        cancelled: () => false,
      };
      const res = await runCodeAgent(
        { uid: user.uid, token: () => user.getIdToken(), e2bKey, apiKeys, provider: chat.provider, model: chat.model, chatId: chat.id, sandboxId: sid },
        hooks, project, instruction, { brain: brainOf(chat.id), persona: opts.persona }
      );
      if (!opts.silent) {
        await sayNext(chat, res.ok ? `✅ Venus Code finished.\n\n${res.summary}\n\n[Open the Code page](/code?chat=${chat.id})` : `⚠️ Venus Code stopped: ${res.summary}\n\n[Open the Code page](/code?chat=${chat.id})`);
      }
      return res.summary;
    } catch (err) {
      return out(`⚠️ Venus Code failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      codeBusyRef.current.delete(chat.id); busyChats.current.delete(chat.id); setCodeRun(null);
      if (showWork) workEnd(chat.id, "code");
      if (sid) void releaseNow(e2bKey, sid); // work is over: its computer is switched off
    }
  }

  // ---- The computer agent (visible on the screen) ----

  async function finishPcRun(chat: Chat, task: string, out: PcOutcome, opts?: { quiet?: boolean; verify?: boolean; heal?: HealCtx }): Promise<string> {
    if (!user || !e2bKey) return out.summary;
    const chatId = chat.id;
    const env = { uid: user.uid, token: () => user.getIdToken(), e2bKey };
    const steps = sessionsRef.current[chatId]?.steps ?? [];
    const summary = out.summary || "Finished.";
    const skillsUsed = rankSkills(brainOf(chatId).skills, task, 3).map((s) => s.name);
    if (out.status === "stopped") { pushStep(chatId, "■ Stopped."); return "Stopped before finishing."; }
    if (out.status !== "done") {
      if (!opts?.quiet && steps.length >= 3) learnFrom(chat, { task, outcome: summary, steps: steps.join("\n"), verdict: "fail", skillsUsed });
      return `⚠️ ${summary}`;
    }

    let replay = "";
    if (out.proof) { const url = await proofUrl(env, out.proof).catch(() => ""); if (url) replay = `\n\n🎥 [Watch the replay](${url}) (link works for 6 hours)`; }
    if (opts?.quiet && !opts?.verify) return summary + replay;

    pushStep(chatId, "🔎 Verifier is checking the result…");
    const v = await verifyResult((s, p) => callLLM(chat, s, p, [], "verify"), { task, summary, evidence: [steps.slice(-25).join("\n")] });
    traceOf(chatId)?.add("verify", `${v.verdict}: ${v.reason}`);
    pushStep(chatId, `${v.verdict === "pass" ? "✅" : "⚠️"} Verifier: ${v.verdict} — ${v.reason}`);

    pushStep(chatId, "✍️ Writing the final report…");
    let text = (await composeReport(chat, { task, summary, steps })) ?? summary;
    if (v.verdict !== "pass") text = `⚠️ **Verifier (${v.verdict}):** ${v.reason}\n\n${text}`;
    text += replay;

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
    if (steps.length >= 3) learnFrom(chat, { task, outcome: summary, steps: steps.join("\n"), verdict: v.verdict, skillsUsed });
    return text;
  }

  async function runPcTask(
    chat: Chat, task: string, logTask: boolean,
    opts?: { quiet?: boolean; showPanel?: boolean; heal?: HealCtx; resume?: { jobId: string; sandboxId: string }; onLine?: (line: string) => void }
  ): Promise<string> {
    const chatId = chat.id;
    if (!user || !e2bKey) return "";
    if (runningRef.current[chatId]) { const m = "This chat's computer is already running a task — one at a time."; setPcMessage(m); return m; }
    const key = apiKeys[chat.provider];
    if (!key) { setSettingsOpen(true); return "No API key for this chat's model."; }

    runningRef.current[chatId] = true;
    stopRef.current[chatId] = false;
    busyChats.current.add(chatId);
    patchSession(chatId, { running: true, steps: [`▶ ${task.slice(0, 300)}`], request: null });
    const showWork = !opts?.quiet;
    const showPanel = !opts?.quiet || Boolean(opts?.showPanel);
    if (showWork) workStart(chatId, opts?.resume ? "Chalte hue task se jud raha hoon…" : "Computer chalu kar raha hoon…", "pc");
    if (activeIdRef.current === chatId && showPanel) { setPcOpen(true); setTeamOpen(false); }
    const trace = beginTrace(user.uid, chatId, task.slice(0, 80), "computer");
    const env = { uid: user.uid, token: () => user.getIdToken(), e2bKey };
    let finalText = "";

    try {
      pushStep(chatId, "🖥️ Computer chalu kar raha hoon…");
      const sid = opts?.resume?.sandboxId ?? (await startOrResumePc(chatId));
      if (!sid) throw new Error(sessionsRef.current[chatId]?.error || "The computer could not be started — see the panel for the reason.");
      let jobId = opts?.resume?.jobId;
      if (!jobId) {
        pushStep(chatId, "⚙️ Preparing the computer…");
        await ensureNode(env, sid, (l) => pushStep(chatId, l));
        jobId = await startPcJob(env, { sandboxId: sid, chatId, task, provider: chat.provider, model: chat.model, apiKey: key, context: brainPrompt(brainOf(chatId), task), heal: opts?.heal });
        pushStep(chatId, "🚀 Working on the computer screen — you can watch it live.");
      } else pushStep(chatId, "🔗 Re-attached to the running task.");

      const out = await followPcJob({
        env, chatId, sandboxId: sid, jobId,
        onStep: (l) => { pushStep(chatId, l); opts?.onLine?.(l); touch(chatId); },
        cancelled: () => Boolean(stopRef.current[chatId]),
        onAsk: async (p) => {
          if (p.kind === "login" && findCredential(p.site ?? "")) return { type: "login_saved", site: p.site ?? "" };
          const reply = await askUser(chatId, toRequest(p));
          if (stopRef.current[chatId]) return { type: "answer", text: "" };
          if (reply.type === "login") {
            await savePcCredential(normSite(p.site ?? ""), { email: reply.email, password: reply.password }); // encrypted on the server
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
      if (showWork) workEnd(chatId, "pc");
    }

    if (!opts?.quiet) {
      const at = Date.now();
      const shown = withNext(finalText || "Finished.", await suggestNext(chat, finalText || "Finished."));
      appendMessages(chatId, logTask
        ? [{ role: "user", content: `🖥️ Task on the computer: ${task.slice(0, 600)}`, at }, { role: "assistant", content: shown, at }]
        : [{ role: "assistant", content: shown, at }]);
    }
    // Quiet/background/team tasks also get the same persistence + credit-saving lifecycle.
    // Team execution keeps teamBusyRef true, so the computer is not paused between dependent steps.
    void autoOff(chatId);
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
    workStart(chat.id, `Recipe chala raha hoon: ${hit.name}`, "recipe");
    try {
      const r = await replayRecipe({
        token: () => user.getIdToken(), uid: user.uid, chatId: chat.id, connectors: {},
        recipe: hit, creds: undefined,
        onLine: (l) => workSet(chat.id, l, "recipe"),
        shell: async (command) => {
          if (!e2bKey) return { ok: false, text: "Add an E2B key first." };
          const id = await startOrResumePc(chat.id);
          if (!id) return { ok: false, text: "The computer could not be started." };
          const res = await readJson(await fetch("/api/e2b/shell", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ e2bKey, sandboxId: id, command }) }));
          return { ok: !res.error && (res.done ? res.exitCode === 0 : true), text: String(res.error ?? res.output ?? "") };
        },
        approve: async (summary) => window.confirm(`Approve this recipe action?\n\n${summary}`),
      });
      await markRecipe(user.uid, hit, r.ok);
      if (r.ok) return say(chat.id, `✅ Recipe finished.\n\n${r.snapshot.slice(0, 1500)}`);

      const k = r.failedAt ?? 0;
      if (!e2bKey) return say(chat.id, `⚠️ Recipe broke at step ${k + 1}. Add an E2B key and I can repair it.\n\n${r.snapshot.slice(0, 400)}`);
      say(chat.id, `🩹 Step ${k + 1} of ${hit.steps.length} broke (${describeStep(hit.steps[k])}). I will re-learn only that part on the computer and keep the steps before it.`);
      const healTask =
        `A saved recipe "${hit.name}" (original goal: ${hit.task}) broke at step ${k + 1} of ${hit.steps.length} because the site changed.\n` +
        `The browser is open${r.url ? ` on ${r.url}` : ""}. Do what the broken step intended, then finish the rest of the goal. Steps still to do, for reference:\n` +
        hit.steps.slice(k).map((s, i) => `${k + i + 1}. ${describeStep(s)}`).join("\n");
      workEnd(chat.id, "recipe");
      await runPcTask(chat, healTask, true, { heal: { recipe: hit, keep: hit.steps.slice(0, k), session: r.session, snapshot: r.snapshot, url: r.url } });
    } catch (e) {
      say(chat.id, `⚠️ Recipe failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally { workEnd(chat.id, "recipe"); }
  }

  // ---- GitHub repository: clone into Venus Code's workspace, push all changes back (direct commands, no model needed) ----

  async function runRepoCommand(chat: Chat, cmd: RepoIntent) {
    if (!user) return;
    if (codeBusyRef.current.has(chat.id)) return say(chat.id, "Venus Code is working in this chat right now. Wait for it to finish, then try again.");
    if (!e2bKey) return say(chat.id, "A cloned repository lives on your coding computer. Add your E2B key under API keys first.");
    workStart(chat.id, cmd.kind === "clone" ? `Cloning ${cmd.repo}…` : "Pushing all changes to GitHub…", "repo");
    try {
      const res = await fetch("/api/code/repo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cmd.kind === "clone"
          ? { action: "clone", ws: chat.id, repo: cmd.repo, branch: cmd.branch }
          : { action: "push", ws: chat.id, branch: cmd.branch, message: cmd.message, direct: cmd.direct }),
      });
      const d = await readJson(res);
      if (!res.ok) throw new Error(d?.error || "The repository command failed.");
      if (cmd.kind === "clone") {
        patchChat(chat.id, { repo: { owner: d.owner, name: d.name, branch: d.branch, at: Date.now() } });
        const msg =
          `✅ **${d.mode === "update" ? "Updated" : "Cloned"} ${d.repo}** (branch \`${d.branch}\`, ${d.files} files) in this chat's Venus Code workspace.\n\n` +
          `[Open it in Venus Code](/code?chat=${chat.id}) — the files are there now.${d.backup ? `\n\nYour previous workspace was kept as a backup folder: \`${d.backup}\`.` : ""}\n\n` +
          `Tell me what to change (for example \`/code fix the failing tests\`), or just ask me to add or edit a file. When you are done, say **push all changes**.`;
        await sayNext(chat, msg, ["/code Read the repo and explain how it is structured and how to run it", "Run the tests and fix any failures"]);
        if (cmd.then) void runCodeFor(chat, cmd.then);
      } else {
        const msg = `✅ ${d.note}\n\n- [View the branch on GitHub](${d.url})${d.compareUrl ? `\n- [Open a pull request](${d.compareUrl})` : ""}`;
        await sayNext(chat, msg, d.compareUrl ? ["Open a pull request for this branch", "Summarize what I changed in three lines"] : ["Summarize what I changed in three lines", "Show me the repo status"]);
      }
    } catch (err) {
      say(chat.id, `⚠️ ${err instanceof Error ? err.message : "The repository command failed."}`);
    } finally { workEnd(chat.id, "repo"); }
  }

  /**
   * "Add this file to my repo" is NOT a coding task: it never starts Venus Code or the computer.
   * Repo cloned in the workspace → repo.write_file + repo.push. Not cloned → github.put_files straight through the GitHub API.
   */
  async function repoHint(chat: Chat): Promise<string> {
    let repo = "";
    try {
      const r = await readJson(await fetch("/api/code/repo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "info", ws: chat.id }) }));
      if (r?.repo?.owner) repo = `${r.repo.owner}/${r.repo.name}`;
    } catch { /* no info: treated as not cloned */ }
    const live = chatsRef.current.find((c) => c.id === chat.id) ?? chat;
    const hasGithub = Boolean(live.connectors?.github || live.connectors?.["oauth:github_oauth"]);
    const noGithub = hasGithub ? "" : " GitHub is NOT connected for this chat: tell the owner to open Connectors → GitHub and paste a token with write access, then try again.";
    if (repo) {
      return `\n\nREPO TASK: the repository ${repo} is already cloned in the owner's workspace. Make the file change with repo.write_file (one call per file) and then repo.push. Do NOT start Venus Code and do NOT open the computer. If the owner means a DIFFERENT repository, use github.put_files for that one instead.${noGithub}`;
    }
    return `\n\nREPO TASK: no repository is cloned in the workspace. Make the file change DIRECTLY through the GitHub API with github.put_files (all files in ONE call). Do NOT start Venus Code, do NOT open the computer. If the owner did not name the repository (owner/name), ask which one.${noGithub}`;
  }

  // ---- Venus Pro: its OWN computer (unless it needs assets the computer agent downloaded) ----

  async function startVenus(chat: Chat, brief: string, opts: { silent?: boolean } = {}): Promise<string> {
    if (!user) return "";
    const out = (m: string) => { if (!opts.silent) say(chat.id, m); return m; };
    if (!e2bKey) return out("Venus Pro needs an E2B key. Add it under API keys first.");
    if (cfg && !cfg.supabase) return out("Venus Pro needs Supabase for video storage. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy.");
    if (venusBusyRef.current.has(chat.id)) return out("Venus Pro is already making a video in this chat. Wait for it to finish, then ask again.");
    if (!apiKeys[chat.provider]) return out("No API key is saved for this chat's model.");

    venusBusyRef.current.add(chat.id);
    busyChats.current.add(chat.id);
    const showWork = !opts.silent;
    const ownerText = String([...(chatsRef.current.find((c) => c.id === chat.id)?.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "");
    const opt = guessVenusOptions(brief, ownerText);
    if (showWork) workStart(chat.id, "Venus Pro shuru ho raha hai…", "venus");
    setVenusRun({ title: brief.replace(/\s+/g, " ").slice(0, 48), label: "Starting…", value: null });
    try {
      // Assets are downloaded by the computer agent onto the chat's computer, so then the video is made there too.
      // Otherwise Venus Pro gets its own studio computer and never waits for the chat's computer.
      const needsAssets = /\b(assets?|footage|stock|photos?|images?|logos?|clips?|b-?roll|download)\b/i.test(brief);
      let sid: string | undefined;
      if (needsAssets) {
        workSet(chat.id, "Computer assets download kar raha hai…", "venus");
        setVenusRun((p) => (p ? { ...p, label: "The computer is downloading assets…" } : p));
        await runPcTask(chat, `Find and download 5-10 royalty-free images or short video clips (and logos if the brief names a brand) for a video about: ${brief.slice(0, 400)}. Save them into the folder ~/venus-assets (create it if needed) with short file names using only letters, numbers and dashes (e.g. skyline-night.jpg). Use free sources (Pexels, Pixabay, Unsplash, Wikimedia). Finish by listing the file names you saved.`, false, { quiet: true });
        sid = sandboxRef.current[chat.id] ?? undefined;
        if (!sid) return out("The computer for downloading assets could not be started — turn it on with the monitor button first.");
      }
      if (!opts.silent) say(chat.id, `🎬 Venus Pro is making your video (${opt.seconds}s, ${opt.aspect}) on its own computer. Progress shows above the message box. The first video can take 15-30 minutes — keep this tab open.`);

      const project: VenusProject = {
        id: "v" + Date.now().toString(36), title: brief.replace(/\s+/g, " ").slice(0, 48), brief,
        seconds: opt.seconds, aspect: opt.aspect, theme: "midnight", voice: Boolean(apiKeys.openai), voiceName: "nova",
        captions: true, quality: "720p", review: true, design: "ai", music: true, origin: "chat", chatId: chat.id,
        provider: chat.provider, model: chat.model, stage: "studio", status: "idle", createdAt: Date.now(), updatedAt: Date.now(),
      };
      const env: PipelineEnv = { uid: user.uid, token: () => user.getIdToken(), e2bKey, apiKeys, pexels: Boolean(cfg?.pexels), sandboxId: sid };
      const final = await runPipeline(env, {
        log: (m) => { setVenusRun((prev) => (prev ? { ...prev, label: m.slice(0, 100) } : prev)); workSet(chat.id, m.slice(0, 110), "venus"); },
        progress: (p) => {
          setVenusRun((prev) => (prev ? { ...prev, label: p?.label ?? prev.label, value: p ? p.value : null } : prev));
          if (p) workSet(chat.id, `${p.label}${p.value != null ? " " + Math.round(p.value * 100) + "%" : ""}`, "venus");
        },
        update: () => {}, cancelled: () => false,
      }, project, "studio");
      if (final.status === "done" && final.finalPath) {
        const url = await signedUrl(env, final.finalPath, "venus-video.mp4").catch(() => "");
        const msg = `✅ Your video is ready: **${final.title}**.\n\n- [Open and edit it in Venus Pro](/venus?project=${final.id})${url ? `\n- [Download the video](${url})` : ""}`;
        if (!opts.silent) await sayNext(chat, msg, ["Make a shorter vertical version of it", "Write a caption and hashtags for this video"]);
        return msg;
      }
      return out(`⚠️ The video could not be finished: ${final.error ?? "unknown error"}\n\n[Open it in Venus Pro](/venus?project=${final.id}) to retry from the failed step.`);
    } catch (err) {
      return out(`⚠️ Venus Pro failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      venusBusyRef.current.delete(chat.id); busyChats.current.delete(chat.id); setVenusRun(null);
      if (showWork) workEnd(chat.id, "venus");
    }
  }

  // ---- Connectors & deploy ----

  async function testConnector(kind: string, token: string): Promise<{ ok: boolean; label?: string; error?: string }> {
    if (!user) return { ok: false, error: "Not signed in." };
    const res = await fetch("/api/connectors/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, token }) });
    return readJson(res);
  }

  // Writes ONE key at a time, so a connector the server added (e.g. the agent's own inbox) is never overwritten.
  async function saveConnector(kind: string, token: string) {
    if (!user || !activeChat) return;
    const chatId = activeChat.id;
    const ref = doc(db, "users", user.uid, "chats", chatId);
    const name = `conn.${chatId.toLowerCase()}.${kind.toLowerCase().replace(/[^a-z0-9:]+/g, "_")}`;
    const next = { ...(chatsRef.current.find((c) => c.id === chatId)?.connectors ?? {}) };
    try {
      if (kind.startsWith("auto:")) {
        if (token) { await updateDoc(ref, new FieldPath("connectors", kind), token); next[kind] = token; }
        else { await updateDoc(ref, new FieldPath("connectors", kind), deleteField()); delete next[kind]; }
      } else if (token) {
        const r = await readJson(await fetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set", name, value: token }) }));
        if (r.error) throw new Error(r.error);
        await updateDoc(ref, new FieldPath("connectors", kind), r.placeholder as string);
        next[kind] = r.placeholder as string;
      } else {
        await updateDoc(ref, new FieldPath("connectors", kind), deleteField());
        delete next[kind];
        await fetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", name }) }).catch(() => {});
      }
    } catch (e) { setPcMessage(`⚠️ Could not save the connector: ${e instanceof Error ? e.message : "unknown error"}`); return; }
    patchChat(chatId, { connectors: next });
    delete toolCache.current[chatId];
  }

  async function runDeploy(chat: Chat, name?: string): Promise<string> {
    if (!user) return "";
    const live = chatsRef.current.find((c) => c.id === chat.id) ?? chat;
    const token = live.connectors?.vercel;
    const out = (m: string) => { say(chat.id, m); return m; };
    if (!token) return out("Vercel is not connected for this chat. Open the **Connectors** button (plug icon), add your Vercel token, then ask again.");
    if (!e2bKey) return out("Deploy needs the computer (E2B key). Add it under API keys first.");
    workStart(chat.id, "Deploy ke liye project wala computer chalu kar raha hoon…", "deploy");
    let sid: string | null = null;
    try {
      sid = await acquire({ uid: user.uid, e2bKey }, chat.id, "code"); // the project lives on Venus Code's computer
      say(chat.id, "🚀 Deploying to Vercel… this takes up to a minute.");
      workSet(chat.id, "Vercel par deploy ho raha hai…", "deploy");
      const res = await fetch("/api/deploy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ e2bKey, sandboxId: sid, ws: chat.id, vercelToken: token, name: name?.trim() || undefined }) });
      const data = await readJson(res);
      if (!res.ok) return out(`⚠️ Deploy failed: ${data?.error ?? "unknown error"}`);
      const msg = `✅ Live: [${data.url}](${data.url})${data.state && data.state !== "READY" ? `\n\nVercel is still finishing the build (${data.state}) — the link works in a minute.` : ""}`;
      await sayNext(chat, msg);
      return msg;
    } catch (err) {
      return out(`⚠️ Deploy failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally { workEnd(chat.id, "deploy"); if (sid) void releaseNow(e2bKey, sid); }
  }

  // ---- Team ----

  function teamHost(chat: Chat): TeamHost {
    return {
      llm: (system, prompt) => callLLM(chat, system, prompt),
      runPc: (task, who, onLine) => runPcTask(chat, task, false, { quiet: true, showPanel: true, onLine }),
      runCode: (task, who) => runCodeFor(chat, task, { silent: true, persona: personaOf(who) }),
      runVideo: (task) => startVenus(chat, task, { silent: true }),
    };
  }

  async function runTeam(chat: Chat, goal: string) {
    if (!user) return;
    if (teamBusyRef.current.has(chat.id)) return say(chat.id, "The team is already working on a goal in this chat. Wait for the report, then ask again.");
    teamBusyRef.current.add(chat.id);
    setTeamRun(goal.slice(0, 60));
    workStart(chat.id, "Team ko goal samjha raha hoon, kaam baant raha hoon…", "team");
    if (activeIdRef.current === chat.id) { setTeamOpen(true); setPcOpen(false); }
    say(chat.id, "👥 Chief is assembling a team for this. Open the **Team** panel (people icon) to watch who does what — I'll post one final report here.");
    try {
      const report = await runTeamGoal({ uid: user.uid, chatId: chat.id, goal, ctx: brainPrompt(brainOf(chat.id), goal, { noSkills: true }), host: teamHost(chat) });
      await sayNext(chat, report);
    } catch (err) {
      say(chat.id, `⚠️ The team could not finish: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally { teamBusyRef.current.delete(chat.id); setTeamRun(null); workEnd(chat.id, "team"); void autoOff(chat.id); }
  }

  /** "Assemble a team" only prepares the roster. Nothing is started. */
  async function assembleFor(chat: Chat, brief: string) {
    if (!user) return;
    setTeamOpen(true); setPcOpen(false);
    try {
      const members = await assembleTeam({ uid: user.uid, chatId: chat.id, brief: `${roleOf(chat.id)}\n${brief}`.trim(), ctx: brainPrompt(brainOf(chat.id), brief, { noSkills: true }), llm: (s, p) => callLLM(chat, s, p, [], "plan") });
      say(chat.id, `👥 Team ready: ${members.map((m) => `${m.name} (${m.title})`).join(", ")}.\n\nTell me the first goal and I will plan it with them. Nothing has been started yet.`);
    } catch (e) { say(chat.id, `⚠️ Could not assemble the team: ${e instanceof Error ? e.message : "unknown error"}`); }
  }

  async function applyMemoryCommand(chat: Chat, arg: string, quiet = false) {
    if (!user) return;
    const m = /^(add|forget)\s*\|\s*([\s\S]+)$/i.exec(arg);
    if (!m) return;
    const scope = { uid: user.uid, chatId: chat.id };
    if (m[1].toLowerCase() === "add") {
      const saved = await addMemory(scope, m[2]);
      if (saved && !quiet) say(chat.id, `🧠 Remembered (in this chat): ${saved.text}`);
    } else {
      const n = await forgetMemory(scope, m[2]);
      if (!quiet) say(chat.id, n ? `🧠 Forgot ${n} item${n > 1 ? "s" : ""} about “${m[2]}”.` : `I had nothing saved about “${m[2]}”.`);
    }
    await loadChatBrain(chat.id);
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
      who.tool === "pc" ? "To do work on the computer (browse, scrape, download, terminal), end your reply with [[PC:task|<clear instruction>]]."
      : who.tool === "code" ? "Only if the user wants a software project built or changed, end your reply with [[CODE:<detailed instruction>]]."
      : who.tool === "video" ? "To make a video, end your reply with [[VENUS:<detailed brief>]]. The brief MUST start with the exact length the owner asked for (for example \"45 seconds\" or \"2 minutes\"; any length up to one hour is possible) and the shape (vertical or horizontal): never shorten it or replace it with a default. If the owner gave a SCRIPT, copy it into the brief unchanged after the word SCRIPT: (it becomes the voice-over, word for word)."
      : who.tool === "email" ? "You draft emails (sending needs a Gmail MCP connector): write the full draft in your reply."
      : "Answer directly and concretely.";
    const reply = await callLLM(chat, `${personaOf(who)}\n${hint}${brainPrompt(brainOf(chat.id), text)}`, text, history.slice(-12).map((m) => ({ role: m.role, content: m.content })));
    const parsed = extractCommands(reply);
    const extra = parsed.cmds.length ? await runMemberCommands(parsed.cmds, chat, who) : "";
    return [parsed.clean, extra].filter(Boolean).join("\n\n") || "Done.";
  }

  // ---- Skills from chat (saved for THIS chat only): URL, GitHub repo, "npx skills add ..." command or pasted text ----

  async function installSkillFrom(chat: Chat, input: string): Promise<{ names: string[]; message: string }> {
    if (!user) return { names: [], message: "" };
    try {
      const r = await readJson(await fetch("/api/skills/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: chat.id, input }) }));
      if (r.error) throw new Error(String(r.error));
      const names: string[] = Array.isArray(r.names) ? r.names.map(String) : [];
      const errors: string[] = Array.isArray(r.errors) ? r.errors.map(String) : [];
      await loadChatBrain(chat.id);
      const problems = errors.length ? `\n\n⚠️ Problems:\n${errors.map((e) => `- ${e}`).join("\n")}` : "";
      return {
        names,
        message: names.length
          ? `🧩 Skill installed for this chat: **${names.join(", ")}**. I will use it automatically whenever a job fits it (manage it on the [Skills page](/skills?chat=${chat.id})).${problems}`
          : `⚠️ I could not install that skill.${problems}`,
      };
    } catch (e) {
      return { names: [], message: `⚠️ ${e instanceof Error ? e.message : "Skill install failed."}` };
    }
  }

  async function runCommands(cmds: Cmd[], chat: Chat) {
    for (const c of cmds) {
      if (c.cmd === "deploy") await runDeploy(chat, c.arg);
      else if (c.cmd === "skill" && c.arg) say(chat.id, (await installSkillFrom(chat, c.arg)).message);
      else if (c.cmd === "memory" && c.arg) await applyMemoryCommand(chat, c.arg);
    }
  }

  /** Acts on what the "understand first" step decided. Work only starts when the user really asked for it. */
  async function routeIntent(chat: Chat, u: Understanding, text: string) {
    if (!user) return;
    const task = u.task || text;
    const ack = (fallback: string) => say(chat.id, u.reply || fallback);
    switch (u.intent) {
      case "set_role":
        await setRole({ uid: user.uid, chatId: chat.id }, u.role || text);
        await loadChatBrain(chat.id);
        return ack("Understood — I will act in that role from now on. What is the first thing you want me to handle?");
      case "assemble": ack("On it — putting the team together. Nothing will be started yet."); void assembleFor(chat, text); return;
      case "clarify": return ack("Can you tell me a little more about what exactly you want me to do?");
      case "remember": return void (await applyMemoryCommand(chat, `add|${task}`));
      case "forget": return void (await applyMemoryCommand(chat, `forget|${task}`));
      case "pc":
        if (!e2bKey) return say(chat.id, "That needs a computer you can watch. Add your E2B key under API keys first.");
        ack("On it — opening the computer. You can watch it work in the panel."); void runPcTask(chat, task, false); return;
      case "code": ack("Starting this as a coding project."); void runCodeFor(chat, task); return;
      case "video": ack("Starting the video."); void startVenus(chat, task); return;
      case "team": ack("This needs a few specialists — starting the team."); void runTeam(chat, task); return;
    }
  }

  async function handleAttachFiles(files: File[]) {
    if (!activeChat) return;
    const chatId = activeChat.id;
    const picked = files.slice(0, Math.max(0, MAX_ATTACH_FILES - attach.length));
    if (files.length > picked.length) setPcMessage(`You can attach up to ${MAX_ATTACH_FILES} files in one message.`);
    for (const f of picked) {
      const a = await localAttachment(f);
      setAttach((cur) => [...cur, a]);
      if (a.status !== "uploading") continue;
      const patch = (p: Partial<Attachment>) => setAttach((cur) => cur.map((x) => (x.id === a.id ? { ...x, ...p } : x)));
      void uploadAttachment(f, chatId, (pr) => patch({ progress: pr }))
        .then((realId) => patch({ id: realId, status: "ready", progress: 1 }))
        .catch((e) => patch({ status: "error", error: e instanceof Error ? e.message : "Upload failed." }));
    }
  }

  // ---- Chat ----

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    void submitText(draft.trim() || (attach.some((a) => a.status === "ready") ? "Please look at the attached file(s): tell me what they are and what is in them." : ""));
  }

  /** Used by the composer AND by the two suggestion buttons under every reply. */
  async function submitText(text: string) {
    if (!text || !user || !activeChat || sending) return;
    const chat = activeChat;
    const reply = replyTo; // the agent reply this message is about (null when the owner did not use the reply icon)
    const video = /^\/video\s+([\s\S]+)/i.exec(text);
    const code = /^\/code\s+([\s\S]+)/i.exec(text);
    const team = /^\/team\s+([\s\S]+)/i.exec(text);
    const deploy = /^\/deploy(?:\s+([\s\S]+))?$/i.exec(text);
    const recipe = /^\/recipe(?:\s+([\s\S]*))?$/i.exec(text);
    const forget = /^\/forget\s+([\s\S]+)/i.exec(text);
    const remember = /^\/remember\s+([\s\S]+)/i.exec(text) ?? /^(?:please\s+)?remember(?:\s+that)?[:\s]+([\s\S]{3,})/i.exec(text);
    const rIntent = repoIntent(text);
    const slash = Boolean(video || code || team || deploy || recipe || rIntent);
    const analysis = e2bKey && !slash ? analyzePcMessage(text) : { pureCommand: null, compound: false, stopAfter: false };
    const key = apiKeys[chat.provider];
    if (!analysis.pureCommand && !forget && !remember && !deploy && !recipe && !rIntent && !key) { setSettingsOpen(true); return; }

    const files = slash ? [] : attach.filter((a) => a.status === "ready");
    const payload = text + attachmentBlock(files);
    const vision = files.find((a) => a.vision)?.vision;
    files.forEach((a) => rememberPreview(a.id, a.preview)); // the thumbnail stays visible in the sent message
    attach.filter((a) => a.status !== "ready" || slash).forEach(revokePreview);
    appendMessages(chat.id, [{ role: "user", content: payload, at: Date.now(), ...(reply ? { replyTo: reply } : {}) }]);
    setDraft(""); setAttach([]); setReplyTo(null);

    // the reply the owner pointed at travels with the task into chat, computer, Venus Code, Venus Pro and the team
    const replyCtx = reply
      ? `\n\nREPLY CONTEXT: the owner is replying to THIS exact earlier message of yours (they clicked its reply icon). Words like "this", "it", "that" and "the above" refer to it. Answer about it and act on it:\n"""\n${reply.preview}\n"""`
      : "";

    // @agent mentions: read the work of those agents first; "Agent cooperation" tells the agent about its colleagues
    const targets = resolveMentions(chat, text);
    const coop = (chatsRef.current.find((c) => c.id === chat.id) as ChatX | undefined)?.cooperation === true;
    let collab = "";
    let coopText = "";
    if (targets.length || coop) {
      setSending(true);
      workStart(chat.id, targets.length ? `${targets.map((t) => "@" + t.agentName).join(", ")} ka kaam padh raha hoon…` : "Doosre agents ko dekh raha hoon…", "collab");
      try {
        if (targets.length) collab = await collabBlock(chat, targets, text);
        if (coop) coopText = await coopPrompt(chat);
      } finally { workEnd(chat.id, "collab"); setSending(false); }
    }
    const extra = collab + coopText + replyCtx;
    // private download links for the attached files travel with a task for the computer / Venus Code (never stored in the chat)
    let fileLinks = "";
    const attIds = attachmentIdsIn(payload);
    if (attIds.length) {
      const links = await attachmentLinks(chat.id, attIds);
      if (links.length) fileLinks = `\n\nATTACHED FILES (private download links, valid 6 hours; on the computer: curl -L -o "<name>" "<link>"):\n${links.map((l) => `- ${l.name}: ${l.url}`).join("\n")}`;
    }
    const taskExtra = extra + fileLinks;

    // explicit commands: the user chose them, no guessing
    if (recipe) { void runRecipeCmd(chat, recipe[1] ?? ""); return; }
    if (deploy) { void runDeploy(chat, deploy[1]); return; }
    if (video) { void startVenus(chat, video[1].trim() + extra); return; }
    if (code) { void runCodeFor(chat, code[1].trim() + extra); return; }
    if (team) { void runTeam(chat, team[1].trim() + extra); return; }
    if (forget) { await applyMemoryCommand(chat, `forget|${forget[1].trim()}`); return; }
    if (remember) { await applyMemoryCommand(chat, `add|${remember[1].trim()}`); return; }
    if (rIntent) { void runRepoCommand(chat, rIntent); return; } // /clone, /push, "clone github.com/a/b", "push all changes"

    if (analysis.pureCommand) {
      setSending(true);
      let replyText: string;
      try {
        if (analysis.pureCommand === "start") {
          const id = await startOrResumePc(chat.id);
          replyText = id ? "✅ Computer is on — its screen is in the panel." : `⚠️ The computer could not be turned on: ${sessionsRef.current[chat.id]?.error ?? "unknown error"}`;
        } else {
          const r = await pausePc(chat.id);
          replyText = r.ok ? (sandboxRef.current[chat.id] ? "✅ Computer turned off. Files, apps and logins are saved — turn it on again and it continues where it stopped." : "✅ This chat's computer is already off or expired.") : `⚠️ ${r.error ?? "Could not turn the computer off."}`;
        }
      } catch (err) { replyText = `⚠️ ${err instanceof Error ? err.message : "Something went wrong."}`; }
      finally { setSending(false); }
      say(chat.id, replyText);
      return;
    }

    let extraSystem = "";
    if (looksLikeSkillInstall(text)) {
      setSending(true);
      const r = await installSkillFrom(chat, text);
      setSending(false);
      say(chat.id, r.message);
      if (r.names.length) extraSystem = `\n\nThe user just installed the skill(s): ${r.names.join(", ")}. Acknowledge briefly and carry out any remaining part of the request using the skill.`;
      if (text.replace(/https?:\/\/\S+/g, "").length < 90) return;
    }
    extraSystem += extra;

    // the user switched on Computer mode: that is an explicit order
    if (e2bKey && computerMode) {
      say(chat.id, "On it — opening the computer. You can watch it work in the panel.");
      void runPcTask(chat, text + taskExtra, false);
      return;
    }

    setSending(true);
    let cmds: Cmd[] = [];
    workStart(chat.id, "Tools aur memory dekh raha hoon…", "chat");
    try {
      if (!brains.current[chat.id]) await loadChatBrain(chat.id);
      const history = (chatsRef.current.find((c) => c.id === chat.id)?.messages ?? []).map((m) => ({ role: m.role, content: histText(m) }));
      const specs = await loadTools(chat);
      const planNote = await openPlanNote(chat);

      // Adding a file to a GitHub repo is not coding: skip "understand" (it could pick the computer / Venus Code) and answer with tools.
      const repoFile = repoFileIntent(text);
      let extraRepo = "";
      if (repoFile) {
        workSet(chat.id, "Checking whether the repo is cloned…", "chat");
        extraRepo = await repoHint(chat);
      } else {
        // 1) UNDERSTAND FIRST (with the chat's own model, so it cannot fail because of a helper model)
        workSet(chat.id, "Samajh raha hoon aap kya chahte ho…", "chat");
        const recent = history.slice(0, -1);
        const u = await understand((s, p) => callLLM(chat, s, p, [], "act"), {
          text,
          recent: reply ? [...recent, { role: "assistant" as const, content: `(The owner is replying to THIS exact message of yours: "${reply.preview}")` }] : recent,
          role: roleOf(chat.id), tools: specs.map((s) => s.name), hasComputer: Boolean(e2bKey),
        });
        traceOf(chat.id)?.add("intent", `${u.intent}: ${u.why}`);
        workSet(chat.id, `Samajh gaya: ${INTENT_LABEL[u.intent] ?? u.intent}${u.why.startsWith("keyword") ? " (keyword se)" : ""}`, "chat");
        if (u.intent !== "chat") {
          // the mentioned agents' work and the reply the owner pointed at travel with the task
          if (taskExtra && ["pc", "code", "video", "team"].includes(u.intent)) u.task = (u.task || text) + taskExtra;
          await routeIntent(chat, u, text);
          return;
        }
      }

      // 2) A normal answer: streaming, with the connected tools available
      const fr = await fountBegin(chat.id, text, chat.model, chat.provider); // FOUNT: never throws, empty when off
      const system =
        `You are ${chat.agentName}, an AI teammate working inside AgenticVenus. Be direct and useful, and focus on getting real work done for the person you're talking to.` +
        brainPrompt(brainOf(chat.id), text) + planNote + MEMORY_PROMPT + (chat.connectors?.vercel ? DEPLOY_PROMPT : "") + toolPrompt(fr.narrow(specs)) + extraSystem + extraRepo + SUGGEST_PROMPT;
      const base = chatsRef.current.find((c) => c.id === chat.id)?.messages ?? [];
      const at = Date.now();
      const userPrompt = (history.pop()?.content ?? text) + fr.block; // FOUNT note rides on the user turn so the cached system prompt stays identical

      workSet(chat.id, "Jawab likh raha hoon…", "chat");
      setStreaming(true);
      const showText = (t: string) => patchChat(chat.id, { messages: [...base, { role: "assistant", content: t.replace(/\[\[[\s\S]*$/, "").trim() || "…", at }] });
      let replyOut: string;
      try { replyOut = await streamLLM(chat, system, userPrompt, history, showText, vision); }
      catch (e) {
        if (!vision) throw e;
        // this model cannot look at pictures: carry on without the picture and say so
        replyOut = await streamLLM(chat, system, `${userPrompt}\n(The photo could not be shown to this model. Say so, and work from the file name and the owner's words.)`, history, showText);
      }

      let convo: Array<{ role: "user" | "assistant"; content: string }> = [...history, { role: "user", content: userPrompt }];
      let tainted = false;
      let planActive = planNote.length > 0;
      let gates = 0;
      // keeps long jobs inside the model's memory: old steps are dropped, the saved plan + latest results stay
      const compact = (list: typeof convo): typeof convo => {
        if (list.length <= 26) return list;
        let s = list.length - 16;
        if (list[s].role === "user") s++;
        return [{ role: "user", content: "(earlier steps were trimmed: rely on the plan and on the results below)" }, ...list.slice(s)];
      };
      for (let round = 0; round < 40; round++) {
        const tc = extractToolCalls(replyOut);
        if (!tc.calls.length) {
          // the agent wants to stop: if its checklist still has open steps, send it back to work
          if (!planActive || gates >= 6) break;
          const st = await execTool(chat, "plan.status", {}, tainted);
          if (!/PLAN OPEN:\s*\d+/.test(st.text)) break;
          gates++;
          workSet(chat.id, "Bacha hua kaam poora kar raha hoon…", "chat");
          const nudge = `NOT FINISHED. Your plan still has open steps:\n${st.text}\n\nDo the next open step NOW with the right tool, then call plan.done with proof from the tool result. If a step fails, try another route first; only if truly impossible mark it done with note "skipped: reason". If the owner changed the subject, call plan.clear. Do not give the final answer until every step is done or explicitly skipped.`;
          const before = replyOut;
          replyOut = await callLLM(chat, system, nudge, [...convo, { role: "assistant", content: before }]);
          convo = compact([...convo, { role: "assistant", content: before }, { role: "user", content: nudge }]);
          continue;
        }
        const results: string[] = [];
        for (const c of tc.calls.slice(0, 8)) {
          if (c.name.startsWith("plan.")) planActive = true;
          patchChat(chat.id, { messages: [...base, { role: "assistant", content: `🔧 Using ${c.name}…`, at }] });
          workSet(chat.id, `🔧 ${c.name} chala raha hoon…`, "chat");
          const t = await execTool(chat, c.name, c.args, tainted);
          fr.tool(c.name, !/^(ERROR:|The user declined)/.test(t.text), t.text);
          if (t.flagged) tainted = true;
          results.push(`### ${c.name}\n${t.text}`);
        }
        workSet(chat.id, "Tool ke result se agla step dekh raha hoon…", "chat");
        const resultsMsg = `TOOL RESULTS:\n${results.join("\n\n")}\n\nCheck: is the owner's WHOLE request done and confirmed by these results? If not, or if a tool failed or returned nothing useful, do NOT stop: fix the arguments and retry, or use a different tool or route, and continue now. If you have a plan, call plan.done for the steps these results confirm. Answer only when everything is done and proven, or when you are truly blocked (then say exactly what is blocked, what you tried, and what you need from the owner).`;
        const prev = replyOut;
        replyOut = await callLLM(chat, system, resultsMsg, [...convo, { role: "assistant", content: prev }]);
        convo = compact([...convo, { role: "assistant", content: prev }, { role: "user", content: resultsMsg }]);
      }
      if (planActive) {
        const st = await execTool(chat, "plan.status", {}, tainted);
        if (/PLAN OPEN:\s*\d+/.test(st.text)) replyOut = `${extractToolCalls(replyOut).clean}\n\n⏸️ Kuch steps abhi bache hain. "continue" bolo, main wahin se aage badhunga.`;
      }

      const parsed = extractCommands(extractToolCalls(replyOut).clean);
      cmds = parsed.cmds.filter((c) => c.cmd === "memory" || c.cmd === "skill" || c.cmd === "deploy"); // chat can never start heavy work by itself
      const body = parsed.clean || (cmds.length ? "Done." : "…");
      if (splitSuggestions(body).next.length) say(chat.id, body);
      else await sayNext(chat, body); // the model forgot the next-step line: a fast model writes it
      void fr.end({ summary: body, verify: (task, summary, evidence) => verifyResult((s, p) => callLLM(chat, s, p, [], "verify"), { task, summary, evidence }) });
      // quietly learn about the owner from this message (profile memory)
      void fetch("/api/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: chat.id, user: text, reply: body.slice(0, 1500) }) }).then(() => loadChatBrain(chat.id)).catch(() => {});
    } catch (err) {
      say(chat.id, `⚠️ ${err instanceof Error ? err.message : "Something went wrong."}`);
    } finally { setSending(false); setStreaming(false); workEnd(chat.id, "chat"); }
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
      const replyText = await callLLM(activeChat, "", routine.instructions);
      appendMessages(activeChat.id, [{ role: "user", content: `🔁 Routine: ${routine.name}`, at: Date.now() }, { role: "assistant", content: replyText, at: Date.now() }]);
      await recordManualRun(user.uid, routine.id, replyText);
      setRoutines((prev) => prev.map((r) => (r.id === routine.id ? { ...r, lastRunAt: Date.now(), lastResult: replyText.slice(0, 200) } : r)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Routine run failed.";
      await recordManualRun(user.uid, routine.id, `⚠️ ${message}`);
      setRoutines((prev) => prev.map((r) => (r.id === routine.id ? { ...r, lastRunAt: Date.now(), lastResult: `⚠️ ${message}` } : r)));
    } finally { setRunningRoutineId(null); }
  }

  if (authLoading || !user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;

  const session: PcSession = activeChat ? sessions[activeChat.id] ?? EMPTY_SESSION : EMPTY_SESSION;
  const activeSandboxId = activeChat?.pcSandboxId ?? null;
  const connectedNames = Object.keys(activeChat?.connectors ?? {}).filter((k) => !k.startsWith("auto:")).map((k) => (k.includes(":") ? k.replace(":", " · ") : k));
  const pcStatus = !activeSandboxId ? "no computer yet" : session.status === "paused" ? "off (saved)" : session.running ? "working" : session.status === "ready" ? "on" : session.status;
  const activeWork = activeChat ? work[activeChat.id] : undefined;
  const coopOn = (activeChat as ChatX | null)?.cooperation === true;

  return (
    <div className="flex h-screen bg-bg">
      {!focusMode && <Sidebar chats={chats} activeId={activeId} onSelect={setActiveId} onNewChat={() => setNewChatOpen(true)} userLabel={user.email ?? "Account"} onOpenApiKeys={() => setSettingsOpen(true)} onSignOut={() => signOut(auth)} />}

      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {activeChat && (
            <ChatHeader
              name={activeChat.agentName} color={activeChat.agentColor} focusMode={focusMode} onToggleFocus={() => setFocusMode((v) => !v)}
              onIdentity={() => setIdentityOpen(true)}
              onCode={() => router.push(`/code?chat=${activeChat.id}`)} onVenus={() => router.push("/venus")} onSkills={() => router.push(`/skills?chat=${activeChat.id}`)} onRuns={() => router.push("/runs")} onVpassword={() => router.push(`/vpassword?chat=${activeChat.id}`)}
              onConnectors={() => setConnectorsOpen(true)} hasConnectors={connectedNames.length > 0}
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
                <div className="mx-auto max-w-2xl">
                  <ChatThread
                    chatId={activeChat.id}
                    messages={activeChat.messages}
                    pending={sending && !streaming && !activeWork}
                    busy={sending || Boolean(activeWork)}
                    onSaveAsRoutine={(t) => { setRoutinePrefill(t); setRoutinesOpen(true); }}
                    onSuggest={(t) => void submitText(t)}
                    onReply={(preview, at) => setReplyTo({ at, preview })}
                    onRetry={(t) => void submitText(t)}
                    replyingAt={replyTo?.at ?? null}
                  />
                </div>
              </div>
              {activeWork && <WorkingBar key={`${activeChat.id}:${activeWork.startedAt}`} label={activeWork.label} startedAt={activeWork.startedAt} steps={activeWork.steps} />}
              <RunBars venusRun={venusRun} codeRun={codeRun} teamRun={teamRun} />
              <div className="mx-auto w-full max-w-2xl px-6 pb-2"><ModelPicker provider={activeChat.provider} model={activeChat.model} apiKeys={apiKeys} onChange={handleModelChange} /></div>
              <ChatComposer
                draft={draft} setDraft={setDraft} onSubmit={handleSend} sending={sending} agentName={activeChat.agentName}
                hasComputerKey={Boolean(e2bKey)} computerMode={computerMode} onToggleComputer={() => setComputerMode((v) => !v)}
                attach={attach} onPickFiles={(f) => void handleAttachFiles(f)} onRemoveAttach={(id) => setAttach((cur) => { cur.filter((x) => x.id === id).forEach(revokePreview); return cur.filter((x) => x.id !== id); })}
                mentionables={mentionables} onMention={(token, id) => { pickedRef.current[token] = id; }}
                replyTo={replyTo} onClearReply={() => setReplyTo(null)}
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

      {approval && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl2 border border-line bg-panel p-5">
            <h2 className="text-sm font-medium text-ink">Approve this action?</h2>
            <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-bg p-3 text-xs text-ink">{approval.summary}</pre>
            {approval.warn && <p className="mt-2 text-[11px] text-gold">{approval.warn}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => { approval.resolve(false); setApproval(null); }} className="flex-1 rounded-lg border border-line py-2.5 text-sm text-ink hover:bg-panel2">Decline</button>
              <button onClick={() => { approval.resolve(true); setApproval(null); }} className="flex-1 rounded-lg bg-white py-2.5 text-sm font-medium text-bg hover:opacity-90">Approve</button>
            </div>
          </div>
        </div>
      )}

      <NewChatModal open={newChatOpen} onClose={() => setNewChatOpen(false)} customAgents={customAgents} onPick={handlePickAgent} onCreateAgent={handleCreateAgent} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {activeChat && (
        <RoutinesPanel open={routinesOpen} onClose={() => { setRoutinesOpen(false); setRoutinePrefill(null); }} chatName={activeChat.agentName} routines={routines} prefillInstructions={routinePrefill} busyId={runningRoutineId} onCreate={handleCreateRoutine} onToggle={handleToggleRoutine} onDelete={handleDeleteRoutine} onRunNow={handleRunRoutineNow} />
      )}
      {activeChat && (
        <ConnectorsModal open={connectorsOpen} onClose={() => setConnectorsOpen(false)} chatName={activeChat.agentName} chatId={activeChat.id} getToken={() => user!.getIdToken()} connectors={activeChat.connectors ?? {}} onTest={testConnector} onSave={saveConnector} />
      )}
      {activeChat && (
        <IdentityPanel
          open={identityOpen} onClose={() => setIdentityOpen(false)} chatId={activeChat.id} name={activeChat.agentName} color={activeChat.agentColor}
          presetRole={PRESET_AGENTS.find((a) => a.name === activeChat.agentName)?.role} role={roleOf(activeChat.id)}
          model={`${activeChat.provider} · ${activeChat.model}`} plugins={connectedNames}
          memories={brainOf(activeChat.id).memories.length} skills={brainOf(activeChat.id).skills.length} computer={pcStatus}
          getToken={() => user.getIdToken()}
          onEmailCreated={(ph) => { patchChat(activeChat.id, { connectors: { ...(activeChat.connectors ?? {}), identity: ph } }); delete toolCache.current[activeChat.id]; }}
          cooperation={coopOn} onToggleCooperation={(on) => void setCooperation(on)}
        />
      )}
    </div>
  );
}