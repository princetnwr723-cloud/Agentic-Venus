import { createHmac } from "crypto";

export type VpKind = "login" | "card" | "session" | "proxy";
export type VpMeta = {
  id: string; kind: VpKind; label: string; site: string; hint: string; last4?: string; brand?: string;
  /** Card: the biggest single payment. */
  limit?: number;
  /** Card: the most the agent may spend in total with this card (until you reset it). */
  budget?: number;
  /** Card: the most the agent may spend per day (UTC day). */
  daily?: number;
  /** Card: amount used so far (counted when a payment is released to the page). */
  spent?: number;
  dayKey?: string;
  daySpent?: number;
  /** Card: true only when you chose "any site" instead of one site. */
  anySite?: boolean;
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

// ---------------- money: amounts, budgets, limits (pure functions, unit-tested) ----------------

/** Rounds to 2 decimals so 0.1 + 0.2 never breaks a limit check. */
export const money = (n: number): number => Math.round(n * 100) / 100;

/** "₹1,299.50", "1.299,50", "499", 499 -> number. Returns 0 when it is not a positive amount. */
export function parseAmount(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 && v < 1e9 ? money(v) : 0;
  let t = String(v ?? "").replace(/[^0-9.,]/g, "");
  if (!/[0-9]/.test(t)) return 0;
  const lastDot = t.lastIndexOf("."), lastComma = t.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    t = lastComma > lastDot ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const after = t.length - lastComma - 1;
    t = after <= 2 && t.indexOf(",") === lastComma ? t.replace(",", ".") : t.replace(/,/g, "");
  } else if (lastDot >= 0 && t.indexOf(".") !== lastDot) {
    t = t.replace(/\./g, "");
  }
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 && n < 1e9 ? money(n) : 0;
}

/** The biggest number in a list of page-total candidates ("1,299.00", "499"). Null when there is none. */
export function maxAmount(list: unknown): number | null {
  if (!Array.isArray(list)) return null;
  let best = 0;
  for (const x of list.slice(0, 12)) { const n = parseAmount(x); if (n > best) best = n; }
  return best > 0 ? best : null;
}

export const dayKey = (at = Date.now()): string => new Date(at).toISOString().slice(0, 10);

export type SpendInput = Pick<VpMeta, "limit" | "budget" | "daily" | "spent" | "dayKey" | "daySpent">;
export type SpendCheck = { ok: true } | { ok: false; error: string };

/** How much this card may still spend. null = no cap of that kind. */
export function spendLeft(m: SpendInput, now = Date.now()): { budgetLeft: number | null; dailyLeft: number | null } {
  const budgetLeft = m.budget ? Math.max(0, money(m.budget - (m.spent ?? 0))) : null;
  const used = m.dayKey === dayKey(now) ? (m.daySpent ?? 0) : 0;
  const dailyLeft = m.daily ? Math.max(0, money(m.daily - used)) : null;
  return { budgetLeft, dailyLeft };
}

/** May this card pay `amount` right now? Checks the per-payment limit, the total budget and the daily limit. */
export function checkSpend(m: SpendInput, amount: number, now = Date.now()): SpendCheck {
  const a = money(amount);
  if (!(a > 0)) return { ok: false, error: "The payment amount is missing or is not a positive number." };
  if (m.limit && a > m.limit) return { ok: false, error: `Amount ${a} is over the limit of ${m.limit} per payment.` };
  const left = spendLeft(m, now);
  if (left.budgetLeft !== null && a > left.budgetLeft) return { ok: false, error: `Amount ${a} is over the remaining budget (${left.budgetLeft} of ${m.budget} left).` };
  if (left.dailyLeft !== null && a > left.dailyLeft) return { ok: false, error: `Amount ${a} is over today's remaining limit (${left.dailyLeft} of ${m.daily} left).` };
  return { ok: true };
}

/** The new counters after paying `amount`. */
export function applySpend(m: SpendInput, amount: number, now = Date.now()): { spent: number; dayKey: string; daySpent: number } {
  const k = dayKey(now);
  const used = m.dayKey === k ? (m.daySpent ?? 0) : 0;
  return { spent: money((m.spent ?? 0) + amount), dayKey: k, daySpent: money(used + amount) };
}

/** The page shows clearly more than the agent said it would pay. */
export const totalLooksWrong = (stated: number, onPage: number | null | undefined): boolean =>
  Boolean(onPage && onPage > 0 && onPage > stated * 1.01 + 1);

/** After the user approved: did the total on the page go UP (cart changed)? */
export function pageTotalChanged(approved: number, firstSeen: number | null | undefined, nowSeen: number | null | undefined): boolean {
  if (!nowSeen || !(nowSeen > 0)) return false;
  const base = Math.max(approved, firstSeen ?? 0);
  return nowSeen > base * 1.01 + 1;
}

// ---------------- proxy entries ----------------

export type ProxyCfg = { scheme: "http" | "https"; host: string; port: number; username: string; password: string; tz: string; lang: string };

/** Validates what the user typed for a proxy. Only http/https proxies (the kind residential providers give you). */
export function cleanProxy(b: Record<string, unknown>): { ok: true; cfg: ProxyCfg } | { ok: false; error: string } {
  const scheme = String(b.scheme ?? "http").toLowerCase();
  if (scheme !== "http" && scheme !== "https") return { ok: false, error: "The proxy type must be http or https." };
  const host = String(b.host ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9.-]{0,198}[a-z0-9])?$/.test(host)) return { ok: false, error: "The proxy host looks wrong (for example proxy.example.com)." };
  const port = Number(String(b.port ?? "").trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: "The proxy port must be a number from 1 to 65535." };
  const username = String(b.username ?? "").slice(0, 200);
  const password = String(b.password ?? "").slice(0, 300);
  const tz = String(b.tz ?? "").trim();
  if (tz && !/^[A-Za-z0-9_+\/-]{1,60}$/.test(tz)) return { ok: false, error: "The time zone must look like Asia/Kolkata or America/New_York." };
  const lang = String(b.lang ?? "").trim();
  if (lang && !/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) return { ok: false, error: "The language must look like en-US or hi-IN." };
  return { ok: true, cfg: { scheme, host, port, username, password, tz, lang } };
}
