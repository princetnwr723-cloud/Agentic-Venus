// Server-only. Lets the computer agent search the web and read pages as plain text.

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
  const res = await fetch(u.toString(), {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`The page answered HTTP ${res.status}.`);
  const type = res.headers.get("content-type") ?? "";
  const raw = (await res.text()).slice(0, 600_000);
  const isHtml = type.includes("html") || /^\s*<(!doctype|html)/i.test(raw);
  const title = isHtml ? stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? "") : "";
  const body = isHtml ? htmlToText(raw) : raw;
  return `${title ? `TITLE: ${title}\n` : ""}URL: ${u.toString()}\n\n${body.slice(0, maxChars)}`;
}

export async function webSearch(query: string): Promise<string> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await res.text();

  const links = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];

  const lines: string[] = [];
  links.slice(0, 8).forEach((m, i) => {
    let href = decodeEntities(m[1]);
    const uddg = /[?&]uddg=([^&]+)/.exec(href);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = `https:${href}`;
    lines.push(
      `${i + 1}. ${stripTags(m[2])}\n   ${href}\n   ${snippets[i] ? stripTags(snippets[i][1]) : ""}`
    );
  });

  if (lines.length === 0) {
    throw new Error("No results came back (the search engine may have blocked this request).");
  }
  return lines.join("\n");
}