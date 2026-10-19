// Server-only. Lets the agent search the web and read pages as plain text.
// Search order: keyed providers first (Tavily, Brave, Serper: reliable), free HTML scrapers only as a fallback.
import { safeFetch } from "@/lib/tools/net";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.startsWith("[") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)
  );
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// ---------------- small cache + retry ----------------

const cache = new Map<string, { t: number; ttl: number; v: string }>();
function cacheGet(k: string): string | null {
  const h = cache.get(k);
  if (!h) return null;
  if (Date.now() - h.t < h.ttl) return h.v;
  cache.delete(k);
  return null;
}
function cacheSet(k: string, v: string, ttl: number) {
  if (cache.size > 250) cache.clear();
  cache.set(k, { t: Date.now(), ttl, v });
}

const RETRYABLE = /(\b429\b|\b5\d\d\b|timeout|timed out|fetch failed|ECONN|socket|aborted)/i;
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!RETRYABLE.test(e instanceof Error ? e.message : String(e))) throw e;
    await new Promise((r) => setTimeout(r, 700));
    return fn();
  }
}

async function getText(url: string, extra: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...extra },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---------------- Reading pages ----------------

export async function webRead(url: string, maxChars = 4500): Promise<string> {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    throw new Error("That is not a valid URL.");
  }
  if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) {
    throw new Error("Only public http(s) pages can be read.");
  }

  const ck = `read:${u.toString()}:${maxChars}`;
  const hit = cacheGet(ck);
  if (hit) return hit;

  try {
    // safeFetch resolves the host and re-checks it on every redirect, so a page can't lead into a private network.
    const res = await withRetry(() =>
      safeFetch(u.toString(), { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain" } }, 15_000)
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    const raw = (await res.text()).slice(0, 600_000);
    const isHtml = type.includes("html") || /^\s*<(!doctype|html)/i.test(raw);
    const title = isHtml ? stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? "") : "";
    const body = isHtml ? htmlToText(raw) : raw;
    if (body.trim().length > 200) {
      const out = `${title ? `TITLE: ${title}\n` : ""}URL: ${u.toString()}\n\n${body.slice(0, maxChars)}`;
      cacheSet(ck, out, 5 * 60_000);
      return out;
    }
    throw new Error("Page had almost no readable text");
  } catch (firstErr) {
    // Blocked or JavaScript-only page: try a public reader proxy.
    try {
      const text = await getText(`https://r.jina.ai/${u.toString()}`, { Accept: "text/plain" });
      if (text.trim().length > 100) {
        const out = `URL: ${u.toString()} (read through a reader proxy)\n\n${text.slice(0, maxChars)}`;
        cacheSet(ck, out, 5 * 60_000);
        return out;
      }
    } catch {
      // ignore — report the original problem below
    }
    throw new Error(firstErr instanceof Error ? firstErr.message : "Could not read the page.");
  }
}

// ---------------- Searching ----------------

type SearchFn = (q: string, newsy: boolean) => Promise<string | null>;

const numbered = (rows: Array<{ title?: string; url?: string; text?: string }>, max = 8): string =>
  rows
    .filter((r) => r.url && /^https?:\/\//.test(r.url))
    .filter((r, i, a) => a.findIndex((x) => x.url === r.url) === i)
    .slice(0, max)
    .map((r, i) => `${i + 1}. ${stripTags(r.title ?? "")}\n   ${r.url}\n   ${stripTags(r.text ?? "").slice(0, 300)}`)
    .join("\n");

// ----- keyed providers (reliable) -----

const searchTavily: SearchFn = async (q, newsy) => {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null; // not configured: skip silently
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: q, max_results: 7, include_answer: true, search_depth: "basic", ...(newsy ? { topic: "news" } : {}) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const lines = numbered((data.results ?? []).map((r) => ({ title: r.title, url: r.url, text: r.content })));
  if (!lines) throw new Error("no results");
  return `${data.answer ? `QUICK ANSWER: ${data.answer}\n\n` : ""}${lines}`;
};

const searchBrave: SearchFn = async (q, newsy) => {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return null;
  const url = `https://api.search.brave.com/res/v1/${newsy ? "news" : "web"}/search?q=${encodeURIComponent(q)}&count=8`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> }; results?: Array<{ title?: string; url?: string; description?: string }> };
  const rows = (newsy ? data.results : data.web?.results) ?? [];
  const lines = numbered(rows.map((r) => ({ title: r.title, url: r.url, text: r.description })));
  if (!lines) throw new Error("no results");
  return lines;
};

const searchSerper: SearchFn = async (q, newsy) => {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://google.serper.dev/${newsy ? "news" : "search"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": key },
    body: JSON.stringify({ q, num: 8 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    answerBox?: { answer?: string; snippet?: string };
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    news?: Array<{ title?: string; link?: string; snippet?: string; source?: string }>;
  };
  const rows = (newsy ? data.news : data.organic) ?? [];
  const lines = numbered(rows.map((r) => ({ title: r.title, url: r.link, text: r.snippet })));
  if (!lines) throw new Error("no results");
  const box = data.answerBox?.answer || data.answerBox?.snippet;
  return `${box ? `QUICK ANSWER: ${box}\n\n` : ""}${lines}`;
};

// ----- free scrapers (fallback only) -----

const searchBing: SearchFn = async (q) => {
  const html = await getText(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en-US&cc=US`);
  const blocks = html.split('<li class="b_algo"').slice(1, 9);
  const rows: Array<{ title: string; url: string; text: string }> = [];
  for (const b of blocks) {
    const link = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!link) continue;
    let href = decodeEntities(link[1]);
    // Bing sometimes wraps links: bing.com/ck/a?...&u=a1<base64url>
    const wrapped = /[?&]u=a1([A-Za-z0-9_-]+)/.exec(href);
    if (wrapped) {
      try {
        href = Buffer.from(wrapped[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      } catch {
        // keep original
      }
    }
    const snip = /<p[^>]*>([\s\S]*?)<\/p>/.exec(b);
    rows.push({ title: link[2], url: href, text: snip ? snip[1] : "" });
  }
  const lines = numbered(rows);
  if (!lines) throw new Error("no results");
  return lines;
};

function xmlTag(xml: string, name: string): string {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? stripTags(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : "";
}

const searchNews: SearchFn = async (q) => {
  const xml = await getText(
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`
  );
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8);
  const lines = items.map((m, i) => {
    const title = xmlTag(m[1], "title");
    const source = xmlTag(m[1], "source");
    const date = xmlTag(m[1], "pubDate");
    const link = xmlTag(m[1], "link");
    return `${i + 1}. ${title}${source ? ` — ${source}` : ""}${date ? ` (${date})` : ""}\n   ${link}`;
  });
  if (lines.length === 0) throw new Error("no results");
  return lines.join("\n");
};

const searchDdg: SearchFn = async (q) => {
  const html = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
  const links = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  const rows: Array<{ title: string; url: string; text: string }> = [];
  links.slice(0, 8).forEach((m, i) => {
    let href = decodeEntities(m[1]);
    const uddg = /[?&]uddg=([^&]+)/.exec(href);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = `https:${href}`;
    rows.push({ title: m[2], url: href, text: snippets[i] ? snippets[i][1] : "" });
  });
  const lines = numbered(rows);
  if (!lines) throw new Error("no results");
  return lines;
};

export async function webSearch(query: string): Promise<string> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!q) throw new Error("web_search needs a query.");

  const newsy = /\b(news|latest|today|headline|headlines|breaking|update|updates|khabar|samachar)\b/i.test(q);
  const ck = `search:${newsy ? "n" : "w"}:${q.toLowerCase()}`;
  const hit = cacheGet(ck);
  if (hit) return hit;

  const keyed: Array<[string, SearchFn]> = [
    ["tavily", searchTavily],
    ["brave", searchBrave],
    ["serper", searchSerper],
  ];
  const free: Array<[string, SearchFn]> = [
    ...(newsy ? ([["google-news", searchNews]] as Array<[string, SearchFn]>) : []),
    ["bing", searchBing],
    ["duckduckgo", searchDdg],
    ...(!newsy ? ([["google-news", searchNews]] as Array<[string, SearchFn]>) : []),
  ];

  const errors: string[] = [];
  const configured = Boolean(process.env.TAVILY_API_KEY || process.env.BRAVE_API_KEY || process.env.SERPER_API_KEY);
  for (const [name, fn] of [...keyed, ...free]) {
    try {
      const out = await withRetry(() => fn(q, newsy));
      if (out) {
        const text = `(results from ${name})\n${out}`;
        cacheSet(ck, text, newsy ? 2 * 60_000 : 10 * 60_000);
        return text;
      }
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  throw new Error(
    `All search sources failed (${errors.join("; ")}).${configured ? "" : " Tip: set TAVILY_API_KEY (or BRAVE_API_KEY / SERPER_API_KEY) on the server for reliable search."}`
  );
}