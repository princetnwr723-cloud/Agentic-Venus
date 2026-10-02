"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Code2, Download, File as FileIcon, Loader2, Plus, RefreshCw, RotateCcw, Square, Trash2 } from "lucide-react";
import Logo from "@/components/Logo";
import Markdown from "@/components/Markdown";
import ModelPicker from "@/components/dashboard/ModelPicker";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { getModelPref, setModelPref } from "@/lib/model-pref";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import { deleteCodeProject, listCodeProjects, newCodeProject, saveCodeProject, type CodeProject } from "@/lib/code-store";
import { runCodeAgent, wsCall, type CodeEnv, type CodeEvent, type CodeHooks } from "@/lib/code-agent";
import { getCodeComputer } from "@/lib/code-store";

type Ev = CodeEvent & { id: number };
const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";

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
  const [tab, setTab] = useState<"files" | "preview" | "terminal" | "checkpoints">("files");
  const [tree, setTree] = useState<string[]>([]);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [saved, setSaved] = useState(true);
  const [checks, setChecks] = useState<Array<{ sha: string; when: string; msg: string }>>([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [port, setPort] = useState("3000");
  const [zipUrl, setZipUrl] = useState("");
  const [asking, setAsking] = useState<{ q: string; options: string[]; resolve: (a: string) => void } | null>(null);
  const [answer, setAnswer] = useState("");
  const cancelRef = useRef(false);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const pref = typeof window !== "undefined" ? getModelPref() : null;
  const first = (pref && apiKeys[pref.provider] ? pref.provider : PROVIDERS.find((p) => apiKeys[p.id])?.id ?? PROVIDERS[0].id) as ProviderId;
  const [provider, setProvider] = useState<ProviderId>(first);
  const [model, setModel] = useState(pref && apiKeys[pref.provider] ? pref.model : providerMeta(first).models[0]);

  const project = projects.find((p) => p.id === activeId) ?? null;

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);
  useEffect(() => {
    if (!user) return;
    listCodeProjects(user.uid).then((l) => {
      setProjects(l);
      const want = new URLSearchParams(window.location.search).get("project");
      setActiveId(want && l.some((p) => p.id === want) ? want : l[0]?.id ?? null);
    });
  }, [user]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length]);
  useEffect(() => {
    setEvents(((project?.log ?? []) as CodeEvent[]).map((e) => ({ ...e, id: ++idRef.current } as Ev)));
    setTodo(""); setFile(null); setTree([]); setChecks([]); setPreviewUrl(project?.previewUrl ?? ""); setZipUrl("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const env = (): CodeEnv => ({ uid: user!.uid, token: () => user!.getIdToken(), e2bKey: e2bKey as string, apiKeys, provider, model });

  async function sandboxId(): Promise<string | null> {
    return (await getCodeComputer(user!.uid))?.sandboxId ?? null;
  }

  async function refreshSide() {
    if (!user || !project) return;
    const sid = await sandboxId();
    if (!sid) return;
    try {
      setTree(((await wsCall(env(), "tree", { sandboxId: sid, ws: project.id })).files ?? []) as string[]);
      setChecks(((await wsCall(env(), "checkpoints", { sandboxId: sid, ws: project.id })).items ?? []) as Array<{ sha: string; when: string; msg: string }>);
    } catch { /* computer may be starting */ }
  }

  async function createProject() {
    if (!user) return;
    const p = newCodeProject("Workspace " + (projects.length + 1));
    await saveCodeProject(user.uid, p);
    setProjects((prev) => [p, ...prev]);
    setActiveId(p.id);
  }

  async function run() {
    if (!user || !project || !text.trim() || running || !e2bKey) return;
    const instruction = text.trim();
    setText("");
    setRunning(true);
    cancelRef.current = false;
    const log: Ev[] = [];
    const push = (e: CodeEvent) => {
      const ev = { ...e, id: ++idRef.current } as Ev;
      log.push(ev);
      setEvents((prev) => [...prev.slice(-500), ev]);
    };
    push({ kind: "user", text: instruction });
    const hooks: CodeHooks = {
      event: (e) => {
        if (e.kind === "todo") setTodo(e.text);
        if (e.kind === "preview") { setPreviewUrl(e.text); setTab("preview"); }
        push(e);
      },
      ask: (q, options) => new Promise((resolve) => setAsking({ q, options, resolve })),
      cancelled: () => cancelRef.current,
    };
    const res = await runCodeAgent(env(), hooks, project, instruction, { plan });
    const persist = { ...res.project, log: [...(project.log ?? []), ...log.filter((l) => l.kind !== "term").map(({ id, ...rest }) => rest)].slice(-250) };
    setProjects((prev) => prev.map((x) => (x.id === persist.id ? persist : x)));
    saveCodeProject(user.uid, persist).catch(() => {});
    setRunning(false);
    refreshSide();
  }

  async function openFile(path: string) {
    const sid = await sandboxId();
    if (!sid || !project) return;
    const r = await wsCall(env(), "readfile", { sandboxId: sid, ws: project.id, path });
    setFile({ path, content: r.content });
    setSaved(true);
  }

  async function saveFile() {
    const sid = await sandboxId();
    if (!sid || !project || !file) return;
    await wsCall(env(), "writefile", { sandboxId: sid, ws: project.id, path: file.path, content: file.content });
    setSaved(true);
    refreshSide();
  }

  async function restore(sha: string) {
    const sid = await sandboxId();
    if (!sid || !project || !window.confirm("Restore the workspace to this checkpoint? Later changes will be discarded.")) return;
    await wsCall(env(), "restore", { sandboxId: sid, ws: project.id, sha });
    setFile(null);
    refreshSide();
  }

  async function getPreview() {
    const sid = await sandboxId();
    if (!sid || !project) return;
    setPreviewUrl((await wsCall(env(), "previewurl", { sandboxId: sid, ws: project.id, port: Number(port) })).url);
  }

  async function zip() {
    const sid = await sandboxId();
    if (!sid || !project) return;
    setZipUrl((await wsCall(env(), "backup", { sandboxId: sid, ws: project.id })).url);
  }

  if (!user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;
  const termLines = events.filter((e) => e.kind === "term");

  return (
    <div className="flex h-screen bg-bg">
      <aside className="flex w-[230px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center justify-between px-4 py-4">
          <Logo size={18} />
          <button onClick={() => router.push("/dashboard")} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><ArrowLeft size={17} /></button>
        </div>
        <div className="px-4 pb-3">
          <div className="mb-3 flex items-center gap-2"><Code2 size={16} className="text-gold" /><span className="text-sm font-medium text-ink">Venus Code</span><span className="rounded-full bg-goldSoft px-2 py-0.5 text-[10px] font-medium uppercase text-gold">Beta</span></div>
          <button onClick={createProject} className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2 text-sm font-medium text-bg"><Plus size={15} /> New workspace</button>
        </div>
        <nav className="flex-1 overflow-y-auto">
          {projects.map((p) => (
            <div key={p.id} className={`group flex items-center ${p.id === activeId ? "bg-panel2" : "hover:bg-panel2/60"}`}>
              <button onClick={() => setActiveId(p.id)} className="min-w-0 flex-1 px-4 py-3 text-left">
                <span className="block truncate text-sm text-ink">{p.name}</span>
                <span className="block text-[11px] text-faint">{new Date(p.updatedAt).toLocaleDateString()}</span>
              </button>
              <button onClick={async () => { if (window.confirm("Delete this workspace record? (the files stay on the Code computer)")) { await deleteCodeProject(user.uid, p.id); setProjects((x) => x.filter((y) => y.id !== p.id)); if (activeId === p.id) setActiveId(null); } }} className="px-3 text-faint opacity-0 hover:text-red-400 group-hover:opacity-100"><Trash2 size={13} /></button>
            </div>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line p-3">
          <p className="text-[11px] text-muted">Model (shared with chats)</p>
          <ModelPicker provider={provider} model={model} apiKeys={apiKeys} onChange={(p, m) => { setProvider(p); setModel(m); setModelPref(p, m); }} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {!e2bKey && <div className="border-b border-line bg-goldSoft/40 px-6 py-2.5 text-sm text-ink">Add your E2B key in the dashboard (API keys) to use Venus Code.</div>}
        {!project ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Code2 size={30} className="text-gold" />
            <p className="max-w-sm text-sm text-muted">A full coding agent: it reads, edits, runs and previews real projects. Create a workspace, or just type <code className="text-gold">/code build me a landing page</code> in any chat.</p>
            <button onClick={createProject} className="rounded-full bg-white px-5 py-2 text-sm font-medium text-bg">Create a workspace</button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <section className="flex min-w-0 flex-1 flex-col border-r border-line">
              {todo && <pre className="max-h-32 overflow-y-auto border-b border-line bg-panel px-4 py-2 text-xs leading-relaxed text-muted">{todo}</pre>}
              <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
                {events.filter((e) => e.kind !== "term").map((e) => (
                  <div key={e.id} style={{ marginLeft: (e.depth ?? 0) * 16 }}>
                    {e.kind === "user" && <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-xl bg-ink px-3.5 py-2 text-sm text-bg">{e.text}</div>}
                    {e.kind === "thought" && <p className="text-sm italic text-muted">{e.text}</p>}
                    {e.kind === "tool" && <p className="font-mono text-[12px] text-gold">▸ {e.text}</p>}
                    {e.kind === "result" && <p className="line-clamp-3 whitespace-pre-wrap font-mono text-[11px] text-faint">{e.text}</p>}
                    {e.kind === "checkpoint" && <p className="text-[11px] text-avatar-teal">✓ checkpoint {e.text}</p>}
                    {e.kind === "info" && <p className="text-xs text-muted">{e.text}</p>}
                    {e.kind === "preview" && <p className="text-xs text-avatar-teal">Preview ready → see the Preview tab</p>}
                    {e.kind === "error" && <p className="text-sm text-red-300">⚠️ {e.text}</p>}
                    {e.kind === "done" && <div className="rounded-xl border border-line bg-panel2 px-4 py-3 text-sm text-ink"><Markdown text={e.text} /></div>}
                  </div>
                ))}
                {asking && (
                  <div className="rounded-lg border border-gold/60 bg-goldSoft/40 p-3">
                    <p className="mb-2 text-sm text-ink">{asking.q}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {asking.options.map((o) => <button key={o} onClick={() => { asking.resolve(o); setAsking(null); }} className="rounded-full border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2">{o}</button>)}
                    </div>
                    <form onSubmit={(e) => { e.preventDefault(); if (answer.trim()) { asking.resolve(answer.trim()); setAsking(null); setAnswer(""); } }} className="mt-2 flex gap-2">
                      <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Or type an answer…" className={input} />
                      <button className="rounded-lg bg-white px-3 text-xs font-medium text-bg">Send</button>
                    </form>
                  </div>
                )}
                {running && <p className="flex items-center gap-2 text-xs text-muted"><Loader2 size={12} className="animate-spin" /> working…</p>}
                <div ref={endRef} />
              </div>
              <form onSubmit={(e) => { e.preventDefault(); run(); }} className="border-t border-line p-3">
                <div className="mb-2 flex items-center gap-3 text-xs text-muted">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={plan} onChange={(e) => setPlan(e.target.checked)} /> Plan first (ask me before editing)</label>
                </div>
                <div className="flex gap-2">
                  <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } }} rows={2} placeholder="Tell Venus Code what to build or change…" className={input} />
                  {running ? (
                    <button type="button" onClick={() => { cancelRef.current = true; asking?.resolve("Stop."); setAsking(null); }} className="rounded-lg bg-red-500 px-3 text-white"><Square size={15} /></button>
                  ) : (
                    <button disabled={!text.trim() || !e2bKey} className="rounded-lg bg-white px-4 text-sm font-medium text-bg disabled:opacity-40">Run</button>
                  )}
                </div>
              </form>
            </section>

            <aside className="flex w-[44%] min-w-[340px] flex-col">
              <div className="flex gap-1 border-b border-line px-3 py-2">
                {(["files", "preview", "terminal", "checkpoints"] as const).map((t) => (
                  <button key={t} onClick={() => { setTab(t); if (t === "files" || t === "checkpoints") refreshSide(); }} className={`rounded-md px-3 py-1 text-xs capitalize ${tab === t ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>{t}</button>
                ))}
                <button onClick={refreshSide} className="ml-auto text-muted hover:text-ink"><RefreshCw size={13} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {tab === "files" && (
                  <div className="flex h-full flex-col">
                    <div className="max-h-[38%] overflow-y-auto border-b border-line p-2">
                      {tree.length === 0 && <p className="p-2 text-xs text-faint">No files yet.</p>}
                      {tree.map((f) => (
                        <button key={f} onClick={() => openFile(f)} style={{ paddingLeft: 8 + f.split("/").length * 8 - 8 }} className={`flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left font-mono text-[11px] hover:bg-panel2 ${file?.path === f ? "bg-panel2 text-gold" : "text-muted"}`}><FileIcon size={11} />{f}</button>
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
                {tab === "preview" && (
                  <div className="flex h-full flex-col p-2">
                    <div className="mb-2 flex gap-2">
                      <input value={port} onChange={(e) => setPort(e.target.value)} className="w-20 rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink" />
                      <button onClick={getPreview} className="rounded-md border border-line px-3 text-xs text-ink hover:bg-panel2">Get preview URL</button>
                      {previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer" className="self-center text-xs text-gold underline">Open</a>}
                    </div>
                    {previewUrl ? <iframe src={previewUrl} className="min-h-0 flex-1 rounded-md border border-line bg-white" title="Preview" /> : <p className="p-3 text-xs text-faint">Start a dev server (bound to 0.0.0.0) and ask the agent to preview it.</p>}
                  </div>
                )}
                {tab === "terminal" && (
                  <div className="space-y-3 p-3 font-mono text-[11px] text-muted">
                    {termLines.length === 0 && <p className="text-faint">Command output appears here.</p>}
                    {termLines.slice(-30).map((e) => <pre key={e.id} className="whitespace-pre-wrap break-words">{e.text}</pre>)}
                  </div>
                )}
                {tab === "checkpoints" && (
                  <div className="p-3">
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