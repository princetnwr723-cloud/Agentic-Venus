"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, File as FileIcon, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import Markdown from "@/components/Markdown";
import ModelPicker from "@/components/dashboard/ModelPicker";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { getModelPref, setModelPref } from "@/lib/model-pref";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import type { AvatarColor } from "@/lib/bots";
import { deleteCodeProject, getCodeComputer, listCodeProjects, newCodeProject, saveCodeProject, type CodeProject } from "@/lib/code-store";
import { runCodeAgent, wsCall, type Approval, type CodeEnv, type CodeEvent, type CodeHooks, type PermMode } from "@/lib/code-agent";

type Ev = CodeEvent & { id: number };
const PERSONAS: Array<{ name: string; role: string; color: AvatarColor; prompt: string }> = [
  { name: "Forge", role: "Full-stack engineer", color: "teal", prompt: "You are Forge, a pragmatic full-stack engineer. You ship working, tested features end to end." },
  { name: "Pixel", role: "UI/UX & front-end designer", color: "violet", prompt: "You are Pixel, a design-obsessed front-end engineer. Visual polish, motion and responsive layout are your priority; always check desktop and mobile with <look>." },
  { name: "Atlas", role: "Backend & APIs", color: "sky", prompt: "You are Atlas, a backend engineer: clean APIs, data models, validation, error handling and tests." },
  { name: "Sentinel", role: "QA & bug fixer", color: "coral", prompt: "You are Sentinel, a meticulous debugger. Reproduce the bug first, find the root cause, fix it minimally and prove it with a test or a run." },
  { name: "Scribe", role: "Docs & README", color: "sage", prompt: "You are Scribe, a technical writer: clear READMEs, setup guides and code comments." },
  { name: "Rocket", role: "Performance & SEO", color: "amber", prompt: "You are Rocket, a performance and SEO engineer: fast loads, accessibility, metadata, structured data." },
];
const MODES: PermMode[] = ["default", "accept-edits", "auto"];
const MODE_LABEL: Record<PermMode, string> = {
  default: "ask before edits & commands",
  "accept-edits": "⏵⏵ accept edits on",
  auto: "⏵⏵⏵ auto mode (no prompts)",
};
const SLASH = ["/help", "/clear", "/plan", "/init", "/undo", "/preview", "/memory", "/skills"];

const fmtTool = (t: string): [string, string] => {
  if (t.startsWith("$ ")) return ["Bash", t.slice(2)];
  const i = t.indexOf(" ");
  const n = i < 0 ? t : t.slice(0, i);
  return [n.charAt(0).toUpperCase() + n.slice(1), i < 0 ? "" : t.slice(i + 1)];
};

function DiffBox({ lines }: { lines: NonNullable<CodeEvent["lines"]> }) {
  return (
    <div className="overflow-x-auto border-y border-line bg-black/30 py-1 text-[12px] leading-5">
      {lines.map((l, i) => (
        <div key={i} className={`flex whitespace-pre ${l.t === "+" ? "bg-emerald-500/10 text-emerald-200" : l.t === "-" ? "bg-red-500/10 text-red-200" : "text-muted"}`}>
          <span className="w-9 shrink-0 select-none pr-2 text-right text-faint">{l.n ?? ""}</span>
          <span className="w-4 shrink-0 select-none">{l.t === " " ? "" : l.t}</span>
          <span>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

export default function CodePage() {
  const { user, loading } = useAuth();
  const { apiKeys, e2bKey } = useKeys();
  const router = useRouter();

  const [projects, setProjects] = useState<CodeProject[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [todo, setTodo] = useState("");
  const [running, setRunning] = useState(false);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState(false);
  const [mode, setMode] = useState<PermMode>("default");
  const [persona, setPersona] = useState(0);
  const [tab, setTab] = useState<"preview" | "files" | "terminal" | "checkpoints">("preview");
  const [tree, setTree] = useState<string[]>([]);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [saved, setSaved] = useState(true);
  const [checks, setChecks] = useState<Array<{ sha: string; when: string; msg: string }>>([]);
  const [server, setServer] = useState<{ running: boolean; port: number; url: string; log: string; cmd: string } | null>(null);
  const [port, setPort] = useState("3000");
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [auto, setAuto] = useState(true);
  const [bump, setBump] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const [busyServer, setBusyServer] = useState(false);
  const [zipUrl, setZipUrl] = useState("");
  const [asking, setAsking] = useState<{ q: string; options: string[]; resolve: (a: string) => void } | null>(null);
  const [approval, setApproval] = useState<{ req: Approval; resolve: (a: "yes" | "always" | "no") => void } | null>(null);
  const [sel, setSel] = useState(0);
  const [answer, setAnswer] = useState("");
  const cancelRef = useRef(false);
  const idRef = useRef(0);
  const modeRef = useRef<PermMode>("default");
  const endRef = useRef<HTMLDivElement>(null);
  const sidRef = useRef<string | null>(null);

  const pref = typeof window !== "undefined" ? getModelPref() : null;
  const first = (pref && apiKeys[pref.provider] ? pref.provider : PROVIDERS.find((p) => apiKeys[p.id])?.id ?? PROVIDERS[0].id) as ProviderId;
  const [provider, setProvider] = useState<ProviderId>(first);
  const [model, setModel] = useState(pref && apiKeys[pref.provider] ? pref.model : providerMeta(first).models[0]);

  const project = projects.find((p) => p.id === activeId) ?? null;
  const P = PERSONAS[persona];

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);
  useEffect(() => {
    if (!user) return;
    listCodeProjects(user.uid).then((l) => {
      setProjects(l);
      const want = new URLSearchParams(window.location.search).get("project");
      setActiveId(want && l.some((p) => p.id === want) ? want : l[0]?.id ?? null);
    });
  }, [user]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length, approval, asking]);
  useEffect(() => {
    setEvents(((project?.log ?? []) as CodeEvent[]).map((e) => ({ ...e, id: ++idRef.current } as Ev)));
    setTodo(""); setFile(null); setTree([]); setChecks([]); setServer(null); setZipUrl("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const env = (): CodeEnv => ({ uid: user!.uid, token: () => user!.getIdToken(), e2bKey: e2bKey as string, apiKeys, provider, model });
  async function sid(): Promise<string | null> {
    if (!sidRef.current) sidRef.current = (await getCodeComputer(user!.uid))?.sandboxId ?? null;
    return sidRef.current;
  }

  async function refreshSide() {
    if (!user || !project) return;
    const s = await sid();
    if (!s) return;
    try {
      setTree(((await wsCall(env(), "tree", { sandboxId: s, ws: project.id })).files ?? []) as string[]);
      setChecks(((await wsCall(env(), "checkpoints", { sandboxId: s, ws: project.id })).items ?? []) as Array<{ sha: string; when: string; msg: string }>);
    } catch { /* computer may be starting */ }
  }

  async function pollServer() {
    if (!user || !project || !e2bKey) return;
    const s = await sid();
    if (!s) return;
    try {
      const r = await wsCall(env(), "servestatus", { sandboxId: s, ws: project.id });
      setServer(r);
      if (r.port) setPort(String(r.port));
    } catch { /* ignore */ }
  }
  useEffect(() => {
    if (tab !== "preview" || !project) return;
    pollServer();
    const iv = setInterval(pollServer, 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeId, running]);

  async function serverAction(kind: "serve" | "servestop", restart = false) {
    const s = await sid();
    if (!s || !project) return;
    setBusyServer(true);
    try {
      await wsCall(env(), kind, { sandboxId: s, ws: project.id, port: Number(port) || 3000, restart });
      await pollServer();
    } catch (e) {
      setEvents((prev) => [...prev, { id: ++idRef.current, kind: "error", text: e instanceof Error ? e.message : "Server action failed." }]);
    } finally { setBusyServer(false); }
  }

  async function createProject() {
    if (!user) return;
    const p = newCodeProject("Workspace " + (projects.length + 1));
    await saveCodeProject(user.uid, p);
    setProjects((prev) => [p, ...prev]);
    setActiveId(p.id);
  }

  const push = (e: CodeEvent, log?: Ev[]) => {
    const ev = { ...e, id: ++idRef.current } as Ev;
    log?.push(ev);
    setEvents((prev) => [...prev.slice(-600), ev]);
  };

  async function run(instruction: string) {
    if (!user || !project || running || !e2bKey) return;
    setRunning(true);
    cancelRef.current = false;
    const log: Ev[] = [];
    push({ kind: "user", text: instruction }, log);
    const hooks: CodeHooks = {
      event: (e) => {
        if (e.kind === "todo") setTodo(e.text);
        if (e.kind === "preview") { setTab("preview"); setBump((b) => b + 1); pollServer(); }
        if (e.kind === "checkpoint") setBump((b) => b + 1);
        push(e, log);
      },
      ask: (q, options) => new Promise((resolve) => setAsking({ q, options, resolve })),
      approve: (req) => new Promise((resolve) => { setSel(0); setApproval({ req, resolve }); }),
      mode: () => modeRef.current,
      cancelled: () => cancelRef.current,
    };
    const res = await runCodeAgent(env(), hooks, project, instruction, { plan, persona: P.prompt });
    const persist = { ...res.project, log: [...(project.log ?? []), ...log.filter((l) => l.kind !== "term").map(({ id, ...rest }) => rest)].slice(-250) };
    setProjects((prev) => prev.map((x) => (x.id === persist.id ? persist : x)));
    saveCodeProject(user.uid, persist).catch(() => {});
    setRunning(false);
    refreshSide();
    pollServer();
  }

  async function submit() {
    const t = text.trim();
    if (!t) return;
    setText("");
    if (t.startsWith("/")) {
      const [cmd, ...rest] = t.split(" ");
      const arg = rest.join(" ");
      if (cmd === "/clear") { setEvents([]); return; }
      if (cmd === "/plan") { setPlan((v) => !v); push({ kind: "info", text: `Plan mode ${!plan ? "on" : "off"}.` }); return; }
      if (cmd === "/memory") { router.push("/skills"); return; }
      if (cmd === "/skills") { router.push("/skills"); return; }
      if (cmd === "/preview") { setTab("preview"); serverAction("serve"); return; }
      if (cmd === "/help") { push({ kind: "info", text: "Commands: /clear · /plan · /init · /undo · /preview · /memory · /skills.   Shortcuts: shift+tab cycles permissions, 1/2/3 answers prompts, esc stops." }); return; }
      if (cmd === "/init") { run("Explore this workspace and create or update VENUS.md (overview, commands, architecture, conventions)."); return; }
      if (cmd === "/undo") {
        const s = await sid();
        if (s && project && checks[1]) { await wsCall(env(), "restore", { sandboxId: s, ws: project.id, sha: checks[1].sha }); push({ kind: "info", text: `Undid the last change → checkpoint ${checks[1].sha}.` }); refreshSide(); setBump((b) => b + 1); }
        else push({ kind: "info", text: "Nothing to undo." });
        return;
      }
      if (cmd !== "/") { run(arg ? `${cmd.slice(1)} ${arg}` : t); return; }
    }
    run(t);
  }

  // keyboard: permission prompt (1/2/3, arrows, enter) and esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (approval) {
        const pick = (n: number) => { const r = (["yes", "always", "no"] as const)[n]; if (r === "always") setMode("accept-edits"); approval.resolve(r); setApproval(null); };
        if (e.key === "1" || e.key === "2" || e.key === "3") { e.preventDefault(); pick(Number(e.key) - 1); }
        else if (e.key === "ArrowDown") setSel((s) => Math.min(2, s + 1));
        else if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
        else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement && e.target.value)) { e.preventDefault(); pick(sel); }
        else if (e.key === "Escape") pick(2);
      } else if (e.key === "Escape" && running) { cancelRef.current = true; asking?.resolve("Stop."); setAsking(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approval, sel, running, asking]);

  async function openFile(path: string) {
    const s = await sid();
    if (!s || !project) return;
    setFile({ path, content: (await wsCall(env(), "readfile", { sandboxId: s, ws: project.id, path })).content });
    setSaved(true);
  }
  async function saveFile() {
    const s = await sid();
    if (!s || !project || !file) return;
    await wsCall(env(), "writefile", { sandboxId: s, ws: project.id, path: file.path, content: file.content });
    setSaved(true); refreshSide(); setBump((b) => b + 1);
  }
  async function restore(sha: string) {
    const s = await sid();
    if (!s || !project || !window.confirm("Restore the workspace to this checkpoint? Later changes will be discarded.")) return;
    await wsCall(env(), "restore", { sandboxId: s, ws: project.id, sha });
    setFile(null); refreshSide(); setBump((b) => b + 1);
  }
  async function zip() {
    const s = await sid();
    if (!s || !project) return;
    setZipUrl((await wsCall(env(), "backup", { sandboxId: s, ws: project.id })).url);
  }

  if (!user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;

  const termLines = events.filter((e) => e.kind === "term");
  const shown = events.filter((e) => e.kind !== "term");
  const devW = device === "mobile" ? 390 : device === "tablet" ? 768 : undefined;
  const modelLabel = model;
  const fileCount = tree.length;

  return (
    <div className="flex h-screen bg-bg">
      <aside className="flex w-[210px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center justify-between px-4 py-4">
          <span className="text-sm font-medium text-ink">Venus Code</span>
          <button onClick={() => router.push("/dashboard")} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><ArrowLeft size={16} /></button>
        </div>
        <div className="px-3 pb-2"><button onClick={createProject} className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2 text-sm font-medium text-bg"><Plus size={15} /> New workspace</button></div>
        <nav className="min-h-0 flex-1 overflow-y-auto">
          {projects.map((p) => (
            <div key={p.id} className={`group flex items-center ${p.id === activeId ? "bg-panel2" : "hover:bg-panel2/60"}`}>
              <button onClick={() => setActiveId(p.id)} className="min-w-0 flex-1 px-4 py-2.5 text-left"><span className="block truncate text-sm text-ink">{p.name}</span></button>
              <button onClick={async () => { if (window.confirm("Delete this workspace record? (files stay on the Code computer)")) { await deleteCodeProject(user.uid, p.id); setProjects((x) => x.filter((y) => y.id !== p.id)); if (activeId === p.id) setActiveId(null); } }} className="px-3 text-faint opacity-0 hover:text-red-400 group-hover:opacity-100"><Trash2 size={13} /></button>
            </div>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line p-3">
          <p className="text-[11px] text-muted">Who is coding?</p>
          <div className="grid grid-cols-3 gap-1.5">
            {PERSONAS.map((p, i) => (
              <button key={p.name} onClick={() => setPersona(i)} title={`${p.name} — ${p.role}`} className={`flex flex-col items-center gap-1 rounded-lg p-1.5 text-[10px] ${persona === i ? "bg-panel2 text-ink" : "text-muted hover:bg-panel2"}`}>
                <BotAvatar color={p.color} size={28} ring={persona === i} />{p.name}
              </button>
            ))}
          </div>
          <p className="pt-1 text-[11px] text-muted">Model (shared with chats)</p>
          <ModelPicker provider={provider} model={model} apiKeys={apiKeys} onChange={(p, m) => { setProvider(p); setModel(m); setModelPref(p, m); }} />
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!e2bKey && <div className="border-b border-line bg-goldSoft/40 px-6 py-2.5 text-sm text-ink">Add your E2B key in the dashboard (API keys) to use Venus Code.</div>}
        {!project ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <BotAvatar color="amber" size={56} />
            <p className="max-w-sm text-sm text-muted">A full coding agent: it reads, edits, runs, previews and visually checks real projects. Create a workspace, or type <code className="text-gold">/code build me a landing page</code> in any chat.</p>
            <button onClick={createProject} className="rounded-full bg-white px-5 py-2 text-sm font-medium text-bg">Create a workspace</button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* ---------- terminal window ---------- */}
            <section className="m-3 mr-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-[#12141a] font-mono text-[13px] shadow-2xl">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-2 text-xs text-muted">✳ Venus Code — {project.name}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
                <div className="rounded-lg border border-gold/60 p-3">
                  <p className="-mt-5 mb-2 w-fit bg-[#12141a] px-2 text-xs text-gold">Venus Code v3 — {P.name}</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col items-center gap-1.5 text-center">
                      <p className="font-semibold text-ink">Welcome back!</p>
                      <BotAvatar color={P.color} size={56} />
                      <p className="text-xs text-muted">{P.name} · {P.role}</p>
                      <p className="text-xs text-faint">{modelLabel} · your API key</p>
                      <p className="text-xs text-faint">~/work/{project.id}</p>
                    </div>
                    <div className="space-y-2 border-line text-xs md:border-l md:pl-4">
                      <p className="font-semibold text-gold">Tips for getting started</p>
                      <p className="text-muted">Ask for a website, an app or a fix. Type / for commands. shift+tab changes how often I ask permission.</p>
                      <p className="border-t border-line pt-2 font-semibold text-gold">Recent activity</p>
                      <p className="whitespace-pre-wrap text-muted">{project.ctx ? project.ctx.trim().split("\n").slice(-3).join("\n") : "No recent activity"}</p>
                    </div>
                  </div>
                </div>

                {todo && <pre className="whitespace-pre-wrap rounded-md border border-line bg-black/20 px-3 py-2 text-[12px] leading-5 text-muted">{todo}</pre>}

                {shown.map((e) => (
                  <div key={e.id} style={{ marginLeft: (e.depth ?? 0) * 18 }}>
                    {e.kind === "user" && <div className="bg-white/5 px-2 py-1 text-ink"><span className="text-faint">❯ </span>{e.text}</div>}
                    {e.kind === "thought" && <div className="flex gap-2"><span className="text-ink">●</span><span className="whitespace-pre-wrap text-ink">{e.text}</span></div>}
                    {e.kind === "tool" && (() => { const [n, a] = fmtTool(e.text); return <div className="flex gap-2"><span className="text-avatar-teal">●</span><span className="min-w-0 break-words text-ink"><b>{n}</b>(<span className="text-muted">{a}</span>)</span></div>; })()}
                    {e.kind === "result" && <div className="flex gap-2 pl-1 text-muted"><span>⎿</span><span className="line-clamp-3 whitespace-pre-wrap">{e.text}</span></div>}
                    {e.kind === "diff" && e.lines && (
                      <div className="rounded-md border border-line">
                        <p className="px-3 py-1.5 text-[12px] text-indigo-200">{e.text === "write" ? "Create file" : "Update"} {e.path}</p>
                        <DiffBox lines={e.lines} />
                      </div>
                    )}
                    {e.kind === "checkpoint" && <p className="pl-1 text-[11px] text-avatar-teal">✓ checkpoint {e.text}</p>}
                    {e.kind === "info" && <p className="text-xs text-muted">{e.text}</p>}
                    {e.kind === "preview" && <p className="text-xs text-avatar-teal">● Preview ready — see the Preview tab</p>}
                    {e.kind === "error" && <p className="text-red-300">⚠ {e.text}</p>}
                    {e.kind === "done" && <div className="rounded-lg border border-line bg-panel2 px-4 py-3 font-sans text-sm text-ink"><Markdown text={e.text} /></div>}
                  </div>
                ))}

                {approval && (
                  <div className="rounded-md border border-indigo-400/50">
                    <p className="px-3 py-1.5 text-indigo-200">{approval.req.title}</p>
                    {approval.req.lines && <DiffBox lines={approval.req.lines} />}
                    {approval.req.command && <pre className="whitespace-pre-wrap border-y border-line bg-black/30 px-3 py-2 text-ink">$ {approval.req.command}</pre>}
                    <div className="space-y-0.5 px-3 py-2">
                      <p className="text-ink">Do you want to {approval.req.tool === "bash" ? "run this command" : approval.req.tool === "write" ? "create this file" : "make this edit"}?</p>
                      {["Yes", approval.req.tool === "bash" ? "Yes, and don't ask again for edits this session" : "Yes, allow all edits during this session (shift+tab)", "No"].map((o, i) => (
                        <button key={i} onClick={() => { const r = (["yes", "always", "no"] as const)[i]; if (r === "always") setMode("accept-edits"); approval.resolve(r); setApproval(null); }} className={`block w-full text-left ${sel === i ? "text-indigo-200" : "text-muted"}`}>
                          {sel === i ? "❯" : " "} {i + 1}. {o}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {asking && (
                  <div className="rounded-md border border-gold/60 p-3">
                    <p className="mb-2 text-ink">{asking.q}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {asking.options.map((o) => <button key={o} onClick={() => { asking.resolve(o); setAsking(null); }} className="rounded-full border border-line px-3 py-1 text-xs text-ink hover:bg-panel2">{o}</button>)}
                    </div>
                    <form onSubmit={(e) => { e.preventDefault(); if (answer.trim()) { asking.resolve(answer.trim()); setAsking(null); setAnswer(""); } }} className="mt-2 flex gap-2">
                      <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Or type an answer…" className="w-full rounded border border-line bg-bg px-2 py-1 text-xs text-ink focus:outline-none" />
                    </form>
                  </div>
                )}
                {running && !approval && !asking && <p className="text-xs text-gold">✻ working… <span className="text-faint">(esc to interrupt)</span></p>}
                <div ref={endRef} />
              </div>

              <div className="border-t border-line p-2">
                {text.startsWith("/") && !text.includes(" ") && (
                  <div className="mb-1 flex flex-wrap gap-1.5 px-1">{SLASH.filter((s) => s.startsWith(text)).map((s) => <button key={s} onClick={() => setText(s + " ")} className="text-xs text-gold hover:underline">{s}</button>)}</div>
                )}
                <div className="flex items-start gap-2 rounded-md border border-line bg-black/20 px-3 py-2">
                  <span className="pt-0.5 text-faint">❯</span>
                  <textarea
                    value={text} onChange={(e) => setText(e.target.value)} rows={2} disabled={!e2bKey || Boolean(approval)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!running) submit(); }
                      else if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]); }
                    }}
                    placeholder={running ? "working… (esc to interrupt)" : "Tell Venus Code what to build or change…"}
                    className="min-h-0 flex-1 resize-none bg-transparent text-ink placeholder:text-faint focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-between px-2 pt-1.5 text-[11px] text-faint">
                  <button onClick={() => setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length])} className="hover:text-ink">{MODE_LABEL[mode]} <span className="text-faint">(shift+tab)</span></button>
                  <span className="flex items-center gap-3">
                    <label className="flex items-center gap-1"><input type="checkbox" checked={plan} onChange={(e) => setPlan(e.target.checked)} /> plan first</label>
                    {fileCount > 0 && <span>{fileCount} files</span>}
                    <span>{modelLabel}</span>
                  </span>
                </div>
              </div>
            </section>

            {/* ---------- side panel ---------- */}
            <aside className="flex w-[44%] min-w-[340px] flex-col p-3">
              <div className="flex gap-1 pb-2">
                {(["preview", "files", "terminal", "checkpoints"] as const).map((t) => (
                  <button key={t} onClick={() => { setTab(t); if (t === "files" || t === "checkpoints") refreshSide(); }} className={`rounded-md px-3 py-1 text-xs capitalize ${tab === t ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>{t}</button>
                ))}
                <button onClick={() => { refreshSide(); pollServer(); setBump((b) => b + 1); }} className="ml-auto text-muted hover:text-ink"><RefreshCw size={13} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel">
                {tab === "preview" && (
                  <div className="flex h-full flex-col">
                    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs">
                      <span className={`h-2 w-2 rounded-full ${server?.running ? "bg-avatar-teal" : "bg-red-400"}`} />
                      <span className="text-ink">{server?.running ? "Server running" : "Server stopped"}</span>
                      <input value={port} onChange={(e) => setPort(e.target.value)} className="w-16 rounded border border-line bg-bg px-1.5 py-0.5 text-ink" />
                      <button disabled={busyServer} onClick={() => serverAction("serve", Boolean(server?.running))} className="rounded bg-white px-2.5 py-1 font-medium text-bg disabled:opacity-50">{busyServer ? "…" : server?.running ? "Restart" : "Start"}</button>
                      {server?.running && <button onClick={() => serverAction("servestop")} className="rounded border border-line px-2 py-1 text-muted hover:text-ink">Stop</button>}
                      <span className="ml-auto flex items-center gap-1">
                        {(["desktop", "tablet", "mobile"] as const).map((d) => <button key={d} onClick={() => setDevice(d)} className={`rounded px-1.5 py-0.5 ${device === d ? "bg-panel2 text-ink" : "text-muted"}`}>{d === "desktop" ? "🖥" : d === "tablet" ? "▭" : "📱"}</button>)}
                        <label className="ml-1 flex items-center gap-1 text-muted"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> live</label>
                        {server?.url && <a href={server.url} target="_blank" rel="noreferrer" className="ml-1 text-gold underline">Open</a>}
                      </span>
                    </div>
                    <div className="relative min-h-0 flex-1 overflow-auto bg-[#0b0c10] p-2">
                      {server?.running && server.url ? (
                        <iframe key={auto ? bump : 0} src={server.url} title="Preview" style={{ width: devW ?? "100%", maxWidth: "100%" }} className="mx-auto h-full min-h-[420px] rounded-md border border-line bg-white" />
                      ) : (
                        <div className="mx-auto mt-10 max-w-xs space-y-2 text-center text-xs text-muted">
                          <p className="text-ink">No server is running on port {port}.</p>
                          <p>That is what causes “Closed Port Error”. Press <b>Start</b> — Venus Code detects Next, Vite, Astro or a static site, installs dependencies and opens it.</p>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-line px-3 py-1.5 text-[11px]">
                      <button onClick={() => setShowLog((v) => !v)} className="text-muted hover:text-ink">{showLog ? "Hide" : "Show"} server log{server?.cmd ? ` · ${server.cmd}` : ""}</button>
                      {showLog && <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-faint">{server?.log || "(empty)"}</pre>}
                    </div>
                  </div>
                )}
                {tab === "files" && (
                  <div className="flex h-full flex-col">
                    <div className="max-h-[38%] overflow-y-auto border-b border-line p-2">
                      {tree.length === 0 && <p className="p-2 text-xs text-faint">No files yet.</p>}
                      {tree.map((f) => (
                        <button key={f} onClick={() => openFile(f)} style={{ paddingLeft: 6 + (f.split("/").length - 1) * 10 }} className={`flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left font-mono text-[11px] hover:bg-panel2 ${file?.path === f ? "bg-panel2 text-gold" : "text-muted"}`}><FileIcon size={11} />{f}</button>
                      ))}
                    </div>
                    {file && (
                      <div className="flex min-h-0 flex-1 flex-col p-2">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-muted"><span className="truncate">{file.path}</span><button onClick={saveFile} disabled={saved} className="rounded bg-white px-2 py-0.5 text-bg disabled:opacity-40">Save</button></div>
                        <textarea value={file.content} onChange={(e) => { setFile({ ...file, content: e.target.value }); setSaved(false); }} spellCheck={false} className="min-h-0 flex-1 resize-none rounded-md border border-line bg-bg p-2 font-mono text-[11px] leading-relaxed text-ink focus:outline-none" />
                      </div>
                    )}
                  </div>
                )}
                {tab === "terminal" && (
                  <div className="h-full space-y-3 overflow-y-auto p-3 font-mono text-[11px] text-muted">
                    {termLines.length === 0 && <p className="text-faint">Command output appears here.</p>}
                    {termLines.slice(-30).map((e) => <pre key={e.id} className="whitespace-pre-wrap break-words">{e.text}</pre>)}
                  </div>
                )}
                {tab === "checkpoints" && (
                  <div className="h-full overflow-y-auto p-3">
                    <div className="mb-3 flex items-center gap-3">
                      <button onClick={zip} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2"><Download size={12} /> Create zip</button>
                      {zipUrl && <a href={zipUrl} className="text-xs text-gold underline">Download project.zip</a>}
                    </div>
                    {checks.map((c) => (
                      <div key={c.sha} className="flex items-center gap-2 border-b border-line py-2 text-xs">
                        <span className="font-mono text-gold">{c.sha}</span><span className="min-w-0 flex-1 truncate text-ink">{c.msg}</span><span className="text-faint">{c.when}</span>
                        <button onClick={() => restore(c.sha)} title="Restore" className="text-muted hover:text-ink"><RotateCcw size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}