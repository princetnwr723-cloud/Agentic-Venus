import { useEffect, useRef, useState } from "react";
import { ArrowUp, AtSign, Clapperboard, CornerUpLeft, Monitor, Paperclip, Plus, X } from "lucide-react";
import type { Attachment } from "@/lib/attachments";
import AttachCard from "@/components/dashboard/AttachCard";
import CallButton from "@/components/dashboard/CallButton";
import BotAvatar from "@/components/BotAvatar";
import GlassSheet from "@/components/ui/GlassSheet";
import { useIsMobile } from "@/lib/mobile-ui";
import type { AvatarColor } from "@/lib/bots";

export type Mentionable = { id: string; name: string; color: AvatarColor; hint: string; preview: string };

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g, "");

export default function ChatComposer({
  draft, setDraft, onSubmit, sending, agentName, hasComputerKey, computerMode, onToggleComputer, attach, onPickFiles, onRemoveAttach,
  mentionables, onMention, replyTo, onClearReply, chatId, onTemplates,
}: {
  draft: string; setDraft: (v: string) => void; onSubmit: (e: React.FormEvent) => void; sending: boolean; agentName: string;
  hasComputerKey: boolean; computerMode: boolean; onToggleComputer: () => void;
  attach: Attachment[]; onPickFiles: (f: File[]) => void; onRemoveAttach: (id: string) => void;
  mentionables: Mentionable[]; onMention: (token: string, id: string) => void;
  replyTo: { at: number; preview: string } | null; onClearReply: () => void;
  /** Optional: when given, the call button rings exactly this chat's agent. Without it the agent is found by its name. */
  chatId?: string;
  /** Opens the video templates window (save the style of a video, make a new video in the same style). */
  onTemplates?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [closed, setClosed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [plus, setPlus] = useState(false);
  const mobile = useIsMobile();

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

  const placeholder = replyTo
    ? mobile ? "Reply to this…" : "Tell the agent what to do with this reply…"
    : attach.length
    ? mobile ? "Say what to do with the file(s)…" : "Say what to do with the file(s)… (or just press send)"
    : computerMode
    ? "Give the computer a task…"
    : mobile ? `Message ${agentName}` : `Message ${agentName}  ·  @agent  /code  /video  /team  /deploy  /recipe`;

  const tile = "tile-in press flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-left";

  return (
    <div className="mx-auto w-full max-w-2xl md:border-t md:border-line">
      {replyTo && (
        <div className="flex items-start gap-2 px-3 pt-2 md:px-6 md:pt-3">
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
        className="relative w-full px-3 pb-[calc(0.5rem+var(--sab))] pt-2 md:px-6 md:py-4"
      >
        {open && (
          <div role="listbox" aria-label="Mention an agent" className="glass-m absolute bottom-full left-3 right-3 z-20 mb-2 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl md:left-6 md:right-6 md:mb-1 md:rounded-xl">
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

        {attach.length > 0 && (
          <div className="mb-3 flex flex-nowrap gap-2 overflow-x-auto md:flex-wrap md:overflow-visible">
            {attach.map((a) => (
              <AttachCard key={a.id} name={a.name} kind={a.kind} preview={a.preview} status={a.status} progress={a.progress} error={a.error} onRemove={() => onRemoveAttach(a.id)} />
            ))}
          </div>
        )}

        {/* phone: tells you that computer mode is on (the switch itself is in the + sheet) */}
        {hasComputerKey && computerMode && (
          <button type="button" onClick={onToggleComputer} className="press mb-2 flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-xs font-medium text-bg md:hidden">
            <Monitor size={13} /> Computer mode on · tap to turn off
          </button>
        )}

        <div className="glass-m flex w-full items-center gap-1 rounded-[28px] border border-transparent p-1.5 transition-shadow focus-within:shadow-[0_0_0_1px_rgba(231,178,77,0.5),0_0_32px_rgba(231,178,77,0.14)] md:gap-2 md:rounded-none md:p-0 md:focus-within:shadow-none">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onPickFiles(f); }} />

        {/* phone: one + button instead of three icons */}
        <button type="button" aria-label="Add to message" onClick={() => setPlus(true)} className="press order-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-ink md:hidden"><Plus size={20} /></button>

        <button type="button" aria-label="Attach files (photo, video, zip, PDF, any file)" title="Attach photo, video, zip, PDF or any file" onClick={() => fileRef.current?.click()} className="hidden rounded-full p-2 text-muted hover:bg-panel2 md:inline-flex"><Paperclip size={18} /></button>
        <span className="order-3 flex md:order-none"><CallButton agentName={agentName} chatId={chatId} /></span>
        {onTemplates && (
          <button type="button" aria-label="Video templates" title="Video templates: save the style of a video, make a new video in the same style" onClick={onTemplates} className="hidden rounded-full p-2 text-muted hover:bg-panel2 hover:text-ink md:inline-flex"><Clapperboard size={18} /></button>
        )}
        {hasComputerKey && (
          <button type="button" onClick={onToggleComputer} aria-pressed={computerMode} title={computerMode ? "Computer mode ON — your message goes straight to the computer as a task" : "Computer mode — send your message straight to the computer as a task"} className={`hidden items-center gap-1.5 rounded-full px-2.5 py-2 text-xs md:flex ${computerMode ? "bg-gold font-medium text-bg" : "text-muted hover:bg-panel2 hover:text-ink"}`}>
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
          placeholder={placeholder}
          className="order-2 min-w-0 flex-1 rounded-full border border-transparent bg-transparent px-2 py-2.5 text-[15px] text-ink placeholder:text-faint focus:outline-none md:order-none md:border-line md:bg-panel md:px-4 md:text-sm md:focus:border-gold"
        />
        <button type="submit" aria-label="Send" disabled={(!draft.trim() && !attach.some((a) => a.status === "ready")) || sending || attach.some((a) => a.status === "uploading")} className="press order-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-bg hover:opacity-90 disabled:opacity-40 md:order-none md:h-auto md:w-auto md:p-2.5"><ArrowUp size={16} /></button>
        </div>
      </form>

      <GlassSheet open={plus} onClose={() => setPlus(false)} title="Add to your message">
        <div className="space-y-2.5 pb-1">
          <button type="button" className={tile} style={{ animationDelay: "40ms" }} onClick={() => { setPlus(false); fileRef.current?.click(); }}>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-avatar-sky/15 text-avatar-sky"><Paperclip size={19} /></span>
            <span><span className="block text-[13px] font-medium text-ink">Attach a file</span><span className="block text-[11px] text-muted">Photo, video, zip, PDF, anything</span></span>
          </button>
          {onTemplates && (
            <button type="button" className={tile} style={{ animationDelay: "90ms" }} onClick={() => { setPlus(false); setTimeout(onTemplates, 170); }}>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-avatar-violet/15 text-avatar-violet"><Clapperboard size={19} /></span>
              <span><span className="block text-[13px] font-medium text-ink">Video templates</span><span className="block text-[11px] text-muted">Copy the style of a video</span></span>
            </button>
          )}
          {hasComputerKey && (
            <button type="button" className={tile} style={{ animationDelay: "140ms" }} onClick={() => { onToggleComputer(); setPlus(false); }}>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-avatar-teal/15 text-avatar-teal"><Monitor size={19} /></span>
              <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-ink">Computer mode</span><span className="block text-[11px] text-muted">Your message goes straight to the computer as a task</span></span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${computerMode ? "bg-gold text-bg" : "bg-white/10 text-muted"}`}>{computerMode ? "ON" : "OFF"}</span>
            </button>
          )}
        </div>
      </GlassSheet>
    </div>
  );
}