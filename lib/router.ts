import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
export type Role = "act" | "plan" | "verify" | "report";
export type Pick = {
  provider: ProviderId;
  model: string;
  apiKey: string;
};
export type FallbackEntry = {
  provider: ProviderId;
  apiKey: string;
  model: string;
};
type Keys = Partial<Record<ProviderId, string>>;
type Tier = {
  strong: string;
  fast: string;
};
// Default models for providers with configured model tiers.
// Providers without a configured tier use the model selected by the user.
const DEFAULT_TIERS: Partial<Record<ProviderId, Tier>> = {
  anthropic: {
    strong: "claude-sonnet-5",
    fast: "claude-haiku-4-5-20251001",
  },
  openai: {
    strong: "gpt-4o",
    fast: "gpt-4o-mini",
  },
  grok: {
    strong: "grok-4",
    fast: "grok-4-fast",
  },
  deepseek: {
    strong: "deepseek-reasoner",
    fast: "deepseek-chat",
  },
  mistral: {
    strong: "mistral-large-latest",
    fast: "mistral-small-latest",
  },
};
/**
 * Override model tiers through NEXT_PUBLIC_MODEL_TIERS.
 *
 * Example:
 * {
 *   "openai": {
 *     "strong": "your-strong-model",
 *     "fast": "your-fast-model"
 *   }
 * }
 *
 * Invalid entries are ignored.
 */
function loadTiers(): Partial<Record<ProviderId, Tier>> {
  const tiers: Partial<Record<ProviderId, Tier>> = {
    ...DEFAULT_TIERS,
  };
  const raw = process.env.NEXT_PUBLIC_MODEL_TIERS;
  if (!raw) {
    return tiers;
  }
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      {
        strong?: unknown;
        fast?: unknown;
      }
    >;
    const known = new Set<string>(
      PROVIDERS.map((provider) => provider.id)
    );
    for (const [id, tier] of Object.entries(parsed ?? {})) {
      if (
        known.has(id) &&
        tier &&
        typeof tier.strong === "string" &&
        tier.strong.trim().length > 0 &&
        typeof tier.fast === "string" &&
        tier.fast.trim().length > 0
      ) {
        tiers[id as ProviderId] = {
          strong: tier.strong,
          fast: tier.fast,
        };
      }
    }
  } catch {
    // Invalid JSON: keep the default model tiers.
  }
  return tiers;
}
const TIERS = loadTiers();
/**
 * act:
 *   Use the model selected by the user.
 *
 * plan:
 *   Use the strong model for the selected provider when configured.
 *
 * report:
 *   Use the fast model for the selected provider when configured.
 *
 * verify:
 *   Prefer a different configured provider for an independent review.
 *   If unavailable, fall back to the selected provider.
 *
 * The caller is responsible for retrying with the user's model
 * if a helper-model request fails.
 */
export function pickModel(
  role: Role,
  keys: Keys,
  preferred: {
    provider: ProviderId;
    model: string;
  }
): Pick {
  const own = (
    provider: ProviderId,
    model: string
  ): Pick => ({
    provider,
    model,
    apiKey: keys[provider] ?? "",
  });
  const tier = TIERS[preferred.provider];
  if (role === "act") {
    return own(preferred.provider, preferred.model);
  }
  if (role === "plan") {
    return own(
      preferred.provider,
      tier?.strong ?? preferred.model
    );
  }
  if (role === "report") {
    return own(
      preferred.provider,
      tier?.fast ?? preferred.model
    );
  }
  const other = PROVIDERS
    .map((provider) => provider.id)
    .find(
      (id) =>
        id !== preferred.provider &&
        Boolean(keys[id]) &&
        Boolean(TIERS[id])
    );
  if (other) {
    return own(other, TIERS[other]!.strong);
  }
  return own(
    preferred.provider,
    tier?.strong ?? preferred.model
  );
}
/**
 * Returns up to two alternative providers that the server
 * can try when the primary provider is unavailable or rate-limited.
 */
export function fallbackChain(
  keys: Keys,
  primary: ProviderId
): FallbackEntry[] {
  return PROVIDERS
    .map((provider) => provider.id)
    .filter(
      (id) =>
        id !== primary &&
        id !== "perplexity" &&
        Boolean(keys[id])
    )
    .slice(0, 2)
    .map((id) => ({
      provider: id,
      apiKey: keys[id] as string,
      model:
        TIERS[id]?.fast ??
        providerMeta(id).models[0],
    }));
}