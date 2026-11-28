"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import FountBadge from "@/components/fount/FountBadge";
import GlassSheet from "@/components/ui/GlassSheet";

// Session-lifetime cache so switching between chats on the same
// provider/key doesn't re-fetch every time.
const modelCache = new Map<string, string[]>();

/** "models/gemini-3.5-flash-lite" -> "gemini-3.5-flash-lite", and a short readable label for the pill */
function shortModel(id: string): string {
  const base = String(id || "").replace(/^models\//, "").replace(/^[^/]+\//, "");
  return base.length > 26 ? base.slice(0, 25) + "…" : base || "Model";
}

/**
 * The model chooser.
 *  - variant="inline" (default): the two small drop-downs, used on the Venus Pro start page.
 *  - variant="pill": a pill like Claude's ("Sonnet 5.5 · Medium") that opens a sheet with the providers and a searchable list of models.
 */
export default function ModelPicker({
  provider,
  model,
  apiKeys,
  onChange,
  variant = "inline",
}: {
  provider: ProviderId;
  model: string;
  apiKeys: Partial<Record<ProviderId, string>>;
  onChange: (provider: ProviderId, model: string) => void;
  variant?: "inline" | "pill";
}) {
  const available = PROVIDERS.filter((p) => apiKeys[p.id]);
  const [models, setModels] = useState<string[]>(providerMeta(provider).models);
  const [loading, setLoading] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [keyError, setKeyError] = useState("");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // the provider shown inside the sheet (the chat only changes when a model is picked)
  const [sheetProvider, setSheetProvider] = useState<ProviderId>(provider);

  const activeProvider = variant === "pill" && open ? sheetProvider : provider;
  const key = apiKeys[activeProvider];

  useEffect(() => { setSheetProvider(provider); }, [provider]);

  useEffect(() => {
    setKeyError("");
    if (!key) {
      setModels(providerMeta(activeProvider).models);
      return;
    }
    const cacheKey = `${activeProvider}:${key}`;
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
      body: JSON.stringify({ provider: activeProvider, apiKey: key }),
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data: { models?: Array<{ id: string }> | null; error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          // Do not cache a failure, and tell the user why the list is short.
          setKeyError(
            /decrypt|server key/i.test(data.error)
              ? "Saved key could not be read. Re-enter it in API keys to see all models."
              : `Could not load the model list: ${data.error}`
          );
          setModels(providerMeta(activeProvider).models);
          return;
        }
        const list =
          data.models && data.models.length > 0
            ? data.models.map((m) => m.id)
            : providerMeta(activeProvider).models;
        modelCache.set(cacheKey, list);
        setModels(list);
      })
      .catch(() => {
        if (!cancelled) {
          setKeyError("Could not reach the server to load models.");
          setModels(providerMeta(activeProvider).models);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProvider, key]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? models.filter((m) => m.toLowerCase().includes(n)) : models;
  }, [models, q]);

  if (available.length === 0) return null;

  const isCustomModel = !loading && !models.includes(model) && activeProvider === provider;

  function commitCustom() {
    if (customDraft.trim()) {
      onChange(activeProvider, customDraft.trim());
      if (variant === "pill") setOpen(false);
    }
  }

  // ------------------------------------------------------------------ pill (Claude style)
  if (variant === "pill") {
    const pickProvider = (p: ProviderId) => {
      setSheetProvider(p);
      setQ("");
    };
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`Model: ${model}. Tap to change`}
          title={`${providerMeta(provider).label} · ${model}`}
          className="press flex h-10 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-panel2 px-3.5 text-[14px] text-ink transition-colors hover:bg-line/70 sm:h-9"
        >
          <span className="truncate font-medium">{shortModel(model)}</span>
          <ChevronDown size={14} className="shrink-0 text-muted" />
        </button>

        <GlassSheet open={open} onClose={() => setOpen(false)} title="Choose a model">
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {available.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pickProvider(p.id)}
                aria-pressed={sheetProvider === p.id}
                className={`press shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
                  sheetProvider === p.id ? "border-gold/60 bg-gold/15 text-gold" : "border-line bg-panel text-muted"
                }`}
              >
                {p.label.replace(/\s*\(.*\)$/, "")}
              </button>
            ))}
          </div>

          <div className="mb-2 flex items-center gap-2 rounded-2xl border border-line bg-bg/60 px-3 py-2.5">
            <Search size={15} className="shrink-0 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={loading ? "Loading your models…" : `Search ${models.length} models`}
              aria-label="Search models"
              className="w-full bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none md:text-sm"
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-line bg-panel/70">
            {loading && <p className="px-4 py-6 text-center text-sm text-muted">Loading your models…</p>}
            {!loading && filtered.length === 0 && <p className="px-4 py-6 text-center text-sm text-faint">No model matches “{q}”.</p>}
            {!loading &&
              filtered.slice(0, 80).map((m, i) => {
                const on = m === model && sheetProvider === provider;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { onChange(sheetProvider, m); setOpen(false); setQ(""); }}
                    className={`press flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] transition-colors hover:bg-panel2/70 ${i > 0 ? "border-t border-line/70" : ""} ${on ? "bg-panel2/80 text-ink" : "text-ink"}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{m}</span>
                    {on && <Check size={16} className="shrink-0 text-gold" />}
                  </button>
                );
              })}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitCustom()}
              placeholder="Or type an exact model id"
              aria-label="Custom model id"
              className="min-w-0 flex-1 rounded-2xl border border-line bg-bg/60 px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint focus:border-gold/60 focus:outline-none md:text-sm"
            />
            <button
              type="button"
              onClick={commitCustom}
              disabled={!customDraft.trim()}
              className="press shrink-0 rounded-2xl bg-white px-4 py-2.5 text-sm font-medium text-bg disabled:opacity-40"
            >
              Use
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <FountBadge model={model} />
            {keyError && <p className="text-[11px] text-red-300">{keyError}</p>}
          </div>
        </GlassSheet>
      </>
    );
  }

  // ------------------------------------------------------------------ inline (original two drop-downs)
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

      <FountBadge model={model} />

      {keyError && <p className="w-full text-[11px] text-red-300">{keyError}</p>}
    </div>
  );
}
