// Pure memory-list logic shared by the owner profile and the per-chat memory (server side).
import { jaccard } from "@/lib/bm25";
import { MEM_CAP, MEM_TEXT_MAX, looksSecret } from "@/lib/learn-utils";

export type MemLike = { id: string; text: string; at: number; auto?: boolean; kind?: string; weight?: number };

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ").trim();
/** Numbers and 1-2 letter words ("A", "B", "10", "Q3"): the search tokens ignore them, but they decide WHICH fact it is. */
const sig = (x: string) => (x.toLowerCase().match(/\b[a-z0-9]{1,2}\b|\d[\d.,]*/g) ?? []).sort().join("|");
const newId = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/** Make room: drop the least valuable AUTO memories first (low weight, old). Role and profile facts are kept longest. */
export function trimItems(items: MemLike[], cap = MEM_CAP): MemLike[] {
  if (items.length <= cap) return items;
  const keep = (m: MemLike) => (m.kind === "role" ? 3 : m.kind === "profile" ? 2 : m.auto ? 0 : 1);
  const order = items
    .map((m, i) => ({ m, i }))
    .sort((a, b) => keep(a.m) - keep(b.m) || (a.m.weight ?? 1) - (b.m.weight ?? 1) || a.m.at - b.m.at);
  const drop = new Set(order.slice(0, items.length - cap).map((x) => x.m.id));
  return items.filter((m) => !drop.has(m.id));
}

export function addItem(
  items: MemLike[],
  text: string,
  o: { auto?: boolean; kind?: string; weight?: number } = {},
  cap = MEM_CAP
): { items: MemLike[]; saved: MemLike | null; refreshed: boolean } {
  const t = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MEM_TEXT_MAX);
  if (t.length < 3 || looksSecret(t)) return { items, saved: null, refreshed: false };
  const kind = o.kind ?? "fact";
  const n = norm(t);
  const dup = items.find((i) => norm(i.text) === n);
  if (dup) return { items: items.map((i) => (i.id === dup.id ? { ...i, at: Date.now() } : i)), saved: null, refreshed: true };
  // Near-identical wording of the SAME kind AND the same numbers/letters = the same fact said again (latest wording wins).
  // A different number or name ("Supplier A pays in 10 days" vs "Supplier B pays in 30 days") is a DIFFERENT fact and is kept. Other kinds never overwrite each other.
  const similar = items.find((i) => i.kind !== "role" && (i.kind ?? "fact") === kind && jaccard(i.text, t) > 0.8 && sig(i.text) === sig(t));
  if (similar) {
    return {
      items: items.map((i) => (i.id === similar.id ? { ...i, text: t, at: Date.now(), weight: Math.max(i.weight ?? 1, o.weight ?? 1) } : i)),
      saved: null, refreshed: true,
    };
  }
  const mem: MemLike = { id: newId(), text: t, at: Date.now(), kind, weight: Math.min(3, Math.max(1, Math.round(o.weight ?? 1))), ...(o.auto ? { auto: true } : {}) };
  return { items: trimItems([...items, mem], cap), saved: mem, refreshed: false };
}

/** Replace the one memory that contains `match` (case-insensitive). */
export function replaceInList(
  items: MemLike[], match: string, newText: string
): { items: MemLike[]; status: "ok" | "none" | "many" | "bad"; matched: string[] } {
  const m = match.trim().toLowerCase();
  const t = newText.replace(/\s+/g, " ").trim().slice(0, MEM_TEXT_MAX);
  if (m.length < 3 || t.length < 3 || looksSecret(t)) return { items, status: "bad", matched: [] };
  const hits = items.filter((i) => i.kind !== "role" && i.text.toLowerCase().includes(m));
  if (!hits.length) return { items, status: "none", matched: [] };
  if (hits.length > 1) return { items, status: "many", matched: hits.map((h) => h.text) };
  return { items: items.map((i) => (i.id === hits[0].id ? { ...i, text: t, at: Date.now() } : i)), status: "ok", matched: [hits[0].text] };
}

/** Remove every memory (never the role) that contains `match`. */
export function forgetInList(items: MemLike[], match: string): { items: MemLike[]; removed: number } {
  const m = match.trim().toLowerCase();
  if (m.length < 3) return { items, removed: 0 };
  const left = items.filter((i) => i.kind === "role" || !i.text.toLowerCase().includes(m));
  return { items: left, removed: items.length - left.length };
}
