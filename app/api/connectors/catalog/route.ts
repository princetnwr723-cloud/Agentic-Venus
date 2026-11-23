import { NextResponse } from "next/server";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { isOwner } from "@/lib/owner";
import { categoryCounts, searchCatalog } from "@/lib/mcp/catalog";
import { loadCatalog, refreshIfStale, syncCatalog } from "@/lib/mcp/catalog-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const PAGE_MAX = 60;

/**
 * The connector catalog for the Connectors window.
 *   {action:"list", q, category, auth, offset, limit}  -> a page of servers + category counts
 *   {action:"sync"}                                     -> the owner of the deployment re-reads the official registry now
 */
export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 2 * 1024 });
    const action = String(b.action || "list");

    if (action === "sync") {
      if (!(await isOwner(String(b.uid)))) throw new RequestError("Only the owner of this site can refresh the catalog.", 403);
      return NextResponse.json(await syncCatalog());
    }
    if (action !== "list") throw new RequestError("Unknown action.", 400);

    const cat = await loadCatalog();
    refreshIfStale(cat);
    const q = String(b.q ?? "").slice(0, 60);
    const category = String(b.category ?? "all").slice(0, 20);
    const auth = String(b.auth ?? "all").slice(0, 10);
    const offset = Math.max(0, Math.min(100_000, Number(b.offset) || 0));
    const limit = Math.max(1, Math.min(PAGE_MAX, Number(b.limit) || 30));
    const found = searchCatalog(cat.entries, { q, category, auth });
    return NextResponse.json({
      total: found.length,
      all: cat.entries.length,
      offset,
      entries: found.slice(offset, offset + limit),
      categories: categoryCounts(cat.entries),
      updatedAt: cat.updatedAt,
      fromRegistry: cat.fromRegistry,
      refreshing: cat.updatedAt === 0,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The catalog could not be loaded." }, { status: requestStatus(e) });
  }
}
