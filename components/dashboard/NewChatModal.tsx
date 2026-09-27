"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import { PRESET_AGENTS, AVATAR_COLORS, type AvatarColor } from "@/lib/bots";
import type { CustomAgent } from "@/lib/agents";

type PickedAgent = { name: string; role?: string; color: AvatarColor };

export default function NewChatModal({
  open,
  onClose,
  customAgents,
  onPick,
  onCreateAgent,
}: {
  open: boolean;
  onClose: () => void;
  customAgents: CustomAgent[];
  onPick: (agent: PickedAgent) => void;
  onCreateAgent: (name: string, color: AvatarColor) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<AvatarColor>("teal");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function handleClose() {
    setCreating(false);
    setName("");
    setColor("teal");
    onClose();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    await onCreateAgent(name.trim(), color);
    setBusy(false);
    handleClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-xl2 border border-line bg-panel p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">
            {creating ? "New agent" : "New chat"}
          </h2>
          <button
            onClick={handleClose}
            className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {!creating ? (
          <>
            <p className="mb-3 text-xs text-muted">
              Pick a teammate to start with.
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {PRESET_AGENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onPick(a)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-panel2"
                >
                  <BotAvatar color={a.color} size={30} />
                  <div className="min-w-0">
                    <div className="text-sm text-ink">{a.name}</div>
                    <div className="text-xs text-faint">{a.role}</div>
                  </div>
                </button>
              ))}
              {customAgents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onPick(a)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-panel2"
                >
                  <BotAvatar color={a.color} size={30} />
                  <span className="text-sm text-ink">{a.name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setCreating(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:border-faint hover:text-ink"
            >
              <Plus size={16} /> Create a new agent
            </button>
          </>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name"
              className="w-full rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold"
            />
            <div>
              <p className="mb-2 text-xs text-muted">Avatar</p>
              <div className="flex items-center gap-2">
                {AVATAR_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setColor(c)}
                    className={`rounded-full transition-transform ${
                      color === c ? "scale-110 ring-2 ring-white/70" : ""
                    }`}
                  >
                    <BotAvatar color={c} size={30} />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="flex-1 rounded-lg border border-line py-2.5 text-sm text-ink hover:bg-panel2"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={!name.trim() || busy}
                className="flex-1 rounded-lg bg-white py-2.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}