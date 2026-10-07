import { createHmac } from "crypto";

export type VpKind = "login" | "card" | "session";
export type VpMeta = {
  id: string; kind: VpKind; label: string; site: string; hint: string; last4?: string; brand?: string; limit?: number;
  hasTotp?: boolean; allowed: string[] | "all"; createdAt: number; lastUsedAt?: number; uses?: number; cookies?: number;
};

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32(s: string): Buffer {
  let bits = "";
  for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
/** RFC 6238 time-based one-time code (6 digits, 30 s). */
export function totp(secret: string, at = Date.now()): string {
  const key = b32(secret);
  if (!key.length) throw new Error("The 2FA secret is not valid base32.");
  const counter = Math.floor(at / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 4294967296), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const normSite = (s: string): string => {
  try { return new URL(/^https?:\/\//i.test(s) ? s : "https://" + s).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};
/** The page host must be the saved site or one of its sub-domains. "github.com.evil.com" does NOT match. */
export const hostMatches = (site: string, host: string) => {
  const h = host.toLowerCase().replace(/^www\./, "");
  return Boolean(site) && Boolean(h) && (h === site || h.endsWith("." + site));
};
export const luhn = (n: string) => {
  let sum = 0, alt = false;
  for (let i = n.length - 1; i >= 0; i--) { let d = Number(n[i]); if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt; }
  return n.length >= 12 && n.length <= 19 && sum % 10 === 0;
};
export const brandOf = (n: string) => (/^4/.test(n) ? "Visa" : /^(5[1-5]|2[2-7])/.test(n) ? "Mastercard" : /^3[47]/.test(n) ? "Amex" : /^(60|65|81|82)/.test(n) ? "RuPay" : "Card");
export const maskUser = (u: string) => {
  const at = u.indexOf("@");
  return u.length <= 3 ? "***" : at > 0 ? u.slice(0, Math.min(2, at)) + "***" + u.slice(at) : u.slice(0, 2) + "***" + u.slice(-1);
};