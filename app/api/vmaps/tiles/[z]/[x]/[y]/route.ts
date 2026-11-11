// Map tiles for the Vmaps card. The browser asks only THIS server; the server fetches from your own tile server
// (VMAPS_TILE_URL) or the public OpenStreetMap, keeps a copy on disk and serves the copy next time.
import { blankTile, getTile } from "@/lib/vmaps/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Light guard so this route cannot be used to crawl the whole map through your machine.
const buckets = new Map<string, { n: number; reset: number }>();
function allowed(ip: string): boolean {
  const now = Date.now();
  if (buckets.size > 2000) buckets.clear();
  const b = buckets.get(ip);
  if (!b || now > b.reset) { buckets.set(ip, { n: 1, reset: now + 60_000 }); return true; }
  b.n++;
  return b.n <= 900; // a full-screen map needs about 20-30 tiles
}

export async function GET(req: Request, { params }: { params: { z: string; x: string; y: string } }) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (!allowed(ip)) return new Response("Too many tile requests. Wait a minute.", { status: 429, headers: { "Cache-Control": "no-store" } });
  const z = Number(params.z), x = Number(params.x), y = Number(String(params.y).replace(/\.png$/i, ""));
  try {
    const t = await getTile(z, x, y);
    return new Response(new Uint8Array(t.bytes), {
      headers: { "Content-Type": t.type, "Cache-Control": t.stale ? "public, max-age=3600" : "public, max-age=86400" },
    });
  } catch (e) {
    // a see-through tile instead of a broken-image icon; the map stays usable and the reason is in a header
    return new Response(new Uint8Array(blankTile()), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Vmaps-Error": e instanceof Error ? e.message.slice(0, 160).replace(/[^\x20-\x7e]/g, " ") : "tile failed" },
    });
  }
}
