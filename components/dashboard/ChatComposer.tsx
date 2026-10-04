import { useRef } from "react";
import { ArrowUp, Monitor, Paperclip } from "lucide-react";

export default function ChatComposer({
  draft, setDraft, onSubmit, sending, agentName, hasComputerKey, computerMode, onToggleComputer, attach, onPickFile, onClearAttach,
}: {
  draft: string; setDraft: (v: string) => void; onSubmit: (e: React.FormEvent) => void; sending: boolean; agentName: string;
  hasComputerKey: boolean; computerMode: boolean; onToggleComputer: () => void;
  attach: { name: string } | null; onPickFile: (f: File) => void; onClearAttach: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-2xl items-center gap-2 border-t border-line px-6 py-4">
      <input ref={fileRef} type="file" hidden accept=".txt,.md,.csv,.json,.js,.ts,.tsx,.py,.html,.css,.log" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPickFile(f); }} />
      <button type="button" aria-label="Attach file" onClick={() => fileRef.current?.click()} className="rounded-full p-2 text-muted hover:bg-panel2"><Paperclip size={18} /></button>
      {attach && <span className="flex items-center gap-1 rounded-full bg-panel2 px-2.5 py-1 text-[11px] text-ink">📎 {attach.name}<button type="button" onClick={onClearAttach} className="text-faint hover:text-ink">×</button></span>}
      {hasComputerKey && (
        <button type="button" onClick={onToggleComputer} aria-pressed={computerMode} title={computerMode ? "Computer mode ON — your message goes straight to the computer as a task" : "Computer mode — send your message straight to the computer as a task"} className={`flex items-center gap-1.5 rounded-full px-2.5 py-2 text-xs ${computerMode ? "bg-gold font-medium text-bg" : "text-muted hover:bg-panel2 hover:text-ink"}`}>
          <Monitor size={15} />{computerMode && "Computer"}
        </button>
      )}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={computerMode ? "Give the computer a task…" : `Message ${agentName}  ·  /code  /video  /team  /deploy  /recipe`} className="flex-1 rounded-full border border-line bg-panel px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-gold" />
      <button type="submit" aria-label="Send" disabled={!draft.trim() || sending} className="rounded-full bg-white p-2.5 text-bg hover:opacity-90 disabled:opacity-40"><ArrowUp size={16} /></button>
    </form>
  );
}
