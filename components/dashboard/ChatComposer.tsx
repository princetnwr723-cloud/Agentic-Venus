"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertCircle, ArrowUp, AtSign, Check, CornerUpLeft, File as FileIcon, FileArchive, FileCode2, FileSpreadsheet, FileText,
  Film, Image as ImageIcon, Loader2, Music, Paperclip, Presentation, UploadCloud, X,
} from "lucide-react";
import { MAX_ATTACH_FILES, badgeOf, humanSize, shortName, type Attachment, type AttachKind } from "@/lib/attachments";
import CallButton from "@/components/dashboard/CallButton";
import BotAvatar from "@/components/BotAvatar";
import type { AvatarColor } from "@/lib/bots";

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

/** The send button: arrow when ready, a progress ring while files upload, a spinner while the agent starts. */
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
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
        canSend ? "bg-white text-bg shadow-[0_2px_10px_rgba(231,178,77,.25)] hover:scale-105 active:scale-95" : "bg-panel2 text-faint"
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
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <ArrowUp size={17} strokeWidth={2.4} />
      )}
    </button>
  );
}

export default function ChatComposer({
  draft, setDraft, onSubmit, sending, agentName, attach, onPickFiles, onRemoveAttach,
  mentionables, onMention, replyTo, onClearReply, chatId,
}: {
  draft: string; setDraft: (v: string) => void; onSubmit: (e: React.FormEvent) => void; sending: boolean; agentName: string;
  attach: Attachment[]; onPickFiles: (f: File[]) => void; onRemoveAttach: (id: string) => void;
  mentionables: Mentionable[]; onMention: (token: string, id: string) => void;
  replyTo: { at: number; preview: string } | null; onClearReply: () => void;
  /** Optional: when given, the call button rings exactly this chat's agent. Without it the agent is found by its name. */
  chatId?: string;
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
  const [caret, setCaret] = useState(0);
  const [closed, setClosed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

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

  return (
    <div className="mx-auto w-full max-w-2xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
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

      <form
        onSubmit={onSubmit}
        onDragEnter={(e) => { if (e.dataTransfer?.types?.includes("Files")) { dragDepth.current++; setDragging(true); } }}
        onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => {
          dragDepth.current = 0; setDragging(false);
          const f = Array.from(e.dataTransfer?.files ?? []);
          if (f.length) { e.preventDefault(); onPickFiles(f); }
        }}
        className="relative flex w-full items-end gap-1.5"
      >
        {open && (
          <div role="listbox" aria-label="Mention an agent" className="cc-in absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
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

        <div className="pb-2"><CallButton agentName={agentName} chatId={chatId} /></div>

        {/* the message box: files + their progress, the text, the attach button and the send arrow, all inside */}
        <div
          className={`relative min-w-0 flex-1 overflow-hidden rounded-[26px] border bg-panel transition-[border-color,box-shadow] duration-200 ${
            dragging ? "border-gold shadow-[0_0_0_3px_rgba(231,178,77,.18)]" : "border-line focus-within:border-gold/60 focus-within:shadow-[0_0_0_3px_rgba(231,178,77,.08)]"
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
            <div className="border-b border-line/70 px-2.5 pb-2 pt-2.5">
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

          <div className="flex items-end gap-1 px-1.5 py-1.5">
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onPickFiles(f); }} />
            <button
              type="button"
              aria-label="Attach files (photo, video, zip, PDF, any file)"
              title={full ? `Up to ${MAX_ATTACH_FILES} files at a time` : "Attach photo, video, zip, PDF or any file"}
              onClick={() => fileRef.current?.click()}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-panel2 hover:text-ink active:scale-95"
            >
              <Paperclip size={18} />
              {attach.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold px-1 text-[10px] font-semibold leading-none text-bg">{attach.length}</span>
              )}
            </button>

            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); syncCaret(e.target); setClosed(false); setIdx(0); }}
              onKeyDown={onKeyDown}
              onPaste={(e) => { const f = Array.from(e.clipboardData?.files ?? []); if (f.length) { e.preventDefault(); onPickFiles(f); } }}
              onKeyUp={(e) => syncCaret(e.currentTarget)}
              onClick={(e) => syncCaret(e.currentTarget)}
              onSelect={(e) => syncCaret(e.currentTarget)}
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="send"
              aria-label={`Message ${agentName}`}
              placeholder={placeholder}
              className="cc-ta min-h-[36px] min-w-0 flex-1 resize-none self-center bg-transparent px-1.5 py-[7px] text-[15px] leading-[22px] text-ink placeholder:text-faint focus:outline-none"
              style={{ maxHeight: MAX_TEXTAREA_PX }}
            />

            <SendButton canSend={canSend} uploading={uploading} overall={overall} sending={sending} />
          </div>
        </div>
      </form>

      {!draft && !attach.length && !replyTo && (
        <p className="mt-1.5 hidden truncate px-12 text-center text-[11px] text-faint sm:block">
          @agent · /code · /video · /team · /deploy · /recipe &nbsp;—&nbsp; Shift+Enter for a new line
        </p>
      )}
    </div>
  );
}