"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, File as FileIcon, RefreshCw, RotateCcw, Square } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import Markdown from "@/components/Markdown";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { listChats, type Chat } from "@/lib/chats";
import { setStop, watchCodeProject, type CodeProject } from "@/lib/code-store";
import { wsCall, type CodeEnv } from "@/lib/code-agent";

const fmtTool = (t: string): [string, string] => {
  if (t.startsWith("$ ")) return ["Bash", t.slice(2)];
  const i = t.indexOf(" ");
  const n = i < 0 ? t : t.slice(0, i);
  return [n.charAt(0).toUpperCase() + n.slice(1), i < 0 ? "" : t.slice(i + 1)];
};

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

export default function CodePage() {
  const { user, loading } = useAuth();
  const { apiKeys, e2bKey } = useKeys();
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [proj, setProj] = useState<CodeProject | null>(null);
  const [tab, setTab] = useState<"preview" | "files" | "terminal" | "checkpoints">("preview");
  const [tree, setTree] = useState<string[]>([]);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [checks, setChecks] = useState<Array<{ sha: string; when: string; msg: string }>>([]);
  const [page, setPage] = useState<{ html: string; entry: string; files: string[] } | null>(null);
  const [entry, setEntry] = useState("");
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [zipUrl, setZipUrl] = useState("");
  const [err, setErr] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const chat = chats.find((c) => c.id === chatId) ?? null;
  const sandboxId = chat?.pcSandboxId ?? null;

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);
  useEffect(() => {
    if (!user) return;
    listChats(user.uid).then((l) => {
      setChats(l);
      const want = new URLSearchParams(window.location.search).get("chat");
      setChatId(want && l.some((c) => c.id === want) ? want : l.find((c) => c.pcSandboxId)?.id ?? l[0]?.id ?? null);
    });
  }, [user]);
  useEffect(() => {
    if (!user || !chatId) return;
    setProj(null); setTree([]); setFile(null); setChecks([]); setPage(null); setEntry(""); setZipUrl("");
    return watchCodeProject(user.uid, chatId, setProj);
  }, [user, chatId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [proj?.log?.length]);

  const env = (): CodeEnv | null =>
    user && chat && e2bKey ? { uid: user.uid, token: () => user.getIdToken(), e2bKey, apiKeys, provider: chat.provider, model: chat.model, chatId: chat.id, sandboxId: sandboxId ?? undefined } : null;

  async function refreshPreview(en = entry) {
    const e = env();
    if (!e || !sandboxId) return;
    try { const r = await wsCall(e, "htmlpreview", { sandboxId, ws: chatId, entry: en || undefined }); setPage(r); setErr(""); } catch (x) { setErr(x instanceof Error ? x.message : "Preview failed."); }
  }
  async function refreshSide() {
    const e = env();
    if (!e || !sandboxId) return;
    try {
      setTree(((await wsCall(e, "tree", { sandboxId, ws: chatId })).files ?? []) as string[]);
      setChecks(((await wsCall(e, "checkpoints", { sandboxId, ws: chatId })).items ?? []) as Array<{ sha: string; when: string; msg: string }>);
    } catch { /* computer may be off */ }
  }

  // live: refresh whenever the agent saved something new (and every 6s while it works)
  useEffect(() => {
    if (!sandboxId || !chatId) return;
    if (tab === "preview") refreshPreview();
    if (tab === "files" || tab === "checkpoints") refreshSide();
    if (!proj?.running) return;
    const iv = setInterval(() => { if (tab === "preview") refreshPreview(); else refreshSide(); }, 6000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sandboxId, chatId, proj?.running, proj?.log?.length && (proj.log[proj.log.length - 1]?.kind === "checkpoint")]);

  async function openFile(path: string) {
    const e = env();
    if (!e || !sandboxId) return;
    setFile({ path, content: (await wsCall(e, "readfile", { sandboxId, ws: chatId, path })).content });
  }
  async function restore(sha: string) {
    const e = env();
    if (!e || !sandboxId || !window.confirm("Restore the codespace to this checkpoint? Later changes will be discarded.")) return;
    await wsCall(e, "restore", { sandboxId, ws: chatId, sha });
    refreshSide(); refreshPreview();
  }
  async function zip() {
    const e = env();
    if (!e || !sandboxId) return;
    setZipUrl((await wsCall(e, "backup", { sandboxId, ws: chatId })).url);
  }

  if (!user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;

  const log = proj?.log ?? [];
  const shown = log.filter((e) => e.kind !== "term");
  const term = log.filter((e) => e.kind === "term");
  const devW = device === "mobile" ? 390 : device === "tablet" ? 768 : undefined;

  return (
    <div className="flex h-screen bg-bg">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center justify-between px-4 py-4">
          <span className="text-sm font-medium text-ink">Venus Code</span>
          <button onClick={() => router.push("/dashboard")} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><ArrowLeft size={16} /></button>
        </div>
        <p className="px-4 pb-2 text-[11px] leading-relaxed text-faint">Each chat has ONE codespace. You operate it from the chat (<code className="text-gold">/code …</code>) — this page just shows the work live.</p>
        <nav className="min-h-0 flex-1 overflow-y-auto">
          {chats.map((c) => (
            <button key={c.id} onClick={() => setChatId(c.id)} className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left ${c.id === chatId ? "bg-panel2" : "hover:bg-panel2/60"}`}>
              <BotAvatar color={c.agentColor} size={22} />
              <span className="min-w-0"><span className="block truncate text-sm text-ink">{c.agentName}</span><span className="block text-[10px] text-faint">{c.pcSandboxId ? "computer ready" : "no computer"}</span></span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1">
        {!chat ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Create a chat first.</div>
        ) : (
          <>
            <section className="m-3 mr-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-[#12141a] font-mono text-[13px] shadow-2xl">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-2 text-xs text-muted">✳ Venus Code — {chat.agentName}</span>
                {proj?.running && <button onClick={() => user && chatId && setStop(user.uid, chatId, true)} className="ml-auto flex items-center gap-1.5 rounded bg-red-500 px-2.5 py-1 text-xs text-white"><Square size={11} /> Stop</button>}
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
                      <p className="text-xs text-faint">~/work/{chat.id}</p>
                    </div>
                    <div className="space-y-2 text-xs md:border-l md:border-line md:pl-4">
                      <p className="font-semibold text-gold">How to use</p>
                      <p className="text-muted">Type <b className="text-ink">/code build me a landing page</b> in this chat, or just ask the agent to build something.</p>
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
                {(["preview", "files", "terminal", "checkpoints"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 text-xs capitalize ${tab === t ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>{t}</button>)}
                <button onClick={() => { refreshSide(); refreshPreview(); }} className="ml-auto text-muted hover:text-ink"><RefreshCw size={13} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel">
                {!sandboxId && <p className="p-4 text-xs text-muted">This chat has no computer yet. Turn it on with the monitor button in the chat — Venus Code works on that computer.</p>}
                {sandboxId && tab === "preview" && (
                  <div className="flex h-full flex-col">
                    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs">
                      <span className="text-ink">Instant HTML preview</span>
                      {page && page.files.length > 1 && <select value={entry || page.entry} onChange={(e) => { setEntry(e.target.value); refreshPreview(e.target.value); }} className="rounded border border-line bg-bg px-1.5 py-0.5 text-ink">{page.files.map((f) => <option key={f}>{f}</option>)}</select>}
                      <span className="ml-auto flex gap-1">{(["desktop", "tablet", "mobile"] as const).map((d) => <button key={d} onClick={() => setDevice(d)} className={`rounded px-1.5 py-0.5 ${device === d ? "bg-panel2 text-ink" : "text-muted"}`}>{d === "desktop" ? "🖥" : d === "tablet" ? "▭" : "📱"}</button>)}</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto bg-[#0b0c10] p-2">
                      {page?.html ? <iframe key={page.html.length} sandbox="allow-scripts allow-forms allow-popups" srcDoc={page.html} title="Preview" style={{ width: devW ?? "100%", maxWidth: "100%" }} className="mx-auto h-full min-h-[420px] rounded-md border border-line bg-white" />
                        : <p className="mx-auto mt-10 max-w-xs text-center text-xs text-muted">{err || "No HTML page yet. Ask the agent in the chat to build a website — it shows up here instantly."}</p>}
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
              </div>
            </aside>
          </>
        )}
      </main>
    </div>
  );
}