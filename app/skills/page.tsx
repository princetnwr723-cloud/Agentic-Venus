"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Brain as BrainIcon, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { getModelPref } from "@/lib/model-pref";
import { PROVIDERS, providerMeta } from "@/lib/providers";
import {
  addMemory, deleteSkill, loadBrain, parseSkillMarkdown, removeMemory, saveSkill, skillFromText,
  type Brain,
} from "@/lib/brain";

const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";

export default function SkillsPage() {
  const { user, loading } = useAuth();
  const { apiKeys } = useKeys();
  const router = useRouter();
  const [brain, setBrain] = useState<Brain>({ memories: [], skills: [] });
  const [mem, setMem] = useState("");
  const [src, setSrc] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);
  const refresh = () => user && loadBrain(user.uid).then(setBrain);
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [user]);

  function llmEnv() {
    const pref = getModelPref();
    const provider = pref && apiKeys[pref.provider] ? pref.provider : (PROVIDERS.find((p) => apiKeys[p.id])?.id ?? PROVIDERS[0].id);
    return { apiKeys, provider, model: pref && apiKeys[pref.provider] ? pref.model : providerMeta(provider).models[0] };
  }

  async function install() {
    if (!user || !src.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      let text = src.trim();
      const url = /^https?:\/\/\S+$/.test(text) ? text : null;
      if (url) {
        const r = await fetch("/api/skills/fetch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not fetch the link.");
        text = d.text;
      }
      const parsed = parseSkillMarkdown(text) ?? (await skillFromText(llmEnv(), text));
      if (!parsed) throw new Error("Could not read that as a skill.");
      const s = await saveSkill(user.uid, { ...parsed, source: url ?? "pasted" });
      setMsg(`Skill saved: ${s.name}`);
      setSrc("");
      refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <button onClick={() => router.push("/dashboard")} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-ink"><ArrowLeft size={14} /> Dashboard</button>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink"><BrainIcon size={20} className="text-gold" /> Memory & Skills</h1>
        <p className="mt-1 text-sm text-muted">Everything your agents remember and every skill they can use. You can also say it in chat: “remember that…”, “install this skill https://…”.</p>

        <h2 className="mb-2 mt-7 text-sm font-medium text-ink">Memory ({brain.memories.length})</h2>
        <div className="flex gap-2">
          <input value={mem} onChange={(e) => setMem(e.target.value)} placeholder="Add something your agents should always remember…" className={input} />
          <button onClick={async () => { if (user && mem.trim()) { await addMemory(user.uid, mem); setMem(""); refresh(); } }} className="rounded-lg bg-white px-3 text-sm font-medium text-bg"><Plus size={16} /></button>
        </div>
        <div className="mt-3 space-y-1.5">
          {brain.memories.slice().reverse().map((m) => (
            <div key={m.id} className="flex items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink">
              <span className="min-w-0 flex-1">{m.text}{m.auto && <span className="ml-2 text-[10px] text-faint">learned</span>}</span>
              <button onClick={async () => { await removeMemory(user.uid, m.id); refresh(); }} className="text-faint hover:text-red-400"><Trash2 size={13} /></button>
            </div>
          ))}
          {brain.memories.length === 0 && <p className="text-xs text-faint">Nothing yet.</p>}
        </div>

        <h2 className="mb-2 mt-8 text-sm font-medium text-ink">Skills ({brain.skills.length})</h2>
        <textarea value={src} onChange={(e) => setSrc(e.target.value)} rows={3} placeholder="Paste a link to a SKILL.md (GitHub works) or paste the skill text…" className={input} />
        <div className="mt-2 flex items-center gap-3">
          <button onClick={install} disabled={busy || !src.trim()} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-bg disabled:opacity-40">{busy ? "Saving…" : "Install skill"}</button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
        <div className="mt-4 space-y-2">
          {brain.skills.map((s) => (
            <div key={s.id} className="rounded-lg border border-line bg-panel">
              <button onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
                <span className="text-sm font-medium text-ink">{s.name}</span>
                {s.auto && <span className="rounded-full bg-goldSoft px-2 py-0.5 text-[10px] text-gold">learned</span>}
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{s.description}</span>
                <span className="text-[11px] text-faint">used {s.uses ?? 0}×</span>
              </button>
              {open === s.id && (
                <div className="space-y-2 border-t border-line p-3">
                  <textarea defaultValue={s.instructions} rows={10} onBlur={(e) => saveSkill(user.uid, { name: s.name, description: s.description, instructions: e.target.value, source: s.source, auto: s.auto }).then(refresh)} className={`${input} font-mono text-[11px]`} />
                  <button onClick={async () => { await deleteSkill(user.uid, s.id); refresh(); }} className="flex items-center gap-1 text-xs text-red-400"><Trash2 size={12} /> Delete skill</button>
                </div>
              )}
            </div>
          ))}
          {brain.skills.length === 0 && <p className="text-xs text-faint">No skills yet.</p>}
        </div>
      </div>
    </div>
  );
}