"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowUp, AtSign, Check, CornerUpLeft, File as FileIcon, FileArchive, FileCode2, FileSpreadsheet, FileText,
  Film, Hand, Image as ImageIcon, Loader2, Mic, Music, Paperclip, Plus, Presentation, UploadCloud, X, Zap,
} from "lucide-react";
import { MAX_ATTACH_FILES, badgeOf, humanSize, shortName, type Attachment, type AttachKind } from "@/lib/attachments";
import CallButton from "@/components/dashboard/CallButton";
import BotAvatar from "@/components/BotAvatar";
import type { AvatarColor } from "@/lib/bots";
import { useAuth } from "@/lib/auth-context";
import { deckIntent } from "@/lib/intent";
import { wantsBusinessHub } from "@/lib/business-core";
import { decksApi } from "@/components/decks/DeckViewer";

export type Mentionable = { id: string; name: string; color: AvatarColor; hint: string; preview: string };

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g, "");

const CSS = `
@keyframes cc-in { from { opacity: 0; transform: translateY(4px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes cc-sheen { 0% { transform: translateX(-100%); } 100% { transform: translateX(260%); } }
@keyframes cc-pop { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); } }
.cc-in { animation: cc-in .2s cubic-bezier(.2,.8,.2,1) both; }
.cc-pop { animation: cc-pop .28s cubic-bezier(.2,.8,.2,1) both; }
.cc-sheen::after { content: ""; position: absolute; inset: 0; width: 40%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent); animation: cc-sheen 1.3s ease-in-out infinite; }
.cc-strip { scrollbar-width: none; -ms-overflow-style: none; }
.cc-strip::-webkit-scrollbar { display: none; }
.cc-ta { scrollbar-width: thin; }
@media (prefers-reduced-motion: reduce) { .cc-in, .cc-pop { animation: none !important; } .cc-sheen::after { animation: none !important; display: none; } }
`;

const MAX_TEXTAREA_PX = 168;

// A normal sentence that asks for a NEW presentation ("ek presentation bana do AI par", "make a pitch deck for my startup").
// It is made by the deck generator straight away, exactly like /deck. Changing an existing deck, questions and long texts still go to the agent.
const NEW_DECK_VERB = /\b(make|create|build|prepare|generate|design|draft|bana\w*|bna\w*|banwa\w*|banao|tayyar|chahiye|chaahiye|de\s?do|dedo|need|want)\b/i;
const OLD_DECK_WORK = /\b(change|edit|update|modify|fix|redo|redesign|delete|remove|shorter|existing|purani|badal\w*|slide\s*(?:no\.?\s*)?\d+)\b/i;
const QUESTION = /^\s*(what|kya|how|why|explain|kaise|kyu|kyun|which|kaun|can you tell)\b/i;
function wantsNewDeck(text: string): boolean {
  const t = String(text ?? "").trim();
  if (t.length < 8 || t.length > 1500 || t.startsWith("/") || QUESTION.test(t)) return false;
  return deckIntent(t) && NEW_DECK_VERB.test(t) && !OLD_DECK_WORK.test(t);
}

function KindIcon({ kind, size = 18 }: { kind: AttachKind | string; size?: number }) {
  switch (kind) {
    case "image": return <ImageIcon size={size} />;
    case "video": return <Film size={size} />;
    case "audio": return <Music size={size} />;
    case "zip": return <FileArchive size={size} />;
    case "pdf":
    case "doc": return <FileText size={size} />;
    case "sheet": return <FileSpreadsheet size={size} />;
    case "slides": return <Presentation size={size} />;
    case "text": return <FileCode2 size={size} />;
    default: return <FileIcon size={size} />;
  }
}

const pct = (p: number) => Math.max(0, Math.min(100, Math.round((Number.isFinite(p) ? p : 0) * 100)));

/** One attached file INSIDE the message box: thumbnail / icon, name, size, live upload progress and a remove button. */
function FileChip({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const bad = a.status === "error";
  const up = a.status === "uploading";
  const p = pct(a.progress);
  return (
    <div
      title={bad ? a.error || "Upload failed" : a.name}
      className={`cc-in group relative flex h-[58px] w-[212px] shrink-0 items-center gap-2.5 overflow-hidden rounded-2xl border bg-panel2/80 pl-2 pr-8 ${bad ? "border-red-400/50" : up ? "border-gold/40" : "border-line"}`}
    >
      <div className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl ${bad ? "bg-red-500/10 text-red-300" : "bg-bg text-muted"}`}>
        {a.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.preview} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : bad ? (
          <AlertCircle size={18} />
        ) : (
          <KindIcon kind={a.kind} />
        )}
        {up && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-semibold tabular-nums text-white">{p}%</span>
        )}
        {a.status === "ready" && (
          <span className="cc-pop absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-avatar-teal text-bg shadow"><Check size={10} strokeWidth={3.5} /></span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium leading-tight text-ink">{shortName(a.name, 26)}</p>
        <p className={`mt-0.5 truncate text-[11px] leading-tight ${bad ? "text-red-300" : up ? "text-gold" : "text-muted"}`}>
          {bad ? a.error || "Upload failed" : up ? `Uploading ${p}% · ${humanSize(a.size)}` : `${badgeOf(a.name, a.kind as AttachKind)} · ${humanSize(a.size)} · Ready`}
        </p>
      </div>

      <button
        type="button"
        aria-label={`Remove ${a.name}`}
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-ink"
      >
        <X size={13} />
      </button>

      {up && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/5">
          <div className="cc-sheen relative h-full overflow-hidden rounded-r-full bg-gold transition-[width] duration-300 ease-out" style={{ width: `${Math.max(4, p)}%` }} />
        </div>
      )}
    </div>
  );
}

/** The send button: a white round arrow when ready, a progress ring while files upload, a spinner while the agent starts. */
function SendButton({ canSend, uploading, overall, sending }: { canSend: boolean; uploading: boolean; overall: number; sending: boolean }) {
  const R = 16;
  const C = 2 * Math.PI * R;
  const label = uploading ? `Uploading ${overall}%…` : sending ? "Sending…" : "Send";
  return (
    <button
      type="submit"
      aria-label={label}
      title={label}
      disabled={!canSend}
      className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all duration-200 sm:h-9 sm:w-9 ${
        canSend ? "bg-white text-bg shadow-[0_2px_12px_rgba(231,178,77,.28)] hover:scale-105 active:scale-95" : "bg-panel2 text-faint"
      }`}
    >
      {uploading ? (
        <>
          <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="18" cy="18" r={R} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="2.5" />
            <circle cx="18" cy="18" r={R} fill="none" stroke="#E7B24D" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - overall / 100)} style={{ transition: "stroke-dashoffset .3s ease-out" }} />
          </svg>
          <span className="text-[9.5px] font-semibold tabular-nums text-ink">{overall}</span>
        </>
      ) : sending ? (
        <Loader2 size={17} className="animate-spin" />
      ) : (
        <ArrowUp size={19} strokeWidth={2.4} />
      )}
    </button>
  );
}

export default function ChatComposer({
  draft, setDraft, onSubmit, sending, agentName, attach, onPickFiles, onRemoveAttach,
  mentionables, onMention, replyTo, onClearReply, chatId, autoMode, onToggleAuto, modelSlot, variant = "dock",
}: {
  draft: string; setDraft: (v: string) => void; onSubmit: (e: React.FormEvent) => void; sending: boolean; agentName: string;
  attach: Attachment[]; onPickFiles: (f: File[]) => void; onRemoveAttach: (id: string) => void;
  mentionables: Mentionable[]; onMention: (token: string, id: string) => void;
  replyTo: { at: number; preview: string } | null; onClearReply: () => void;
  /** Optional: when given, the call button rings exactly this chat's agent. Without it the agent is found by its name. */
  chatId?: string;
  /** Automatic (true) or Manual (false): Automatic never asks before ordinary actions. Without onToggleAuto the switch is not shown. */
  autoMode?: boolean;
  onToggleAuto?: () => void;
  /** The model button (the pill) shown in the bottom row of the message box. */
  modelSlot?: React.ReactNode;
  /** "hero" = the big box of a brand-new chat, "dock" = the box under a running conversation. */
  variant?: "hero" | "dock";
  /** @deprecated The computer and template buttons no longer live beside the message box. Kept so older callers still compile. */
  hasComputerKey?: boolean;
  /** @deprecated see hasComputerKey */
  computerMode?: boolean;
  /** @deprecated see hasComputerKey */
  onToggleComputer?: () => void;
  /** @deprecated see hasComputerKey */
  onTemplates?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [closed, setClosed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const dragDepth = useRef(0);
  const { user } = useAuth();
  const router = useRouter();
  const [deckBusy, setDeckBusy] = useState(false);
  const [deckSecs, setDeckSecs] = useState(0);
  const hero = variant === "hero";

  // ---- dictation: the mic button types what you say into the box (only where the browser can do it)
  const recRef = useRef<{ stop: () => void } | null>(null);
  const baseRef = useRef("");
  const [canDictate, setCanDictate] = useState(false);
  const [listening, setListening] = useState(false);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setCanDictate(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => { try { recRef.current?.stop(); } catch { /* already stopped */ } };
  }, []);

  function stopDictation() { try { recRef.current?.stop(); } catch { /* already stopped */ } }
  function toggleDictation() {
    if (listening) { stopDictation(); return; }
    const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = /^hi\b/i.test(navigator.language) ? "hi-IN" : navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = true;
    baseRef.current = draft ? draft.replace(/\s+$/, "") + " " : "";
    r.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      let s = "";
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      setDraft(baseRef.current + s);
    };
    r.onend = () => { setListening(false); recRef.current = null; };
    r.onerror = () => { setListening(false); recRef.current = null; };
    recRef.current = r;
    try { r.start(); setListening(true); inputRef.current?.focus(); } catch { setListening(false); }
  }

  useEffect(() => {
    if (!deckBusy) { setDeckSecs(0); return; }
    const id = window.setInterval(() => setDeckSecs((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [deckBusy]);

  // the "+" menu closes on an outside tap and on Escape
  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-plus-btn]")) return; // the + button toggles by itself
      if (plusRef.current && !plusRef.current.contains(t as Node)) setPlusOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPlusOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [plusOpen]);

  /**
   * "/deck <topic>", or a normal sentence that asks for a new presentation, makes the presentation right away with this chat's model
   * (exactly like the Decks button), so no router or agent can turn it into a website. Optional: "12 slides" anywhere, and (for /deck) "| the look".
   * Everything is written into the chat (and saved), so it shows up like any other message.
   */
  async function runDeck(text: string, arg: string, natural = false) {
    if (!user || !chatId) return;
    const cid = chatId;
    // the server writes the messages (a message this browser writes itself is not shown by the chat screen)
    const post = (messages: Array<{ role: "user" | "assistant"; content: string }>) => decksApi({ action: "post", chatId: cid, messages }).catch(() => undefined);
    const [main, ...rest] = natural ? [arg] : arg.split("|");
    const look = rest.join("|").replace(/\s+/g, " ").trim();
    const n = /\b(\d{1,2})\s*(?:slides?|pages?)\b/i.exec(main);
    const slides = n ? Math.max(3, Math.min(24, Number(n[1]))) : 10;
    const topic = main.replace(n?.[0] ?? " ", " ").replace(/\s+/g, " ").trim();
    if (topic.length < 3) {
      await post([{ role: "user", content: text }, { role: "assistant", content: "ℹ️ Write what the presentation is about after the command, for example:\n\n`/deck how our AI agents save 20 hours a week, for a client meeting`\n\nOptional: add a number of slides (`/deck AI for beginners 8 slides`) and a look after a `|` (`/deck my startup pitch | dark and bold like a keynote`)." }]);
      return;
    }
    setDeckBusy(true);
    await post([{ role: "user", content: text }, { role: "assistant", content: `⏳ Designing your presentation “${topic.length > 70 ? topic.slice(0, 68) + "…" : topic}” (${slides} slides). This takes about 1 to 2 minutes…` }]);
    try {
      // announce: the server itself writes the ✅ / ⚠️ result into the chat, even if this window is closed meanwhile
      await decksApi({ action: "generate", chatId: cid, topic, slides, style: look || undefined, announce: true });
    } catch { /* the server already wrote the reason into the chat */ }
    setDeckBusy(false);
  }

  function submit(e: React.FormEvent) {
    stopDictation();
    // "/business ..." or "set up a team for my business": the Business Hub opens, and what was typed is sent there as the first message
    const hub = wantsBusinessHub(draft);
    if (hub !== null && attach.length === 0 && !replyTo) {
      e.preventDefault();
      setDraft("");
      router.push(`/business${hub ? `?say=${encodeURIComponent(hub.slice(0, 1500))}` : ""}`);
      return;
    }
    const c = /^\s*\/deck(?:\s+([\s\S]*))?$/i.exec(draft);
    if (c && chatId && user) {
      e.preventDefault();
      if (deckBusy) return;
      const text = draft.trim();
      setDraft("");
      void runDeck(text, (c[1] ?? "").trim());
      return;
    }
    // no command needed: "presentation bana do ..." / "make slides for ..." in a normal message does the same
    if (!c && chatId && user && !deckBusy && attach.length === 0 && !replyTo && wantsNewDeck(draft)) {
      e.preventDefault();
      const text = draft.trim();
      setDraft("");
      void runDeck(text, text, true);
      return;
    }
    onSubmit(e);
  }

  // clicking a reply icon puts the cursor straight into the message box
  useEffect(() => { if (replyTo) inputRef.current?.focus(); }, [replyTo?.at, replyTo]);

  // the box grows with the text (up to a limit) and shrinks back after sending
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [draft]);

  const before = draft.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  const q = norm(m?.[2] ?? "");
  const matches = m ? mentionables.filter((a) => !q || norm(a.name).includes(q)).slice(0, 6) : [];
  const open = Boolean(m) && !closed && mentionables.length > 0;
  const active = Math.min(idx, Math.max(0, matches.length - 1));

  const uploading = attach.some((a) => a.status === "uploading");
  const hasReady = attach.some((a) => a.status === "ready");
  const counted = attach.filter((a) => a.status !== "error");
  const overall = counted.length ? pct(counted.reduce((s, a) => s + (a.status === "ready" ? 1 : a.progress), 0) / counted.length) : 0;
  const canSend = (Boolean(draft.trim()) || hasReady) && !sending && !uploading;
  const full = attach.length >= MAX_ATTACH_FILES;
  // an empty box shows the voice-call button where the send arrow will be (like the waveform button in Claude)
  const showCall = !canSend && !sending && !uploading;

  function pick(a: Mentionable) {
    if (!m) return;
    const token = "@" + a.name.replace(/\s+/g, "_");
    const start = m.index + m[1].length;
    const next = draft.slice(0, start) + token + " " + draft.slice(caret);
    const pos = start + token.length + 1;
    setDraft(next);
    onMention(token, a.id);
    setClosed(true);
    setCaret(pos);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(pos, pos); });
  }

  /** put some text at the start of the box (used by the "+" menu) and focus it */
  function seed(text: string) {
    setDraft(text + draft);
    setPlusOpen(false);
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); const p = text.length + draft.length; el.setSelectionRange(p, p); setCaret(p); } });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx((active + 1) % Math.max(1, matches.length)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setIdx((active - 1 + matches.length) % Math.max(1, matches.length)); return; }
      if ((e.key === "Enter" || e.key === "Tab") && matches[active]) { e.preventDefault(); pick(matches[active]); return; }
      if (e.key === "Escape") { e.preventDefault(); setClosed(true); return; }
    }
    if (e.key === "Escape" && replyTo) { e.preventDefault(); onClearReply(); return; }
    // Enter sends, Shift+Enter writes a new line (never while an IME / voice keyboard is still composing)
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      // on a phone the Enter key writes a new line (the arrow button sends); on a computer Enter sends
      const phone = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 768;
      if (phone) return;
      e.preventDefault();
      if (canSend) e.currentTarget.form?.requestSubmit();
    }
  }

  const syncCaret = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);

  const placeholder = replyTo
    ? "Tell the agent what to do with this reply…"
    : attach.length
      ? "Say what to do with the file(s)… or just press send"
      : `Message ${agentName}`;

  const roundBtn = "press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel2 text-muted transition-colors hover:text-ink sm:h-9 sm:w-9";

  return (
    <div className={`mx-auto w-full max-w-2xl px-3 pt-2 sm:px-6 ${hero ? "pb-3" : "pb-[max(0.75rem,var(--sab))]"}`}>
      <style>{CSS}</style>

      {replyTo && (
        <div className="cc-in mb-2 flex items-start gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-2 rounded-xl border-l-2 border-gold bg-panel px-3 py-2">
            <CornerUpLeft size={14} className="mt-0.5 shrink-0 text-gold" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-gold">Replying to {agentName}</p>
              <p className="line-clamp-2 break-words text-xs text-muted">{replyTo.preview}</p>
            </div>
          </div>
          <button type="button" onClick={onClearReply} aria-label="Cancel reply" className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={14} /></button>
        </div>
      )}

      {deckBusy && (
        <p className="cc-in mb-2 flex items-center gap-2 px-3 text-[11px] text-gold" aria-live="polite">
          <Loader2 size={12} className="animate-spin" /> Designing your presentation… {deckSecs}s <span className="text-faint">· you can keep chatting</span>
        </p>
      )}

      <form
        onSubmit={submit}
        onDragEnter={(e) => { if (e.dataTransfer?.types?.includes("Files")) { dragDepth.current++; setDragging(true); } }}
        onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => {
          dragDepth.current = 0; setDragging(false);
          const f = Array.from(e.dataTransfer?.files ?? []);
          if (f.length) { e.preventDefault(); onPickFiles(f); }
        }}
        className="relative w-full"
      >
        {/* @mention list */}
        {open && (
          <div role="listbox" aria-label="Mention an agent" className="cc-in glass-m absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
            <p className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11px] text-faint">
              <AtSign size={11} /> Use another agent&rsquo;s work in this task
            </p>
            {matches.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted">No agent matches &ldquo;{m?.[2]}&rdquo;.</p>
            ) : (
              matches.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); pick(a); }}
                  onMouseEnter={() => setIdx(i)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === active ? "bg-panel2" : ""}`}
                >
                  <BotAvatar color={a.color} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{a.name}{a.hint ? <span className="ml-2 text-[11px] text-faint">{a.hint}</span> : null}</span>
                    <span className="block truncate text-[11px] text-muted">{a.preview}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {/* the "+" menu */}
        {plusOpen && (
          <div ref={plusRef} role="menu" className="cc-in absolute bottom-full left-0 z-30 mb-2 w-[min(300px,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-line bg-panel p-1.5 shadow-2xl">
            <button type="button" role="menuitem" onClick={() => { setPlusOpen(false); fileRef.current?.click(); }} className="press flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm text-ink hover:bg-panel2">
              <Paperclip size={17} className="text-muted" />
              <span className="min-w-0 flex-1"><span className="block">Add files or photos</span><span className="block text-[11px] text-faint">{full ? `Up to ${MAX_ATTACH_FILES} files at a time` : "Photo, video, zip, PDF or any file"}</span></span>
            </button>
            {chatId && (
              <button type="button" role="menuitem" onClick={() => seed("/deck ")} className="press flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm text-ink hover:bg-panel2">
                <Presentation size={17} className="text-muted" />
                <span className="min-w-0 flex-1"><span className="block">Make a presentation</span><span className="block text-[11px] text-faint">Slides in one or two minutes</span></span>
              </button>
            )}
            {mentionables.length > 0 && (
              <button type="button" role="menuitem" onClick={() => seed("@")} className="press flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm text-ink hover:bg-panel2">
                <AtSign size={17} className="text-muted" />
                <span className="min-w-0 flex-1"><span className="block">Use another agent</span><span className="block text-[11px] text-faint">Bring its work into this task</span></span>
              </button>
            )}
            {onToggleAuto && (
              <>
                <div className="mx-2 my-1 h-px bg-line" />
                <button type="button" role="menuitemcheckbox" aria-checked={Boolean(autoMode)} onClick={() => onToggleAuto()} className="press flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm text-ink hover:bg-panel2">
                  {autoMode ? <Zap size={17} className="text-gold" /> : <Hand size={17} className="text-muted" />}
                  <span className="min-w-0 flex-1">
                    <span className="block">{autoMode ? "Automatic" : "Manual"}</span>
                    <span className="block text-[11px] text-faint">{autoMode ? "Works without asking. Still asks before spending money or deleting." : "Asks before sending, posting or changing things."}</span>
                  </span>
                  <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${autoMode ? "bg-gold" : "bg-line"}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${autoMode ? "left-[18px]" : "left-0.5"}`} />
                  </span>
                </button>
              </>
            )}
          </div>
        )}

        {/* the message box: files + their progress, the text, and a bottom row with + / model / mic / send */}
        <div
          className={`glass-m relative overflow-hidden rounded-[30px] border bg-panel transition-[border-color,box-shadow] duration-200 ${
            dragging ? "border-gold shadow-[0_0_0_3px_rgba(231,178,77,.18)]" : "border-line focus-within:border-gold/50 focus-within:shadow-[0_0_0_3px_rgba(231,178,77,.07)]"
          }`}
        >
          {uploading && (
            <div className="absolute inset-x-0 top-0 z-10 h-[2px] bg-white/5" aria-hidden="true">
              <div className="h-full rounded-r-full bg-gold transition-[width] duration-300 ease-out" style={{ width: `${Math.max(3, overall)}%` }} />
            </div>
          )}

          {dragging && (
            <div className="cc-in absolute inset-0 z-20 flex items-center justify-center gap-2 bg-panel/95 text-sm font-medium text-gold">
              <UploadCloud size={18} /> Drop files to attach
            </div>
          )}

          {attach.length > 0 && (
            <div className="border-b border-line/70 px-3 pb-2 pt-3">
              <div className="cc-strip flex gap-2 overflow-x-auto" role="list" aria-label="Attached files">
                {attach.map((a) => (
                  <FileChip key={a.id} a={a} onRemove={() => onRemoveAttach(a.id)} />
                ))}
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 px-0.5 text-[11px] text-faint" aria-live="polite">
                {uploading ? (
                  <><Loader2 size={11} className="animate-spin text-gold" /><span className="text-gold">Uploading {overall}%</span><span>· send unlocks when it finishes</span></>
                ) : (
                  <><Check size={11} className="text-avatar-teal" /><span>{attach.length} file{attach.length > 1 ? "s" : ""} attached</span></>
                )}
              </p>
            </div>
          )}

          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onPickFiles(f); }} />

          <textarea
            ref={inputRef}
            rows={hero ? 2 : 1}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); syncCaret(e.target); setClosed(false); setIdx(0); }}
            onKeyDown={onKeyDown}
            onPaste={(e) => { const f = Array.from(e.clipboardData?.files ?? []); if (f.length) { e.preventDefault(); onPickFiles(f); } }}
            onKeyUp={(e) => syncCaret(e.currentTarget)}
            onClick={(e) => syncCaret(e.currentTarget)}
            onSelect={(e) => syncCaret(e.currentTarget)}
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="enter"
            aria-label={`Message ${agentName}`}
            placeholder={placeholder}
            className={`cc-ta block w-full resize-none bg-transparent px-5 pb-1 pt-4 text-[16px] leading-[24px] text-ink placeholder:text-faint focus:outline-none ${hero ? "min-h-[72px]" : "min-h-[52px]"}`}
            style={{ maxHeight: MAX_TEXTAREA_PX }}
          />

          <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
            <button
              type="button"
              aria-label="Add files, presentation or settings"
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              data-plus-btn=""
              title="Add files and more"
              onClick={() => setPlusOpen((v) => !v)}
              className={`${roundBtn} relative ${plusOpen ? "text-ink" : ""}`}
            >
              <Plus size={20} className={`transition-transform duration-200 ${plusOpen ? "rotate-45" : ""}`} />
              {attach.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold px-1 text-[10px] font-semibold leading-none text-bg">{attach.length}</span>
              )}
            </button>

            <div className="min-w-0 shrink">{modelSlot}</div>

            {onToggleAuto && (
              <button
                type="button"
                onClick={onToggleAuto}
                aria-pressed={Boolean(autoMode)}
                title={autoMode ? "Automatic: the agent does the work without asking. It still asks before spending money, deleting things, or acting on untrusted web content. Click for Manual." : "Manual: the agent asks before sending, posting or changing things. Click for Automatic."}
                className={`press hidden h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors sm:flex ${autoMode ? "border-gold/50 bg-gold/10 text-gold" : "border-line bg-transparent text-muted hover:text-ink"}`}
              >
                {autoMode ? <Zap size={13} /> : <Hand size={13} />}
                <span>{autoMode ? "Auto" : "Manual"}</span>
              </button>
            )}

            <span className="min-w-2 flex-1" />

            {canDictate && (
              <button
                type="button"
                onClick={toggleDictation}
                aria-pressed={listening}
                aria-label={listening ? "Stop dictation" : "Dictate with your voice"}
                title={listening ? "Stop dictation" : "Speak instead of typing"}
                className={`${roundBtn} ${listening ? "animate-pulse !bg-red-500/15 !text-red-300" : ""}`}
              >
                <Mic size={19} />
              </button>
            )}

            {showCall ? (
              <CallButton agentName={agentName} chatId={chatId} variant="voice" />
            ) : (
              <SendButton canSend={canSend} uploading={uploading} overall={overall} sending={sending} />
            )}
          </div>
        </div>
      </form>

      {!hero && !draft && !attach.length && !replyTo && (
        <p className="mt-1.5 hidden truncate px-12 text-center text-[11px] text-faint sm:block">
          @agent · /deck (or just ask for a presentation) · /code · /video · /team · /business · /deploy · /recipe &nbsp;—&nbsp; Shift+Enter for a new line
        </p>
      )}
    </div>
  );
}
