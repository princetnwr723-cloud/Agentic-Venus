import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 20;

type Hit = { name: string; title: string; description: string; url: string; needsToken: boolean; source: "popular" | "registry" };

// Well-known remote MCP servers (Streamable HTTP). Shown first when the name matches.
const POPULAR: Array<Omit<Hit, "source">> = [
  { name: "github", title: "GitHub", description: "Repos, issues, pull requests, code search. Token: a GitHub personal access token.", url: "https://api.githubcopilot.com/mcp/", needsToken: true },
  { name: "linear", title: "Linear", description: "Issues and projects. Token: a Linear API key.", url: "https://mcp.linear.app/mcp", needsToken: true },
  { name: "stripe", title: "Stripe", description: "Customers, payments, invoices. Token: a restricted API key.", url: "https://mcp.stripe.com", needsToken: true },
  { name: "context7", title: "Context7", description: "Up-to-date docs for any library. No key needed.", url: "https://mcp.context7.com/mcp", needsToken: false },
  { name: "deepwiki", title: "DeepWiki", description: "Ask questions about any GitHub repository. No key needed.", url: "https://mcp.deepwiki.com/mcp", needsToken: false },
];

type Remote = { type?: string; url?: string; headers?: Array<{ is_required?: boolean; isRequired?: boolean }> };
type Server = { name?: string; title?: string; description?: string; remotes?: Remote[] };

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 4 * 1024 });
    const q = String(body.q || "").trim().toLowerCase().slice(0, 60);
    if (q.length < 2) return NextResponse.json({ results: [] });

    const results: Hit[] = POPULAR.filter((p) => `${p.name} ${p.title} ${p.description}`.toLowerCase().includes(q)).map((p) => ({ ...p, source: "popular" as const }));

    try {
      const r = await fetch(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=30`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
      if (r.ok) {
        const j = (await r.json()) as { servers?: Array<{ server?: Server } & Server> };
        for (const entry of j.servers ?? []) {
          const s: Server = entry.server ?? entry;
          const remote = (s.remotes ?? []).find((x) => x.type === "streamable-http" && x.url && !x.url.includes("{"));
          if (!remote?.url || !s.name) continue;
          if (results.some((x) => x.url === remote.url)) continue;
          results.push({
            name: String(s.name).split("/").pop() || s.name, title: s.title || s.name, description: String(s.description ?? "").slice(0, 160),
            url: remote.url, needsToken: (remote.headers ?? []).some((h) => h.is_required || h.isRequired), source: "registry",
          });
        }
      }
    } catch { /* the registry may be offline: popular matches still show */ }

    return NextResponse.json({ results: results.slice(0, 20) });
  } catch (e) {
    return NextResponse.json({ results: [], error: e instanceof Error ? e.message : "Search failed." }, { status: requestStatus(e) });
  }
}