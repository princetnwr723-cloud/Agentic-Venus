import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { safeFetch } from "@/lib/tools/net";

export const runtime = "nodejs";
export const maxDuration = 30;

function toRaw(url: URL): string {
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
    const { url } = (await readBody(req)) as { url?: string };
    const u = new URL(String(url ?? ""));
    if (u.protocol !== "https:") return NextResponse.json({ error: "Only public https links can be fetched." }, { status: 400 });
    const res = await safeFetch(toRaw(u), { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/plain, text/markdown, */*" } }, 15_000);
    if (!res.ok) return NextResponse.json({ error: `The link answered HTTP ${res.status}.` }, { status: 400 });
    return NextResponse.json({ text: (await res.text()).slice(0, 60_000) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not fetch the link." }, { status: requestStatus(err) });
  }
}
