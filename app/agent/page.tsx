"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { createChat } from "@/lib/chats";
import { agentApi, usd, watchRuns, type RunView } from "@/lib/agent/client";

export default function AgentPage() {
  const { user, loading } = useAuth();
  const { apiKeys } = useKeys();
  const router = useRouter();
  const ready = useMemo(() => PROVIDERS.filter((p) => apiKeys[p.id]), [apiKeys]);
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [model, setModel] = useState("");
  const [task, setTask] = useState("");
  const [runs, setRuns] = useState<RunView[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);
  useEffect(() => { if (user) return watchRuns(user.uid, setRuns); }, [user]);
  useEffect(() => { if (ready.length && !ready.some((p) => p.id === provider)) setProvider(ready[0].id); }, [ready, provider]);
  useEffect(() => { setModel(PROVIDERS.find((p) => p.id === provider)?.models[0] ?? ""); }, [provider]);

  if (!user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;
  const meta = PROVIDERS.find((p) => p.id === provider);

  async function start() {
    if (!user || !task.trim()) return;
    setBusy(true); setErr("");
    try {
      const chat = await createChat(user.uid, { agentName: "Agent", agentColor: "teal", provider, model });
      const fallbacks = ready.filter((p) => p.id !== provider).slice(0, 2).map((p) => ({ provider: p.id, model: p.models[0], apiKey: apiKeys[p.id] }));
      const d = await agentApi<{ runId: string }>(user.uid, { action: "start", chatId: chat.id, task, provider, model, apiKey: apiKeys[provider] ?? "", fallbacks });
      setTask(""); setOpen(d.runId);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not start."); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <button onClick={() => router.push("/dashboard")} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-ink"><ArrowLeft size={14} /> Dashboard</button>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink"><Bot size={20} className="text-gold" /> Background agent</h1>
        <p className="mt-1 text-sm text-muted">Runs on the server. Close the tab, switch device — it keeps going, and asks you here when it needs an answer, an approval or a secret.</p>

        <div className="mt-5 rounded-lg border border-line bg-panel p-3">
          <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={3} placeholder="What should the agent do?" className="w-full resize-none rounded-md border border-line bg-bg p-2 text-sm text-ink" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-xs text-ink">
              {(ready.length ? ready : PROVIDERS).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <input list="agent-models" value={model} onChange={(e) => setModel(e.target.value)} className="min-w-[10rem] flex-1 rounded-md border border-line bg-bg px-2 py-1.5 text-xs text-ink" />
            <datalist id="agent-models">{meta?.models.map((m) => <option key={m} value={m} />)}</datalist>
            <button disabled={busy || !task.trim() || !apiKeys[provider]} onClick={start} className="rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50">{busy ? "Starting…" : "Start"}</button>
          </div>
          {!apiKeys[provider] && <div className="mt-2 text-xs text-faint">Add a key for this provider in Settings first.</div>}
          {err && <div className="mt-2 text-xs text-red-400">{err}</div>}
        </div>

        <div className="mt-6 space-y-2">
          {runs.length === 0 && <p className="text-xs text-faint">No background tasks yet.</p>}
          {runs.map((r) => (
            <div key={r.id}>
              <div className="flex w-full items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-2.5 text-left">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.task}</span>
                <span className="text-[11px] text-faint">{r.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
