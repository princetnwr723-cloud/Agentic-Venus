"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, Check, CheckCircle2, Copy, CornerUpLeft, Repeat, Reply, RotateCcw, Wrench, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ChatMessage } from "@/lib/chats";
import Markdown from "@/components/Markdown";
import { splitSuggestions } from "@/lib/suggest";
import { extractToolCalls } from "@/lib/tools/prompt";
import { splitAttachmentBlock, type AttachKind } from "@/lib/attachments";
import { previewFor } from "@/lib/attach-client";
import { parseWork } from "@/lib/chat-files";
import AttachCard from "@/components/dashboard/AttachCard";
import FileCard from "@/components/dashboard/FileCard";
import { CodeCard, LiveComputerCard, ReplayCard, VideoCard } from "@/components/dashboard/WorkCards";
import FountFeedback from "@/components/fount/FountFeedback";
import ConnectCard, { parseConnectCard } from "@/components/dashboard/ConnectCard";
import PayCards from "@/components/dashboard/PayCard";

// runs before the screen is painted (so a chat never flashes at its top), and falls back to useEffect where there is no screen
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

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

/** What to show for one message: the text without any tool-call markers, the next-step chips, and whether it is just noise. */
function viewOf(m: ChatMessage) {
  if (m.role !== "assistant") return { body: m.content, next: [] as string[], empty: false, toolName: "" };
  const split = splitSuggestions(m.content);
  const body = extractToolCalls(split.body).clean; // old messages that still hold a raw [[TOOL:...]] show clean
  const tool = /^🔧\s*Using\s+(.+?)…?$/.exec(body.trim());
  return { body, next: split.next, empty: /^[.\u2026\s]*$/.test(body), toolName: tool ? tool[1] : "" };
}

// A reply that starts with ✅ / ⚠️ / ❌ gets a clear status line on top instead of a loose emoji.
const STATUS: Array<{ re: RegExp; label: string; cls: string; Icon: LucideIcon }> = [
  { re: /^\s*(?:✅|✔️|☑️)\s*/u, label: "Done", cls: "border-avatar-teal/30 bg-avatar-teal/10 text-avatar-teal", Icon: CheckCircle2 },
  { re: /^\s*(?:⚠️|⚠)\s*/u, label: "Needs your attention", cls: "border-avatar-amber/30 bg-avatar-amber/10 text-avatar-amber", Icon: AlertTriangle },
  { re: /^\s*(?:❌|⛔|🚫)\s*/u, label: "Could not finish", cls: "border-red-400/30 bg-red-400/10 text-red-300", Icon: XCircle },
];

function statusOf(text: string): { text: string; s: (typeof STATUS)[number] | null } {
  for (const s of STATUS) {
    const m = s.re.exec(text);
    if (m && text.length > m[0].length + 2) return { text: text.slice(m[0].length), s };
  }
  return { text, s: null };
}

export default function ChatThread({
  chatId,
  messages,
  pending,
  busy,
  onSaveAsRoutine,
  onSuggest,
  onReply,
  onRetry,
  replyingAt,
  agentName,
}: {
  chatId?: string;
  messages: ChatMessage[];
  pending?: boolean;
  busy?: boolean;
  onSaveAsRoutine?: (text: string) => void;
  onSuggest?: (text: string) => void;
  onReply?: (preview: string, at: number) => void;
  onRetry?: (text: string) => void;
  replyingAt?: number | null;
  agentName?: string;
}) {
  const [copied, setCopied] = useState<number | null>(null);
  const [showDown, setShowDown] = useState(false); // true = the reader scrolled up, so the "scroll to latest" button is shown

  // ---- the chat always opens at its LATEST message, and follows new ones while you are at the bottom
  const root = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // true = the reader is at (or near) the bottom, so new content keeps the view at the bottom
  const seen = useRef(0);
  const smoothing = useRef(false); // true while the button's smooth scroll is running (so it is not mistaken for the reader scrolling up)

  const scroller = useCallback((): HTMLElement | null => {
    let el = root.current?.parentElement ?? null;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") return el;
      el = el.parentElement;
    }
    return null;
  }, []);
  const toBottom = useCallback(() => {
    const el = scroller();
    if (el) el.scrollTop = el.scrollHeight;
  }, [scroller]);

  // the round button: glide down to the latest message and follow new ones again
  const goLatest = useCallback(() => {
    const el = scroller();
    if (!el) return;
    stick.current = true;
    smoothing.current = true;
    setShowDown(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    window.setTimeout(() => { smoothing.current = false; if (stick.current) toBottom(); }, 600);
  }, [scroller, toBottom]);

  // another chat was opened: jump to the bottom at once, and once more while cards, images and long replies finish drawing
  useIsoLayoutEffect(() => {
    stick.current = true;
    seen.current = messages.length;
    toBottom();
    const timers = [60, 220, 600, 1300].map((ms) => window.setTimeout(() => { if (stick.current) toBottom(); }, ms));
    return () => timers.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // remember whether the reader scrolled up (then new content must not pull them down) or is back at the bottom
  useEffect(() => {
    const el = scroller();
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (!smoothing.current) stick.current = gap < 140;
      setShowDown(smoothing.current ? false : gap > 240);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [chatId, scroller]);

  // the content grows after the first paint (markdown, cards, the live computer, the run bar): stay at the bottom while it does
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stick.current) toBottom();
      else { const el = scroller(); if (el && !smoothing.current) setShowDown(el.scrollHeight - el.scrollTop - el.clientHeight > 240); }
    });
    if (root.current) ro.observe(root.current);
    const wrap = scroller()?.firstElementChild;
    if (wrap) ro.observe(wrap);
    return () => ro.disconnect();
  }, [chatId, scroller, toBottom]);

  // a new message (or a streaming reply): sending a message always brings you down to it
  useIsoLayoutEffect(() => {
    const n = messages.length;
    if (n > seen.current && messages[n - 1]?.role === "user") stick.current = true;
    seen.current = n;
    if (stick.current) toBottom();
  }, [messages, pending, busy, toBottom]);

  return (
    <div ref={root} className="space-y-4">
      {messages.map((m, i) => {
        const isAssistant = m.role === "assistant";
        const { body, next, empty, toolName } = viewOf(m);
        const isLast = i === messages.length - 1;
        // an empty "…" bubble or an old "Using tool…" line is only a placeholder: once anything follows it, it is gone
        if (isAssistant && (empty || toolName) && !(isLast && (busy || pending))) return null;
        if (isAssistant && toolName) {
          return (
            <div key={i} data-msg={i} className="flex flex-col items-start">
              <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted">
                <Wrench size={13} className="text-gold" aria-hidden="true" />
                <span>Using <span className="font-mono text-ink">{toolName}</span>…</span>
              </div>
            </div>
          );
        }
        const active = replyingAt != null && replyingAt === m.at;
        // The agent asked to connect a service: show the logo card with a Connect button instead of text.
        const card = isAssistant ? parseConnectCard(m.content) : null;
        // Finished work and files: the text is cleaned and the files / video / replay / code preview become cards of their own.
        const work = isAssistant && !card ? parseWork(body) : null;
        const st = work ? statusOf(work.text) : { text: "", s: null };
        const shownText = work ? st.text : body;
        const cardCount = work ? work.files.length + (work.replay ? 1 : 0) + (work.video ? 1 : 0) + (work.code ? 1 : 0) : 0;
        const showBubble = Boolean(card) || Boolean(shownText.trim()) || cardCount === 0;
        const fresh = Date.now() - (m.at ?? 0) < 10 * 60_000;
        const sameSpeaker = i > 0 && messages[i - 1].role === "assistant";
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
                {(() => {
                  const sent = splitAttachmentBlock(m.content);
                  return (
                    <>
                      {sent.files.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-2">
                          {sent.files.map((f, k) => <AttachCard key={k} name={f.name} kind={f.kind as AttachKind} preview={f.id ? previewFor(f.id) : undefined} />)}
                        </div>
                      )}
                      {(sent.text.trim() || sent.files.length === 0) && <div className="whitespace-pre-wrap rounded-2xl rounded-tr-md bg-ink px-4 py-2.5 text-sm leading-relaxed text-bg">{sent.text}</div>}
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="w-full max-w-[85%]">
                {agentName && !sameSpeaker && <p className="mb-1 ml-1 text-[11px] font-medium tracking-wide text-faint">{agentName}</p>}
                {showBubble && (
                  <div className={`rounded-2xl rounded-tl-md border bg-panel2 px-4 py-3 text-sm leading-relaxed text-ink shadow-panel transition-colors ${active ? "border-gold/70" : "border-line"}`}>
                    {st.s && (
                      <div className={`mb-2.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${st.s.cls}`}>
                        <st.s.Icon size={13} /> {st.s.label}
                      </div>
                    )}
                    {card ? <ConnectCard card={card} /> : <Markdown text={shownText || "…"} />}
                  </div>
                )}

                {work && cardCount > 0 && (
                  <div className={`${showBubble ? "mt-2.5" : ""} space-y-2.5`}>
                    {work.code && <CodeCard chatId={work.code.chatId} status={work.code.status} fresh={fresh} />}
                    {work.video && <VideoCard path={work.video.path} projectId={work.video.projectId} title={work.video.title} />}
                    {work.replay && <ReplayCard path={work.replay.path} />}
                    {work.files.map((f) => <FileCard key={f.path} file={f} />)}
                  </div>
                )}

                <div className="mt-1 flex items-center gap-0.5">
                  {onReply && (
                    <Tool label="Reply to this message (select text first to reply to a part)" active={active} onClick={(e) => onReply(quoteOf(e, body), m.at)}>
                      <Reply size={14} />
                    </Tool>
                  )}
                  {!card && (
                  <Tool
                    label="Copy"
                    onClick={() => { navigator.clipboard?.writeText(work ? work.text : body); setCopied(i); setTimeout(() => setCopied((v) => (v === i ? null : v)), 1200); }}
                  >
                    {copied === i ? <Check size={14} className="text-avatar-teal" /> : <Copy size={14} />}
                  </Tool>
                  )}
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
                  {isLast && chatId && !empty && <FountFeedback chatId={chatId} />}
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
          <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-line bg-panel2 px-4 py-3">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-faint" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-faint [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-faint [animation-delay:300ms]" />
          </div>
        </div>
      )}

      {/* The computer starts working: its live screen appears right here in the chat, and goes away when the task ends */}
      {chatId && <LiveComputerCard chatId={chatId} agentName={agentName} />}

      {/* The agent wants to pay: its message and the order card (product, card, total, Allow / Deny) right here in the chat */}
      {chatId && <PayCards chatId={chatId} agentName={agentName} />}

      {/* "scroll to latest" button: sticks to the bottom of the chat window while the reader is up in older messages */}
      <div className="pointer-events-none sticky bottom-2 z-10 !mt-0 h-0">
        <button
          type="button"
          onClick={goLatest}
          title="Scroll to latest"
          aria-label="Scroll to latest message"
          tabIndex={showDown ? 0 : -1}
          className={`pointer-events-auto absolute bottom-0 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-panel2 text-ink shadow-panel transition-all duration-200 hover:border-gold hover:text-gold ${showDown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
        >
          <ArrowDown size={16} />
        </button>
      </div>
    </div>
  );
}