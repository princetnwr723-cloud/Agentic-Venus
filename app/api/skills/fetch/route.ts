import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

function toRaw(url: URL): string {
  // https://github.com/o/r/blob/main/path/SKILL.md → raw.githubusercontent.com/o/r/main/path/SKILL.md
  if (url.hostname === "github.com") {
    const m = /^\/([^/]+)\/([^/]+)\/(blob|tree)\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (m) {
      const path = m[3] === "tree" && !/\.md$/i.test(m[5]) ? `${m[5].replace(/\/$/, "")}/SKILL.md` : m[5];
      return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[4]}/${path}`;
    }
  }
  if (url.hostname === "gist.github.com") return url.toString().replace("gist.github.com", "gist.githubusercontent.com") + "/raw";
  return url.toString();
}

export async function POST(req: Request) {
  try {
    const { url } = (await req.json()) as { url?: string };
    const u = new URL(String(url ?? ""));
    const h = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || h === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith(".local") || h.endsWith(".internal")) {
      return NextResponse.json({ error: "Only public https links can be fetched." }, { status: 400 });
    }
    const res = await fetch(toRaw(u), { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/plain, text/markdown, */*" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return NextResponse.json({ error: `The link answered HTTP ${res.status}.` }, { status: 400 });
    const text = (await res.text()).slice(0, 60_000);
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not fetch the link." }, { status: 500 });
  }
}