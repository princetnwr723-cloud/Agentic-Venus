"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Brain as BrainIcon, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { listChats, type Chat } from "@/lib/chats";
import { getModelPref } from "@/lib/model-pref";
import { PROVIDERS, providerMeta } from "@/lib/providers";
import {
  addMemory, deleteSkill, importLegacy, loadBrain, parseSkillMarkdown, removeMemory, saveSkill, setSkillDisabled, skillFromText, type Brain,
} from "@/lib/brain";

const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";

export default function SkillsPage() {
  const { user, loading } = useAuth();
  const { apiKeys } = useKeys();
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [brain, setBrain] = useState<Brain>({ memories: [], skills: [] });
  const [mem, setMem] = useState("");
  const [src, setSrc] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);
  useEffect(() => {
    if (!user) return;
    listChats(user.uid).then((l) => {
      setChats(l);
      const want = new URLSearchParams(window.location.search).get("chat");
      setChatId(want && l.some((c) => c.id === want) ? want : l[0]?.id ?? null);
    });
  }, [user]);

  const scope = user && chatId ? { uid: user.uid, chatId } : null;
  const refresh = () => scope && loadBrain(scope).then(setBrain);
  useEffect(() => { if (scope) loadBrain(scope).then(setBrain); setOpen(null); setMsg(null); /* eslint-disable-next-line */ }, [chatId, user]);

  function llmEnv() {
    const pref = getModelPref();
    const provider = pref && apiKeys[pref.provider] ? pref.provider : (PROVIDERS.find((p) => apiKeys[p.id])?.id ?? PROVIDERS[0].id);
    return { apiKeys, provider, model: pref && apiKeys[pref.provider] ? pref.model : providerMeta(provider).models[0] };
  }

  async function install() {
    if (!scope || !src.trim()) return;
    setBusy(true); setMsg(null);
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
      const s = await saveSkill(scope, { ...parsed, source: url ?? "pasted" });
      setMsg(`Skill saved for this chat: ${s.name}`); setSrc(""); refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
    finally { setBusy(false); }
  }

  if (!user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;
  const chat = chats.find((c) => c.id === chatId);

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <button onClick={() => router.push("/dashboard")} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-ink"><ArrowLeft size={14} /> Dashboard</button>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink"><BrainIcon size={20} className="text-gold" /> Memory & Skills</h1>
        <p className="mt-1 text-sm text-muted">Every chat has its own memory and skills — nothing is shared between chats. The agent also improves them by itself after each task.</p>

        <div className="mt-4 flex items-center gap-2">
          <select value={chatId ?? ""} onChange={(e) => setChatId(e.target.value)} className={input + " max-w-xs"}>
            {chats.map((c) => <option key={c.id} value={c.id}>{c.agentName}</option>)}
          </select>
          <button onClick={async () => { if (scope) { setMsg(`Imported ${await importLegacy(scope)} old items into ${chat?.agentName}.`); refresh(); } }} className="rounded-lg border border-line px-3 py-2 text-xs text-ink hover:bg-panel2">Import old shared memory here</button>
        </div>
        {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
        {!chatId && <p className="mt-6 text-sm text-faint">Create a chat first.</p>}

        {scope && (<>
          <h2 className="mb-2 mt-7 text-sm font-medium text-ink">Memory ({brain.memories.length})</h2>
          <div className="flex gap-2">
            <input value={mem} onChange={(e) => setMem(e.target.value)} placeholder={`Something ${chat?.agentName ?? "this agent"} should always remember…`} className={input} />
            <button onClick={async () => { if (mem.trim()) { await addMemory(scope, mem); setMem(""); refresh(); } }} className="rounded-lg bg-white px-3 text-sm font-medium text-bg"><Plus size={16} /></button>
          </div>
          <div className="mt-3 space-y-1.5">
            {brain.memories.slice().sort((a, b) => (a.kind === "role" ? -1 : b.kind === "role" ? 1 : b.at - a.at)).map((m) => (
              <div key={m.id} className="flex items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink">
                <span className="min-w-0 flex-1">{m.text}
                  <span className="ml-2 text-[10px] text-faint">{m.kind === "role" ? "role" : m.kind === "lesson" ? "lesson" : m.auto ? "learned" : ""}</span>
                </span>
                {m.kind !== "role" && <button onClick={async () => { await removeMemory(scope, m.id); refresh(); }} className="text-faint hover:text-red-400"><Trash2 size={13} /></button>}
              </div>
            ))}
            {brain.memories.length === 0 && <p className="text-xs text-faint">Nothing yet.</p>}
          </div>

          <h2 className="mb-2 mt-8 text-sm font-medium text-ink">Skills ({brain.skills.length})</h2>
          <textarea value={src} onChange={(e) => setSrc(e.target.value)} rows={3} placeholder="Paste a link to a SKILL.md (GitHub works) or paste the skill text…" className={input} />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={install} disabled={busy || !src.trim()} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-bg disabled:opacity-40">{busy ? "Saving…" : "Install skill"}</button>
          </div>
          <div className="mt-4 space-y-2">
            {brain.skills.map((s) => (
              <div key={s.id} className={`rounded-lg border border-line bg-panel ${s.disabled ? "opacity-60" : ""}`}>
                <button onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
                  <span className="text-sm font-medium text-ink">{s.name}</span>
                  {s.auto && <span className="rounded-full bg-goldSoft px-2 py-0.5 text-[10px] text-gold">learned v{s.version ?? 1}</span>}
                  {s.trial && <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted">on trial</span>}
                  {s.disabled && <span className="rounded-full border border-red-900/60 px-2 py-0.5 text-[10px] text-red-300">paused</span>}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">{s.description}</span>
                  <span className="text-[11px] text-faint">✓{s.wins ?? 0} ✗{s.fails ?? 0}</span>
                </button>
                {open === s.id && (
                  <div className="space-y-2 border-t border-line p-3">
                    <textarea defaultValue={s.instructions} rows={10} onBlur={(e) => e.target.value !== s.instructions && saveSkill(scope, { name: s.name, description: s.description, instructions: e.target.value, source: s.source, auto: s.auto, prev: s.instructions }).then(refresh)} className={`${input} font-mono text-[11px]`} />
                    <div className="flex gap-4 text-xs">
                      <button onClick={async () => { await setSkillDisabled(scope, s.id, !s.disabled); refresh(); }} className="text-muted underline">{s.disabled ? "Turn on again" : "Pause this skill"}</button>
                      {s.prev && <button onClick={async () => { await saveSkill(scope, { name: s.name, description: s.description, instructions: s.prev as string, source: s.source, auto: s.auto, prev: s.instructions, version: (s.version ?? 1) + 1, resetStats: true }); refresh(); }} className="text-muted underline">Go back to the previous version</button>}
                      <button onClick={async () => { await deleteSkill(scope, s.id); refresh(); }} className="flex items-center gap-1 text-red-400"><Trash2 size={12} /> Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {brain.skills.length === 0 && <p className="text-xs text-faint">No skills yet.</p>}
          </div>
        </>)}
      </div>
    </div>
  );
}