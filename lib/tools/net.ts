import { lookup } from "dns/promises";
import net from "net";

function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  return m ? privateIp(m[1]) : false;
}

export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("That is not a valid URL."); }
  const h = u.hostname.toLowerCase();
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) URLs are allowed.");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.startsWith("[")) throw new Error("Only public URLs are allowed.");
  return u;
}

/** Resolves the hostname and rejects it if ANY address is private (blocks DNS tricks like evil.com -> 169.254.169.254). */
export async function assertPublicHost(host: string) {
  if (net.isIP(host)) { if (privateIp(host)) throw new Error("Only public URLs are allowed."); return; }
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error("Only public URLs are allowed.");
}

/** fetch() that checks the host before EVERY hop, so a redirect can't lead into your network. */
export async function safeFetch(url: string, init: RequestInit = {}, ms = 20_000, maxHops = 4): Promise<Response> {
  let cur = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    const u = assertPublicUrl(cur);
    await assertPublicHost(u.hostname);
    const res = await fetch(u, { ...init, redirect: "manual", signal: AbortSignal.timeout(ms) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, u).toString(); continue; }
    return res;
  }
  throw new Error("Too many redirects.");
}

export async function http(url: string, init: RequestInit = {}, ms = 20_000): Promise<{ status: number; text: string; json: any }> {
  const res = await safeFetch(url, init, ms);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json };
}

export const cut = (s: string, n = 6000) => (s.length > n ? s.slice(0, n) + "\n…(truncated)" : s);
