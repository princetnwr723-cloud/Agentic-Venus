// The MCP connector catalog: a big, searchable list of remote MCP servers with logos, categories and one-click Connect.
// PURE (no network, no database): the server part (catalog-server.ts) fills it from the official MCP registry, the Connectors window
// searches it. Tested with node --test.
//
// Where the entries come from
//   - SEED_CATALOG below: well-known servers, written by hand. Their addresses can change; the Connect button asks the server
//     before it trusts it (probe), so a wrong address fails with a clear message instead of doing something odd.
//   - the official registry (https://registry.modelcontextprotocol.io): every server that publishes a remote Streamable-HTTP address.
//     How many that is depends on the registry today. The sync reports the real number.
// Registry text is written by strangers: it is only ever shown as text and never executed or trusted.
import { brandDomain } from "../tools/brand.ts";

export type McpAuth = "oauth" | "token" | "none" | "auto";
export type CatalogEntry = {
  /** unique, stable (the registry name, or the seed name) */
  id: string;
  /** short, safe name used for the connector key: mcp:<slug> (max 24 characters, same rule as safeId) */
  slug: string;
  title: string;
  description: string;
  url: string;
  /** oauth = sign-in page; token = needs a key; none = open; auto = we do not know until it is asked (Connect handles all three) */
  auth: McpAuth;
  /** the site whose logo is shown ("" = show a letter) */
  domain: string;
  category: string;
  source: "seed" | "registry";
};

export const CATEGORIES: Array<{ id: string; label: string; words: string[] }> = [
  { id: "developer", label: "Developer", words: ["github", "gitlab", "git", "repo", "repository", "code", "coding", "deploy", "ci", "cicd", "docker", "kubernetes", "npm", "sdk", "compiler", "debug", "lint", "pull request", "bitbucket", "terminal", "shell", "ide", "developer"] },
  { id: "data", label: "Data & databases", words: ["database", "sql", "postgres", "postgresql", "mysql", "sqlite", "mongodb", "redis", "bigquery", "snowflake", "analytics", "warehouse", "vector", "elasticsearch", "supabase", "neon", "prisma", "dataset", "etl", "csv", "spreadsheet"] },
  { id: "productivity", label: "Productivity", words: ["notion", "calendar", "todo", "tasks", "task", "notes", "docs", "document", "drive", "airtable", "asana", "trello", "jira", "linear", "project", "wiki", "confluence", "kanban", "planner", "obsidian"] },
  { id: "communication", label: "Communication", words: ["slack", "email", "gmail", "mail", "discord", "telegram", "whatsapp", "sms", "chat", "messaging", "teams", "meeting", "zoom", "voice", "call", "twilio"] },
  { id: "crm", label: "CRM, sales & support", words: ["crm", "hubspot", "salesforce", "lead", "leads", "sales", "customer", "support", "intercom", "zendesk", "helpdesk", "ticket", "marketing", "newsletter", "outreach"] },
  { id: "finance", label: "Finance & payments", words: ["payment", "payments", "stripe", "paypal", "invoice", "accounting", "bank", "banking", "crypto", "trading", "stock", "stocks", "finance", "billing", "expense", "tax", "ledger", "blockchain", "wallet"] },
  { id: "design", label: "Design & media", words: ["design", "figma", "canva", "image", "images", "video", "audio", "photo", "music", "media", "illustration", "3d", "animation", "podcast", "speech", "transcription"] },
  { id: "search", label: "Search & web", words: ["search", "web", "browser", "crawl", "crawler", "scrape", "scraping", "fetch", "research", "wikipedia", "news", "documentation", "docs lookup", "internet", "maps", "geocode", "weather"] },
  { id: "ai", label: "AI & agents", words: ["llm", "model", "models", "ai", "embedding", "embeddings", "huggingface", "hugging", "agent", "agents", "prompt", "memory", "rag", "inference"] },
  { id: "cloud", label: "Cloud & DevOps", words: ["cloud", "aws", "azure", "gcp", "cloudflare", "vercel", "hosting", "monitoring", "observability", "sentry", "logs", "logging", "kubernetes", "terraform", "infrastructure", "serverless", "cdn", "dns", "uptime", "incident", "pagerduty"] },
  { id: "commerce", label: "Commerce", words: ["shopify", "ecommerce", "e-commerce", "store", "shop", "product", "products", "order", "orders", "inventory", "catalog", "retail", "woocommerce"] },
  { id: "other", label: "Other", words: [] },
];

const clip = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** Same rule as safeId() in lib/tools/catalog.ts, so the connector key built from a slug matches what the Connectors window builds. */
export const slugOf = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "x";

export function categoryOf(text: string): string {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z0-9+#.-]+/g, " ")} `;
  let best = "other", bestN = 0;
  for (const c of CATEGORIES) {
    let n = 0;
    for (const w of c.words) if (t.includes(` ${w} `)) n++;
    if (n > bestN) { best = c.id; bestN = n; }
  }
  return best;
}

const GENERIC_HOSTS = /(^|\.)((workers|pages)\.dev|vercel\.app|netlify\.app|herokuapp\.com|run\.app|onrender\.com|fly\.dev|railway\.app|azurewebsites\.net|amazonaws\.com|ngrok(-free)?\.(app|io|dev)|trycloudflare\.com|deno\.dev|glitch\.me|replit\.(app|dev)|github\.io|supabase\.co|web\.app|firebaseapp\.com|lovable\.app|loca\.lt|localhost)$/i;

export function hostOf(u: string): string { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }

/** Which site's logo to show: the service's own site, not the shared hosting it happens to run on, and never github.com for a third-party server. */
export function logoDomain(remoteUrl: string, websiteUrl?: string): string {
  const rh = hostOf(remoteUrl);
  if (rh && !GENERIC_HOSTS.test(rh)) return brandDomain(rh);
  const wh = hostOf(String(websiteUrl ?? ""));
  if (wh && !GENERIC_HOSTS.test(wh) && !/(^|\.)(github\.com|gitlab\.com|npmjs\.com|pypi\.org|huggingface\.co)$/.test(wh)) return brandDomain(wh);
  return "";
}

const prettify = (s: string) => s.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

type Remote = { type?: string; url?: string; headers?: Array<{ is_required?: boolean; isRequired?: boolean }> };
type RegServer = { name?: string; title?: string; description?: string; websiteUrl?: string; website_url?: string; remotes?: Remote[] };

/** One item of the registry's list (either `{server: {...}}` or the server itself) -> a catalog entry, or null when it can not be connected from here. */
export function normalizeRegistryServer(raw: unknown): CatalogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const wrap = raw as { server?: RegServer } & RegServer;
  const sv: RegServer = wrap.server && typeof wrap.server === "object" ? wrap.server : wrap;
  const name = clip(sv.name, 200);
  if (!name) return null;
  const remote = (Array.isArray(sv.remotes) ? sv.remotes : []).find((r) => r && typeof r.url === "string" && /^(streamable-http|streamablehttp|http)$/i.test(String(r.type ?? "")) && !r.url.includes("{") && /^https:\/\//i.test(r.url));
  if (!remote?.url) return null;
  const url = remote.url.trim().slice(0, 500);
  if (!hostOf(url)) return null;
  const last = name.split("/").pop() || name;
  const title = clip(sv.title, 80) || prettify(last);
  const description = clip(sv.description, 220);
  const needsHeader = (remote.headers ?? []).some((h) => h && (h.is_required === true || h.isRequired === true));
  return {
    id: name, slug: slugOf(last), title, description, url,
    auth: needsHeader ? "token" : "auto",
    domain: logoDomain(url, sv.websiteUrl ?? sv.website_url),
    category: categoryOf(`${title} ${description} ${last}`),
    source: "registry",
  };
}

const urlKey = (u: string) => u.toLowerCase().replace(/\/+$/, "");

/** Removes the same server listed twice (same address), keeps the first (seed beats registry), and gives every entry a unique slug. */
export function dedupe(list: CatalogEntry[]): CatalogEntry[] {
  const seenUrl = new Set<string>();
  const seenId = new Set<string>();
  const slugs = new Set<string>();
  const out: CatalogEntry[] = [];
  for (const e of list) {
    const k = urlKey(e.url);
    if (seenUrl.has(k) || seenId.has(e.id)) continue;
    seenUrl.add(k); seenId.add(e.id);
    let slug = e.slug, n = 2;
    while (slugs.has(slug)) { const suf = "_" + n++; slug = e.slug.slice(0, 24 - suf.length) + suf; }
    slugs.add(slug);
    out.push(slug === e.slug ? e : { ...e, slug });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export type Query = { q?: string; category?: string; auth?: string };

function score(q: string, tokens: string[], e: CatalogEntry): number {
  const n = norm(e.title), s = norm(e.slug), id = norm(e.id);
  if (q === n || q === s) return 0;
  if (n.startsWith(q) || s.startsWith(q)) return 1;
  if (n.includes(q) || s.includes(q) || id.includes(q)) return 2;
  const hay = `${e.title} ${e.description} ${e.id} ${e.category}`.toLowerCase();
  if (tokens.length > 1 && tokens.every((t) => hay.includes(t))) return 3;
  if (q.length >= 3 && norm(e.description).includes(q)) return 4;
  return -1;
}

/** Filter + order. Hand-picked (seed) servers come before registry ones with the same match quality. */
export function searchCatalog(list: CatalogEntry[], query: Query): CatalogEntry[] {
  const cat = query.category && query.category !== "all" ? query.category : "";
  const auth = query.auth && query.auth !== "all" ? query.auth : "";
  const base = list.filter((e) => (!cat || e.category === cat) && (!auth || e.auth === auth));
  const raw = String(query.q ?? "").trim().toLowerCase().slice(0, 60);
  const q = norm(raw);
  if (q.length < 1) {
    return [...base].sort((a, b) => Number(b.source === "seed") - Number(a.source === "seed") || a.title.localeCompare(b.title));
  }
  const tokens = raw.split(/\s+/).filter((t) => t.length > 1);
  const scored: Array<{ e: CatalogEntry; sc: number }> = [];
  for (const e of base) { const sc = score(q, tokens, e); if (sc >= 0) scored.push({ e, sc }); }
  return scored.sort((a, b) => a.sc - b.sc || Number(b.e.source === "seed") - Number(a.e.source === "seed") || a.e.title.localeCompare(b.e.title)).map((x) => x.e);
}

export function categoryCounts(list: CatalogEntry[]): Array<{ id: string; label: string; count: number }> {
  const m = new Map<string, number>();
  for (const e of list) m.set(e.category, (m.get(e.category) ?? 0) + 1);
  return CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: m.get(c.id) ?? 0 })).filter((c) => c.count > 0);
}

/** Splits a big list into pieces that each fit in one database document (about 1 MB is the limit; stay well under). */
export function packChunks(list: CatalogEntry[], maxBytes = 600_000): CatalogEntry[][] {
  const chunks: CatalogEntry[][] = [];
  let cur: CatalogEntry[] = [], size = 0;
  for (const e of list) {
    const b = JSON.stringify(e).length + 2;
    if (cur.length && size + b > maxBytes) { chunks.push(cur); cur = []; size = 0; }
    cur.push(e); size += b;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** What the sync takes out of one page of the registry's answer: the servers it can use, and where the next page is. */
export function parseRegistryPage(json: unknown): { entries: CatalogEntry[]; next: string; seen: number } {
  const j = (json && typeof json === "object" ? json : {}) as { servers?: unknown[]; metadata?: { nextCursor?: string; next_cursor?: string }; nextCursor?: string; next_cursor?: string };
  const list = Array.isArray(j.servers) ? j.servers : [];
  const entries: CatalogEntry[] = [];
  for (const raw of list) { const e = normalizeRegistryServer(raw); if (e) entries.push(e); }
  const next = String(j.metadata?.nextCursor ?? j.metadata?.next_cursor ?? j.nextCursor ?? j.next_cursor ?? "");
  return { entries, next, seen: list.length };
}

/* ------------------------------------------------------------------ hand-picked servers */

const s = (id: string, title: string, description: string, url: string, auth: McpAuth, category: string): CatalogEntry => ({
  id: "seed/" + id, slug: slugOf(id), title, description, url, auth, domain: logoDomain(url), category, source: "seed",
});

export const SEED_CATALOG: CatalogEntry[] = [
  s("notion", "Notion", "Search, read and create pages and databases.", "https://mcp.notion.com/mcp", "oauth", "productivity"),
  s("linear", "Linear", "Issues, projects and cycles.", "https://mcp.linear.app/mcp", "oauth", "productivity"),
  s("sentry", "Sentry", "Errors and performance issues.", "https://mcp.sentry.dev/mcp", "oauth", "cloud"),
  s("vercel", "Vercel", "Projects, deployments and logs.", "https://mcp.vercel.com", "oauth", "cloud"),
  s("supabase", "Supabase", "Databases, tables and SQL.", "https://mcp.supabase.com/mcp", "oauth", "data"),
  s("neon", "Neon", "Postgres databases and branches.", "https://mcp.neon.tech/mcp", "oauth", "data"),
  s("intercom", "Intercom", "Conversations and contacts.", "https://mcp.intercom.com/mcp", "oauth", "crm"),
  s("paypal", "PayPal", "Invoices, orders and payments.", "https://mcp.paypal.com/mcp", "oauth", "finance"),
  s("canva", "Canva", "Designs and brand assets.", "https://mcp.canva.com/mcp", "oauth", "design"),
  s("figma", "Figma", "Design files, components and variables.", "https://mcp.figma.com/mcp", "oauth", "design"),
  s("stripe", "Stripe", "Customers, payments and invoices. Use a restricted API key.", "https://mcp.stripe.com", "token", "finance"),
  s("github", "GitHub", "Repos, issues and pull requests. Use a personal access token.", "https://api.githubcopilot.com/mcp/", "token", "developer"),
  s("huggingface", "Hugging Face", "Models, datasets and spaces. Token optional.", "https://huggingface.co/mcp", "token", "ai"),
  s("context7", "Context7", "Up-to-date docs for any library. No key needed.", "https://mcp.context7.com/mcp", "none", "developer"),
  s("deepwiki", "DeepWiki", "Ask questions about any GitHub repository. No key needed.", "https://mcp.deepwiki.com/mcp", "none", "developer"),
  s("cloudflare-docs", "Cloudflare Docs", "Search Cloudflare documentation. No key needed.", "https://docs.mcp.cloudflare.com/mcp", "none", "cloud"),
  s("cloudflare-observability", "Cloudflare Observability", "Debug Workers logs and analytics.", "https://observability.mcp.cloudflare.com/mcp", "oauth", "cloud"),
  s("cloudflare-bindings", "Cloudflare Workers Bindings", "Manage KV, R2, D1 and Workers.", "https://bindings.mcp.cloudflare.com/mcp", "oauth", "cloud"),
  s("monday", "monday.com", "Boards, items and updates.", "https://mcp.monday.com/mcp", "oauth", "productivity"),
  s("wix", "Wix", "Build and manage Wix sites.", "https://mcp.wix.com/mcp", "oauth", "commerce"),
  s("box", "Box", "Search and read your files.", "https://mcp.box.com", "oauth", "productivity"),
  s("pagerduty", "PagerDuty", "Incidents, services and on-call.", "https://mcp.pagerduty.com/mcp", "token", "cloud"),
  s("ramp", "Ramp", "Spend, cards and reimbursements.", "https://ramp-mcp-remote.ramp.com/mcp", "oauth", "finance"),
  s("fireflies", "Fireflies", "Meeting notes and transcripts.", "https://api.fireflies.ai/mcp", "token", "communication"),
  s("jam", "Jam", "Bug reports with logs and replays.", "https://mcp.jam.dev/mcp", "oauth", "developer"),
  s("hex", "Hex", "Data notebooks and projects.", "https://app.hex.tech/mcp", "oauth", "data"),
  s("clerk", "Clerk", "Users and sessions.", "https://mcp.clerk.com/mcp", "oauth", "developer"),
  s("prisma", "Prisma", "Prisma Postgres databases.", "https://mcp.prisma.io/mcp", "oauth", "data"),
  s("sanity", "Sanity", "Content and datasets.", "https://mcp.sanity.io", "oauth", "productivity"),
  s("airtable", "Airtable", "Bases, tables and records.", "https://mcp.airtable.com/mcp", "oauth", "productivity"),
  s("apify", "Apify", "Run scrapers and actors from the Apify store.", "https://mcp.apify.com", "oauth", "search"),
  s("exa", "Exa", "AI web search.", "https://mcp.exa.ai/mcp", "token", "search"),
  s("brightdata", "Bright Data", "Web data and scraping.", "https://mcp.brightdata.com/mcp", "token", "search"),
  s("zapier", "Zapier", "Connect 7,000+ apps through your Zaps.", "https://mcp.zapier.com/api/mcp/mcp", "token", "productivity"),
  s("hubspot", "HubSpot", "Contacts, companies and deals.", "https://mcp.hubspot.com", "oauth", "crm"),
  s("docusign", "Docusign", "Agreements and envelopes.", "https://mcp.docusign.com/mcp", "oauth", "productivity"),
  s("mapbox", "Mapbox", "Maps, geocoding and directions.", "https://mcp.mapbox.com/mcp", "token", "search"),
  s("globalping", "Globalping", "Ping and trace from probes around the world.", "https://mcp.globalping.dev/mcp", "none", "cloud"),
];

/* ------------------------------------------------------------------ reading the official registry */

export const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";
type FetchJson = (url: string, timeoutMs: number) => Promise<unknown>;

export type Crawl = { entries: CatalogEntry[]; pages: number; seen: number; complete: boolean; error?: string };

/**
 * Walks the registry page by page (100 servers per page) until it has no next page, the page limit, or the time budget is used up.
 * `getJson` is passed in (a real fetch on the server, a fake in tests). A page that fails stops the walk; what was read so far is kept.
 */
export async function crawlRegistry(getJson: FetchJson, o: { maxPages?: number; pageSize?: number; budgetMs?: number; now?: () => number } = {}): Promise<Crawl> {
  const maxPages = o.maxPages ?? 40, size = o.pageSize ?? 100, budget = o.budgetMs ?? 40_000, now = o.now ?? Date.now;
  const start = now();
  const all: CatalogEntry[] = [];
  let cursor = "", pages = 0, seen = 0;
  const seenCursors = new Set<string>();
  while (pages < maxPages) {
    if (now() - start > budget) return { entries: dedupe(all), pages, seen, complete: false, error: "time budget used up" };
    const url = `${REGISTRY_URL}?limit=${size}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    let json: unknown;
    try { json = await getJson(url, 9000); }
    catch (e) { return { entries: dedupe(all), pages, seen, complete: false, error: e instanceof Error ? e.message : "registry unreachable" }; }
    const p = parseRegistryPage(json);
    pages++; seen += p.seen;
    all.push(...p.entries);
    if (!p.next || seenCursors.has(p.next) || p.seen === 0) return { entries: dedupe(all), pages, seen, complete: true };
    seenCursors.add(p.next);
    cursor = p.next;
  }
  return { entries: dedupe(all), pages, seen, complete: false, error: "page limit reached" };
}
