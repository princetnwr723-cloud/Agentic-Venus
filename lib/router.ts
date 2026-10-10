pimport { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";

export type Role = "act" | "plan" | "verify" | "report";
export type Pick = { provider: ProviderId; model: string; apiKey: string };
export type FallbackEntry = { provider: ProviderId; apiKey: string; model: string };
type Keys = Partial<Record<ProviderId, string>>;
type Tier = { strong: string; fast: string };

// Only models that surely exist are listed. A provider that is NOT listed (Gemini, ...) always uses the model
// the user picked: a hard-coded name your key cannot use silently breaks every helper step.
const DEFAULT_TIERS: Partial<Record<ProviderId, Tier>> = {
  anthropic: { strong: "claude-sonnet-5", fast: "claude-haiku-4-5-20251001" },
  openai: { strong: "gpt-4o", fast: "gpt-4o-mini" },
  grok: { strong: "grok-4", fast: "grok-4-fast" },
  deepseek: { strong: "deepseek-reasoner", fast: "deepseek-chat" },
  mistral: { strong: "mistral-large-latest", fast: "mistral-small-latest" },
};

/**
 * Model names change often. Override them without touching code by setting NEXT_PUBLIC_MODEL_TIERS, e.g.
 * {"openai":{"strong":"<your strong model>","fast":"<your fast model>"}}
 * Entries that are not valid {strong, fast} string pairs are ignored.
 */
function loadTiers(): Partial<Record<ProviderId, Tier>> {
  const tiers: Partial<Record<ProviderId, Tier>> = { ...DEFAULT_TIERS };
  const raw = process.env.NEXT_PUBLIC_MODEL_TIERS;
  if (!raw) return tiers;
  try {
    const parsed = JSON.parse(raw) as Record<string, { strong?: unknown; fast?: unknown }>;
    const known = new Set<string>(PROVIDERS.map((p) => p.id));
    for (const [id, t] of Object.entries(parsed ?? {})) {
      if (known.has(id) && t && typeof t.strong === "string" && t.strong && typeof t.fast === "string" && t.fast) {
        tiers[id as ProviderId] = { strong: t.strong, fast: t.fast };
      }
    }
  } catch { /* bad JSON: keep the defaults */ }
  return tiers;
}
const TIERS = loadTiers();

/**
 * act    -> the model the user chose
 * plan   -> strong tier of the same provider (if known)
 * report -> fast tier of the same provider (if known)
 * verify -> a DIFFERENT provider's strong model when available (independent second opinion)
 * The caller retries with the user's own model if a helper model fails.
 */
export function pickModel(role: Role, keys: Keys, preferred: { provider: ProviderId; model: string }): Pick {
  const own = (provider: ProviderId, model: string): Pick => ({ provider, model, apiKey: keys[provider] ?? "" });
  const tier = TIERS[preferred.provider];
  if (role === "act") return own(preferred.provider, preferred.model);
  if (role === "plan") return own(preferred.provider, tier?.strong ?? preferred.model);
  if (role === "report") return own(preferred.provider, tier?.fast ?? preferred.model);
  const other = PROVIDERS.map((p) => p.id).find((id) => id !== preferred.provider && keys[id] && TIERS[id]);
  if (other) return own(other, TIERS[other]!.strong);
  return own(preferred.provider, tier?.strong ?? preferred.model);
}

/** Up to 2 other providers the server may try if the main one is rate-limited or down. */
export function fallbackChain(keys: Keys, primary: ProviderId): FallbackEntry[] {
  return PROVIDERS.map((p) => p.id)
    .filter((id) => id !== primary && id !== "perplexity" && keys[id])
    .slice(0, 2)
    .map((id) => ({ provider: id, apiKey: keys[id] as string, model: TIERS[id]?.fast ?? providerMeta(id).models[0] }));
}
