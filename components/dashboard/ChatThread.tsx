import { Repeat } from "lucide-react";
import type { ChatMessage } from "@/lib/chats";
import Markdown from "@/components/Markdown";

export default function ChatThread({
  messages,
  pending,
  onSaveAsRoutine,
}: {
  messages: ChatMessage[];
  pending?: boolean;
  onSaveAsRoutine?: (text: string) => void;
}) {
  return (
    <div className="space-y-4">
      {messages.map((m, i) => (
        <div
          key={i}
          className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
        >
          {m.role === "user" ? (
            <div className="max-w-[75%] whitespace-pre-wrap rounded-xl bg-ink px-4 py-2.5 text-sm leading-relaxed text-bg">
              {m.content}
            </div>
          ) : (
            <div className="max-w-[85%] rounded-xl border border-line bg-panel2 px-4 py-2.5 text-sm leading-relaxed text-ink">
              <Markdown text={m.content} />
            </div>
          )}
          {m.role === "user" && onSaveAsRoutine && (
            <button
              onClick={() => onSaveAsRoutine(m.content)}
              className="mt-1 flex items-center gap-1 text-[11px] text-faint hover:text-muted"
            >
              <Repeat size={11} /> Repeat this on a schedule
            </button>
          )}
        </div>
      ))}

      {pending && (
        <div className="flex justify-start">
          <div className="flex items-center gap-1 rounded-xl border border-line bg-panel2 px-4 py-3">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-faint" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-faint [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-faint [animation-delay:300ms]" />
          </div>
        </div>
      )}
    </div>
  );
}