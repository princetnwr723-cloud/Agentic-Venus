"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { useKeys } from "@/lib/keys-context";

export default function FirstKeyGate() {
  const { saveProviderKey } = useKeys();
  const [provider, setProvider] = useState<ProviderId>(PROVIDERS[0].id);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const meta = PROVIDERS.find((p) => p.id === provider)!;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setSaving(true);
    await saveProviderKey(provider, key.trim());
    // No further action needed — the dashboard re-renders once apiKeys
    // has one entry, and this gate unmounts on its own.
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-xl2 border border-line bg-panel p-6">
        <h2 className="text-sm font-medium text-ink">
          Connect one AI provider to start
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Pick any one you already have a key for — Claude, ChatGPT,
          whichever. You can add the other 9 anytime from Settings.
        </p>

        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as ProviderId);
              setKey("");
            }}
            className="w-full rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink focus:border-gold"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={meta.placeholder}
            className="w-full rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold"
          />

          <a
            href={meta.keysUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-faint hover:text-muted"
          >
            Get a {meta.label} key <ExternalLink size={12} />
          </a>

          <button
            type="submit"
            disabled={!key.trim() || saving}
            className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Connecting…" : "Connect & start chatting"}
          </button>
        </form>
      </div>
    </div>
  );
}