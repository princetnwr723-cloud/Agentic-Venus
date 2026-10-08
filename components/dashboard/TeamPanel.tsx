"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Plus, Search, Send, Trash2, Users, X } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import { CATALOG, CATEGORIES, TOOL_LABEL, byId, type Member } from "@/lib/team-catalog";
import { addMember, removeMember, updateTeam, watchTeam, type TeamDoc, type TMsg } from "@/lib/team";

export default function TeamPanel({ uid, chatId, chatName, onClose, onTalk }: {
  uid: string; chatId: string; chatName: string; onClose: () => void;
  onTalk: (m: Member, history: TMsg[], text: string) => Promise<string>;
}) {
  const [team, setTeam] = useState<TeamDoc | null>(null);
  const [view, setView] = useState<"members" | "feed" | "add">("members");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => watchTeam(uid, chatId, setTeam), [uid, chatId]);
  const openThreadLength = open ? (team?.threads[open]?.length ?? 0) : 0;
  const feedLength = team?.feed.length ?? 0;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [feedLength, open, openThreadLength]);

  const member = open ? byId(open) : null;
  const working = team?.working ?? {};

  async function send() {
    if (!member || !text.trim() || busy) return;
    const t = text.trim();
    setText("");
    setBusy(true);
    const hist = team?.threads[member.id] ?? [];
    await updateTeam(uid, chatId, (d) => { (d.threads[member.id] ||= []).push({ role: "user", content: t, at: Date.now() }); });
    let reply: string;
    try { reply = await onTalk(member, hist, t); } catch (e) { reply = `⚠️ ${e instanceof Error ? e.message : "Something went wrong."}`; }
    await updateTeam(uid, chatId, (d) => { (d.threads[member.id] ||= []).push({ role: "assistant", content: reply, at: Date.now() }); });
    setBusy(false);
  }

  const catalog = CATALOG.filter((m) => (cat === "All" || m.cat === cat) && (!q || `${m.name} ${m.title} ${m.skill}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <aside className="flex h-full w-[46%] min-w-[340px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-ink"><Users size={15} /> Team · {chatName}<span className="text-xs text-faint">{team?.members.length ?? 1} members</span></div>
        <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={16} /></button>
      </div>

      {member ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-line px-3 py-2.5">
            <button onClick={() => setOpen(null)} className="text-muted hover:text-ink"><ChevronLeft size={18} /></button>
            <BotAvatar color={member.color} size={32} />
            <div className="min-w-0"><p className="text-sm font-medium text-ink">{member.name}</p><p className="truncate text-[11px] text-muted">{member.title} · {TOOL_LABEL[member.tool]}</p></div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {working[member.id] && <p className="rounded-lg bg-goldSoft/40 px-3 py-2 text-xs text-gold">Working: {working[member.id]}</p>}
            {(team?.threads[member.id] ?? []).length === 0 && <p className="p-2 text-xs text-muted">{member.skill}<br />Say what you need — {member.name} will do it{member.tool === "pc" || member.tool === "code" || member.tool === "video" ? ` using ${TOOL_LABEL[member.tool]}` : ""}.</p>}
            {(team?.threads[member.id] ?? []).map((m, i) => <div key={i} className={`whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-8 bg-ink text-bg" : "mr-8 border border-line bg-panel2 text-ink"}`}>{m.content}</div>)}
            {busy && <p className="text-xs text-muted">{member.name} is working…</p>}
            <div ref={endRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 border-t border-line p-3">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${member.name}…`} className="flex-1 rounded-full border border-line bg-bg px-4 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none" />
            <button disabled={!text.trim() || busy} className="rounded-full bg-white p-2.5 text-bg disabled:opacity-40"><Send size={15} /></button>
          </form>
        </div>
      ) : (
        <>
          <div className="flex gap-1 border-b border-line px-3 py-2 text-xs">
            {(["members", "feed", "add"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 ${view === v ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>{v === "members" ? "Members" : v === "feed" ? "Team feed" : "+ Add"}</button>)}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {view === "members" && (team?.members ?? ["chief"]).map((id) => {
              const m = byId(id);
              if (!m) return null;
              return (
                <div key={id} className="flex items-center gap-3 border-b border-line px-4 py-3 hover:bg-panel2/60">
                  <button onClick={() => setOpen(id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <div className="relative"><BotAvatar color={m.color} size={36} />{working[id] && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-gold" />}</div>
                    <div className="min-w-0"><p className="text-sm font-medium text-ink">{m.name} <span className="ml-1 rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-normal text-muted">{TOOL_LABEL[m.tool]}</span></p><p className="truncate text-xs text-muted">{working[id] ? `Working: ${working[id]}` : m.title}</p></div>
                  </button>
                  {id !== "chief" && <button onClick={() => removeMember(uid, chatId, id)} className="text-faint hover:text-red-400"><Trash2 size={14} /></button>}
                </div>
              );
            })}
            {view === "feed" && (
              <div className="space-y-2 p-3">
                {(team?.feed ?? []).length === 0 && <p className="p-2 text-xs text-muted">When the agent hands work to team members, the whole conversation shows up here — not in your chat.</p>}
                {(team?.feed ?? []).map((f, i) => (
                  <div key={i} className={`rounded-lg border px-3 py-2 text-xs ${f.kind === "result" ? "border-avatar-teal/40" : "border-line"} bg-panel2`}>
                    <p className="mb-1 font-medium text-ink">{f.from} → {f.to} <span className="ml-1 font-normal text-faint">{new Date(f.at).toLocaleTimeString()}</span></p>
                    <p className="whitespace-pre-wrap text-muted">{f.text}</p>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
            )}
            {view === "add" && (
              <div className="p-3">
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2"><Search size={14} className="text-faint" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 63 specialists…" className="w-full bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none" /></div>
                <div className="mb-3 flex flex-wrap gap-1">{["All", ...CATEGORIES].map((c) => <button key={c} onClick={() => setCat(c)} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${cat === c ? "border-white text-ink" : "border-line text-muted"}`}>{c}</button>)}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {catalog.map((m) => {
                    const on = team?.members.includes(m.id);
                    return (
                      <button key={m.id} disabled={on} onClick={() => addMember(uid, chatId, m.id)} className="flex items-start gap-2.5 rounded-xl border border-line bg-panel2 p-3 text-left hover:border-gold/60 disabled:opacity-50">
                        <BotAvatar color={m.color} size={30} />
                        <div className="min-w-0"><p className="text-sm font-medium text-ink">{m.name} {on ? <span className="text-[10px] text-avatar-teal">added</span> : <Plus size={11} className="inline text-muted" />}</p><p className="text-[11px] text-muted">{m.title}</p><p className="mt-1 line-clamp-2 text-[11px] text-faint">{m.skill}</p></div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}