// Server-only. image.search: finds REAL images on the web (Wikimedia Commons, Openverse, or the main picture of a
// page you give), downloads them on the server, stores them privately in Supabase and returns markdown lines
// ("![alt](vimg:path)") that the chat shows from our own site. Nothing is AI-generated.
import type { Def } from "./plugins";
import { safeFetch } from "./net";
import { createSignedUpload, supabaseConfigured } from "@/lib/supabase-server";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const UA = "AgenticVenus/1.0 (https://agenticvenus.app; image fetch for chat)";
const MAX_BYTES = 6 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

type Found = { url: string; title: string; credit: string; license: string; page: string };

const strip = (x: string) => x.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await safeFetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 12_000);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function fromWikimedia(q: string, n: number): Promise<Found[]> {
  const u =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6" +
    `&gsrlimit=${n + 6}&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=1000`;
  const j = await getJson(u);
  const pages = Object.values((j?.query?.pages ?? {}) as Record<string, any>) as any[];
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: Found[] = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii || !TYPES[String(ii.mime)] || (ii.width ?? 0) < 300) continue;
    const md = ii.extmetadata ?? {};
    out.push({
      url: String(ii.thumburl || ii.url),
      title: strip(String(md.ObjectName?.value ?? p.title ?? "").replace(/^File:/, "")).slice(0, 90),
      credit: strip(String(md.Artist?.value ?? "Wikimedia Commons")).slice(0, 60),
      license: strip(String(md.LicenseShortName?.value ?? "")).slice(0, 30),
      page: String(ii.descriptionurl ?? ""),
    });
  }
  return out;
}

async function fromOpenverse(q: string, n: number): Promise<Found[]> {
  const j = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${n + 6}&mature=false`);
  return ((j?.results ?? []) as any[]).map((r) => ({
    url: String(r.url ?? ""),
    title: strip(String(r.title ?? "")).slice(0, 90),
    credit: strip(String(r.creator ?? r.source ?? "")).slice(0, 60),
    license: `${String(r.license ?? "").toUpperCase()} ${String(r.license_version ?? "")}`.trim().slice(0, 30),
    page: String(r.foreign_landing_url ?? ""),
  })).filter((f) => /^https:\/\//.test(f.url));
}

/** The main picture of a page: og:image / twitter:image. */
async function fromPage(pageUrl: string): Promise<Found[]> {
  const r = await safeFetch(pageUrl, { headers: { "User-Agent": UA, Accept: "text/html,*/*" } }, 15_000);
  if (!r.ok) throw new Error(`The page answered HTTP ${r.status}.`);
  const html = (await r.text()).slice(0, 400_000);
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const find = (...names: string[]) => {
    for (const t of metas) {
      const key = /(?:property|name)=["']([^"']+)["']/i.exec(t)?.[1]?.toLowerCase();
      const val = /content=["']([^"']+)["']/i.exec(t)?.[1];
      if (key && val && names.includes(key)) return val.replace(/&amp;/g, "&");
    }
    return "";
  };
  const img = find("og:image", "og:image:url", "twitter:image", "twitter:image:src");
  if (!img) throw new Error("That page has no main image (no og:image).");
  const title = strip(find("og:title", "twitter:title") || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "").slice(0, 90);
  let host = "";
  try { host = new URL(pageUrl).hostname; } catch { /* ignore */ }
  return [{ url: new URL(img, pageUrl).toString(), title, credit: host, license: "", page: pageUrl }];
}

async function download(url: string): Promise<{ bytes: Buffer; ext: string } | null> {
  try {
    const r = await safeFetch(url, { headers: { "User-Agent": UA, Accept: "image/*" } }, 15_000);
    if (!r.ok) return null;
    const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = TYPES[type];
    if (!ext) return null;
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length < 2000 || bytes.length > MAX_BYTES) return null;
    return { bytes, ext };
  } catch { return null; }
}

async function store(uid: string, chatId: string, bytes: Buffer, ext: string): Promise<string> {
  const path = `${uid}/images/${chatId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const up = await createSignedUpload(path);
  const r = await fetch(up, {
    method: "PUT",
    headers: { "Content-Type": ext === "jpg" ? "image/jpeg" : `image/${ext}`, "x-upsert": "true" },
    body: new Blob([new Uint8Array(bytes)]),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Could not save the image (storage HTTP ${r.status}).`);
  return path;
}

const safeAlt = (x: string) => x.replace(/[\[\]()\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);

/** Downloads and stores up to `count` of the candidates; returns one markdown block per saved picture. */
async function gather(candidates: Found[], count: number, query: string, ctx: { uid: string; chatId: string }) {
  const out: Array<{ md: string; path: string; alt: string; credit: string }> = [];
  const seen = new Set<string>();
  let lastErr: unknown = null;
  for (const c of candidates) {
    if (out.length >= count) break;
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    const got = await download(c.url);
    if (!got) continue;
    try {
      const path = await store(ctx.uid, ctx.chatId, got.bytes, got.ext);
      const alt = safeAlt(c.title || query || "Image");
      const credit = [c.credit && `by ${c.credit}`, c.license, c.page && `[source](${c.page})`].filter(Boolean).join(" · ");
      out.push({ md: `![${alt}](vimg:${path})${credit ? `\n_Photo ${credit}_` : ""}`, path, alt, credit: [c.credit && `by ${c.credit}`, c.license].filter(Boolean).join(" · ") });
    } catch (e) { lastErr = e; }
  }
  if (!out.length && lastErr) throw lastErr;
  return out;
}

async function find(query: string, count: number): Promise<Found[]> {
  const [w, o] = await Promise.all([fromWikimedia(query, count).catch(() => []), fromOpenverse(query, count).catch(() => [])]);
  return [...w, ...o];
}

export const VISUAL_TOOLS: Def[] = [
  {
    name: "image.search", risk: "read",
    params: "query:string (what the picture shows, 2-6 words), count?:number (1-3, default 2), page_url?:string (instead of query: take the main picture of this web page), queries?:string[] (2-6 different things: ONE picture for each, for cards / a menu / a list)",
    description:
      "Find REAL pictures on the web (Wikimedia Commons and Openverse, or the main image of a page you give) and show them in the chat from our own site. " +
      "Nothing is AI-generated. With query/page_url it returns markdown lines with source credit: paste them UNCHANGED in your reply, each image on its own line (2 or more in a row become a collage automatically). " +
      "With queries (one picture per item) it returns a vimg: path for each item: put it in the `image` field of that item inside a ```cards block. " +
      "Use it when a real photo helps (a place, product, dish, landmark, animal, object). Never invent image URLs.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Images can only be shown from a chat.");
      if (!supabaseConfigured()) throw new Error("Image storage is not set up: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.");

      const many = (Array.isArray(a.queries) ? a.queries : []).map((q) => s(q, 120)).filter((q) => q.length >= 2).slice(0, 6);
      if (many.length) {
        const rows = await Promise.all(many.map(async (q) => {
          try {
            const got = await gather(await find(q, 1), 1, q, ctx);
            return { q, hit: got[0] ?? null };
          } catch { return { q, hit: null }; }
        }));
        const ok = rows.filter((r) => r.hit);
        if (!ok.length) return `No real images found for these items (${many.join("; ")}). Try simpler English keywords, or show the cards without pictures (use an emoji instead).`;
        const lines = rows.map((r, i) => (r.hit
          ? `${i + 1}. "${r.q}" → image: vimg:${r.hit.path} · credit: ${r.hit.credit || "Wikimedia Commons / Openverse"}`
          : `${i + 1}. "${r.q}" → no picture found (give that card an emoji instead)`));
        return `PICTURES READY (${ok.length} of ${rows.length}). Use each vimg: value as the "image" of the matching card in your \`\`\`cards block (and the credit as its "credit"). Never change a path.\n\n${lines.join("\n")}`;
      }

      const count = Math.min(3, Math.max(1, Math.floor(Number(a.count)) || 2));
      const pageUrl = s(a.page_url, 500);
      const query = s(a.query, 120);
      if (!pageUrl && query.length < 2) throw new Error("Give a `query` (what the picture shows), a list of `queries`, or a `page_url`.");

      const candidates = pageUrl ? await fromPage(pageUrl) : await find(query, count);
      if (!candidates.length) return `No real images found for "${query || pageUrl}". Try other keywords (English works best), or answer without a picture.`;

      const got = await gather(candidates, count, query, ctx);
      if (!got.length) return `Images were found for "${query || pageUrl}" but none could be downloaded. Try other keywords or another page.`;
      return `IMAGES READY (${got.length}). Paste these lines unchanged in your reply, each image on its own line${got.length > 1 ? " (they show as one collage)" : ""}:\n\n${got.map((g) => g.md).join("\n\n")}`;
    },
  },
];
