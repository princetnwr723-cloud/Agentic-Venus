"use client";

import { useEffect, useState } from "react";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";

// Session-lifetime cache so switching between chats on the same
// provider/key doesn't re-fetch every time.
const modelCache = new Map<string, string[]>();

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
  const [models, setModels] = useState<string[]>(providerMeta(provider).models);
  const [loading, setLoading] = useState(false);
  const [customDraft, setCustomDraft] = useState("");

  const key = apiKeys[provider];

  useEffect(() => {
    if (!key) {
      setModels(providerMeta(provider).models);
      return;
    }
    const cacheKey = `${provider}:${key}`;
    const cached = modelCache.get(cacheKey);
    if (cached) {
      setModels(cached);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey: key }),
    })
      .then((res) => res.json())
      .then((data: { models?: Array<{ id: string }> | null }) => {
        if (cancelled) return;
        const list =
          data.models && data.models.length > 0
            ? data.models.map((m) => m.id)
            : providerMeta(provider).models;
        modelCache.set(cacheKey, list);
        setModels(list);
      })
      .catch(() => {
        if (!cancelled) setModels(providerMeta(provider).models);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provider, key]);

  if (available.length === 0) return null;

  const isCustomModel = !loading && !models.includes(model);

  function commitCustom() {
    if (customDraft.trim()) onChange(provider, customDraft.trim());
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={provider}
        onChange={(e) => {
          const nextProvider = e.target.value as ProviderId;
          const nextKey = apiKeys[nextProvider];
          const cached = nextKey ? modelCache.get(`${nextProvider}:${nextKey}`) : undefined;
          onChange(nextProvider, cached?.[0] ?? providerMeta(nextProvider).models[0]);
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
        value={loading ? "" : isCustomModel ? "__custom" : model}
        onChange={(e) => {
          if (e.target.value === "__custom") {
            setCustomDraft("");
          } else {
            onChange(provider, e.target.value);
          }
        }}
        disabled={loading}
        className="rounded-md border border-line bg-panel2 px-2 py-1 text-xs text-ink disabled:opacity-50"
      >
        {loading ? (
          <option value="">Loading your models…</option>
        ) : (
          <>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="__custom">Custom model…</option>
          </>
        )}
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