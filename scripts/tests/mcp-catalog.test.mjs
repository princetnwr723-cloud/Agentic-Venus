import test from "node:test";
import assert from "node:assert/strict";
import {
  SEED_CATALOG, CATEGORIES, categoryOf, slugOf, logoDomain, normalizeRegistryServer, dedupe, searchCatalog, categoryCounts, packChunks, parseRegistryPage,
} from "../../lib/mcp/catalog.ts";

const reg = (name, url, extra = {}) => ({ server: { name, description: "A server", remotes: url ? [{ type: "streamable-http", url, ...(extra.headers ? { headers: extra.headers } : {}) }] : [], ...extra.server }, _meta: {} });

test("seed catalog: every entry is complete, https, unique, with a known category", () => {
  const ids = new Set(), urls = new Set(), slugs = new Set();
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const e of SEED_CATALOG) {
    assert.ok(e.id && e.title && e.description && e.url.startsWith("https://"), e.id);
    assert.ok(cats.has(e.category), e.id + " " + e.category);
    assert.ok(e.domain, "logo domain for " + e.id);
    assert.ok(!ids.has(e.id) && !urls.has(e.url) && !slugs.has(e.slug), "unique " + e.id);
    ids.add(e.id); urls.add(e.url); slugs.add(e.slug);
    assert.ok(e.slug.length <= 24);
  }
  assert.ok(SEED_CATALOG.length >= 30);
});

test("the popular list in connect.ts is part of the seed (same addresses)", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../../lib/tools/connect.ts", import.meta.url), "utf8");
  const urls = [...src.matchAll(/url: "(https:\/\/[^"]+)"/g)].map((m) => m[1]);
  const seed = new Set(SEED_CATALOG.map((e) => e.url));
  for (const u of urls) if (/mcp\.|githubcopilot|huggingface/.test(u)) assert.ok(seed.has(u), "missing from seed: " + u);
});

test("slug rule equals safeId", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../../lib/tools/catalog.ts", import.meta.url), "utf8");
  assert.match(src, /toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\+\/g, "_"\)\.replace\(\/\^_\+\|_\+\$\/g, ""\)\.slice\(0, 24\)/);
  assert.equal(slugOf("Cloudflare Docs!"), "cloudflare_docs");
  assert.equal(slugOf("!!!"), "x");
  assert.equal(slugOf("a".repeat(50)).length, 24);
});

test("registry: streamable-http remotes become entries, packages-only servers do not", () => {
  const ok = normalizeRegistryServer(reg("com.acme/acme-crm", "https://mcp.acme.com/mcp", { server: { title: "Acme CRM", description: "Manage customers and deals in your CRM", websiteUrl: "https://acme.com" } }));
  assert.equal(ok.title, "Acme CRM"); assert.equal(ok.url, "https://mcp.acme.com/mcp"); assert.equal(ok.auth, "auto");
  assert.equal(ok.domain, "acme.com"); assert.equal(ok.category, "crm"); assert.equal(ok.source, "registry"); assert.equal(ok.slug, "acme_crm");
  assert.equal(normalizeRegistryServer(reg("io.github.x/stdio-only", null)), null);
  assert.equal(normalizeRegistryServer(reg("a/b", "http://insecure.example.com/mcp")), null);
  assert.equal(normalizeRegistryServer(reg("a/b", "https://{tenant}.example.com/mcp")), null);
  assert.equal(normalizeRegistryServer({ server: { name: "a/b", remotes: [{ type: "sse", url: "https://x.example.com/sse" }] } }), null);
  assert.equal(normalizeRegistryServer(null), null);
  assert.equal(normalizeRegistryServer({}), null);
});

test("registry: a required header means a token; the older flat shape works too", () => {
  const t = normalizeRegistryServer(reg("a/keyed", "https://api.keyed.io/mcp", { headers: [{ name: "Authorization", is_required: true }] }));
  assert.equal(t.auth, "token");
  const flat = normalizeRegistryServer({ name: "x/flat", description: "d", remotes: [{ type: "streamable-http", url: "https://flat.example.com/mcp" }] });
  assert.equal(flat.url, "https://flat.example.com/mcp");
});

test("registry text from strangers is cleaned (control characters, length)", () => {
  const e = normalizeRegistryServer(reg("a/evil", "https://evil.example.com/mcp", { server: { title: "Nice\u202e\u0000Tool", description: "x".repeat(1000) + "\u200b" } }));
  assert.ok(!/[\u0000\u202e\u200b]/.test(e.title + e.description));
  assert.ok(e.description.length <= 220 && e.title.length <= 80);
});

test("logos: the service's own site, never the hosting it runs on or github", () => {
  assert.equal(logoDomain("https://mcp.canva.com/mcp"), "canva.com");
  assert.equal(logoDomain("https://my-thing.workers.dev/mcp", "https://my-thing-docs.com"), "my-thing-docs.com");
  assert.equal(logoDomain("https://x.vercel.app/mcp", "https://github.com/me/x"), "");
  assert.equal(logoDomain("https://x.herokuapp.com/mcp"), "");
});

test("categories", () => {
  assert.equal(categoryOf("Query your Postgres database with SQL"), "data");
  assert.equal(categoryOf("Send Slack messages and email"), "communication");
  assert.equal(categoryOf("Create Stripe invoices and payments"), "finance");
  assert.equal(categoryOf("zzz qqq"), "other");
});

test("dedupe: same address or id once, seed first, unique slugs", () => {
  const a = { ...SEED_CATALOG[0] };
  const dup = { ...a, id: "io.x/notion", source: "registry", url: a.url + "/" };
  const s1 = { ...a, id: "r/one", url: "https://one.example.com/mcp", slug: "same", source: "registry" };
  const s2 = { ...a, id: "r/two", url: "https://two.example.com/mcp", slug: "same", source: "registry" };
  const out = dedupe([a, dup, s1, s2]);
  assert.equal(out.length, 3);
  assert.equal(out[0].source, "seed");
  assert.deepEqual(out.map((e) => e.slug).filter((x) => x.startsWith("same")), ["same", "same_2"]);
});

test("search: exact and prefix first, typos are not required, category and auth filters work", () => {
  const list = dedupe([...SEED_CATALOG, normalizeRegistryServer(reg("x/notion-helper", "https://mcp.nh.example.com/mcp", { server: { title: "Notion Helper" } }))]);
  const r = searchCatalog(list, { q: "notion" });
  assert.equal(r[0].title, "Notion"); assert.equal(r[1].title, "Notion Helper");
  assert.ok(searchCatalog(list, { q: "cloud" }).length >= 3, "cloudflare entries match by prefix");
  assert.equal(searchCatalog(list, { q: "ca" })[0].title, "Canva");
  assert.deepEqual(searchCatalog(list, { q: "zzzzqqqq" }), []);
  assert.ok(searchCatalog(list, { category: "finance" }).every((e) => e.category === "finance"));
  assert.ok(searchCatalog(list, { auth: "none" }).every((e) => e.auth === "none"));
  assert.ok(searchCatalog(list, { q: "database postgres" }).some((e) => e.slug === "neon"));
  assert.equal(searchCatalog(list, {}).length, list.length);
});

test("category counts only list categories that have entries", () => {
  const c = categoryCounts(SEED_CATALOG);
  assert.ok(c.every((x) => x.count > 0));
  assert.equal(c.reduce((n, x) => n + x.count, 0), SEED_CATALOG.length);
});

test("chunks stay under the size limit and keep every entry in order", () => {
  const many = Array.from({ length: 2000 }, (_, i) => ({ ...SEED_CATALOG[0], id: "r/" + i, description: "d".repeat(200) }));
  const chunks = packChunks(many, 50_000);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(JSON.stringify(c).length <= 50_000 + 1000);
  assert.deepEqual(chunks.flat().map((e) => e.id), many.map((e) => e.id));
  assert.deepEqual(packChunks([]), []);
});

test("registry pages: both cursor spellings, junk entries skipped", () => {
  const p = parseRegistryPage({ servers: [reg("a/one", "https://one.example.com/mcp"), reg("a/pkg", null), "junk", null], metadata: { nextCursor: "abc", count: 4 } });
  assert.equal(p.entries.length, 1); assert.equal(p.next, "abc"); assert.equal(p.seen, 4);
  assert.equal(parseRegistryPage({ servers: [], metadata: { next_cursor: "z" } }).next, "z");
  assert.deepEqual(parseRegistryPage(null), { entries: [], next: "", seen: 0 });
  assert.equal(parseRegistryPage({ servers: [] }).next, "");
});

import { crawlRegistry } from "../../lib/mcp/catalog.ts";

function fakeRegistry(pages) {
  const urls = [];
  const get = async (url) => {
    urls.push(url);
    const c = new URL(url).searchParams.get("cursor") || "";
    const i = c ? Number(c.slice(1)) : 0;
    if (!pages[i]) throw new Error("boom");
    return pages[i];
  };
  return { get, urls };
}
const pg = (names, next) => ({ servers: names.map((n) => reg(n, `https://${n.replace(/\W/g, "")}.example.com/mcp`)), metadata: next ? { nextCursor: next } : {} });

test("crawl follows the cursor to the end and merges pages", async () => {
  const f = fakeRegistry([pg(["a/one", "a/two"], "p1"), pg(["a/three"], "p2"), pg(["a/four"], "")]);
  const r = await crawlRegistry(f.get);
  assert.equal(r.entries.length, 4); assert.equal(r.pages, 3); assert.equal(r.complete, true);
  assert.match(f.urls[1], /cursor=p1/); assert.match(f.urls[0], /limit=100/);
});

test("crawl keeps what it has when a page fails", async () => {
  const f = fakeRegistry([pg(["a/one"], "p1")]); // page p1 does not exist -> fake throws
  const r = await crawlRegistry(f.get);
  assert.equal(r.entries.length, 1); assert.equal(r.complete, false); assert.match(r.error, /boom/);
});

test("crawl stops on a cursor loop, on the page limit and on the time budget", async () => {
  const loop = fakeRegistry([pg(["a/one"], "p0"), pg(["a/x"], "p0")]);
  const l = await crawlRegistry(loop.get); assert.equal(l.complete, true); assert.ok(l.pages <= 2);
  const many = fakeRegistry(Array.from({ length: 10 }, (_, i) => pg(["a/s" + i], "p" + (i + 1))));
  const m = await crawlRegistry(many.get, { maxPages: 3 }); assert.equal(m.pages, 3); assert.equal(m.complete, false);
  let t = 0;
  const slow = fakeRegistry(Array.from({ length: 10 }, (_, i) => pg(["a/t" + i], "p" + (i + 1))));
  const b = await crawlRegistry(slow.get, { budgetMs: 100, now: () => (t += 60) }); assert.equal(b.complete, false); assert.match(b.error, /time budget/);
});

test("an offline registry gives an empty, incomplete crawl (the caller keeps the old list)", async () => {
  const r = await crawlRegistry(async () => { throw new Error("offline"); });
  assert.deepEqual([r.entries.length, r.complete], [0, false]);
});
