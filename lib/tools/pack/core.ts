// Tool Pack core. A "pack tool" is a small, deterministic function (text, math, dates, units, validation, data, leads,
// finance, web helpers ...). There are 1000+ of them, so they are NOT all put in the model's prompt. The agent finds
// them with tools.search and runs them by name (or with tools.call). Every tool here is pure code: no model, no key.

export type A = Record<string, any>;
export type PackTool = {
  name: string; family: string; description: string; params: string; keywords: string;
  run: (a: A) => string | Promise<string>;
};

/** Creates a family: `t(name, params, description, run, keywords?)` registers one tool in it. */
export function family(fam: string) {
  const list: PackTool[] = [];
  const t = (name: string, params: string, description: string, run: PackTool["run"], keywords = "") => {
    list.push({ name, family: fam, description, params, keywords, run });
  };
  return { t, list };
}

// ---------------- argument helpers (models are sloppy: numbers as strings, arrays as text, JSON as text) ----------------
const isEmpty = (v: unknown) => v === undefined || v === null || v === "";

export function s(a: A, k: string, d?: string): string {
  const v = a[k];
  if (isEmpty(v)) { if (d !== undefined) return d; throw new Error(`"${k}" is required.`); }
  if (typeof v === "string") return v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
export function n(a: A, k: string, d?: number): number {
  const v = a[k];
  if (isEmpty(v)) { if (d !== undefined) return d; throw new Error(`"${k}" is required (a number).`); }
  const x = typeof v === "number" ? v : Number(String(v).replace(/[, _]/g, "").replace(/%$/, ""));
  if (!Number.isFinite(x)) throw new Error(`"${k}" must be a number, got "${String(v).slice(0, 40)}".`);
  return x;
}
export function b(a: A, k: string, d = false): boolean {
  const v = a[k];
  if (isEmpty(v)) return d;
  if (typeof v === "boolean") return v;
  return /^(1|true|yes|y|haan|ha|on)$/i.test(String(v).trim());
}
/** A list: a real array, a JSON array in text, or text separated by new lines / commas / semicolons. */
export function list(a: A, k: string, d?: any[]): any[] {
  const v = a[k];
  if (isEmpty(v)) { if (d) return d; throw new Error(`"${k}" is required (a list).`); }
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("[")) { try { const j = JSON.parse(t); if (Array.isArray(j)) return j; } catch { /* fall through */ } }
    const parts = t.includes("\n") ? t.split(/\r?\n/) : t.split(/[,;]/);
    return parts.map((x) => x.trim()).filter((x) => x !== "");
  }
  return [v];
}
export function nums(a: A, k: string, min = 1): number[] {
  const l = list(a, k).map((x) => (typeof x === "number" ? x : Number(String(x).replace(/[, _]/g, ""))));
  const bad = l.findIndex((x) => !Number.isFinite(x));
  if (bad >= 0) throw new Error(`"${k}" must contain only numbers (item ${bad + 1} is not).`);
  if (l.length < min) throw new Error(`"${k}" needs at least ${min} number(s).`);
  return l;
}
export function obj(a: A, k: string, d?: Record<string, any>): Record<string, any> {
  const v = a[k];
  if (isEmpty(v)) { if (d) return d; throw new Error(`"${k}" is required (an object).`); }
  if (typeof v === "object" && !Array.isArray(v)) return v;
  if (typeof v === "string") { try { const j = JSON.parse(v); if (j && typeof j === "object" && !Array.isArray(j)) return j; } catch { /* below */ } }
  throw new Error(`"${k}" must be a JSON object.`);
}
/** Parsed JSON from a value that may already be parsed or still be text. */
export function json(a: A, k: string): any {
  const v = a[k];
  if (isEmpty(v)) throw new Error(`"${k}" is required (JSON).`);
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch (e) { throw new Error(`"${k}" is not valid JSON: ${(e as Error).message.slice(0, 120)}`); }
}
export const J = (v: unknown) => JSON.stringify(v, null, 2);
export const r2 = (x: number, d = 2) => { const f = 10 ** d; return Math.round((x + Number.EPSILON) * f) / f; };
export const fmt = (x: number, _d = 12) => (Number.isInteger(x) ? String(x) : String(parseFloat(x.toPrecision(12))));

// ---------------- CSV (RFC 4180 style, used by data.* and leads.*) ----------------
export function parseCsv(text: string, delim?: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  if (!delim) {
    const first = src.split(/\r?\n/, 1)[0] ?? "";
    const counts: Array<[string, number]> = [",", ";", "\t", "|"].map((d) => [d, first.split(d).length - 1]);
    delim = counts.sort((x, y) => y[1] - x[1])[0][1] > 0 ? counts.sort((x, y) => y[1] - x[1])[0][0] : ",";
  }
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cur); cur = ""; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}
export function toCsv(rows: unknown[][], delim = ","): string {
  const q = (v: unknown) => { const t = v === null || v === undefined ? "" : String(v); return new RegExp(`[${delim}"\\n\\r]`).test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return rows.map((r) => r.map(q).join(delim)).join("\n");
}
/** CSV text -> array of objects keyed by the header row. */
export function csvObjects(text: string, delim?: string): { headers: string[]; rows: Record<string, string>[] } {
  const all = parseCsv(text, delim);
  if (!all.length) throw new Error("The CSV is empty.");
  const headers = all[0].map((h, i) => h.trim() || `col${i + 1}`);
  const rows = all.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, rows };
}
export const objectsToCsv = (headers: string[], rows: Record<string, unknown>[], delim = ",") => toCsv([headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))], delim);

/** rows can come as a CSV text, a JSON array of objects, or a real array. */
export function table(a: A, k = "data"): { headers: string[]; rows: Record<string, any>[] } {
  const v = a[k] ?? a.csv ?? a.rows ?? a.items ?? a.leads;
  if (isEmpty(v)) throw new Error(`"${k}" is required (CSV text or a list of objects).`);
  let arr: any = v;
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("[")) { try { arr = JSON.parse(t); } catch { return csvObjects(t); } } else return csvObjects(t);
  }
  if (!Array.isArray(arr) || !arr.length) throw new Error(`"${k}" is empty.`);
  const rows = arr.filter((x: any) => x && typeof x === "object" && !Array.isArray(x));
  if (!rows.length) throw new Error(`"${k}" must be a list of objects or CSV text.`);
  const headers: string[] = [];
  for (const r of rows) for (const h of Object.keys(r)) if (!headers.includes(h)) headers.push(h);
  return { headers, rows };
}

// ---------------- search over the pack (works in English, Hinglish) ----------------
const SYN: Record<string, string[]> = {
  mail: ["email"], gmail: ["email"], lead: ["leads", "prospect", "contact"], leads: ["lead", "prospect"], prospect: ["lead"],
  sheet: ["csv", "table", "spreadsheet"], excel: ["csv", "table", "xlsx", "spreadsheet"], spreadsheet: ["csv", "table", "xlsx"],
  paisa: ["money", "finance"], money: ["finance", "currency"], loan: ["emi", "finance"], tax: ["gst", "finance"],
  date: ["time", "calendar"], time: ["date"], dedupe: ["duplicate", "unique"], duplicate: ["dedupe", "unique"], duplicates: ["dedupe", "unique"],
  clean: ["normalize", "trim"], normalise: ["normalize"], convert: ["unit", "conversion"], hash: ["sha256", "md5", "checksum"],
  password: ["random", "strength"], phone: ["mobile", "number"], mobile: ["phone"], name: ["person", "title"],
  pdf: ["document", "file"], word: ["docx", "document"], ppt: ["pptx", "slides"], slides: ["pptx"], json: ["data"],
  kitna: ["calculate", "count"], hisab: ["calculate", "finance"], gst: ["tax", "india"], pan: ["india", "validate"], aadhaar: ["india", "validate"],
};
const tok = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1);

export function searchPack(all: PackTool[], query: string, limit = 12): PackTool[] {
  const q = tok(query);
  if (!q.length) return [];
  const words = new Set<string>(q);
  for (const w of q) for (const s2 of SYN[w] ?? []) words.add(s2);
  const scored: Array<[number, PackTool]> = [];
  for (const t of all) {
    const nameParts = tok(t.name);
    const nameText = t.name.toLowerCase();
    const desc = t.description.toLowerCase();
    const kw = t.keywords.toLowerCase();
    let sc = 0;
    for (const w of words) {
      const orig = q.includes(w) ? 1 : 0.5;
      if (nameText === w) sc += 12 * orig;
      else if (nameParts.includes(w)) sc += 6 * orig;
      else if (nameText.includes(w)) sc += 3 * orig;
      if (kw.includes(w)) sc += 3 * orig;
      if (desc.includes(w)) sc += 1.5 * orig;
      if (t.family === w) sc += 2 * orig;
    }
    if (sc > 0) scored.push([sc, t]);
  }
  scored.sort((x, y) => y[0] - x[0] || x[1].name.length - y[1].name.length);
  return scored.slice(0, limit).map((x) => x[1]);
}

/** Levenshtein for "did you mean" on mistyped tool names. */
export function lev(a: string, b: string): number {
  const m = a.length, n2 = b.length;
  if (!m) return n2; if (!n2) return m;
  let prev = Array.from({ length: n2 + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n2; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n2];
}
