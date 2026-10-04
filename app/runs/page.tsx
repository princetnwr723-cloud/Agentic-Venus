"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { estimateCost, listTraces, type Trace } from "@/lib/trace";

const dot: Record<Trace["status"], string> = {
  running: "bg-gold", done: "bg-avatar-teal", error: "bg-red-400", stopped: "bg-faint",
};
const secs = (a: number, b?: number) => (b ? Math.max(1, Math.round((b - a) / 1000)) + "s" : "…");

export default function RunsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);
  useEffect(() => { if (user) listTraces(user.uid).then(setTraces).catch(() => {}); }, [user]);

  if (!user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;
  const total = traces.reduce((n, t) => n + estimateCost(t.usage), 0);

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <button onClick={() => router.push("/dashboard")} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-ink"><ArrowLeft size={14} /> Dashboard</button>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink"><Activity size={20} className="text-gold" /> Runs</h1>
        <p className="mt-1 text-sm text-muted">Every agent run, step by step. Cost is an estimate from text size and list prices (last {traces.length} runs ≈ ${total.toFixed(3)}).</p>
        <div className="mt-6 space-y-2">
          {traces.length === 0 && <p className="text-xs text-faint">No runs yet — give a chat&apos;s computer a task.</p>}
          {traces.map((t) => (
            <div key={t.id} className="rounded-lg border border-line bg-panel">
              <button onClick={() => setOpen(open === t.id ? null : t.id)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dot[t.status]}`} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.title}</span>
                <span className="text-[11px] text-faint">{t.kind} · {secs(t.startedAt, t.endedAt)} · ~${estimateCost(t.usage).toFixed(3)}</span>
              </button>
              {open === t.id && (
                <div className="space-y-1 border-t border-line p-3 text-[12px] leading-relaxed">
                  <p className="text-faint">Models: {Object.keys(t.usage).join(", ") || "—"}</p>
                  {t.events.map((e, i) => (
                    <p key={i} className={e.kind === "verify" ? "text-gold" : "text-muted"}>
                      <span className="mr-2 font-mono text-faint">+{Math.round((e.t - t.startedAt) / 1000)}s</span>{e.text}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}