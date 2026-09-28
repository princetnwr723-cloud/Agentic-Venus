// SAVE AS: components/dashboard/PcPanel.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ExternalLink,
  Hand,
  Loader2,
  Monitor,
  RefreshCw,
  Square,
  Trash2,
  X,
  Eye,
} from "lucide-react";

export type PcStatus = "idle" | "creating" | "loading" | "ready" | "error";

export default function PcPanel({
  agentName,
  hasComputer,
  status,
  error,
  screenUrl,
  steps,
  running,
  onClose,
  onStart,
  onReload,
  onDelete,
  onRunTask,
  onStop,
}: {
  agentName: string;
  hasComputer: boolean;
  status: PcStatus;
  error: string | null;
  screenUrl: string | null;
  steps: string[];
  running: boolean;
  onClose: () => void;
  onStart: () => void;
  onReload: () => void;
  onDelete: () => void;
  onRunTask: (task: string) => void;
  onStop: () => void;
}) {
  const [takeControl, setTakeControl] = useState(false);
  const [task, setTask] = useState("");
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length]);

  // Watch mode is view-only, so a stray tap can't disturb the agent. Taking
  // control just drops the view_only flag from the noVNC URL.
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

  return (
    <aside className="flex h-full w-[46%] min-w-[340px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <Monitor size={15} />
          {agentName}&rsquo;s computer
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === "ready" ? "bg-avatar-teal" : busy ? "bg-gold" : "bg-faint"
            }`}
          />
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
            </>
          )}
          {hasComputer && (
            <button
              onClick={onDelete}
              disabled={busy || running}
              title="Delete this computer"
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
              : "Waking the computer and opening its screen…"}
          </div>
        )}

        {!busy && !hasComputer && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <Monitor size={26} className="text-faint" />
            <p className="text-sm text-ink">
              Give {agentName} a computer of its own
            </p>
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

        {!busy && hasComputer && status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm text-ink">Couldn&rsquo;t open the screen</p>
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
            title={`${agentName} computer screen`}
            allow="clipboard-read; clipboard-write"
            className="h-full w-full border-0"
          />
        )}
      </div>

      {hasComputer && status === "ready" && (
        <div className="border-t border-line">
          {steps.length > 0 && (
            <div className="max-h-32 space-y-1 overflow-y-auto px-4 py-2 text-[11px] leading-relaxed text-muted">
              {steps.map((s, i) => (
                <p key={i}>{s}</p>
              ))}
              <div ref={logEnd} />
            </div>
          )}
          <form onSubmit={submit} className="flex items-center gap-2 px-3 py-3">
            <input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              disabled={running}
              placeholder={`Give ${agentName} a task on its computer…`}
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