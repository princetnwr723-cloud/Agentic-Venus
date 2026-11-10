"use client";
// The Decks button (left sidebar): write ONE command, get a real presentation. It opens with a preview you can present, edit and
// download as PowerPoint / HTML / PDF. Nothing here touches Venus Code or any website project.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listChats, type Chat } from "@/lib/chats";
import { getActiveChat } from "@/lib/avatar-activity";
import { DECK_THEMES } from "@/lib/decks";
import type { DeckListItem } from "@/lib/decks-server";
import DeckViewer, { DeckStyles, SlideView, decksApi } from "@/components/decks/DeckViewer";
import { DeckIcon, SparkIcon } from "@/components/icons";

const IDEAS = [
  "Pitch deck for my startup: problem, solution, market, traction, ask",
  "Explain AI agents to beginners in simple words",
  "Monthly business report: sales, wins, problems, next steps",
  "Why Dubai became so rich: story for investors",
];
const STEPS = ["Understanding your topic…", "Planning the story…", "Writing the slides…", "Choosing layouts and notes…", "Almost ready…"];
const ago = (ms: number) => { const m = Math.round((Date.now() - ms) / 60000); if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };

export default function DeckStudio({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState("");
  const [decks, setDecks] = useState<DeckListItem[]>([]);
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(10);
  const [theme, setTheme] = useState("venus");
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    try { setDecks((await decksApi<{ decks: DeckListItem[] }>({ action: "list" })).decks); } catch { /* the list stays as it was */ }
  }, []);

  useEffect(() => {
    if (!open || !user) return;
    setErr("");
    listChats(user.uid).then((l) => {
      setChats(l);
      const active = getActiveChat();
      setChatId((cur) => (cur && l.some((c) => c.id === cur) ? cur : active && l.some((c) => c.id === active) ? active : l[0]?.id ?? ""));
    }).catch(() => {});
    void refresh();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10_000);
    window.setTimeout(() => box.current?.focus(), 80);
    return () => window.clearInterval(id);
  }, [open, user, refresh]);

  useEffect(() => {
    if (!open || openId) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, openId, busy, onClose]);

  useEffect(() => {
    if (!busy) { setSecs(0); return; }
    const id = window.setInterval(() => setSecs((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  async function generate() {
    if (busy) return;
    if (!chatId) { setErr("Create a chat first: its AI model writes the presentation."); return; }
    if (topic.trim().length < 3) { setErr("Write what the presentation is about."); box.current?.focus(); return; }
    setBusy(true); setErr("");
    try {
      const r = await decksApi<{ deck: { id: string } }>({ action: "generate", chatId, topic: topic.trim(), slides: count, theme });
      setTopic("");
      await refresh();
      setOpenId(r.deck.id);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not make the presentation."); }
    setBusy(false);
  }

  async function removeDeck(d: DeckListItem) {
    if (!window.confirm(`Delete the presentation “${d.title}”? This cannot be undone.`)) return;
    try { await decksApi({ action: "delete", id: d.id }); setDecks((l) => l.filter((x) => x.id !== d.id)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not delete."); }
  }

  if (!open) return null;
  const chip = "rounded-full border px-3 py-1 text-xs transition-colors";
  return createPortal(
    <>
      <DeckStyles />
      <div
        className="fixed inset-0 z-[56] flex items-stretch justify-center bg-black/70 sm:items-center sm:px-4"
        onMouseDown={(e) => { if (e.target === e.currentTarget && !busy && !openId) onClose(); }}
        onClick={(e) => e.stopPropagation()}
      >
      <div className="flex max-h-full w-full flex-col overflow-hidden bg-panel sm:max-h-[92vh] sm:max-w-3xl sm:rounded-xl2 sm:border sm:border-line">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-goldSoft text-gold"><DeckIcon size={21} /></span>
          <div className="min-w-0 flex-1"><h2 className="text-base font-semibold text-ink">Decks</h2><p className="text-xs text-muted">Write one command. Get a real presentation.</p></div>
          <button onClick={() => !busy && onClose()} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label htmlFor="deck-cmd" className="mb-1.5 block text-xs font-medium text-muted">What should the presentation be about?</label>
          <textarea
            id="deck-cmd" ref={box} rows={3} value={topic} disabled={busy} maxLength={1500}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate(); } }}
            placeholder="e.g. Make a presentation on how our AI agents save 20 hours a week, for a client meeting"
            className="w-full resize-none rounded-lg border border-line bg-bg px-3.5 py-3 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none disabled:opacity-60"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {IDEAS.map((i) => <button key={i} type="button" disabled={busy} onClick={() => setTopic(i)} className={`${chip} border-line text-muted hover:text-ink disabled:opacity-50`}>{i.length > 46 ? i.slice(0, 44) + "…" : i}</button>)}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">Slides</p>
              <div className="flex flex-wrap gap-1.5">{[6, 8, 10, 12, 15, 20].map((n) => <button key={n} type="button" disabled={busy} onClick={() => setCount(n)} aria-pressed={count === n} className={`${chip} ${count === n ? "border-gold bg-goldSoft text-ink" : "border-line text-muted hover:text-ink"}`}>{n}</button>)}</div>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">Look</p>
              <div className="flex flex-wrap gap-2">
                {DECK_THEMES.map((t) => (
                  <button key={t.id} type="button" disabled={busy} title={t.name} aria-label={t.name} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}
                    className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${theme === t.id ? "border-gold" : "border-line"}`}
                    style={{ background: `linear-gradient(135deg, ${t.bg}, ${t.bg2} 60%, ${t.ac})` }} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">Written by</p>
              <select value={chatId} disabled={busy} onChange={(e) => setChatId(e.target.value)} className="w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs text-ink" aria-label="Agent">
                {chats.length === 0 && <option value="">No chats yet</option>}
                {chats.map((c) => <option key={c.id} value={c.id}>{c.agentName}</option>)}
              </select>
            </div>
          </div>

          {err && <p className="mt-3 whitespace-pre-wrap rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">{err}</p>}

          <button type="button" onClick={generate} disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-70">
            {busy ? <><Loader2 size={16} className="animate-spin" /> {STEPS[Math.min(STEPS.length - 1, Math.floor(secs / 7))]} <span className="opacity-60">{secs}s</span></> : <><SparkIcon size={17} /> Make presentation</>}
          </button>
          <p className="mt-2 text-center text-[11px] text-faint">{busy ? "This takes about 20 to 60 seconds. Keep this window open." : "Ctrl/⌘ + Enter also works. Then preview, present, edit and download."}</p>

          <p className="mb-2 mt-6 text-[11px] font-medium uppercase tracking-wider text-faint">Your presentations ({decks.length})</p>
          {decks.length === 0 && <p className="text-xs text-faint">None yet. Your first one will appear here.</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {decks.map((d) => (
              <div key={d.id} className="group relative overflow-hidden rounded-lg border border-line transition-colors hover:border-muted">
                <button type="button" onClick={() => setOpenId(d.id)} className="block w-full text-left" aria-label={`Open ${d.title}`}>
                  {d.cover ? <SlideView deck={{ theme: d.theme, slides: [d.cover] }} index={0} style={{ borderRadius: 0 }} /> : <div className="aspect-video bg-panel2" />}
                  <div className="px-2.5 py-2"><p className="truncate text-xs font-medium text-ink">{d.title}</p><p className="text-[10px] text-faint">{d.slideCount} slides · {ago(d.updatedAt)}</p></div>
                </button>
                <button type="button" onClick={() => void removeDeck(d)} title="Delete" aria-label={`Delete ${d.title}`} className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1.5 text-white opacity-90 hover:bg-red-600"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>
      {openId && <DeckViewer id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </>,
    document.body,
  );
}