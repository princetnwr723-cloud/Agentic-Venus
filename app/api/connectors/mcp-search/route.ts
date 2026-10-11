import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 20;

type Auth = "oauth" | "token" | "none";
type Hit = { name: string; title: string; description: string; url: string; auth: Auth; source: "popular" | "registry" };

// Well-known remote MCP servers. URLs can change: if one fails, search the registry or paste the URL under "Custom".
const POPULAR: Array<Omit<Hit, "source">> = [
  { name: "notion", title: "Notion", description: "Search, read and create pages and databases.", url: "https://mcp.notion.com/mcp", auth: "oauth" },
  { name: "linear", title: "Linear", description: "Issues, projects, cycles.", url: "https://mcp.linear.app/mcp", auth: "oauth" },
  { name: "sentry", title: "Sentry", description: "Errors and performance issues.", url: "https://mcp.sentry.dev/mcp", auth: "oauth" },
  { name: "vercel", title: "Vercel", description: "Projects, deployments, logs.", url: "https://mcp.vercel.com", auth: "oauth" },
  { name: "supabase", title: "Supabase", description: "Databases, tables, SQL.", url: "https://mcp.supabase.com/mcp", auth: "oauth" },
  { name: "neon", title: "Neon", description: "Postgres databases and branches.", url: "https://mcp.neon.tech/mcp", auth: "oauth" },
  { name: "intercom", title: "Intercom", description: "Conversations and contacts.", url: "https://mcp.intercom.com/mcp", auth: "oauth" },
  { name: "paypal", title: "PayPal", description: "Invoices, orders, payments.", url: "https://mcp.paypal.com/mcp", auth: "oauth" },
  { name: "canva", title: "Canva", description: "Designs and brand assets.", url: "https://mcp.canva.com/mcp", auth: "oauth" },
  { name: "stripe", title: "Stripe", description: "Customers, payments, invoices. Use a restricted API key.", url: "https://mcp.stripe.com", auth: "token" },
  { name: "github", title: "GitHub", description: "Repos, issues, pull requests. Use a personal access token.", url: "https://api.githubcopilot.com/mcp/", auth: "token" },
  { name: "huggingface", title: "Hugging Face", description: "Models, datasets, spaces. Token optional.", url: "https://huggingface.co/mcp", auth: "token" },
  { name: "context7", title: "Context7", description: "Up-to-date docs for any library. No key needed.", url: "https://mcp.context7.com/mcp", auth: "none" },
  { name: "deepwiki", title: "DeepWiki", description: "Ask questions about any GitHub repository. No key needed.", url: "https://mcp.deepwiki.com/mcp", auth: "none" },
  { name: "cloudflare-docs", title: "Cloudflare Docs", description: "Search Cloudflare documentation. No key needed.", url: "https://docs.mcp.cloudflare.com/mcp", auth: "none" },
];

type Remote = { type?: string; url?: string; headers?: Array<{ is_required?: boolean; isRequired?: boolean }> };
type Server = { name?: string; title?: string; description?: string; remotes?: Remote[] };

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 4 * 1024 });
    const q = String(body.q || "").trim().toLowerCase().slice(0, 60);
    if (q.length < 2) return NextResponse.json({ results: [] });

    const results: Hit[] = POPULAR.filter((p) => `${p.name} ${p.title} ${p.description}`.toLowerCase().includes(q)).map((p) => ({ ...p, source: "popular" as const }));

    // The official MCP registry lists thousands of servers; only remote (streamable HTTP) ones can be used from here.
    try {
      const r = await fetch(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=40`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
      if (r.ok) {
        const j = (await r.json()) as { servers?: Array<{ server?: Server } & Server> };
        for (const entry of j.servers ?? []) {
          const s: Server = entry.server ?? entry;
          const remote = (s.remotes ?? []).find((x) => x.type === "streamable-http" && x.url && !x.url.includes("{"));
          if (!remote?.url || !s.name) continue;
          if (results.some((x) => x.url === remote.url)) continue;
          const needsHeader = (remote.headers ?? []).some((h) => h.is_required || h.isRequired);
          results.push({
            name: String(s.name).split("/").pop() || s.name, title: s.title || s.name,
            description: String(s.description ?? "").slice(0, 160), url: remote.url,
            auth: needsHeader ? "token" : "none", source: "registry",
          });
        }
      }
    } catch { /* registry offline: popular matches still show */ }

    return NextResponse.json({ results: results.slice(0, 25) });
  } catch (e) {
    return NextResponse.json({ results: [], error: e instanceof Error ? e.message : "Search failed." }, { status: requestStatus(e) });
  }
}