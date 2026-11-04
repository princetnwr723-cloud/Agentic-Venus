// What the agent is about to buy, in a shape that is safe to store and to show in the chat.
// Pure functions only (no server or browser imports) so the server, the chat card and the chat apps can all use it.
// The picture is ALWAYS a small data: image taken from the page by the agent's computer, never a link:
// a link written by a model could leak data in its query string.

export type PayProduct = {
  name: string;
  variant: string;
  brand: string;
  /** Price of one item on the page. */
  price: number | null;
  /** The crossed-out "usual" price on the page. */
  was: number | null;
  /** "$", "₹", "€" ... (or "USD" when unknown). */
  currency: string;
  rating: number | null;
  reviews: number | null;
  qty: number;
  /** data:image/... only. Empty when the page picture could not be taken. */
  image: string;
};

export const IMG_DATA = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_IMG = 140_000;

const text = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const toNum = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 && v < 1e9 ? Math.round(v * 100) / 100 : null;
  const t = String(v ?? "").replace(/[^0-9.,]/g, "");
  if (!/[0-9]/.test(t)) return null;
  const lastDot = t.lastIndexOf("."), lastComma = t.lastIndexOf(",");
  let n = t;
  if (lastDot >= 0 && lastComma >= 0) n = lastComma > lastDot ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (lastComma >= 0) n = t.length - lastComma - 1 <= 2 && t.indexOf(",") === lastComma ? t.replace(",", ".") : t.replace(/,/g, "");
  else if (lastDot >= 0 && t.indexOf(".") !== lastDot) n = t.replace(/\./g, "");
  const x = parseFloat(n);
  return Number.isFinite(x) && x > 0 && x < 1e9 ? Math.round(x * 100) / 100 : null;
};

const SYMBOL: Record<string, string> = { USD: "$", INR: "₹", EUR: "€", GBP: "£", JPY: "¥", AUD: "A$", CAD: "C$", AED: "AED " };
export const symbolOf = (c: unknown): string => {
  const t = text(c, 8);
  return SYMBOL[t.toUpperCase()] ?? (t.length <= 3 && !/^[A-Za-z]+$/.test(t) ? t : t ? t.toUpperCase() + " " : "");
};

/** Cleans what the agent computer sent. Returns null when there is nothing worth showing. */
export function cleanProduct(raw: unknown): PayProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const image = typeof r.image === "string" && r.image.length <= MAX_IMG && IMG_DATA.test(r.image) ? r.image : "";
  const price = toNum(r.price);
  let was = toNum(r.was);
  if (was !== null && price !== null && was <= price) was = null; // a "was" price must be higher than the price
  const rating = toNum(r.rating);
  const reviews = toNum(r.reviews);
  const p: PayProduct = {
    name: text(r.name, 140),
    variant: text(r.variant, 80),
    brand: text(r.brand, 60),
    price,
    was,
    currency: symbolOf(r.currency),
    rating: rating !== null && rating <= 5 ? rating : null,
    reviews: reviews !== null ? Math.round(reviews) : null,
    qty: Math.min(99, Math.max(1, Math.round(Number(r.qty) || 1))),
    image,
  };
  return p.name || p.image ? p : null;
}

export const money = (n: number, cur = ""): string =>
  cur + n.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

/** 0 when the page shows no crossed-out price. */
export const savingsPct = (p: Pick<PayProduct, "price" | "was"> | null | undefined): number =>
  p && p.price && p.was && p.was > p.price ? Math.round((1 - p.price / p.was) * 100) : 0;

/** A very big discount is the most common sign of a fake shop. */
export function dealWarning(p: PayProduct | null | undefined): string {
  const pct = savingsPct(p);
  return pct >= 60 ? `${pct}% off is a very big discount, and that is a common sign of a fake shop. Check the seller and the reviews before you allow.` : "";
}

/** The agent's own sentence when it wrote none: short, friendly, with the usual price for comparison. */
export function pitchFor(p: PayProduct | null | undefined, amount: number, host: string): string {
  const cur = p?.currency ?? "";
  const name = p?.name || "this";
  const now = money(p?.price ?? amount, cur);
  const usual = p?.was && p.was > (p.price ?? amount) ? ` (usually ${money(p.was, cur)})` : "";
  return `Found it: ${name} for ${now}${usual} on ${host}. Shall I place the order?`;
}

/** Plain text for chat apps (Telegram, WhatsApp, Slack). */
export function productLine(p: PayProduct | null | undefined): string {
  if (!p || !p.name) return "";
  const cur = p.currency;
  const parts = [p.name + (p.variant ? ` (${p.variant})` : "") + (p.qty > 1 ? ` x${p.qty}` : "")];
  if (p.price) parts.push(money(p.price, cur) + (p.was ? ` (usually ${money(p.was, cur)}, ${savingsPct(p)}% off)` : ""));
  if (p.rating) parts.push(`★ ${p.rating}${p.reviews ? ` (${p.reviews})` : ""}`);
  return "🛍️ " + parts.join(" • ");
}