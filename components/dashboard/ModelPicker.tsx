"use client";

import { useState } from "react";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";

export default function ModelPicker({
  provider,
  model,
  apiKeys,
  onChange,
}: {
  provider: ProviderId;
  model: string;
  apiKeys: Partial<Record<ProviderId, string>>;
  onChange: (provider: ProviderId, model: string) => void;
}) {
  const available = PROVIDERS.filter((p) => apiKeys[p.id]);
  const current = providerMeta(provider);
  const isCustomModel = !current.models.includes(model);
  const [customDraft, setCustomDraft] = useState(isCustomModel ? model : "");

  if (available.length === 0) return null;

  function commitCustom() {
    if (customDraft.trim()) onChange(provider, customDraft.trim());
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={provider}
        onChange={(e) => {
          const nextProvider = e.target.value as ProviderId;
          onChange(nextProvider, providerMeta(nextProvider).models[0]);
        }}
        className="rounded-md border border-line bg-panel2 px-2 py-1 text-xs text-ink"
      >
        {available.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      <select
        value={isCustomModel ? "__custom" : model}
        onChange={(e) => {
          if (e.target.value === "__custom") {
            setCustomDraft("");
          } else {
            onChange(provider, e.target.value);
          }
        }}
        className="rounded-md border border-line bg-panel2 px-2 py-1 text-xs text-ink"
      >
        {current.models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value="__custom">Custom model…</option>
      </select>

      {isCustomModel && (
        <input
          value={customDraft}
          onChange={(e) => setCustomDraft(e.target.value)}
          onBlur={commitCustom}
          onKeyDown={(e) => e.key === "Enter" && commitCustom()}
          placeholder="exact model id, then press Enter"
          className="w-44 rounded-md border border-line bg-panel2 px-2 py-1 text-xs text-ink placeholder:text-faint"
        />
      )}
    </div>
  );
}