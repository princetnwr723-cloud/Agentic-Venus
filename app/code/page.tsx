"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { ArrowLeft, Download, File as FileIcon, Folder, Maximize2, Pencil, Plus, RefreshCw, RotateCcw, Square, Trash2, X } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import Markdown from "@/components/Markdown";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { db } from "@/lib/firebase";
import { touch } from "@/lib/computers";
import { listChats, type Chat } from "@/lib/chats";
import {
  newCodeProject, projectIdFor, removeCodeProject, renameCodeProject, saveCodeProject, setActiveProject, setStop,
  watchCodeProject, watchCodeProjects, type CodeProject,
} from "@/lib/code-store";
import { wsCall, type CodeEnv } from "@/lib/code-agent";

const fmtTool = (t: string): [string, string] => {
  if (t.startsWith("$ ")) return ["Bash", t.slice(2)];
  const i = t.indexOf(" ");
  const n = i < 0 ? t : t.slice(0, i);
  return [n.charAt(0).toUpperCase() + n.slice(1), i < 0 ? "" : t.slice(i + 1)];
};

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i += 7) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

function DiffBox({ lines }: { lines: NonNullable<CodeProject["log"][number]["lines"]> }) {
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

type Live = { state: "idle" | "starting" | "ready" | "failed"; url: string | null; log: string };
type Tab = "preview" | "files" | "terminal" | "checkpoints" | "repo";

export default function CodePage() {
  const { user, loading } = useAuth();
  const { apiKeys, e2bKey } = useKeys();
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [proj, setProj] = useState<CodeProject | null>(null);
  const [projects, setProjects] = useState<CodeProject[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  // wsId = the workspace of the project that is open. The chat's first project uses the chat id itself.
  const [wsId, setWsId] = useState<string | null>(null);
  const wantProject = useRef<string | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [tree, setTree] = useState<string[]>([]);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [checks, setChecks] = useState<Array<{ sha: string; when: string; msg: string }>>([]);
  const [page, setPage] = useState<{ html: string; entry: string; files: string[]; hasPackage?: boolean } | null>(null);
  const [entry, setEntry] = useState("");
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [mode, setMode] = useState<"static" | "live">("static");
  const [live, setLive] = useState<Live>({ state: "idle", url: null, log: "" });
  const [zipUrl, setZipUrl] = useState("");
  const [err, setErr] = useState("");
  const [full, setFull] = useState(false);
  const [repoIn, setRepoIn] = useState("");
  const [repoBranch, setRepoBranch] = useState("");
  const [pushMsg, setPushMsg] = useState("");
  const [pushDirect, setPushDirect] = useState(false);
  const [repoBusy, setRepoBusy] = useState<string | null>(null);
  const [repoOut, setRepoOut] = useState<{ ok: boolean; text: string; links?: Array<{ label: string; href: string }> } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const chat = chats.find((c) => c.id === chatId) ?? null;
  // The dashboard runs code on the chat's computer; older chats may have a separate "code" computer.
  const sandboxId =
    (chat as unknown as { computers?: Record<string, string> } | null)?.computers?.code ?? chat?.pcSandboxId ?? null;
  const repo = chat?.repo ?? null;

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);
  useEffect(() => {
    if (!user) return;
    listChats(user.uid).then((l) => {
      setChats(l);
      const want = new URLSearchParams(window.location.search).get("chat");
      wantProject.current = new URLSearchParams(window.location.search).get("project");
      setChatId(want && l.some((c) => c.id === want) ? want : l[0]?.id ?? null);
    });
  }, [user]);

  // keep the chat's computer id (and cloned repo) fresh: they are created after this page may have loaded
  useEffect(() => {
    if (!user || !chatId) return;
    return onSnapshot(doc(db, "users", user.uid, "chats", chatId), (s) => {
      if (!s.exists()) return;
      const data = s.data() as Omit<Chat, "id">;
      setChats((prev) => prev.map((c) => (c.id === s.id ? { ...c, pcSandboxId: data.pcSandboxId, ...(data as object) } : c)));
    }, () => {});
  }, [user, chatId]);

  // the projects of this chat (left side)
  useEffect(() => {
    if (!user || !chatId) return;
    setProjects([]); setProjectsLoaded(false); setWsId(null);
    return watchCodeProjects(user.uid, chatId, (list) => { setProjects(list); setProjectsLoaded(true); });
  }, [user, chatId]);

  // which project is open: ?project=, else the one the agent / owner worked in last, else the newest, else the chat's main workspace
  useEffect(() => {
    if (!chatId || !projectsLoaded || wsId) return;
    const ids = new Set(projects.map((p) => p.id));
    const pinned = wantProject.current && ids.has(wantProject.current) ? wantProject.current : null;
    const last = chat?.codeWs && ids.has(chat.codeWs) ? chat.codeWs : null;
    const newest = [...projects].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]?.id ?? null;
    setWsId(pinned ?? last ?? newest ?? chatId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, projectsLoaded, projects, wsId, chat?.codeWs]);

  // the agent started or switched to another project while this page is open: follow it
  const agentWs = chat?.codeWs ?? null;
  useEffect(() => {
    if (agentWs && projects.some((p) => p.id === agentWs)) setWsId(agentWs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentWs]);

  useEffect(() => {
    if (!user || !wsId) return;
    setProj(null); setTree([]); setFile(null); setChecks([]); setPage(null); setEntry(""); setZipUrl(""); setRepoOut(null);
    setLive({ state: "idle", url: null, log: "" });
    return watchCodeProject(user.uid, wsId, setProj);
  }, [user, wsId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [proj?.log?.length]);

  const env = (): CodeEnv | null =>
    user && chat && e2bKey ? { uid: user.uid, token: () => user.getIdToken(), e2bKey, apiKeys, provider: chat.provider, model: chat.model, chatId: chat.id, sandboxId: sandboxId ?? undefined } : null;

  async function pv(action: string, extra: Record<string, unknown> = {}) {
    if (!user || !e2bKey || !sandboxId || !wsId) throw new Error("The computer is not available yet.");
    const res = await fetch("/api/code/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
      body: JSON.stringify({ action, uid: user.uid, e2bKey, sandboxId, ws: wsId, ...extra }),
    });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { error: `Server returned ${res.status}` }; }
    if (!res.ok) throw new Error(data?.error || "Preview failed.");
    touch(sandboxId, e2bKey);
    return data;
  }

  async function refreshPreview(en = entry) {
    try { setPage(await pv("html", { entry: en || undefined })); setErr(""); } catch (x) { setErr(x instanceof Error ? x.message : "Preview failed."); }
  }
  async function refreshSide() {
    const e = env();
    if (!e || !sandboxId || !wsId) return;
    try {
      setTree(((await wsCall(e, "tree", { sandboxId, ws: wsId })).files ?? []) as string[]);
      setChecks(((await wsCall(e, "checkpoints", { sandboxId, ws: wsId })).items ?? []) as Array<{ sha: string; when: string; msg: string }>);
    } catch { /* computer may be off */ }
  }

  // refresh when the agent saved something new (checkpoint) and every 6s while it works
  const ckpt = (proj?.log ?? []).filter((l) => l.kind === "checkpoint").length;
  useEffect(() => {
    if (!sandboxId || !wsId || !user || !e2bKey) return;
    if (tab === "preview" && mode === "static") refreshPreview();
    if (tab === "files" || tab === "checkpoints") refreshSide();
    if (!proj?.running) return;
    const iv = setInterval(() => { if (tab === "preview") { if (mode === "static") refreshPreview(); } else refreshSide(); }, 6000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, mode, sandboxId, wsId, user, e2bKey, proj?.running, ckpt]);

  // live server: detect an already running server when switching to it
  useEffect(() => {
    if (mode !== "live" || !sandboxId || !user || !e2bKey) return;
    pv("serve_status").then((r) => { if (r.ready) setLive({ state: "ready", url: r.url ?? null, log: r.log ?? "" }); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sandboxId, wsId, user, e2bKey]);

  useEffect(() => {
    if (live.state !== "starting") return;
    let n = 0;
    const iv = setInterval(async () => {
      n++;
      try {
        const r = await pv("serve_status");
        if (r.ready) setLive({ state: "ready", url: r.url ?? null, log: r.log ?? "" });
        else if (r.exited || n > 80) setLive({ state: "failed", url: null, log: r.log ?? "" });
        else setLive((l) => ({ ...l, log: r.log ?? l.log }));
      } catch (x) {
        setLive({ state: "failed", url: null, log: x instanceof Error ? x.message : "failed" });
      }
    }, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.state]);

  async function startLive() {
    setLive({ state: "starting", url: null, log: "Starting the dev server…" });
    try { await pv("serve"); } catch (x) { setLive({ state: "failed", url: null, log: x instanceof Error ? x.message : "failed" }); }
  }
  async function stopLive() {
    try { await pv("serve_stop"); } catch { /* ignore */ }
    setLive({ state: "idle", url: null, log: "" });
  }

  // links between local pages inside the static preview
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!page || e.source !== frameRef.current?.contentWindow) return;
      const h = e.data && typeof e.data === "object" ? (e.data as { venusNav?: unknown }).venusNav : null;
      if (typeof h !== "string") return;
      const cur = entry || page.entry;
      const base = cur.includes("/") ? cur.slice(0, cur.lastIndexOf("/")) : "";
      const raw = h.split("?")[0].split("#")[0];
      const parts = (raw.startsWith("/") ? raw.slice(1) : (base ? base + "/" : "") + raw).split("/");
      const out: string[] = [];
      for (const p of parts) { if (!p || p === ".") continue; if (p === "..") out.pop(); else out.push(p); }
      const target = out.join("/");
      if (page.files.includes(target)) { setEntry(target); refreshPreview(target); }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, entry]);

  async function openFile(path: string) {
    const e = env();
    if (!e || !sandboxId) return;
    setFile({ path, content: (await wsCall(e, "readfile", { sandboxId, ws: wsId, path })).content });
  }
  async function restore(sha: string) {
    const e = env();
    if (!e || !sandboxId || !window.confirm("Restore the codespace to this checkpoint? Later changes will be discarded.")) return;
    await wsCall(e, "restore", { sandboxId, ws: wsId, sha });
    refreshSide(); refreshPreview();
  }
  async function zip() {
    const e = env();
    if (!e || !sandboxId) return;
    setZipUrl((await wsCall(e, "backup", { sandboxId, ws: wsId })).url);
  }

  // ---- Projects (left side) ----
  function openProject(id: string) {
    if (!user || !chatId || id === wsId) return;
    setWsId(id);
    void setActiveProject(user.uid, chatId, id).catch(() => {});
    window.history.replaceState(null, "", `/code?chat=${chatId}&project=${id}`);
  }
  async function createProject() {
    if (!user || !chatId) return;
    const name = window.prompt("Name of the new project", "New project")?.trim();
    if (!name) return;
    const id = projects.length === 0 ? chatId : projectIdFor(chatId);
    await saveCodeProject(user.uid, newCodeProject(chatId, name, id));
    openProject(id);
  }
  async function renameProject(p: CodeProject) {
    if (!user) return;
    const name = window.prompt("Project name", p.name)?.trim();
    if (name && name !== p.name) await renameCodeProject(user.uid, p.id, name);
  }
  async function deleteProject(p: CodeProject) {
    if (!user || !chatId || p.running) return;
    if (!window.confirm(`Remove the project "${p.name}" from this list? Its activity log is deleted. The files stay on the computer until it is reset.`)) return;
    await removeCodeProject(user.uid, p.id);
    if (wsId === p.id) {
      const next = projects.find((x) => x.id !== p.id);
      if (next) openProject(next.id); else setWsId(chatId);
    }
  }

  // ---- GitHub repository: clone into this workspace, push all changes back ----
  async function repoCall(action: "clone" | "push" | "status", extra: Record<string, unknown>) {
    const res = await fetch("/api/code/repo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ws: chatId, ...extra }) });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { error: `Server returned ${res.status}` }; }
    if (!res.ok) throw new Error(data?.error || "Repository request failed.");
    return data;
  }
  async function doClone() {
    if (!repoIn.trim() || repoBusy) return;
    setRepoBusy("clone"); setRepoOut(null);
    try {
      const d = await repoCall("clone", { repo: repoIn.trim(), branch: repoBranch.trim() || undefined });
      setRepoOut({ ok: true, text: `Cloned ${d.repo} (branch ${d.branch}, ${d.files} files). The files are in this workspace now.${d.backup ? `\nThe old workspace was kept at ${d.backup}.` : ""}` });
      setTab("files");
      setTimeout(() => { void refreshSide(); void refreshPreview(); }, 1500);
    } catch (x) { setRepoOut({ ok: false, text: x instanceof Error ? x.message : "Clone failed." }); }
    setRepoBusy(null);
  }
  async function doPush() {
    if (repoBusy) return;
    setRepoBusy("push"); setRepoOut(null);
    try {
      const d = await repoCall("push", { message: pushMsg.trim() || undefined, direct: pushDirect, branch: repoBranch.trim() || undefined });
      setRepoOut({ ok: true, text: d.note, links: [{ label: "Open the branch on GitHub", href: d.url }, ...(d.compareUrl ? [{ label: "Open a pull request", href: d.compareUrl }] : [])] });
      void refreshSide();
    } catch (x) { setRepoOut({ ok: false, text: x instanceof Error ? x.message : "Push failed." }); }
    setRepoBusy(null);
  }
  async function doStatus() {
    if (repoBusy) return;
    setRepoBusy("status"); setRepoOut(null);
    try {
      const d = await repoCall("status", {});
      setRepoOut({ ok: true, text: d.cloned ? `${d.repo} · branch ${d.branch} · ${d.files} files · ${d.dirty} changed file(s) not pushed yet${d.last ? `\nLast commit: ${d.last}` : ""}${d.changes ? `\n\n${d.changes}` : ""}` : `No repository is cloned in this workspace.${d.note ? " " + d.note : ""}` });
    } catch (x) { setRepoOut({ ok: false, text: x instanceof Error ? x.message : "Status failed." }); }
    setRepoBusy(null);
  }

  if (!user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;

  const log = proj?.log ?? [];
  const shown = log.filter((e) => e.kind !== "term");
  const term = log.filter((e) => e.kind === "term");
  const devW = device === "mobile" ? 390 : device === "tablet" ? 768 : undefined;
  const frameCls = `mx-auto rounded-md border border-line bg-white ${full ? "h-[calc(100vh-24px)]" : "h-full min-h-[420px]"}`;
  const inp = "w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold focus:outline-none";

  return (
    <div className="flex h-screen bg-bg">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center justify-between px-4 py-4">
          <span className="text-sm font-medium text-ink">Venus Code</span>
          <button onClick={() => router.push("/dashboard")} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><ArrowLeft size={16} /></button>
        </div>
        {chat && (
          <div className="flex items-center gap-2.5 px-4 pb-3">
            <BotAvatar color={chat.agentColor} size={26} />
            <span className="min-w-0 truncate text-sm text-ink">{chat.agentName}</span>
          </div>
        )}
        {chat && (
          <>
            <div className="flex items-center justify-between px-4 pb-1 pt-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Projects</span>
              <button onClick={createProject} title="New project" className="rounded p-1 text-muted hover:bg-panel2 hover:text-ink"><Plus size={14} /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
              {projects.length === 0 && <p className="px-2 py-1.5 text-[11px] leading-relaxed text-faint">No project yet. Ask for code in the chat and the agent creates one with its own name, or press + to make one.</p>}
              {projects.map((p) => (
                <div
                  key={p.id}
                  onClick={() => openProject(p.id)}
                  className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${wsId === p.id ? "bg-panel2 text-ink" : "text-muted hover:bg-panel2/60 hover:text-ink"}`}
                >
                  <Folder size={14} className={wsId === p.id ? "text-gold" : ""} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.running && <span title="Working" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />}
                  <button onClick={(e) => { e.stopPropagation(); void renameProject(p); }} title="Rename" className="hidden shrink-0 text-faint hover:text-ink group-hover:block"><Pencil size={12} /></button>
                  {!p.running && <button onClick={(e) => { e.stopPropagation(); void deleteProject(p); }} title="Remove from list" className="hidden shrink-0 text-faint hover:text-red-300 group-hover:block"><Trash2 size={12} /></button>}
                </div>
              ))}
            </div>
          </>
        )}
        {repo && <p className="px-4 pb-2 text-[11px] text-avatar-teal">Repo: {repo.owner}/{repo.name} · {repo.branch}</p>}
        <p className="mt-auto px-4 pb-4 text-[11px] leading-relaxed text-faint">One chat can hold many projects. Ask for code in the chat — the agent picks or creates the right project and this page shows the work live. It runs inside the computer, so it keeps working even if you close this tab.</p>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1">
        {!chat ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Create a chat first.</div>
        ) : (
          <>
            <section className="m-3 mr-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-[#12141a] font-mono text-[13px] shadow-2xl">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-2 text-xs text-muted">✳ Venus Code — {proj?.name ?? chat.agentName}</span>
                {proj?.runnerJob && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">background runner · keeps going if you close this tab</span>}
                {proj?.running && <button onClick={() => user && wsId && setStop(user.uid, wsId, true)} className="ml-auto flex items-center gap-1.5 rounded bg-red-500 px-2.5 py-1 text-xs text-white"><Square size={11} /> Stop</button>}
              </div>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
                <div className="rounded-lg border border-gold/60 p-3">
                  <p className="-mt-5 mb-2 w-fit bg-[#12141a] px-2 text-xs text-gold">Venus Code v3</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col items-center gap-1.5 text-center">
                      <p className="font-semibold text-ink">Welcome back!</p>
                      <BotAvatar color={chat.agentColor} size={56} />
                      <p className="text-xs text-muted">{chat.agentName}</p>
                      <p className="text-xs text-faint">{chat.model} · your API key</p>
                      <p className="text-xs text-faint">~/work/{wsId ?? chat.id}</p>
                    </div>
                    <div className="space-y-2 text-xs md:border-l md:border-line md:pl-4">
                      <p className="font-semibold text-gold">How to use</p>
                      <p className="text-muted">Just ask in the chat — for example <b className="text-ink">build me a landing page</b>, or <b className="text-ink">/clone owner/name</b> to bring a GitHub repo here and <b className="text-ink">push all changes</b> when you are done.</p>
                      <p className="border-t border-line pt-2 font-semibold text-gold">Recent activity</p>
                      <p className="whitespace-pre-wrap text-muted">{proj?.ctx ? proj.ctx.trim().split("\n").slice(-3).join("\n") : "No recent activity"}</p>
                    </div>
                  </div>
                </div>
                {proj?.todo && <pre className="whitespace-pre-wrap rounded-md border border-line bg-black/20 px-3 py-2 text-[12px] leading-5 text-muted">{proj.todo}</pre>}
                {shown.map((e, i) => (
                  <div key={i} style={{ marginLeft: (e.depth ?? 0) * 18 }}>
                    {e.kind === "user" && <div className="bg-white/5 px-2 py-1 text-ink"><span className="text-faint">❯ </span>{e.text}</div>}
                    {e.kind === "thought" && <div className="flex gap-2"><span className="text-ink">●</span><span className="whitespace-pre-wrap text-ink">{e.text}</span></div>}
                    {e.kind === "tool" && (() => { const [n, a] = fmtTool(e.text); return <div className="flex gap-2"><span className="text-avatar-teal">●</span><span className="min-w-0 break-words text-ink"><b>{n}</b>(<span className="text-muted">{a}</span>)</span></div>; })()}
                    {e.kind === "result" && <div className="flex gap-2 pl-1 text-muted"><span>⎿</span><span className="line-clamp-3 whitespace-pre-wrap">{e.text}</span></div>}
                    {e.kind === "diff" && e.lines && <div className="rounded-md border border-line"><p className="px-3 py-1.5 text-[12px] text-indigo-200">{e.text === "write" ? "Create file" : "Update"} {e.path}</p><DiffBox lines={e.lines} /></div>}
                    {e.kind === "checkpoint" && <p className="pl-1 text-[11px] text-avatar-teal">✓ checkpoint {e.text}</p>}
                    {e.kind === "info" && <p className="text-xs text-muted">{e.text}</p>}
                    {e.kind === "error" && <p className="text-red-300">⚠ {e.text}</p>}
                    {e.kind === "done" && <div className="rounded-lg border border-line bg-panel2 px-4 py-3 font-sans text-sm text-ink"><Markdown text={e.text} /></div>}
                  </div>
                ))}
                {proj?.running && <p className="text-xs text-gold">✻ working…</p>}
                <div ref={endRef} />
              </div>
              <div className="border-t border-line px-4 py-2 text-[11px] text-faint">Operated from the chat — there is no command box here.</div>
            </section>

            <aside className="flex w-[46%] min-w-[340px] flex-col p-3">
              <div className="flex gap-1 pb-2">
                {(["preview", "files", "terminal", "checkpoints", "repo"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 text-xs capitalize ${tab === t ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>{t}</button>)}
                <button onClick={() => { refreshSide(); if (mode === "static") refreshPreview(); }} className="ml-auto text-muted hover:text-ink"><RefreshCw size={13} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel">
                {tab !== "repo" && !e2bKey && <p className="p-4 text-xs text-muted">Add your E2B key under API keys in the dashboard to see the computer.</p>}
                {tab !== "repo" && e2bKey && !sandboxId && <p className="p-4 text-xs text-muted">This chat has no computer yet. It starts automatically the first time you ask for code in the chat, or when you clone a repo (Repo tab).</p>}
                {sandboxId && tab === "preview" && (
                  <div className="flex h-full flex-col">
                    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs">
                      <span className="flex overflow-hidden rounded border border-line">
                        {(["static", "live"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={`px-2 py-0.5 ${mode === m ? "bg-panel2 text-ink" : "text-muted"}`}>{m === "static" ? "Instant" : "Live server"}</button>)}
                      </span>
                      {mode === "static" && page && page.files.length > 1 && <select value={entry || page.entry} onChange={(e) => { setEntry(e.target.value); refreshPreview(e.target.value); }} className="rounded border border-line bg-bg px-1.5 py-0.5 text-ink">{page.files.map((f) => <option key={f}>{f}</option>)}</select>}
                      {mode === "live" && (
                        <>
                          <button onClick={startLive} disabled={live.state === "starting"} className="rounded border border-line px-2 py-0.5 text-ink hover:bg-panel2 disabled:opacity-50">{live.state === "ready" ? "Restart" : live.state === "starting" ? "Starting…" : "Start server"}</button>
                          {live.state !== "idle" && <button onClick={stopLive} className="text-muted underline">Stop</button>}
                          {live.url && <a href={live.url} target="_blank" rel="noreferrer" className="text-gold underline">Open in new tab</a>}
                        </>
                      )}
                      <span className="ml-auto flex gap-1">{(["desktop", "tablet", "mobile"] as const).map((d) => <button key={d} onClick={() => setDevice(d)} className={`rounded px-1.5 py-0.5 ${device === d ? "bg-panel2 text-ink" : "text-muted"}`}>{d === "desktop" ? "🖥" : d === "tablet" ? "▭" : "📱"}</button>)}</span>
                    </div>
                    <div className={full ? "fixed inset-0 z-50 overflow-auto bg-[#0b0c10] p-3" : "relative min-h-0 flex-1 overflow-auto bg-[#0b0c10] p-2"}>
                      <button onClick={() => setFull((v) => !v)} title={full ? "Exit fullscreen" : "Fullscreen preview"} className="absolute right-3 top-3 z-10 rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80">{full ? <X size={15} /> : <Maximize2 size={15} />}</button>
                      {mode === "static" ? (
                        page?.html ? (
                          <iframe ref={frameRef} key={page.entry + ":" + hash(page.html)} sandbox="allow-scripts allow-forms allow-popups" srcDoc={page.html} title="Preview" style={{ width: devW ?? "100%", maxWidth: "100%" }} className={frameCls} />
                        ) : (
                          <div className="mx-auto mt-10 max-w-xs space-y-3 text-center text-xs text-muted">
                            <p>{err || "No HTML page yet. Ask the agent in the chat to build a website — it shows up here instantly."}</p>
                            {page?.hasPackage && <button onClick={() => { setMode("live"); startLive(); }} className="rounded-md border border-line px-3 py-1.5 text-ink hover:bg-panel2">This looks like an app — start the live server</button>}
                          </div>
                        )
                      ) : live.state === "ready" && live.url ? (
                        <iframe key={live.url} src={live.url} sandbox="allow-scripts allow-forms allow-popups allow-same-origin" title="Live preview" style={{ width: devW ?? "100%", maxWidth: "100%" }} className={frameCls} />
                      ) : (
                        <div className="mx-auto mt-10 max-w-sm space-y-2 text-center text-xs text-muted">
                          <p>{live.state === "starting" ? "Starting the dev server… the first start can take a minute (it installs packages)." : live.state === "failed" ? "The server did not start. Last output:" : "Runs your project on port 3000 inside the computer (Next.js, Vite, npm dev, or a static server)."}</p>
                          {live.log && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-left font-mono text-[10px] text-faint">{live.log}</pre>}
                          {live.state === "idle" && <button onClick={startLive} className="rounded-md bg-white px-3 py-1.5 font-medium text-bg">Start live server</button>}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {sandboxId && tab === "files" && (
                  <div className="flex h-full flex-col">
                    <div className="max-h-[40%] overflow-y-auto border-b border-line p-2">
                      {tree.length === 0 && <p className="p-2 text-xs text-faint">No files yet.</p>}
                      {tree.map((f) => <button key={f} onClick={() => openFile(f)} style={{ paddingLeft: 6 + (f.split("/").length - 1) * 10 }} className={`flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left font-mono text-[11px] hover:bg-panel2 ${file?.path === f ? "bg-panel2 text-gold" : "text-muted"}`}><FileIcon size={11} />{f}</button>)}
                    </div>
                    {file && <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-ink">{file.content}</pre>}
                  </div>
                )}
                {sandboxId && tab === "terminal" && (
                  <div className="h-full space-y-3 overflow-y-auto p-3 font-mono text-[11px] text-muted">
                    {term.length === 0 && <p className="text-faint">Command output appears here.</p>}
                    {term.slice(-30).map((e, i) => <pre key={i} className="whitespace-pre-wrap break-words">{e.text}</pre>)}
                  </div>
                )}
                {sandboxId && tab === "checkpoints" && (
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
                {tab === "repo" && wsId && wsId !== chatId && (
                  <div className="h-full space-y-2 overflow-y-auto p-3 text-xs text-muted">
                    <p>GitHub clone and push work on this chat&apos;s main workspace (~/work/{chatId}).</p>
                    {projects.some((p) => p.id === chatId) && <button onClick={() => openProject(chatId as string)} className="rounded-md border border-line px-3 py-1.5 text-ink hover:bg-panel2">Open the main project: {projects.find((p) => p.id === chatId)?.name}</button>}
                  </div>
                )}
                {tab === "repo" && (!wsId || wsId === chatId) && (
                  <div className="h-full space-y-3 overflow-y-auto p-3 text-xs">
                    <p className={repo ? "text-avatar-teal" : "text-muted"}>{repo ? `Cloned here: ${repo.owner}/${repo.name} · branch ${repo.branch}` : "No repository is cloned in this workspace yet."}</p>

                    <div className="space-y-2 rounded-lg border border-line p-3">
                      <p className="font-medium text-ink">Clone a GitHub repository</p>
                      <input className={inp} placeholder="owner/name or https://github.com/owner/name" value={repoIn} onChange={(e) => setRepoIn(e.target.value)} />
                      <input className={inp} placeholder="Branch (optional)" value={repoBranch} onChange={(e) => setRepoBranch(e.target.value)} />
                      <button onClick={doClone} disabled={!repoIn.trim() || repoBusy !== null} className="rounded-md bg-white px-3 py-1.5 font-medium text-bg disabled:opacity-40">{repoBusy === "clone" ? "Cloning…" : "Clone into this workspace"}</button>
                      <p className="text-[11px] leading-relaxed text-faint">Private repos use the GitHub token from Connectors. An older workspace is kept as a backup folder. The files show up under Files, and the agent can work on them.</p>
                    </div>

                    <div className="space-y-2 rounded-lg border border-line p-3">
                      <p className="font-medium text-ink">Push all changes</p>
                      <input className={inp} placeholder="Commit message (optional)" value={pushMsg} onChange={(e) => setPushMsg(e.target.value)} />
                      <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={pushDirect} onChange={(e) => setPushDirect(e.target.checked)} /> Push straight to the current branch (even main). Default: a new branch venus/changes-…</label>
                      <div className="flex gap-2">
                        <button onClick={doPush} disabled={!repo || repoBusy !== null} className="rounded-md bg-white px-3 py-1.5 font-medium text-bg disabled:opacity-40">{repoBusy === "push" ? "Pushing…" : "Push all changes"}</button>
                        <button onClick={doStatus} disabled={!repo || repoBusy !== null} className="rounded-md border border-line px-3 py-1.5 text-ink hover:bg-panel2 disabled:opacity-40">{repoBusy === "status" ? "Checking…" : "Status"}</button>
                      </div>
                    </div>

                    {repoOut && (
                      <div className={`rounded-lg border p-3 ${repoOut.ok ? "border-avatar-teal/40 text-ink" : "border-red-900/60 bg-red-950/30 text-red-200"}`}>
                        <p className="whitespace-pre-wrap break-words">{repoOut.text}</p>
                        {repoOut.links?.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="mt-1 block text-gold underline">{l.label}</a>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </main>
    </div>
  );
}
