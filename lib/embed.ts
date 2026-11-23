// Semantic search helpers (embeddings). PURE except embedBatch(), which takes the fetch function as a parameter, so the tests run offline.
//
// What exists today: lib/bm25.ts ranks memories and skills by keywords + fuzzy letter pieces (good for typos and Hinglish spellings).
// What embeddings add: "mera budget kam hai" finds the memory "monthly spend limit 30000" although no word is shared.
// This file is the engine for that. It is NOT connected to the memory store yet: that needs a decision (which provider's key pays for the
// embeddings, and where the vectors are cached) and is described in the hand-over notes.

export type Provider = "openai" | "gemini";

export const cosine = (a: number[], b: number[]): number => {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
};

/**
 * Mixes the keyword score (0..1, from hybrid()) with the meaning score (cosine, mapped to 0..1).
 * `alpha` is the weight of meaning. Documents without a vector keep their keyword score only.
 */
export function fuse<T>(hits: Array<{ doc: T; score: number }>, qVec: number[], vecOf: (d: T) => number[] | undefined, alpha = 0.5, limit = 50): Array<{ doc: T; score: number }> {
  const a = Math.min(1, Math.max(0, alpha));
  return hits
    .map((h) => {
      const v = vecOf(h.doc);
      if (!v || !v.length) return { doc: h.doc, score: h.score };
      const sem = Math.max(0, cosine(qVec, v)); // 0..1 for normal text embeddings
      return { doc: h.doc, score: (1 - a) * h.score + a * sem };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

/** A short stable key for a text (to cache its vector). Not for security. */
export function textKey(s: string): string {
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = ((h1 << 5) + h1 + c) | 0; h2 = ((h2 << 5) + h2) ^ c; h2 |= 0; }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}

export function requestFor(provider: Provider, key: string, texts: string[]): { url: string; init: { method: string; headers: Record<string, string>; body: string } } {
  const clip = texts.map((t) => String(t ?? "").slice(0, 6000));
  if (provider === "openai") {
    return { url: "https://api.openai.com/v1/embeddings", init: { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "text-embedding-3-small", input: clip }) } };
  }
  return {
    url: "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents",
    init: { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ requests: clip.map((t) => ({ model: "models/text-embedding-004", content: { parts: [{ text: t }] } })) }) },
  };
}

export function parseVectors(provider: Provider, json: unknown, expected: number): number[][] | null {
  const j = json as { data?: Array<{ embedding?: number[]; index?: number }>; embeddings?: Array<{ values?: number[] }> } | null;
  let out: number[][] = [];
  if (provider === "openai") out = (j?.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding ?? []);
  else out = (j?.embeddings ?? []).map((e) => e.values ?? []);
  return out.length === expected && out.every((v) => v.length > 0 && v.every((x) => Number.isFinite(x))) ? out : null;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Embeds up to 64 texts in one call. Returns null on any problem (the caller then simply uses keyword ranking). Never throws. */
export async function embedBatch(fetchImpl: FetchLike, provider: Provider, key: string, texts: string[]): Promise<number[][] | null> {
  try {
    if (!key || texts.length === 0 || texts.length > 64) return null;
    const r = requestFor(provider, key, texts);
    const res = await fetchImpl(r.url, { ...r.init, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return parseVectors(provider, await res.json(), texts.length);
  } catch { return null; }
}
