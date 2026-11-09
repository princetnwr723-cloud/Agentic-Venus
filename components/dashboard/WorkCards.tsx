"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { CheckCircle2, Code2, Download, Film, Loader2, Maximize2, Monitor, MousePointer2, PlayCircle, Eye, X, AlertTriangle } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { touch } from "@/lib/computers";
import { freshLink, startDownload } from "@/lib/chat-files";

/* ------------------------------------------------------------------ */
/* small shared pieces                                                 */
/* ------------------------------------------------------------------ */

function Shell({ icon, tone, title, sub, badge, children }: { icon: React.ReactNode; tone: string; title: string; sub: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-panel2 shadow-panel">
      <div className="flex items-center gap-3 px-3.5 pb-2.5 pt-3.5">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${tone}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <p className="truncate text-xs text-muted">{sub}</p>
        </div>
        {badge}
      </div>
      <div className="px-3 pb-3">{children}</div>
    </div>
  );
}

const Pill = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <span className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>{children}</span>
);

const BigButton = ({ onClick, children, href }: { onClick?: () => void; children: React.ReactNode; href?: string }) => {
  const cls = "mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-bg px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-panel";
  return href ? <Link href={href} className={cls}>{children}</Link> : <button type="button" onClick={onClick} className={cls}>{children}</button>;
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** A full-screen window over the chat. Esc or the X closes it. */
function Overlay({ title, onClose, right, children }: { title: string; onClose: () => void; right?: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/85 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 py-3 text-sm text-white">
        <p className="min-w-0 flex-1 truncate font-medium">{title}</p>
        {right}
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"><X size={18} /></button>
      </div>
      <div className="min-h-0 flex-1 px-3 pb-3">{children}</div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* 1. The computer, LIVE: appears the moment a computer task starts    */
/* ------------------------------------------------------------------ */

type PcJob = { running?: boolean; task?: string; startedAt?: number; job?: { id?: string; sandboxId?: string } };

const viewSrc = (url: string, control: boolean) => {
  try { const u = new URL(url); if (control) u.searchParams.delete("view_only"); else u.searchParams.set("view_only", "true"); return u.toString(); } catch { return url; }
};

/** Shown at the bottom of the chat while this chat's computer is working; it goes away by itself when the task ends (the finished replay card is in the reply). */
export function LiveComputerCard({ chatId, agentName }: { chatId: string; agentName?: string }) {
  const { user } = useAuth();
  const { e2bKey } = useKeys();
  const [job, setJob] = useState<PcJob | null>(null);
  const [screen, setScreen] = useState("");
  const [err, setErr] = useState("");
  const [full, setFull] = useState(false);
  const [control, setControl] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid, "pcJobs", chatId), (s) => setJob(s.exists() ? (s.data() as PcJob) : null), () => setJob(null));
  }, [user, chatId]);

  const sandboxId = job?.job?.sandboxId ?? "";
  const active = Boolean(job?.running && job.job && sandboxId && Date.now() - (job.startedAt ?? Date.now()) < 3 * 3600_000);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    if (!active || !e2bKey || !sandboxId) { setScreen(""); return; }
    let dead = false;
    setErr("");
    (async () => {
      try {
        const res = await fetch("/api/e2b/screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: e2bKey, sandboxId }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d?.url) throw new Error(d?.error || "Could not open the computer's screen.");
        if (!dead) setScreen(String(d.url));
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : "Could not open the computer's screen."); }
    })();
    return () => { dead = true; };
  }, [active, e2bKey, sandboxId]);

  if (!active) return null;
  const who = agentName ? `${agentName}'s computer` : "Computer";
  const task = (job?.task ?? "Working on your task").replace(/\s+/g, " ").slice(0, 110);

  return (
    <div className="flex justify-start">
      <Shell
        icon={<Monitor size={20} />} tone="bg-[#1D4ED8]" title={who} sub={task}
        badge={<Pill tone="border-red-400/40 bg-red-400/10 text-red-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />Live · {mmss(now - (job?.startedAt ?? now))}</Pill>}
      >
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-line bg-bg">
          {screen ? (
            <>
              <iframe key={screen} src={viewSrc(screen, false)} title="Computer screen" className="pointer-events-none h-full w-full border-0" />
              <button type="button" onClick={() => setFull(true)} aria-label="Open the computer" className="absolute inset-0 cursor-zoom-in" />
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted">
              {err ? <><AlertTriangle size={18} className="text-avatar-amber" /><span>{err}</span></> : <><Loader2 size={18} className="animate-spin" /><span>Opening the screen…</span></>}
            </div>
          )}
        </div>
        <BigButton onClick={() => setFull(true)}><Maximize2 size={15} /> Open computer</BigButton>
      </Shell>

      {full && screen && (
        <Overlay
          title={`${who} · ${task}`} onClose={() => { setFull(false); setControl(false); }}
          right={
            <button type="button" onClick={() => setControl((v) => !v)} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20">
              {control ? <><Eye size={14} /> View only</> : <><MousePointer2 size={14} /> Take control</>}
            </button>
          }
        >
          <iframe key={viewSrc(screen, control)} src={viewSrc(screen, control)} title="Computer screen" allow="clipboard-read; clipboard-write" className="h-full w-full rounded-xl border-0 bg-black" />
        </Overlay>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. A finished computer task: the replay of what the computer did    */
/* ------------------------------------------------------------------ */

function useLink(path: string, download?: string) {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!user) return;
    let dead = false;
    freshLink(user.uid, path, download).then((u) => { if (!dead) setUrl(u); }).catch((e) => { if (!dead) setErr(e instanceof Error ? e.message : "Could not open the file."); });
    return () => { dead = true; };
  }, [user, path, download]);
  return { url, err, user };
}

export function ReplayCard({ path }: { path: string }) {
  const { url, err, user } = useLink(path);
  const [full, setFull] = useState(false);
  async function save() { if (!user) return; try { startDownload(await freshLink(user.uid, path, "computer-replay.mp4"), "computer-replay.mp4"); } catch { /* the card already shows errors */ } }
  return (
    <Shell icon={<Monitor size={20} />} tone="bg-[#1D4ED8]" title="Computer" sub="What the computer did, recorded" badge={<Pill tone="border-avatar-teal/40 bg-avatar-teal/10 text-avatar-teal"><CheckCircle2 size={11} />Finished</Pill>}>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-line bg-black">
        {url ? (
          <video src={`${url}#t=0.3`} controls playsInline preload="metadata" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted">{err ? err : <Loader2 size={18} className="animate-spin" />}</div>
        )}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setFull(true)} disabled={!url} className="flex items-center justify-center gap-2 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm font-medium text-ink hover:bg-panel disabled:opacity-40"><PlayCircle size={15} /> Watch big</button>
        <button type="button" onClick={() => void save()} className="flex items-center justify-center gap-2 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm font-medium text-ink hover:bg-panel"><Download size={15} /> Download</button>
      </div>
      {full && url && (
        <Overlay title="Computer replay" onClose={() => setFull(false)}>
          <video src={url} controls autoPlay playsInline className="h-full w-full rounded-xl bg-black object-contain" />
        </Overlay>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Venus Pro: the finished video                                    */
/* ------------------------------------------------------------------ */

export function VideoCard({ path, projectId, title }: { path: string; projectId: string; title: string }) {
  const { url, err, user } = useLink(path);
  const [full, setFull] = useState(false);
  const name = `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 50) || "venus-video"}.mp4`;
  async function save() { if (!user) return; try { startDownload(await freshLink(user.uid, path, name), name); } catch { /* the card already shows errors */ } }
  return (
    <Shell icon={<Film size={20} />} tone="bg-[#7C3AED]" title="Venus Pro" sub={title} badge={<Pill tone="border-avatar-teal/40 bg-avatar-teal/10 text-avatar-teal"><CheckCircle2 size={11} />Ready</Pill>}>
      <div className="relative w-full overflow-hidden rounded-xl border border-line bg-black">
        {url ? (
          <video src={`${url}#t=0.3`} controls playsInline preload="metadata" className="max-h-[420px] w-full object-contain" />
        ) : (
          <div className="flex aspect-video items-center justify-center px-6 text-center text-xs text-muted">{err ? err : <Loader2 size={18} className="animate-spin" />}</div>
        )}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setFull(true)} disabled={!url} className="flex items-center justify-center gap-2 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm font-medium text-ink hover:bg-panel disabled:opacity-40"><Maximize2 size={15} /> Full screen</button>
        <button type="button" onClick={() => void save()} className="flex items-center justify-center gap-2 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm font-medium text-ink hover:bg-panel"><Download size={15} /> Download</button>
      </div>
      <BigButton href={`/venus?project=${encodeURIComponent(projectId)}`}><Film size={15} /> Open &amp; edit in Venus Pro</BigButton>
      {full && url && (
        <Overlay title={title} onClose={() => setFull(false)}>
          <video src={url} controls autoPlay playsInline className="h-full w-full rounded-xl bg-black object-contain" />
        </Overlay>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Venus Code: the finished app, running in a preview               */
/* ------------------------------------------------------------------ */

type Preview = { state: "idle" | "loading" | "ready" | "none" | "error"; html: string; note: string };

export function CodeCard({ chatId, status, fresh }: { chatId: string; status: "finished" | "stopped"; fresh: boolean }) {
  const { user } = useAuth();
  const { e2bKey } = useKeys();
  const [pv, setPv] = useState<Preview>({ state: "idle", html: "", note: "" });
  const [full, setFull] = useState(false);

  async function load() {
    if (!user || !e2bKey) { setPv({ state: "error", html: "", note: "Add your computer key first, then the preview can open." }); return; }
    setPv({ state: "loading", html: "", note: "" });
    try {
      const snap = await getDoc(doc(db, "users", user.uid, "chats", chatId));
      const c = (snap.data() ?? {}) as { computers?: Record<string, string>; pcSandboxId?: string | null; codeWs?: string | null };
      const sandboxId = c.computers?.code ?? c.pcSandboxId ?? "";
      const ws = c.codeWs || chatId;
      if (!sandboxId) { setPv({ state: "none", html: "", note: "The code computer is not available any more. Open the Code page." }); return; }
      const res = await fetch("/api/code/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "html", uid: user.uid, e2bKey, sandboxId, ws }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Preview failed.");
      touch(sandboxId, e2bKey);
      if (!d?.html) setPv({ state: "none", html: "", note: d?.hasPackage ? "This is an app that runs on a server, so there is no instant picture. Open the Code page to run it." : "No web page to show yet. Open the Code page to see the files." });
      else setPv({ state: "ready", html: String(d.html), note: "" });
    } catch (e) { setPv({ state: "error", html: "", note: e instanceof Error ? e.message : "Preview failed." }); }
  }

  // a project that has just finished opens its preview by itself; old ones wait for a tap (so no computer is woken for nothing)
  useEffect(() => { if (fresh && user && e2bKey && pv.state === "idle") void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fresh, user, e2bKey]);

  const ok = status === "finished";
  const frame = useMemo(() => pv.html, [pv.html]);
  return (
    <Shell
      icon={<Code2 size={20} />} tone="bg-[#0F766E]" title="Venus Code" sub={ok ? "Your project is ready" : "Stopped before the end"}
      badge={ok ? <Pill tone="border-avatar-teal/40 bg-avatar-teal/10 text-avatar-teal"><CheckCircle2 size={11} />Finished</Pill> : <Pill tone="border-avatar-amber/40 bg-avatar-amber/10 text-avatar-amber"><AlertTriangle size={11} />Stopped</Pill>}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-line bg-white">
        {pv.state === "ready" ? (
          <>
            <iframe srcDoc={frame} sandbox="allow-scripts allow-forms allow-popups" title="Project preview" className="pointer-events-none absolute left-0 top-0 border-0" style={{ width: "200%", height: "200%", transform: "scale(0.5)", transformOrigin: "top left" }} />
            <button type="button" onClick={() => setFull(true)} aria-label="Open the preview" className="absolute inset-0 cursor-zoom-in" />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2.5 bg-bg px-6 text-center text-xs text-muted">
            {pv.state === "loading" ? <><Loader2 size={18} className="animate-spin" /><span>Opening the preview…</span></> : (
              <>
                {pv.note && <span>{pv.note}</span>}
                {(pv.state === "idle" || pv.state === "error") && (
                  <button type="button" onClick={() => void load()} className="rounded-full border border-line bg-panel px-4 py-1.5 text-xs font-medium text-ink hover:bg-panel2">{pv.state === "error" ? "Try again" : "Show preview"}</button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setFull(true)} disabled={pv.state !== "ready"} className="flex items-center justify-center gap-2 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm font-medium text-ink hover:bg-panel disabled:opacity-40"><Maximize2 size={15} /> Full screen</button>
        <Link href={`/code?chat=${encodeURIComponent(chatId)}`} className="flex items-center justify-center gap-2 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm font-medium text-ink hover:bg-panel"><Code2 size={15} /> Code page</Link>
      </div>
      {full && pv.state === "ready" && (
        <Overlay title="Venus Code preview" onClose={() => setFull(false)}>
          <iframe srcDoc={frame} sandbox="allow-scripts allow-forms allow-popups" title="Project preview" className="h-full w-full rounded-xl border-0 bg-white" />
        </Overlay>
      )}
    </Shell>
  );
}
