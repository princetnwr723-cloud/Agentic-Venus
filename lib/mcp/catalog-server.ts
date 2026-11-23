// Server only. Keeps the MCP connector catalog in the database and refreshes it from the official registry.
//   mcpCatalog/meta       { updatedAt, count, pages, seen, complete, error?, syncingAt? }
//   mcpCatalog/chunk_0..n { entries: CatalogEntry[] }   (about 600 KB each, so every piece fits in one document)
// Only the Admin SDK touches these (the client SDK is blocked by the default-deny Firestore rules).
import { getAdminDb } from "@/lib/firebase-admin";
import { runAfter } from "@/lib/channels";
import { SEED_CATALOG, crawlRegistry, dedupe, packChunks, type CatalogEntry } from "@/lib/mcp/catalog";

const col = () => getAdminDb().collection("mcpCatalog");
export const STALE_MS = 24 * 3600_000;
const LOCK_MS = 3 * 60_000;
const CACHE_MS = 10 * 60_000;

export type Loaded = { entries: CatalogEntry[]; updatedAt: number; fromRegistry: number; complete: boolean; error?: string };
let cache: { at: number; value: Loaded } | null = null;

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`registry answered HTTP ${r.status}`);
  return r.json();
}

/** The catalog as it is now: the hand-picked servers first, then everything the last sync read from the registry. */
export async function loadCatalog(force = false): Promise<Loaded> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let registry: CatalogEntry[] = [];
  let meta: { updatedAt?: number; complete?: boolean; error?: string } = {};
  try {
    const snap = await col().get();
    const chunks: Array<{ n: number; entries: CatalogEntry[] }> = [];
    snap.forEach((d) => {
      if (d.id === "meta") meta = d.data() as typeof meta;
      else if (/^chunk_\d+$/.test(d.id)) chunks.push({ n: Number(d.id.slice(6)), entries: ((d.data() as { entries?: CatalogEntry[] }).entries ?? []) });
    });
    registry = chunks.sort((a, b) => a.n - b.n).flatMap((c) => c.entries);
  } catch { /* no database: the hand-picked list still works */ }
  const entries = dedupe([...SEED_CATALOG, ...registry]);
  const value: Loaded = { entries, updatedAt: Number(meta.updatedAt) || 0, fromRegistry: entries.filter((e) => e.source === "registry").length, complete: Boolean(meta.complete), ...(meta.error ? { error: meta.error } : {}) };
  cache = { at: Date.now(), value };
  return value;
}

export type SyncResult = { ok: boolean; skipped?: string; count: number; pages: number; seen: number; complete: boolean; error?: string };

/**
 * Reads the whole registry and replaces the stored list. If the registry can not be reached (0 servers read) the old list is kept.
 * A lock in the database stops two syncs from running at once.
 */
export async function syncCatalog(): Promise<SyncResult> {
  const metaRef = col().doc("meta");
  const now = Date.now();
  try {
    const m = (await metaRef.get()).data() as { syncingAt?: number } | undefined;
    if (m?.syncingAt && now - m.syncingAt < LOCK_MS) return { ok: false, skipped: "another sync is running", count: 0, pages: 0, seen: 0, complete: false };
    await metaRef.set({ syncingAt: now }, { merge: true });
  } catch (e) { return { ok: false, skipped: "database not available", count: 0, pages: 0, seen: 0, complete: false, error: e instanceof Error ? e.message : String(e) }; }

  try {
    const crawl = await crawlRegistry(getJson);
    if (crawl.entries.length === 0) {
      await metaRef.set({ syncingAt: 0, error: crawl.error ?? "the registry returned no usable servers", lastTryAt: now }, { merge: true });
      return { ok: false, count: 0, pages: crawl.pages, seen: crawl.seen, complete: false, error: crawl.error ?? "no usable servers" };
    }
    const chunks = packChunks(crawl.entries);
    for (let i = 0; i < chunks.length; i++) await col().doc(`chunk_${i}`).set({ entries: chunks[i] });
    // chunks of an older, bigger list are removed
    const old = await col().get();
    await Promise.all(old.docs.filter((d) => /^chunk_\d+$/.test(d.id) && Number(d.id.slice(6)) >= chunks.length).map((d) => d.ref.delete()));
    await metaRef.set({ updatedAt: Date.now(), count: crawl.entries.length, pages: crawl.pages, seen: crawl.seen, complete: crawl.complete, error: crawl.error ?? null, syncingAt: 0 }, { merge: true });
    cache = null;
    return { ok: true, count: crawl.entries.length, pages: crawl.pages, seen: crawl.seen, complete: crawl.complete, ...(crawl.error ? { error: crawl.error } : {}) };
  } catch (e) {
    await metaRef.set({ syncingAt: 0, error: e instanceof Error ? e.message.slice(0, 200) : "sync failed" }, { merge: true }).catch(() => undefined);
    return { ok: false, count: 0, pages: 0, seen: 0, complete: false, error: e instanceof Error ? e.message : "sync failed" };
  }
}

/** Called when somebody opens the catalog: an empty or old list is refreshed in the background, the answer is never held back. */
export function refreshIfStale(l: Loaded): void {
  if (l.updatedAt === 0 || Date.now() - l.updatedAt > STALE_MS) runAfter(syncCatalog());
}
