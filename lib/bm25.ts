const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "are", "was", "you", "your", "from", "have",
  "ka", "ki", "ke", "hai", "ko", "me", "se", "aur", "ye", "wo", "kar", "kro",
]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Okapi BM25: proper relevance ranking with zero dependencies. */
export function bm25<T>(
  docs: T[],
  getText: (d: T) => string,
  queryText: string
): Array<{ doc: T; score: number }> {
  const k1 = 1.4;
  const b = 0.75;
  const q = Array.from(new Set(tokens(queryText)));
  if (!q.length || !docs.length) return [];
  const toks = docs.map((d) => tokens(getText(d)));
  const avg = toks.reduce((n, t) => n + t.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of Array.from(new Set(t))) df.set(w, (df.get(w) ?? 0) + 1);

  return docs
    .map((doc, i) => {
      const t = toks[i];
      const tf = new Map<string, number>();
      for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
      let score = 0;
      for (const w of q) {
        const f = tf.get(w);
        if (!f) continue;
        const n = df.get(w) ?? 0;
        const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * t.length) / avg)));
      }
      return { doc, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
}

export function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter);
}