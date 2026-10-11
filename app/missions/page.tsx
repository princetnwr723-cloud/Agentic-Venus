"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleAlert, LoaderCircle, Rocket, Square } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listChats, type Chat } from "@/lib/chats";

type M = {
  id: string; goal: string; status: string; steps: number; maxSteps: number; calls: number; maxCalls: number; allowWrites: boolean;
  notes: string; log: Array<{ t: number; text: string }>; result: string; pending: { name: string; summary: string } | null; createdAt: number; updatedAt: number;
};

const box = "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none focus:border-ink/40";
const tone: Record<string, string> = { running: "text-gold", waiting_call: "text-sky-400", needs_approval: "text-orange-400", done: "text-emerald-500", error: "text-red-400", stopped: "text-muted" };
const label: Record<string, string> = { running: "Working", waiting_call: "On a call", needs_approval: "Needs your OK", done: "Done", error: "Problem", stopped: "Stopped" };

export default function MissionsPage() {
  const { user, loading } = useAuth();
  const [list, setList] = useState<M[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [maxCalls, setMaxCalls] = useState(0);
  const [allowWrites, setAllowWrites] = useState(false);
  const [chatId, setChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const api = useCallback(async (body: Record<string, unknown>) => {
    if (!user) throw new Error("Sign in karo.");
    const res = await fetch("/api/missions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (HTTP ${res.status}).`);
    return d;
  }, [user]);

  const refresh = useCallback(async () => { const d = await api({ action: "list" }); setList(d.missions ?? []); }, [api]);

  useEffect(() => {
    if (!user) return;
    listChats(user.uid).then((c) => { setChats(c); if (c[0]) setChatId(c[0].id); }).catch(() => {});
    refresh().catch((e) => setNote({ kind: "error", text: e.message }));
    const iv = setInterval(() => refresh().catch(() => {}), 4000);
    return () => clearInterval(iv);
  }, [user, refresh]);

  const start = async () => {
    if (!window.confirm(`Mission shuru karni hai?\n\n• Phone calls ki limit: ${maxCalls}\n• Sheets/messages likhna bina poochhe: ${allowWrites ? "HAAN" : "nahi (har baar poochega)"}\n\nSirf unhi ko call karwao jinki permission/consent ho.`)) return;
    setBusy(true); setNote(null);
    try {
      const d = await api({ action: "start", goal, maxCalls, allowWrites, chatId });
      setNote({ kind: "ok", text: `Mission shuru ho gayi (${d.id}). Report chat par aur connected apps par aayegi.` });
      setGoal(""); await refresh(); setOpen(d.id);
    } catch (e) { setNote({ kind: "error", text: e instanceof Error ? e.message : "Failed." }); }
    setBusy(false);
  };
  const act = async (action: string, id: string) => {
    try { await api({ action, id }); await refresh(); } catch (e) { setNote({ kind: "error", text: e instanceof Error ? e.message : "Failed." }); }
  };

  if (loading) return <main className="min-h-screen bg-bg p-8 text-ink">Loading…</main>;
  if (!user) return <main className="min-h-screen bg-bg p-8 text-ink"><Link href="/" className="text-sm text-muted">Sign in karo</Link></main>;
  const when = (n: number) => new Date(n).toLocaleString();

  return (
    <main className="min-h-screen bg-bg px-4 py-6 text-ink sm:px-8 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <Link href="/dashboard" className="mb-2 inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Dashboard</Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Rocket size={22} /> Missions</h1>
          <p className="mt-1 text-sm text-muted">Lambe multi-step kaam jo server pe chalte hain, tab band karne ke baad bhi. Jaise: leads dhundo → ek-ek ko call → Google Sheet update → summary WhatsApp pe.</p>
        </div>

        {note && <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${note.kind === "error" ? "border-red-500/30 bg-red-500/5 text-red-500" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-500"}`}>{note.kind === "error" ? <CircleAlert size={17} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0" />}<span>{note.text}</span></div>}

        <section className="space-y-3 rounded-2xl border border-line bg-panel p-5">
          <h2 className="font-semibold">Nayi mission</h2>
          <textarea className={`${box} h-28`} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Jaise: Delhi ke 15 dentists dhundo (website + phone verified), unhe call karke free consultation offer batao, jo book kare unhe 'Dental Leads' naam ki Google Sheet me likho (naam, phone, time), aur end me summary WhatsApp pe bhejo." />
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Agent (chat)</label><select className={box} value={chatId} onChange={(e) => setChatId(e.target.value)}>{chats.map((c) => <option key={c.id} value={c.id}>{c.agentName} · {c.model}</option>)}</select></div>
            <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Max phone calls</label><input className={box} type="number" min={0} max={50} value={maxCalls} onChange={(e) => setMaxCalls(Math.max(0, Math.min(50, Number(e.target.value) || 0)))} /></div>
            <label className="flex items-end gap-2 pb-2.5 text-sm"><input type="checkbox" checked={allowWrites} onChange={(e) => setAllowWrites(e.target.checked)} /> Sheets / messages bina poochhe likhne do</label>
          </div>
          <button onClick={start} disabled={busy || goal.trim().length < 10 || !chatId} className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-bg disabled:opacity-40">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Rocket size={15} />} Mission shuru karo</button>
          <p className="text-xs text-muted">Calls ke liye Voice page pe Twilio connected hona chahiye; Sheets ke liye Connectors me Google.</p>
        </section>

        <section className="space-y-2">
          {list.length === 0 && <p className="text-sm text-muted">Abhi koi mission nahi.</p>}
          {list.map((m) => (
            <div key={m.id} className="rounded-2xl border border-line bg-panel">
              <button onClick={() => setOpen(open === m.id ? null : m.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className={`w-28 shrink-0 text-xs font-medium ${tone[m.status] ?? "text-muted"}`}>{label[m.status] ?? m.status}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{m.goal}</span>
                <span className="shrink-0 text-xs text-muted">step {m.steps}/{m.maxSteps} · calls {m.calls}/{m.maxCalls}</span>
              </button>
              {open === m.id && (
                <div className="space-y-3 border-t border-line p-4 text-sm">
                  <p className="whitespace-pre-wrap text-muted">{m.goal}</p>
                  {m.pending && (
                    <div className="space-y-2 rounded-xl border border-orange-500/40 bg-orange-500/5 p-3">
                      <p className="text-xs font-semibold text-orange-400">Approval chahiye</p>
                      <p className="whitespace-pre-wrap break-words text-xs text-muted">{m.pending.summary}</p>
                      <div className="flex gap-2">
                        <button onClick={() => act("approve", m.id)} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-bg">Approve</button>
                        <button onClick={() => act("decline", m.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs">Decline</button>
                      </div>
                    </div>
                  )}
                  {m.result && <div className="whitespace-pre-wrap rounded-xl border border-line bg-bg p-3 text-xs">{m.result}</div>}
                  {m.notes && <details className="text-xs text-muted"><summary className="cursor-pointer">Agent ke notes</summary><pre className="mt-2 whitespace-pre-wrap">{m.notes}</pre></details>}
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line bg-bg p-3 font-mono text-[11px] text-muted">
                    {m.log.map((l, i) => <p key={i}><span className="mr-2 text-faint">{new Date(l.t).toLocaleTimeString()}</span>{l.text}</p>)}
                  </div>
                  <div className="flex items-center justify-between text-xs text-faint">
                    <span>Shuru: {when(m.createdAt)}</span>
                    {["running", "waiting_call", "needs_approval"].includes(m.status) && <button onClick={() => act("stop", m.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-red-400"><Square size={11} /> Stop</button>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}