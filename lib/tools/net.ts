export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("That is not a valid URL."); }
  const h = u.hostname.toLowerCase();
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) URLs are allowed.");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.startsWith("[") ||
      /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) {
    throw new Error("Only public URLs are allowed.");
  }
  return u;
}

export async function http(url: string, init: RequestInit = {}, ms = 20_000): Promise<{ status: number; text: string; json: any }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms), redirect: "follow" });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json };
}

export const cut = (s: string, n = 6000) => (s.length > n ? s.slice(0, n) + "\n…(truncated)" : s);