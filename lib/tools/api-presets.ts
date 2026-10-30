/**
 * Known REST APIs: for these the owner types ONLY the service name and the key.
 * Pure data + two helpers, no server code, so the Connectors window (browser) and the agent (server) share it.
 * Unknown service? Then the base URL is asked once (and the header, if it is not "Authorization: Bearer").
 */
export type ApiPreset = {
  id: string;
  label: string;
  baseUrl: string;
  /** Header that carries the key. */
  header: string;
  /** bearer = "Bearer <key>", raw = the key as it is. */
  scheme: "bearer" | "raw";
  /** Extra fixed headers the service needs (version headers and so on). */
  headers?: Record<string, string>;
  /** A cheap GET that proves the key works. */
  testPath?: string;
  aliases?: string[];
  description: string;
};

export const API_PRESETS: ApiPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", header: "Authorization", scheme: "bearer", testPath: "/models", description: "OpenAI API: chat, images, embeddings, audio." },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", header: "x-api-key", scheme: "raw", headers: { "anthropic-version": "2023-06-01" }, testPath: "/models", aliases: ["claude"], description: "Anthropic Claude API." },
  { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", header: "x-goog-api-key", scheme: "raw", testPath: "/models", aliases: ["google ai", "googleai", "aistudio"], description: "Google Gemini API." },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", header: "Authorization", scheme: "bearer", testPath: "/models", description: "Groq fast inference API (OpenAI compatible)." },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", header: "Authorization", scheme: "bearer", testPath: "/models", description: "Mistral AI API." },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", header: "Authorization", scheme: "bearer", testPath: "/models", description: "DeepSeek API." },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", header: "Authorization", scheme: "bearer", testPath: "/auth/key", description: "OpenRouter: one key for many AI models." },
  { id: "together", label: "Together AI", baseUrl: "https://api.together.xyz/v1", header: "Authorization", scheme: "bearer", testPath: "/models", aliases: ["togetherai"], description: "Together AI API." },
  { id: "perplexity", label: "Perplexity", baseUrl: "https://api.perplexity.ai", header: "Authorization", scheme: "bearer", description: "Perplexity search-grounded answers API (POST /chat/completions)." },
  { id: "replicate", label: "Replicate", baseUrl: "https://api.replicate.com/v1", header: "Authorization", scheme: "bearer", testPath: "/account", description: "Replicate: run image, video and audio models." },
  { id: "huggingface", label: "Hugging Face", baseUrl: "https://huggingface.co/api", header: "Authorization", scheme: "bearer", testPath: "/whoami-v2", aliases: ["hf"], description: "Hugging Face Hub API." },
  { id: "elevenlabs", label: "ElevenLabs", baseUrl: "https://api.elevenlabs.io/v1", header: "xi-api-key", scheme: "raw", testPath: "/user", description: "ElevenLabs voice and speech API." },
  { id: "stripe", label: "Stripe", baseUrl: "https://api.stripe.com/v1", header: "Authorization", scheme: "bearer", testPath: "/balance", description: "Stripe payments API. Use a restricted key." },
  { id: "github", label: "GitHub", baseUrl: "https://api.github.com", header: "Authorization", scheme: "bearer", headers: { "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "AgenticVenus" }, testPath: "/user", description: "GitHub REST API." },
  { id: "vercel", label: "Vercel", baseUrl: "https://api.vercel.com", header: "Authorization", scheme: "bearer", testPath: "/v2/user", description: "Vercel API: projects and deployments." },
  { id: "netlify", label: "Netlify", baseUrl: "https://api.netlify.com/api/v1", header: "Authorization", scheme: "bearer", testPath: "/user", description: "Netlify API." },
  { id: "cloudflare", label: "Cloudflare", baseUrl: "https://api.cloudflare.com/client/v4", header: "Authorization", scheme: "bearer", testPath: "/user/tokens/verify", description: "Cloudflare API." },
  { id: "digitalocean", label: "DigitalOcean", baseUrl: "https://api.digitalocean.com/v2", header: "Authorization", scheme: "bearer", testPath: "/account", aliases: ["do"], description: "DigitalOcean API." },
  { id: "notion", label: "Notion", baseUrl: "https://api.notion.com/v1", header: "Authorization", scheme: "bearer", headers: { "Notion-Version": "2022-06-28" }, testPath: "/users/me", description: "Notion API (integration token)." },
  { id: "airtable", label: "Airtable", baseUrl: "https://api.airtable.com/v0", header: "Authorization", scheme: "bearer", testPath: "/meta/whoami", description: "Airtable API (personal access token)." },
  { id: "asana", label: "Asana", baseUrl: "https://app.asana.com/api/1.0", header: "Authorization", scheme: "bearer", testPath: "/users/me", description: "Asana API (personal access token)." },
  { id: "clickup", label: "ClickUp", baseUrl: "https://api.clickup.com/api/v2", header: "Authorization", scheme: "raw", testPath: "/user", description: "ClickUp API (personal token)." },
  { id: "todoist", label: "Todoist", baseUrl: "https://api.todoist.com/rest/v2", header: "Authorization", scheme: "bearer", testPath: "/projects", description: "Todoist REST API." },
  { id: "calendly", label: "Calendly", baseUrl: "https://api.calendly.com", header: "Authorization", scheme: "bearer", testPath: "/users/me", description: "Calendly API." },
  { id: "hubspot", label: "HubSpot", baseUrl: "https://api.hubapi.com", header: "Authorization", scheme: "bearer", testPath: "/account-info/v3/details", description: "HubSpot CRM API (private app token)." },
  { id: "resend", label: "Resend", baseUrl: "https://api.resend.com", header: "Authorization", scheme: "bearer", description: "Resend email API." },
  { id: "sendgrid", label: "SendGrid", baseUrl: "https://api.sendgrid.com/v3", header: "Authorization", scheme: "bearer", testPath: "/scopes", description: "SendGrid email API." },
  { id: "brevo", label: "Brevo", baseUrl: "https://api.brevo.com/v3", header: "api-key", scheme: "raw", testPath: "/account", aliases: ["sendinblue"], description: "Brevo (Sendinblue) email and CRM API." },
  { id: "newsapi", label: "NewsAPI", baseUrl: "https://newsapi.org/v2", header: "X-Api-Key", scheme: "raw", testPath: "/top-headlines/sources", aliases: ["news"], description: "NewsAPI: news headlines and articles." },
  { id: "pexels", label: "Pexels", baseUrl: "https://api.pexels.com/v1", header: "Authorization", scheme: "raw", testPath: "/curated?per_page=1", description: "Pexels free photos API." },
  { id: "apify", label: "Apify", baseUrl: "https://api.apify.com/v2", header: "Authorization", scheme: "bearer", testPath: "/users/me", description: "Apify scrapers and actors." },
  { id: "firecrawl", label: "Firecrawl", baseUrl: "https://api.firecrawl.dev/v1", header: "Authorization", scheme: "bearer", description: "Firecrawl: scrape and crawl websites (POST /scrape)." },
  { id: "exa", label: "Exa", baseUrl: "https://api.exa.ai", header: "x-api-key", scheme: "raw", description: "Exa web search API (POST /search)." },
  { id: "tavily", label: "Tavily", baseUrl: "https://api.tavily.com", header: "Authorization", scheme: "bearer", description: "Tavily search API (POST /search)." },
  { id: "jina", label: "Jina AI", baseUrl: "https://api.jina.ai", header: "Authorization", scheme: "bearer", aliases: ["jinaai"], description: "Jina AI reader and embeddings." },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "Stripe", "stripe api", "open ai" ... -> the preset, or undefined for an unknown service. */
export function findPreset(name: string): ApiPreset | undefined {
  const n = norm(name).replace(/api$/, "");
  if (!n) return undefined;
  return API_PRESETS.find((p) => norm(p.id) === n || norm(p.label) === n || (p.aliases ?? []).some((a) => norm(a) === n));
}

export type ApiPayload = {
  baseUrl: string;
  header?: string;
  value?: string;
  headers?: Record<string, string>;
  description: string;
};

/**
 * Turns "name + key" into the saved connector. Known service: nothing else is needed.
 * Unknown service: a base URL is required (and optionally the header name).
 */
export function apiPayload(o: { name: string; key: string; preset?: ApiPreset; baseUrl?: string; header?: string; description?: string }): ApiPayload {
  const key = o.key.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!key) throw new Error("Paste the API key.");
  const p = o.preset;
  if (p) {
    const header = (o.header ?? "").trim() || p.header;
    const useBearer = p.scheme === "bearer" && header.toLowerCase() === "authorization";
    return {
      baseUrl: p.baseUrl,
      header,
      value: useBearer && !/^bearer\s/i.test(key) ? `Bearer ${key}` : key,
      ...(p.headers ? { headers: p.headers } : {}),
      description: (o.description ?? "").trim() || p.description,
    };
  }
  const base = (o.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("I do not know this service's address yet. Add its Base URL, for example https://api.example.com/v1.");
  let u: URL;
  try { u = new URL(base); } catch { throw new Error("The Base URL is not a valid address."); }
  if (u.protocol !== "https:") throw new Error("The Base URL must start with https://");
  const header = (o.header ?? "").trim() || "Authorization";
  const bearer = header.toLowerCase() === "authorization" && !/^(bearer|basic|token)\s/i.test(key);
  return {
    baseUrl: base,
    header,
    value: bearer ? `Bearer ${key}` : key,
    description: (o.description ?? "").trim() || `${o.name.trim() || u.hostname} API`,
  };
}
