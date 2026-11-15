// Durable replay for server-side Venus Pro runs.
//
// A server function lives 60 seconds, a video takes 15-30 minutes. So a run is cut into slices, and every slice runs the SAME
// pipeline again from the step where the last one stopped. To make that cheap and safe, every expensive call (the AI plan, a
// scene's code, the voice, a render start ...) is written to this journal the first time it succeeds. When the pipeline asks for
// the same call again it gets the saved answer at once: nothing is paid twice, no render is started twice.
//
//   key        = the call's address + a hash of its arguments (secrets left out)
//   occurrence = the 1st, 2nd ... time the same call is made in one slice (a repair loop legitimately repeats a call)
//
// Pure: the storage is injected (Firestore in production, a Map in the tests). No imports.

export type JournalEntry = { k: string; n: number; v: string };
export type JournalStore = { load(): Promise<JournalEntry[]>; put(e: JournalEntry): Promise<void>; clear(): Promise<void> };

/** One entry (a storyboard with code can be big) must fit into one Firestore document. */
export const MAX_ENTRY_CHARS = 900_000;
const SECRET_FIELDS = new Set(["uid", "e2bKey", "apiKey", "apiKeys", "token", "authorization"]);

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

/** 53-bit string hash (cyrb53): enough to tell calls apart, no crypto needed. */
export function hash53(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function callKey(path: string, body: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body ?? {})) if (!SECRET_FIELDS.has(k)) rest[k] = v;
  return `${path}#${hash53(stableStringify(rest))}`;
}

export async function createJournal(store: JournalStore) {
  const entries = new Map<string, string>();
  try { for (const e of await store.load()) entries.set(`${e.k}:${e.n}`, e.v); } catch { /* an unreadable journal only costs a repeat of the calls */ }
  const seen = new Map<string, number>();
  const slot = (key: string) => `${key}:${seen.get(key) ?? 0}`;
  return {
    size: () => entries.size,
    /** Would the next call with this key be answered from the journal? (does not count as a call) */
    wouldReplay: (key: string) => entries.has(slot(key)),
    /** The saved answer, or the live call (kept only when `keep` says it succeeded). */
    async call<T>(key: string, live: () => Promise<T>, keep: (r: T) => boolean = () => true): Promise<{ value: T; replayed: boolean }> {
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      const hit = entries.get(`${key}:${n}`);
      if (hit !== undefined) return { value: JSON.parse(hit) as T, replayed: true };
      const value = await live();
      if (keep(value)) {
        const v = JSON.stringify(value);
        if (v.length <= MAX_ENTRY_CHARS) {
          entries.set(`${key}:${n}`, v);
          try { await store.put({ k: key, n, v }); } catch { /* not saved: the call is simply repeated next time */ }
        }
      }
      return { value, replayed: false };
    },
    /** A new stage begins: the answers of the old one are not needed any more. */
    async clear() { entries.clear(); seen.clear(); try { await store.clear(); } catch { /* ignore */ } },
  };
}
export type Journal = Awaited<ReturnType<typeof createJournal>>;

/** A small seeded random source (mulberry32): the same project + step always picks the same style. */
export function seededRandom(seed: string): () => number {
  let a = parseInt(hash53(seed).slice(0, 6), 36) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
