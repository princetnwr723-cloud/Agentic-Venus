"use client";

import { useEffect, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { useKeys } from "@/lib/keys-context";

function mask(key?: string) {
  if (!key) return null;
  return key.length <= 6 ? "••••" : `••••${key.slice(-4)}`;
}

export default function SettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { apiKeys, daytonaKey, saveProviderKey, saveDaytonaKey } = useKeys();
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, string>>>({});
  const [daytonaDraft, setDaytonaDraft] = useState("");
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  useEffect(() => {
    setDaytonaDraft(daytonaKey ?? "");
  }, [daytonaKey]);

  if (!open) return null;

  function flash(id: string) {
    setSavedFlash(id);
    setTimeout(() => setSavedFlash((v) => (v === id ? null : v)), 1500);
  }

  async function handleSaveProvider(id: ProviderId) {
    const value = (drafts[id] ?? "").trim();
    if (!value) return;
    await saveProviderKey(id, value);
    setDrafts((d) => ({ ...d, [id]: "" }));
    flash(id);
  }

  async function handleSaveDaytona() {
    if (!daytonaDraft.trim()) return;
    await saveDaytonaKey(daytonaDraft.trim());
    flash("daytona");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl2 border border-line bg-panel p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">API keys</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-5 text-xs leading-relaxed text-muted">
          Add at least one AI provider to start chatting. Keys are stored on
          your account, scoped so only you can read them back.
        </p>

        <div className="space-y-3">
          {PROVIDERS.map((p) => (
            <div key={p.id} className="rounded-lg border border-line p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm text-ink">{p.label}</span>
                <div className="flex items-center gap-2">
                  {apiKeys[p.id] && (
                    <span className="text-[11px] text-avatar-teal">
                      Connected · {mask(apiKeys[p.id])}
                    </span>
                  )}
                  <a
                    href={p.keysUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-faint hover:text-muted"
                    title="Get a key"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder={p.placeholder}
                  value={drafts[p.id] ?? ""}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                  }
                  className="flex-1 rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold"
                />
                <button
                  onClick={() => handleSaveProvider(p.id)}
                  className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90"
                >
                  {savedFlash === p.id ? "Saved" : "Save"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="my-5 h-px bg-line" />

        <h3 className="mb-1.5 text-sm text-ink">Daytona (cloud computer)</h3>
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Each agent gets its own cloud computer through Daytona. Add your
          key once — get one at{" "}
          <a
            href="https://app.daytona.io/dashboard/keys"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            app.daytona.io
          </a>
          .
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="dtn_..."
            value={daytonaDraft}
            onChange={(e) => setDaytonaDraft(e.target.value)}
            className="flex-1 rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold"
          />
          <button
            onClick={handleSaveDaytona}
            className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90"
          >
            {savedFlash === "daytona" ? "Saved" : "Save"}
          </button>
        </div>
        {daytonaKey && (
          <p className="mt-1.5 text-[11px] text-avatar-teal">
            Connected · {mask(daytonaKey)}
          </p>
        )}
      </div>
    </div>
  );
}