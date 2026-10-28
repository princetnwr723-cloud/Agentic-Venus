// Search helpers (zero dependencies, runs in the browser and on the server).
// 1) tokens(): lower-case words with light stemming and a small Hinglish/synonym map.
// 2) bm25(): classic Okapi BM25 keyword ranking.
// 3) hybrid(): BM25 + fuzzy character-trigram match (typos, word forms, Hinglish spellings). This is the
//    "semantic-ish" layer that needs no embedding API, so it works with every provider and costs nothing.
const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "are", "was", "you", "your", "from", "have", "has", "had", "not", "but",
  "can", "will", "would", "should", "could", "what", "how", "when", "where", "who", "why", "there", "their", "them",
  "they", "then", "than", "been", "were", "just", "also", "into", "about", "over", "some", "more", "very", "any", "all",
  "please", "pls", "bhai", "yaar",
  "ka", "ki", "ke", "hai", "hain", "ho", "hoga", "hogi", "tha", "thi", "the", "ko", "me", "mein", "se", "aur", "ye", "yeh",
  "wo", "woh", "kar", "kro", "karo", "kya", "kyu", "kyun", "nahi", "nhi", "bhi", "toh", "isko", "usko", "mera", "meri",
  "mere", "tum", "aap", "hum", "mujhe", "abhi", "phir", "fir", "sab", "kuch", "par", "pe", "ek",
]);

// Different spellings / languages of the same idea map to ONE token.
const ALIAS: Record<string, string> = {
  mail: "email", mails: "email", emails: "email", gmail: "email", inbox: "email",
  bhejo: "send", bhejna: "send", bhej: "send", bhejdo: "send", bheja: "send", sending: "send", sent: "send",
  likho: "write", likhna: "write", likh: "write", likha: "write", wrote: "write", written: "write",
  banao: "make", banana: "make", bana: "make", banado: "make", create: "make", build: "make", built: "make", generate: "make",
  dhundo: "search", dhoondo: "search", khojo: "search", khoj: "search", find: "search", lookup: "search",
  kharcha: "expense", kharche: "expense", kharch: "expense", spending: "expense", cost: "expense",
  paisa: "money", paise: "money", rupee: "money", rupees: "money", rupaye: "money", cash: "money",
  payment: "pay", payments: "pay", paid: "pay", paying: "pay", bhugtan: "pay",
  bill: "invoice", bills: "invoice", billing: "invoice", receipt: "invoice",
  grahak: "customer", customers: "customer", client: "customer", clients: "customer", buyer: "customer",
  naukri: "job", jobs: "job", hiring: "job", vacancy: "job",
  meeting: "meet", meetings: "meet", mitting: "meet", call: "call", calls: "call", phone: "call",
  report: "report", reports: "report", summary: "report", summarise: "report", summarize: "report",
  delete: "remove", hatao: "remove", hata: "remove", mita: "remove", mitao: "remove", erase: "remove",
  yaad: "remember", yaad_rakho: "remember", remember: "remember", memorize: "remember",
  bhool: "forget", bhulo: "forget", forget: "forget",
  video: "video", videos: "video", reel: "video", reels: "video", shorts: "video",
  website: "site", websites: "site", webpage: "site", page: "site", landing: "site",
  photo: "image", photos: "image", pic: "image", pics: "image", picture: "image", pictures: "image", tasveer: "image",
  kaam: "task", tasks: "task", todo: "task", work: "task",
  naya: "new", nayi: "new", purana: "old", puraana: "old",
};

function stem(w: string): string {
  if (w.length <= 4 || /[\u0900-\u097f]/.test(w)) return w;
  for (const suf of ["ingly", "edly", "ing", "ied", "ies", "ed", "es", "ly", "s"]) {
    if (!w.endsWith(suf) || w.length - suf.length < 3) continue;
    if (suf === "s" && w.endsWith("ss")) continue;
    if (suf === "ies" || suf === "ied") return w.slice(0, -3) + "y";
    return w.slice(0, -suf.length);
  }
  return w;
}

export function tokens(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => ALIAS[w] ?? stem(w));
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

/** Set of 3-character pieces of the text. "expense" -> " ex","exp","xpe","pen","ens","nse","se ". */
function grams(text: string): Set<string> {
  const t = " " + String(text ?? "").toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000) + " ";
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

/**
 * Hybrid ranking = keyword BM25 (precise) + fuzzy trigram coverage (forgiving: typos, plurals, Hinglish spellings).
 * Score is roughly 0..1. Documents below `minScore` are dropped.
 */
export function hybrid<T>(
  docs: T[],
  getText: (d: T) => string,
  queryText: string,
  o: { minScore?: number; limit?: number } = {}
): Array<{ doc: T; score: number }> {
  if (!docs.length || !String(queryText ?? "").trim()) return [];
  const lex = bm25(docs, getText, queryText);
  const top = lex.length ? lex[0].score : 0;
  const lexScore = new Map<T, number>();
  for (const r of lex) lexScore.set(r.doc, top > 0 ? r.score / top : 0);

  const q = grams(queryText);
  if (!q.size) return lex.slice(0, o.limit ?? 50).map((r) => ({ doc: r.doc, score: top > 0 ? r.score / top : 0 }));
  const dg = docs.map((d) => grams(getText(d)));
  const df = new Map<string, number>();
  for (const s of dg) s.forEach((g) => df.set(g, (df.get(g) ?? 0) + 1));
  const idf = (g: string) => Math.log(1 + docs.length / (df.get(g) ?? 1));
  let qTotal = 0;
  q.forEach((g) => { qTotal += idf(g); });

  const min = o.minScore ?? 0.06;
  const out: Array<{ doc: T; score: number }> = [];
  docs.forEach((doc, i) => {
    let hit = 0;
    q.forEach((g) => { if (dg[i].has(g)) hit += idf(g); });
    const cover = qTotal > 0 ? hit / qTotal : 0;
    const fuzzy = Math.max(0, (cover - 0.3) / 0.7);
    const score = 0.7 * (lexScore.get(doc) ?? 0) + 0.3 * fuzzy;
    if (score >= min) out.push({ doc, score });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, o.limit ?? 50);
}
