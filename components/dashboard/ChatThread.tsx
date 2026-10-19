"use client";

import { useState } from "react";
import { Check, Copy, CornerUpLeft, Repeat, Reply, RotateCcw } from "lucide-react";
import type { ChatMessage } from "@/lib/chats";
import Markdown from "@/components/Markdown";
import { splitSuggestions } from "@/lib/suggest";

function Tool({ label, onClick, active, children }: { label: string; onClick: (e: React.MouseEvent) => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()} // keeps the text selection alive so "reply to the selected part" works
      onClick={onClick}
      className={`rounded-md p-1.5 transition-colors ${active ? "bg-goldSoft text-gold" : "text-faint hover:bg-panel2 hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

/** The selected text inside this message, or the whole reply when nothing is selected. */
function quoteOf(e: React.MouseEvent, body: string): string {
  try {
    const sel = window.getSelection();
    const txt = sel ? sel.toString().trim() : "";
    const host = (e.currentTarget as HTMLElement).closest("[data-msg]");
    if (txt.length > 1 && host && sel && sel.anchorNode && host.contains(sel.anchorNode)) return txt.slice(0, 1200);
  } catch { /* use the whole reply */ }
  return body.trim().slice(0, 1200);
}

export default function ChatThread({
  messages,
  pending,
  busy,
  onSaveAsRoutine,
  onSuggest,
  onReply,
  onRetry,
  replyingAt,
}: {
  messages: ChatMessage[];
  pending?: boolean;
  busy?: boolean;
  onSaveAsRoutine?: (text: string) => void;
  onSuggest?: (text: string) => void;
  onReply?: (preview: string, at: number) => void;
  onRetry?: (text: string) => void;
  replyingAt?: number | null;
}) {
  const [copied, setCopied] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      {messages.map((m, i) => {
        const isAssistant = m.role === "assistant";
        const { body, next } = isAssistant ? splitSuggestions(m.content) : { body: m.content, next: [] as string[] };
        const isLast = i === messages.length - 1;
        const active = replyingAt != null && replyingAt === m.at;
        return (
          <div key={i} data-msg={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            {m.role === "user" ? (
              <div className="flex max-w-[75%] flex-col items-end gap-1">
                {m.replyTo && (
                  <div className="flex max-w-full items-start gap-1.5 rounded-lg border-l-2 border-gold/70 bg-panel px-2.5 py-1.5 text-[11px] text-muted">
                    <CornerUpLeft size={12} className="mt-0.5 shrink-0 text-gold" />
                    <span className="line-clamp-2 break-words">{m.replyTo.preview}</span>
                  </div>
                )}
                <div className="whitespace-pre-wrap rounded-xl bg-ink px-4 py-2.5 text-sm leading-relaxed text-bg">{m.content}</div>
              </div>
            ) : (
              <div className="max-w-[85%]">
                <div className={`rounded-xl border bg-panel2 px-4 py-2.5 text-sm leading-relaxed text-ink transition-colors ${active ? "border-gold/70" : "border-line"}`}>
                  <Markdown text={body || "…"} />
                </div>
                <div className="mt-1 flex items-center gap-0.5">
                  {onReply && (
                    <Tool label="Reply to this message (select text first to reply to a part)" active={active} onClick={(e) => onReply(quoteOf(e, body), m.at)}>
                      <Reply size={14} />
                    </Tool>
                  )}
                  <Tool
                    label="Copy"
                    onClick={() => { navigator.clipboard?.writeText(body); setCopied(i); setTimeout(() => setCopied((v) => (v === i ? null : v)), 1200); }}
                  >
                    {copied === i ? <Check size={14} className="text-avatar-teal" /> : <Copy size={14} />}
                  </Tool>
                  {onRetry && (
                    <Tool
                      label="Ask again"
                      onClick={() => {
                        for (let k = i - 1; k >= 0; k--) {
                          if (messages[k].role === "user") { onRetry(messages[k].content); return; }
                        }
                      }}
                    >
                      <RotateCcw size={14} />
                    </Tool>
                  )}
                </div>
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
            {isAssistant && isLast && next.length > 0 && onSuggest && (
              <div className="mt-2 flex max-w-[85%] flex-wrap gap-2">
                {next.map((n) => (
                  <button
                    key={n}
                    disabled={busy}
                    onClick={() => onSuggest(n)}
                    className="rounded-full border border-line bg-panel px-3 py-1.5 text-left text-xs text-ink transition-colors hover:border-gold hover:bg-panel2 disabled:opacity-40"
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

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