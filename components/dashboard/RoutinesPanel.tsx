"use client";

import { useEffect, useState } from "react";
import { Clock, Plus, Trash2, X } from "lucide-react";
import type { Routine } from "@/lib/routines";

const PRESETS = [
  { label: "Every hour", minutes: 60 },
  { label: "Every 6 hours", minutes: 360 },
  { label: "Every day", minutes: 1440 },
  { label: "Every week", minutes: 10080 },
];

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function relativeTo(ms: number) {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const label =
    mins < 60
      ? `${mins}m`
      : mins < 1440
      ? `${Math.round(mins / 60)}h`
      : `${Math.round(mins / 1440)}d`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

export default function RoutinesPanel({
  open,
  onClose,
  chatName,
  routines,
  prefillInstructions,
  busyId,
  onCreate,
  onToggle,
  onDelete,
  onRunNow,
}: {
  open: boolean;
  onClose: () => void;
  chatName: string;
  routines: Routine[];
  prefillInstructions?: string | null;
  busyId?: string | null;
  onCreate: (input: {
    name: string;
    instructions: string;
    everyMinutes: number;
    startAt: number;
  }) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onRunNow: (routine: Routine) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [everyMinutes, setEveryMinutes] = useState(1440);
  const [customMinutes, setCustomMinutes] = useState("");
  const [startAt, setStartAt] = useState(() => toDatetimeLocalValue(new Date()));

  useEffect(() => {
    if (open && prefillInstructions) {
      setInstructions(prefillInstructions);
      setName(prefillInstructions.slice(0, 40));
      setCreating(true);
    }
  }, [open, prefillInstructions]);

  if (!open) return null;

  function resetForm() {
    setCreating(false);
    setName("");
    setInstructions("");
    setEveryMinutes(1440);
    setCustomMinutes("");
    setStartAt(toDatetimeLocalValue(new Date()));
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const minutes = everyMinutes === -1 ? Number(customMinutes) : everyMinutes;
    if (!name.trim() || !instructions.trim() || !minutes || minutes < 1) return;
    await onCreate({
      name: name.trim(),
      instructions: instructions.trim(),
      everyMinutes: minutes,
      startAt: new Date(startAt).getTime(),
    });
    resetForm();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={handleClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl2 border border-line bg-panel p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <Clock size={15} /> Routines · {chatName}
          </h2>
          <button
            onClick={handleClose}
            className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted">
          Teach this agent something once, then have it repeat on its own —
          runs through your own scheduler, not tied to any hosting limits.
        </p>

        {!creating ? (
          <>
            {routines.length === 0 ? (
              <p className="py-6 text-center text-xs text-faint">
                No routines yet for this chat.
              </p>
            ) : (
              <div className="space-y-2">
                {routines.map((r) => (
                  <div key={r.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-ink">{r.name}</span>
                      <button
                        onClick={() => onToggle(r.id, !r.enabled)}
                        className={`h-5 w-9 shrink-0 rounded-full transition-colors ${
                          r.enabled ? "bg-avatar-teal" : "bg-line"
                        }`}
                        title={
                          r.enabled ? "Enabled — click to pause" : "Paused — click to enable"
                        }
                      >
                        <span
                          className={`block h-4 w-4 translate-y-0.5 rounded-full bg-white transition-transform ${
                            r.enabled ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {r.instructions}
                    </p>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
                      <span>
                        {r.enabled ? `next run ${relativeTo(r.nextRunAt)}` : "paused"}
                        {r.lastRunAt ? ` · last ran ${relativeTo(r.lastRunAt)}` : ""}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onRunNow(r)}
                          disabled={busyId === r.id}
                          className="text-ink hover:underline disabled:opacity-50"
                        >
                          {busyId === r.id ? "Running…" : "Run now"}
                        </button>
                        <button
                          onClick={() => onDelete(r.id)}
                          className="text-faint hover:text-red-400"
                          aria-label="Delete routine"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    {r.lastResult && (
                      <p className="mt-1.5 truncate text-[11px] text-faint">
                        ↳ {r.lastResult}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setCreating(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:border-faint hover:text-ink"
            >
              <Plus size={16} /> New routine
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Routine name"
              className="w-full rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold"
            />
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="What should it do each time? e.g. Check the inbox and draft replies to anything urgent."
              rows={3}
              className="w-full resize-none rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold"
            />

            <div>
              <p className="mb-1.5 text-xs text-muted">Repeat</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.minutes}
                    onClick={() => setEveryMinutes(p.minutes)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      everyMinutes === p.minutes
                        ? "border-white bg-white text-bg"
                        : "border-line text-muted hover:text-ink"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setEveryMinutes(-1)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    everyMinutes === -1
                      ? "border-white bg-white text-bg"
                      : "border-line text-muted hover:text-ink"
                  }`}
                >
                  Custom
                </button>
              </div>
              {everyMinutes === -1 && (
                <input
                  type="number"
                  min={1}
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  placeholder="every N minutes"
                  className="mt-2 w-full rounded-lg border border-line bg-bg px-3.5 py-2 text-sm text-ink placeholder:text-faint focus:border-gold"
                />
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs text-muted">Start</p>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full rounded-lg border border-line bg-bg px-3.5 py-2 text-sm text-ink focus:border-gold"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="flex-1 rounded-lg border border-line py-2.5 text-sm text-ink hover:bg-panel2"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 rounded-lg bg-white py-2.5 text-sm font-medium text-bg hover:opacity-90"
              >
                Create routine
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}