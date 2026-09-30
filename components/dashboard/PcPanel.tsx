"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ExternalLink,
  Eye,
  Hand,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  Play,
  Power,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";

export type PcStatus = "idle" | "creating" | "loading" | "ready" | "paused" | "error";

export type AgentRequest =
  | { kind: "login"; site: string }
  | { kind: "choice"; question: string; options: string[] }
  | { kind: "text"; question: string }
  | { kind: "handoff"; message: string };

export type RequestReply =
  | { type: "login"; email: string; password: string; remember: boolean }
  | { type: "self" }
  | { type: "answer"; text: string }
  | { type: "handoff_done" };

function RequestCard({
  request,
  onReply,
}: {
  request: AgentRequest;
  onReply: (r: RequestReply) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [text, setText] = useState("");

  const box = "mx-3 mb-2 rounded-lg border border-gold/60 bg-goldSoft/40 p-3";
  const input =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";

  if (request.kind === "login") {
    return (
      <div className={box}>
        <p className="mb-2 text-sm text-ink">
          Login needed{request.site ? ` · ${request.site}` : ""}
        </p>
        <div className="space-y-2">
          <input
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email or username"
            autoComplete="off"
            className={input}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="off"
            className={input}
          />
          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember for next time
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => onReply({ type: "self" })}
              className="flex-1 rounded-md border border-line py-2 text-xs text-ink hover:bg-panel2"
            >
              Do it myself
            </button>
            <button
              disabled={!email.trim() || !password}
              onClick={() =>
                onReply({ type: "login", email: email.trim(), password, remember })
              }
              className="flex-1 rounded-md bg-white py-2 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-faint">
            The password is typed on the computer for you — the AI model never sees it.
          </p>
        </div>
      </div>
    );
  }

  if (request.kind === "choice") {
    return (
      <div className={box}>
        <p className="mb-2 text-sm text-ink">{request.question}</p>
        <div className="flex flex-wrap gap-1.5">
          {request.options.map((o) => (
            <button
              key={o}
              onClick={() => onReply({ type: "answer", text: o })}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2"
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (request.kind === "text") {
    return (
      <div className={box}>
        <p className="mb-2 text-sm text-ink">{request.question}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onReply({ type: "answer", text: text.trim() });
          }}
          className="flex gap-2"
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your answer (e.g. the OTP)"
            autoComplete="one-time-code"
            className={input}
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="rounded-md bg-white px-3 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={box}>
      <p className="mb-2 text-sm text-ink">{request.message}</p>
      <button
        onClick={() => onReply({ type: "handoff_done" })}
        className="w-full rounded-md bg-white py-2 text-xs font-medium text-bg hover:opacity-90"
      >
        I&rsquo;m done, continue
      </button>
    </div>
  );
}

export default function PcPanel({
  hasComputer,
  status,
  error,
  screenUrl,
  steps,
  running,
  request,
  fullscreen,
  wide,
  onClose,
  onStart,
  onReload,
  onPause,
  onDelete,
  onRunTask,
  onStop,
  onReply,
  onToggleFullscreen,
}: {
  hasComputer: boolean;
  status: PcStatus;
  error: string | null;
  screenUrl: string | null;
  steps: string[];
  running: boolean;
  request: AgentRequest | null;
  fullscreen: boolean;
  wide: boolean;
  onClose: () => void;
  onStart: () => void;
  onReload: () => void;
  onPause: () => void;
  onDelete: () => void;
  onRunTask: (task: string) => void;
  onStop: () => void;
  onReply: (r: RequestReply) => void;
  onToggleFullscreen: () => void;
}) {
  const [takeControl, setTakeControl] = useState(false);
  const [task, setTask] = useState("");
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length, request]);

  // When the user chose "Do it myself", hand them the mouse automatically.
  useEffect(() => {
    if (request?.kind === "handoff" || (request?.kind === "login")) {
      // login card keeps watch mode; only handoff needs control
    }
    if (request?.kind === "handoff") setTakeControl(true);
  }, [request]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, onToggleFullscreen]);

  const src = useMemo(() => {
    if (!screenUrl) return null;
    const u = new URL(screenUrl);
    if (takeControl) u.searchParams.delete("view_only");
    else u.searchParams.set("view_only", "true");
    return u.toString();
  }, [screenUrl, takeControl]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = task.trim();
    if (!t || running) return;
    setTask("");
    onRunTask(t);
  }

  const busy = status === "creating" || status === "loading";
  const rootClass = fullscreen
    ? "fixed inset-0 z-[60] flex flex-col bg-panel"
    : `flex h-full ${wide ? "w-[62%]" : "w-[46%]"} min-w-[340px] shrink-0 flex-col border-l border-line bg-panel`;

  return (
    <aside className={rootClass}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <Monitor size={15} />
          Your team&rsquo;s computer
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === "ready" ? "bg-avatar-teal" : busy ? "bg-gold" : "bg-faint"
            }`}
          />
          {status === "paused" && <span className="text-[11px] text-muted">off · saved</span>}
        </div>
        <div className="flex items-center gap-0.5">
          {status === "ready" && (
            <>
              <button
                onClick={() => setTakeControl((v) => !v)}
                title={
                  takeControl
                    ? "Back to watch-only"
                    : "Take control with your own mouse/keyboard"
                }
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-panel2 hover:text-ink"
              >
                {takeControl ? <Eye size={13} /> : <Hand size={13} />}
                {takeControl ? "Watch" : "Take control"}
              </button>
              <button
                onClick={onReload}
                title="Reload the screen"
                className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-ink"
              >
                <RefreshCw size={14} />
              </button>
              {src && (
                <a
                  href={src}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the screen in its own tab"
                  className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-ink"
                >
                  <ExternalLink size={14} />
                </a>
              )}
              <button
                onClick={onPause}
                disabled={running}
                title="Turn the computer off (everything is saved)"
                className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-ink disabled:opacity-40"
              >
                <Power size={14} />
              </button>
            </>
          )}
          {hasComputer && (
            <button
              onClick={onToggleFullscreen}
              title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
              className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-ink"
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
          {hasComputer && (
            <button
              onClick={onDelete}
              disabled={busy || running}
              title="Delete this computer for good"
              className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-red-400 disabled:opacity-40"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={onClose}
            title="Close panel"
            className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-bg">
        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center text-xs text-muted">
            <Loader2 size={20} className="animate-spin" />
            {status === "creating"
              ? "Setting up a fresh computer — this can take up to a minute."
              : "Working on the computer…"}
          </div>
        )}

        {!busy && !hasComputer && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <Monitor size={26} className="text-faint" />
            <p className="text-sm text-ink">Give your team a computer</p>
            <p className="max-w-xs text-xs leading-relaxed text-muted">
              A private Linux desktop with a browser. You watch its screen live
              right here, and can take over any time.
            </p>
            <button
              onClick={onStart}
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
            >
              Create computer
            </button>
            {status === "error" && error && (
              <p className="max-w-sm break-words text-xs leading-relaxed text-red-300">
                {error}
              </p>
            )}
          </div>
        )}

        {!busy && hasComputer && status === "paused" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <Power size={26} className="text-faint" />
            <p className="text-sm text-ink">The computer is off</p>
            <p className="max-w-xs text-xs leading-relaxed text-muted">
              Everything on it — files, open apps, logins — is saved. Turn it on
              and it continues exactly where it stopped.
            </p>
            <button
              onClick={onReload}
              className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
            >
              <Play size={14} /> Turn on
            </button>
          </div>
        )}

        {!busy && hasComputer && status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm text-ink">Something went wrong</p>
            <p className="max-w-sm break-words text-xs leading-relaxed text-muted">
              {error}
            </p>
            <button
              onClick={onReload}
              className="rounded-full border border-line px-4 py-2 text-sm text-ink hover:bg-panel2"
            >
              Try again
            </button>
          </div>
        )}

        {status === "ready" && src && (
          <iframe
            key={src}
            src={src}
            title="Team computer screen"
            allow="clipboard-read; clipboard-write"
            className="h-full w-full border-0"
          />
        )}
      </div>

      {hasComputer && status === "ready" && (
        <div className="border-t border-line">
          {steps.length > 0 && (
            <div
              className={`${
                fullscreen ? "max-h-48" : "max-h-32"
              } space-y-1 overflow-y-auto px-4 py-2 text-[11px] leading-relaxed text-muted`}
            >
              {steps.map((s, i) => (
                <p key={i}>{s}</p>
              ))}
              <div ref={logEnd} />
            </div>
          )}

          {request && (
            <div className="pt-2">
              <RequestCard
                key={JSON.stringify(request)}
                request={request}
                onReply={onReply}
              />
            </div>
          )}

          <form onSubmit={submit} className="flex items-center gap-2 px-3 py-3">
            <input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              disabled={running}
              placeholder="Give it a task on the computer…"
              className="flex-1 rounded-full border border-line bg-bg px-4 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none disabled:opacity-60"
            />
            {running ? (
              <button
                type="button"
                onClick={onStop}
                title="Stop"
                className="rounded-full bg-red-500 p-2.5 text-white hover:opacity-90"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                title="Run task"
                disabled={!task.trim()}
                className="rounded-full bg-white p-2.5 text-bg hover:opacity-90 disabled:opacity-40"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </form>
          <p className="px-4 pb-3 text-[10px] leading-relaxed text-faint">
            Tasks need a vision-capable model (Claude, GPT-4o, Gemini…) — pick
            one in the chat&rsquo;s model picker.
          </p>
        </div>
      )}
    </aside>
  );
}