"use client";
// The "Decks" column in Venus Code: every presentation the agents made (or you made), plus a form to generate a new one.
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Presentation, Sparkles, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listChats } from "@/lib/chats";
import { DECK_THEMES, type DeckSummary } from "@/lib/decks";
import DeckViewer, { decksApi } from "@/components/decks/DeckViewer";

const ago = (ms: number) => { const m = Math.round((Date.now() - ms) / 60000); if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };

export default function DecksRail() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [scope, setScope] = useState<"chat" | "all">("chat");
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(10);
  const [theme, setTheme] = useState("venus");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    if (!user) return;
    const want = new URLSearchParams(window.location.search).get("chat");
    listChats(user.uid).then((l) => setChatId(want && l.some((c) => c.id === want) ? want : l[0]?.id ?? null)).catch(() => {});
    const deck = new URLSearchParams(window.location.search).get("deck");
    if (deck) setOpenId(deck);
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try { setDecks((await decksApi<{ decks: DeckSummary[] }>({ action: "list" })).decks); } catch { /* the list stays as it was */ }
  }, [user]);
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function generate() {
    if (!chatId) { setErr("Create a chat first: the deck is written by that chat's AI model."); return; }
    setBusy(true); setErr("");
    try {
      const r = await decksApi<{ deck: { id: string } }>({ action: "generate", chatId, topic, slides: count, theme });
      setTopic(""); setForm(false); await refresh(); setOpenId(r.deck.id);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not make the deck."); }
    setBusy(false);
  }

  const shown = scope === "chat" && chatId ? decks.filter((d) => d.chatId === chatId) : decks;
  const inp = "w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold focus:outline-none";

  return (
    <>
      <button onClick={() => setMobile(true)} className="fixed bottom-4 left-4 z-30 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-xs font-medium text-bg shadow-lg md:hidden"><Presentation size={14} /> Decks</button>
      {mobile && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setMobile(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[270px] shrink-0 flex-col border-r border-line bg-panel transition-transform md:static md:z-auto md:w-[230px] md:translate-x-0 ${mobile ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 py-4">
          <span className="flex items-center gap-2 text-sm font-medium text-ink"><Presentation size={15} className="text-gold" /> Decks</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setForm((v) => !v)} title="New deck" className="rounded p-1 text-muted hover:bg-panel2 hover:text-ink"><Plus size={15} /></button>
            <button onClick={() => setMobile(false)} className="rounded p-1 text-muted hover:bg-panel2 md:hidden"><X size={15} /></button>
          </div>
        </div>

        {form && (
          <div className="mx-3 mb-3 space-y-2 rounded-lg border border-line bg-bg p-3">
            <textarea rows={4} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What is the deck about? e.g. “Why Dubai is rich, for investors, simple words”" className={inp} />
            <div className="flex gap-2">
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={inp} aria-label="Slides">{[6, 8, 10, 12, 15, 20].map((n) => <option key={n} value={n}>{n} slides</option>)}</select>
              <select value={theme} onChange={(e) => setTheme(e.target.value)} className={inp} aria-label="Theme">{DECK_THEMES.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}</select>
            </div>
            {err && <p className="text-[11px] text-red-300">{err}</p>}
            <button onClick={generate} disabled={busy || topic.trim().length < 3} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-white py-2 text-xs font-medium text-bg disabled:opacity-50">{busy ? <><Loader2 size={13} className="animate-spin" /> Writing slides…</> : <><Sparkles size={13} /> Generate deck</>}</button>
            <p className="text-[10px] leading-relaxed text-faint">Or just tell your agent in the chat: “AgenticVenus, make a deck on …”.</p>
          </div>
        )}

        <div className="flex gap-1 px-3 pb-2 text-[11px]">
          {(["chat", "all"] as const).map((k) => <button key={k} onClick={() => setScope(k)} className={`rounded-full px-3 py-1 ${scope === k ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>{k === "chat" ? "This chat" : "All chats"}</button>)}
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {shown.length === 0 && <p className="px-2 py-2 text-[11px] leading-relaxed text-faint">No decks yet. Ask your agent: <b className="text-muted">“make a presentation on …”</b>, or press + to generate one here.</p>}
          {shown.map((d) => (
            <button key={d.id} onClick={() => { setOpenId(d.id); setMobile(false); }} className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-panel2/70">
              <span className="block truncate text-[13px] text-ink">{d.title}</span>
              <span className="block text-[11px] text-faint">{d.slideCount} slides · {ago(d.updatedAt)}</span>
            </button>
          ))}
        </div>
      </aside>
      {openId && <DeckViewer id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </>
  );
}