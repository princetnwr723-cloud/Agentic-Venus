"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, ChevronLeft, Pin, Plus, Search, Send, Square, Trash2, Users, X } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import { CATALOG, CATEGORIES, TOOL_LABEL, byId, type Member } from "@/lib/team-catalog";
import { addMember, removeMember, updateTeam, watchTeam, type TeamDoc, type TMsg } from "@/lib/team";
import { groupCall, removeNote, removePin, watchGroupMsgs, watchGroupState, type GroupStateDoc } from "@/lib/group-client";
import type { GMsg } from "@/lib/group-core";

type View = "group" | "members" | "feed" | "memory" | "add";
const VIEW_LABEL: Record<View, string> = { group: "Group chat", members: "Members", feed: "Team feed", memory: "Memory", add: "+ Add" };
const emptyGroup: GroupStateDoc = { memory: {}, pins: [], working: {}, running: [] };
const hhmm = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function TeamPanel({ uid, chatId, chatName, onClose, onTalk }: {
  uid: string; chatId: string; chatName: string; onClose: () => void;
  onTalk: (m: Member, history: TMsg[], text: string) => Promise<string>;
}) {
  const [team, setTeam] = useState<TeamDoc | null>(null);
  const [view, setView] = useState<View>("group");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<GMsg[]>([]);
  const [gs, setGs] = useState<GroupStateDoc>(emptyGroup);
  const [gtext, setGtext] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [pinsOpen, setPinsOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => watchTeam(uid, chatId, setTeam), [uid, chatId]);
  useEffect(() => watchGroupMsgs(uid, chatId, setMsgs), [uid, chatId]);
  useEffect(() => watchGroupState(uid, chatId, setGs), [uid, chatId]);

  // While a turn is running, nudge it forward every few seconds (the server also does this on its own, so a closed panel loses nothing).
  const runKey = gs.running.join(",");
  useEffect(() => {
    if (!gs.running.length) return;
    const tick = () => { for (const turnId of gs.running) void groupCall(uid, "group_advance", { turnId }).catch(() => {}); };
    const t = setInterval(tick, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, runKey]);

  const openThreadLength = open ? (team?.threads[open]?.length ?? 0) : 0;
  const feedLength = team?.feed.length ?? 0;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [feedLength, open, openThreadLength, msgs.length, view]);

  const member = open ? byId(open) : null;
  const working = team?.working ?? {};
  const members = useMemo(() => (team?.members ?? ["chief"]).map((id) => byId(id)).filter(Boolean) as Member[], [team?.members]);
  const gWorking = Object.entries(gs.working).filter(([id]) => byId(id));
  const running = gs.running.length > 0;

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

  // ---- group chat
  const mention = /(?:^|\s)@([A-Za-z0-9_]*)$/.exec(gtext);
  const picks = mention
    ? [{ id: "everyone", name: "everyone" }, ...members.map((m) => ({ id: m.id, name: m.name }))].filter((m) => m.name.toLowerCase().startsWith(mention[1].toLowerCase())).slice(0, 6)
    : [];
  const pickMention = (name: string) => setGtext(gtext.replace(/@([A-Za-z0-9_]*)$/, `@${name} `));

  async function sendGroup() {
    const t = gtext.trim();
    if (!t || sending) return;
    setErr("");
    setSending(true);
    try {
      if (/^\/stop\b/i.test(t)) { for (const turnId of gs.running) await groupCall(uid, "group_stop", { turnId }); }
      else if (/^\/pin\s+/i.test(t)) await groupCall(uid, "group_pin", { chatId, text: t.replace(/^\/pin\s+/i, "") });
      else if (/^\/goal\s+/i.test(t)) await groupCall(uid, "group_goal", { chatId, goal: t.replace(/^\/goal\s+/i, "") });
      else await groupCall(uid, "group_post", { chatId, text: t });
      setGtext("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not send."); }
    setSending(false);
  }

  async function stopAll() {
    setErr("");
    try { for (const turnId of gs.running) await groupCall(uid, "group_stop", { turnId }); } catch (e) { setErr(e instanceof Error ? e.message : "Could not stop."); }
  }

  const catalog = CATALOG.filter((m) => (cat === "All" || m.cat === cat) && (!q || `${m.name} ${m.title} ${m.skill}`.toLowerCase().includes(q.toLowerCase())));

  const bubble = (m: GMsg) => {
    const body = m.text.replace(/\*\*/g, "");
    if (m.from === "you") {
      return <div key={m.id} className="ml-10 rounded-xl bg-ink px-3 py-2 text-sm text-bg"><p className="whitespace-pre-wrap">{body}</p><p className="mt-1 text-right text-[10px] opacity-60">{hhmm(m.at)}</p></div>;
    }
    if (m.kind === "note" || m.from === "system") return <p key={m.id} className="px-6 text-center text-[11px] text-faint">{body}</p>;
    const who = byId(m.from);
    return (
      <div key={m.id} className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0"><BotAvatar color={who?.color ?? "teal"} size={28} working={Boolean(gs.working[m.from])} /></div>
        <div className={`mr-6 min-w-0 rounded-xl border px-3 py-2 text-sm text-ink ${m.kind === "result" ? "border-avatar-teal/40" : m.kind === "ask" ? "border-gold/60" : "border-line"} bg-panel2`}>
          <p className="mb-0.5 text-[11px] font-medium text-muted">
            {who?.name ?? m.from}
            {m.kind === "result" && <span className="ml-1 rounded-full bg-panel px-1.5 py-0.5 text-[9px] font-normal text-avatar-teal">result</span>}
            {m.to && m.to.length > 0 && m.to.length <= 3 && <span className="ml-1 font-normal text-faint">→ {m.to.map((id) => byId(id)?.name ?? id).join(", ")}</span>}
            <span className="ml-1 font-normal text-faint">{hhmm(m.at)}</span>
          </p>
          <p className="whitespace-pre-wrap break-words">{body}</p>
        </div>
      </div>
    );
  };

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
            <BotAvatar color={member.color} size={36} working={Boolean(working[member.id]) || busy} />
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
          <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 text-xs">
            {(Object.keys(VIEW_LABEL) as View[]).map((v) => <button key={v} onClick={() => setView(v)} className={`shrink-0 rounded-md px-3 py-1 ${view === v ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>{VIEW_LABEL[v]}{v === "group" && running && <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />}</button>)}
          </div>

          {view === "group" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {gs.pins.length > 0 && (
                <div className="border-b border-line px-3 py-2 text-xs">
                  <button onClick={() => setPinsOpen(!pinsOpen)} className="flex w-full items-center gap-1.5 text-muted hover:text-ink"><Pin size={12} /> {gs.pins.length} pinned for everyone <span className="ml-auto text-faint">{pinsOpen ? "hide" : "show"}</span></button>
                  {pinsOpen && <ul className="mt-2 space-y-1">{gs.pins.map((p) => <li key={p} className="flex items-start gap-2 rounded-md bg-panel2 px-2 py-1.5 text-ink"><span className="flex-1">{p}</span><button onClick={() => removePin(uid, chatId, p)} className="text-faint hover:text-red-400"><X size={12} /></button></li>)}</ul>}
                </div>
              )}
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
                {msgs.length === 0 && (
                  <div className="space-y-2 p-2 text-xs text-muted">
                    <p>This is your team's group chat. Write a message and the right teammate answers; teammates can hand work to each other, and anyone with a computer, code, video or web skill does real work in the background while you keep chatting.</p>
                    <p><span className="text-ink">@Hunter</span> asks one member · <span className="text-ink">@everyone</span> is a round table · no @ and the team picks who answers.</p>
                    <p><span className="text-ink">/pin text</span> pins a fact for everyone · <span className="text-ink">/goal text</span> starts a planned multi-step goal · <span className="text-ink">/stop</span> stops all work.</p>
                  </div>
                )}
                {msgs.map(bubble)}
                {gWorking.length > 0 && (
                  <div className="space-y-1">
                    {gWorking.map(([id, what]) => <p key={id} className="flex items-center gap-1.5 text-[11px] text-gold"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />{byId(id)?.name}: {what}</p>)}
                  </div>
                )}
                <div ref={endRef} />
              </div>
              {err && <p className="border-t border-line bg-red-500/10 px-3 py-1.5 text-xs text-red-400">{err}</p>}
              <div className="relative border-t border-line p-3">
                {picks.length > 0 && (
                  <div className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-xl border border-line bg-panel2 shadow-lg">
                    {picks.map((p) => <button key={p.id} onClick={() => pickMention(p.name)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-panel">@{p.name}<span className="text-[11px] text-faint">{p.id === "everyone" ? "ask all members" : byId(p.id)?.title}</span></button>)}
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); sendGroup(); }} className="flex gap-2">
                  <input value={gtext} onChange={(e) => setGtext(e.target.value)} placeholder="Message the team…  @name  /pin  /goal" className="flex-1 rounded-full border border-line bg-bg px-4 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none" />
                  {running && <button type="button" onClick={stopAll} title="Stop all work" className="rounded-full border border-line p-2.5 text-red-400 hover:bg-panel2"><Square size={15} /></button>}
                  <button disabled={!gtext.trim() || sending} className="rounded-full bg-white p-2.5 text-bg disabled:opacity-40"><Send size={15} /></button>
                </form>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {view === "members" && (team?.members ?? ["chief"]).map((id) => {
                const m = byId(id);
                if (!m) return null;
                return (
                  <div key={id} className="flex items-center gap-3 border-b border-line px-4 py-3 hover:bg-panel2/60">
                    <button onClick={() => setOpen(id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <div className="relative"><BotAvatar color={m.color} size={40} working={Boolean(working[id] || gs.working[id])} />{(working[id] || gs.working[id]) && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-gold" />}</div>
                      <div className="min-w-0"><p className="text-sm font-medium text-ink">{m.name} <span className="ml-1 rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-normal text-muted">{TOOL_LABEL[m.tool]}</span></p><p className="truncate text-xs text-muted">{working[id] || gs.working[id] ? `Working: ${working[id] || gs.working[id]}` : m.title}</p></div>
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
              {view === "memory" && (
                <div className="space-y-3 p-3">
                  <p className="flex items-start gap-2 p-1 text-xs text-muted"><Brain size={14} className="mt-0.5 shrink-0" /> What your teammates have learned about you and the project. They read this before every answer and every task. Passwords and keys are never saved. Remove anything that is wrong.</p>
                  {gs.pins.length > 0 && (
                    <div className="rounded-xl border border-line bg-panel2 p-3">
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink"><Pin size={12} /> Pinned for everyone</p>
                      <ul className="space-y-1">{gs.pins.map((p) => <li key={p} className="flex items-start gap-2 text-xs text-muted"><span className="flex-1">{p}</span><button onClick={() => removePin(uid, chatId, p)} className="text-faint hover:text-red-400"><X size={12} /></button></li>)}</ul>
                    </div>
                  )}
                  {members.map((m) => {
                    const notes = gs.memory[m.id] ?? [];
                    if (!notes.length) return null;
                    return (
                      <div key={m.id} className="rounded-xl border border-line bg-panel2 p-3">
                        <p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-ink"><BotAvatar color={m.color} size={22} working={false} />{m.name}</p>
                        <ul className="space-y-1">{notes.map((n) => <li key={n} className="flex items-start gap-2 text-xs text-muted"><span className="flex-1">{n}</span><button onClick={() => removeNote(uid, chatId, m.id, n)} className="text-faint hover:text-red-400"><X size={12} /></button></li>)}</ul>
                      </div>
                    );
                  })}
                  {gs.pins.length === 0 && members.every((m) => !(gs.memory[m.id] ?? []).length) && <p className="p-2 text-xs text-faint">Nothing yet. Teammates add a note when they learn something lasting, for example your business, tone or preferences. You can also pin a fact yourself with /pin in the group chat.</p>}
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
                          <BotAvatar color={m.color} size={34} working={false} />
                          <div className="min-w-0"><p className="text-sm font-medium text-ink">{m.name} {on ? <span className="text-[10px] text-avatar-teal">added</span> : <Plus size={11} className="inline text-muted" />}</p><p className="text-[11px] text-muted">{m.title}</p><p className="mt-1 line-clamp-2 text-[11px] text-faint">{m.skill}</p></div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}