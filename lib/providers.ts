// The 10 providers AgenticVenus supports. Model lists here are convenient
// starting points, not a live catalog — providers ship new models often,
// so the UI also lets a person type any model id directly (see
// ModelPicker.tsx). Update these arrays whenever you want new defaults.

export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "grok"
  | "openrouter"
  | "mistral"
  | "cohere"
  | "perplexity"
  | "groq"
  | "deepseek";

export type ProviderMeta = {
  id: ProviderId;
  label: string;
  placeholder: string;
  keysUrl: string;
  models: string[];
};

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    placeholder: "sk-ant-...",
    keysUrl: "https://console.anthropic.com/settings/keys",
    models: ["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"],
  },
  {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    placeholder: "sk-...",
    keysUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  },
  {
    id: "gemini",
    label: "Google (Gemini)",
    placeholder: "AIza...",
    keysUrl: "https://aistudio.google.com/apikey",
    models: ["gemini-2.0-flash", "gemini-1.5-pro"],
  },
  {
    id: "grok",
    label: "xAI (Grok)",
    placeholder: "xai-...",
    keysUrl: "https://console.x.ai",
    models: ["grok-4", "grok-4-fast"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    placeholder: "sk-or-...",
    keysUrl: "https://openrouter.ai/keys",
    models: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"],
  },
  {
    id: "mistral",
    label: "Mistral",
    placeholder: "...",
    keysUrl: "https://console.mistral.ai/api-keys",
    models: ["mistral-large-latest", "mistral-small-latest"],
  },
  {
    id: "cohere",
    label: "Cohere",
    placeholder: "...",
    keysUrl: "https://dashboard.cohere.com/api-keys",
    models: ["command-r-plus", "command-r"],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    placeholder: "pplx-...",
    keysUrl: "https://www.perplexity.ai/settings/api",
    models: ["sonar-pro", "sonar"],
  },
  {
    id: "groq",
    label: "Groq",
    placeholder: "gsk_...",
    keysUrl: "https://console.groq.com/keys",
    models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    placeholder: "sk-...",
    keysUrl: "https://platform.deepseek.com/api_keys",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
];

export function providerMeta(id: ProviderId): ProviderMeta {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}