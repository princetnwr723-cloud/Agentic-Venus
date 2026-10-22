import { useEffect, useRef, useState } from "react";
import { ArrowUp, AtSign, CornerUpLeft, Monitor, Paperclip, X } from "lucide-react";
import { humanSize, type Attachment } from "@/lib/attachments";
import BotAvatar from "@/components/BotAvatar";
import type { AvatarColor } from "@/lib/bots";

export type Mentionable = { id: string; name: string; color: AvatarColor; hint: string; preview: string };

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g, "");

export default function ChatComposer({
  draft, setDraft, onSubmit, sending, agentName, hasComputerKey, computerMode, onToggleComputer, attach, onPickFiles, onRemoveAttach,
  mentionables, onMention, replyTo, onClearReply,
}: {
  draft: string; setDraft: (v: string) => void; onSubmit: (e: React.FormEvent) => void; sending: boolean; agentName: string;
  hasComputerKey: boolean; computerMode: boolean; onToggleComputer: () => void;
  attach: Attachment[]; onPickFiles: (f: File[]) => void; onRemoveAttach: (id: string) => void;
  mentionables: Mentionable[]; onMention: (token: string, id: string) => void;
  replyTo: { at: number; preview: string } | null; onClearReply: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [closed, setClosed] = useState(false);
  const [idx, setIdx] = useState(0);

  // clicking a reply icon puts the cursor straight into the message box
  useEffect(() => { if (replyTo) inputRef.current?.focus(); }, [replyTo?.at, replyTo]);

  const before = draft.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  const q = norm(m?.[2] ?? "");
  const matches = m ? mentionables.filter((a) => !q || norm(a.name).includes(q)).slice(0, 6) : [];
  const open = Boolean(m) && !closed && mentionables.length > 0;
  const active = Math.min(idx, Math.max(0, matches.length - 1));

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

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "Escape" && replyTo) { e.preventDefault(); onClearReply(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((active + 1) % Math.max(1, matches.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((active - 1 + matches.length) % Math.max(1, matches.length)); }
    else if ((e.key === "Enter" || e.key === "Tab") && matches[active]) { e.preventDefault(); pick(matches[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setClosed(true); }
  }

  const syncCaret = (el: HTMLInputElement) => setCaret(el.selectionStart ?? el.value.length);

  return (
    <div className="mx-auto w-full max-w-2xl border-t border-line">
      {replyTo && (
        <div className="flex items-start gap-2 px-6 pt-3">
          <div className="flex min-w-0 flex-1 items-start gap-2 rounded-lg border-l-2 border-gold bg-panel px-3 py-2">
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
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => { const f = Array.from(e.dataTransfer?.files ?? []); if (f.length) { e.preventDefault(); onPickFiles(f); } }}
        className="relative flex w-full items-center gap-2 px-6 py-4"
      >
        {open && (
          <div role="listbox" aria-label="Mention an agent" className="absolute bottom-full left-6 right-6 z-20 mb-1 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
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

        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onPickFiles(f); }} />
        <button type="button" aria-label="Attach files (photo, video, zip, PDF, any file)" title="Attach photo, video, zip, PDF or any file" onClick={() => fileRef.current?.click()} className="rounded-full p-2 text-muted hover:bg-panel2"><Paperclip size={18} /></button>
        {attach.length > 0 && <div className="flex max-w-[45%] flex-wrap gap-1">{attach.map((a) => (
          <span key={a.id} title={a.error || `${a.name} · ${humanSize(a.size)}`} className={`flex max-w-[210px] items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ${a.status === "error" ? "bg-red-500/15 text-red-300" : "bg-panel2 text-ink"}`}>
            <span className="truncate">{a.kind === "image" ? "🖼️" : a.kind === "video" ? "🎬" : a.kind === "audio" ? "🎵" : a.kind === "zip" ? "🗜️" : "📎"} {a.name}</span>
            <span className="shrink-0 text-faint">{a.status === "uploading" ? `${Math.round(a.progress * 100)}%` : a.status === "error" ? "⚠" : humanSize(a.size)}</span>
            <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemoveAttach(a.id)} className="text-faint hover:text-ink">×</button>
          </span>
        ))}</div>}
        {hasComputerKey && (
          <button type="button" onClick={onToggleComputer} aria-pressed={computerMode} title={computerMode ? "Computer mode ON — your message goes straight to the computer as a task" : "Computer mode — send your message straight to the computer as a task"} className={`flex items-center gap-1.5 rounded-full px-2.5 py-2 text-xs ${computerMode ? "bg-gold font-medium text-bg" : "text-muted hover:bg-panel2 hover:text-ink"}`}>
            <Monitor size={15} />{computerMode && "Computer"}
          </button>
        )}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); syncCaret(e.target); setClosed(false); setIdx(0); }}
          onKeyDown={onKeyDown}
          onPaste={(e) => { const f = Array.from(e.clipboardData?.files ?? []); if (f.length) { e.preventDefault(); onPickFiles(f); } }}
          onKeyUp={(e) => syncCaret(e.currentTarget)}
          onClick={(e) => syncCaret(e.currentTarget)}
          onSelect={(e) => syncCaret(e.currentTarget)}
          autoComplete="off"
          placeholder={replyTo ? "Tell the agent what to do with this reply…" : attach.length ? "Say what to do with the file(s)… (or just press send)" : computerMode ? "Give the computer a task…" : `Message ${agentName}  ·  @agent  /code  /video  /team  /deploy  /recipe`}
          className="flex-1 rounded-full border border-line bg-panel px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-gold"
        />
        <button type="submit" aria-label="Send" disabled={(!draft.trim() && !attach.some((a) => a.status === "ready")) || sending || attach.some((a) => a.status === "uploading")} className="rounded-full bg-white p-2.5 text-bg hover:opacity-90 disabled:opacity-40"><ArrowUp size={16} /></button>
      </form>
    </div>
  );
}