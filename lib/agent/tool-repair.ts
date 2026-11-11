// Models are sloppy: broken JSON, wrong tool names, strings where numbers belong. This repairs what can be repaired
// and returns a clear error the model can act on for everything else.
import type { JsonSchema, Prop } from "./types.ts";

// ---------- lenient JSON ----------
export type Loose = { ok: true; value: unknown; repaired: boolean } | { ok: false };

/** Accepts: code fences, comments, single quotes, unquoted keys, trailing commas, True/False/None, raw newlines in strings, cut-off output. */
export function parseLooseJson(input: string): Loose {
  const src = String(input ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!src) return { ok: false };
  try { return { ok: true, value: JSON.parse(src), repaired: false }; } catch { /* repair below */ }
  let i = 0;
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith("//", i)) { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (src.startsWith("/*", i)) { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; continue; }
      return;
    }
  };
  const str = (q: string): string => {
    let out = "";
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\" && i + 1 < src.length) {
        const n = src[i + 1];
        if (n === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) { out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); i += 6; continue; }
        out += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n === "b" ? "\b" : n === "f" ? "\f" : n;
        i += 2;
      } else out += src[i++];
    }
    i++;
    return out;
  };
  const value = (): unknown => {
    ws();
    const c = src[i];
    if (c === "{") {
      i++;
      const o: Record<string, unknown> = {};
      for (;;) {
        ws();
        if (i >= src.length) return o;
        if (src[i] === "}") { i++; return o; }
        if (src[i] === ",") { i++; continue; }
        let k: string;
        if (src[i] === '"' || src[i] === "'") k = str(src[i]);
        else { const m = /^[A-Za-z_$][\w$-]*/.exec(src.slice(i)); if (!m) { i++; continue; } k = m[0]; i += k.length; }
        ws();
        if (src[i] === ":" || src[i] === "=") i++;
        o[k] = value();
      }
    }
    if (c === "[") {
      i++;
      const a: unknown[] = [];
      for (;;) {
        ws();
        if (i >= src.length) return a;
        if (src[i] === "]") { i++; return a; }
        if (src[i] === ",") { i++; continue; }
        a.push(value());
      }
    }
    if (c === '"' || c === "'") return str(c);
    const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|True|False|None|undefined)/.exec(src.slice(i));
    if (m) {
      i += m[0].length;
      const t = m[0].toLowerCase();
      return t === "true" ? true : t === "false" ? false : t === "null" || t === "none" || t === "undefined" ? null : Number(m[0]);
    }
    const bare = /^[^,}\]\n]+/.exec(src.slice(i));
    i += bare ? bare[0].length : 1;
    return bare ? bare[0].trim() : null;
  };
  try {
    const first = src.search(/[{[]/);
    if (first < 0) return { ok: false };
    i = first;
    const v = value();
    return v !== null && typeof v === "object" ? { ok: true, value: v, repaired: true } : { ok: false };
  } catch { return { ok: false }; }
}

/** The arguments of a tool call as an object. */
export function parseArgs(raw: unknown): { args: Record<string, unknown>; repaired: boolean; failed: boolean } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { args: raw as Record<string, unknown>, repaired: false, failed: false };
  if (typeof raw === "string") {
    if (!raw.trim()) return { args: {}, repaired: false, failed: false };
    const r = parseLooseJson(raw);
    if (r.ok && r.value && typeof r.value === "object" && !Array.isArray(r.value)) return { args: r.value as Record<string, unknown>, repaired: r.repaired, failed: false };
    return { args: {}, repaired: false, failed: true };
  }
  return { args: {}, repaired: false, failed: raw !== undefined && raw !== null };
}

// ---------- tool names ----------
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export type NameMatch = { name: string; how: "exact" | "native" | "case" | "squashed" | "fuzzy" } | { name: null; suggestions: string[] };

/** "plan__set", "Plan.Set", "plan-set", "plan.sett" -> "plan.set" (only when the match is unambiguous). */
export function resolveToolName(raw: string, known: string[], fromNative?: (n: string) => string | undefined): NameMatch {
  const r = String(raw ?? "").trim();
  if (known.includes(r)) return { name: r, how: "exact" };
  const nat = fromNative?.(r);
  if (nat && known.includes(nat)) return { name: nat, how: "native" };
  const lower = known.filter((k) => k.toLowerCase() === r.toLowerCase());
  if (lower.length === 1) return { name: lower[0], how: "case" };
  const sq = known.filter((k) => squash(k) === squash(r));
  if (sq.length === 1) return { name: sq[0], how: "squashed" };
  const scored = known.map((k) => [k, distance(squash(k), squash(r))] as const).sort((a, b) => a[1] - b[1]);
  if (scored.length && scored[0][1] <= 2 && (scored.length === 1 || scored[1][1] > scored[0][1])) return { name: scored[0][0], how: "fuzzy" };
  return { name: null, suggestions: scored.slice(0, 3).map(([k]) => k) };
}

// ---------- arguments against the schema ----------
function coerce(v: unknown, p: Prop): unknown {
  if (v === null || v === undefined) return v;
  switch (p.type) {
    case "number": case "integer": {
      if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return p.type === "integer" ? Math.trunc(Number(v)) : Number(v);
      return v;
    }
    case "boolean": return v === "true" || v === "yes" ? true : v === "false" || v === "no" ? false : v;
    case "array": {
      if (typeof v === "string") {
        const r = parseLooseJson(v);
        if (r.ok && Array.isArray(r.value)) return r.value;
        return v.trim() ? [v] : [];
      }
      return Array.isArray(v) ? v : [v];
    }
    case "object": {
      if (typeof v === "string") { const r = parseLooseJson(v); if (r.ok && !Array.isArray(r.value)) return r.value; }
      return v;
    }
    case "string": return typeof v === "object" ? JSON.stringify(v) : typeof v === "number" || typeof v === "boolean" ? String(v) : v;
    default: return v;
  }
}

export type Checked = { args: Record<string, unknown>; errors: string[] };

export function checkArgs(schema: JsonSchema, input: Record<string, unknown>): Checked {
  const args: Record<string, unknown> = { ...input };
  const errors: string[] = [];
  for (const [k, p] of Object.entries(schema.properties)) {
    if (k in args) args[k] = coerce(args[k], p);
  }
  for (const k of schema.required ?? []) {
    const v = args[k];
    if (v === undefined || v === null || v === "") errors.push(`missing required argument "${k}"`);
  }
  for (const [k, p] of Object.entries(schema.properties)) {
    const v = args[k];
    if (v === undefined || v === null) continue;
    const ok = p.type === "array" ? Array.isArray(v) : p.type === "object" ? typeof v === "object" && !Array.isArray(v)
      : p.type === "number" || p.type === "integer" ? typeof v === "number" && !Number.isNaN(v)
      : p.type === "boolean" ? typeof v === "boolean" : p.type === "string" ? typeof v === "string" : true;
    if (!ok) errors.push(`argument "${k}" must be ${p.type}`);
  }
  return { args, errors };
}

/** The tool-result text the model sees when its call cannot run. */
export function repairMessage(name: string, errors: string[], schema?: JsonSchema): string {
  const need = schema ? Object.entries(schema.properties).map(([k, p]) => `${k}${schema.required?.includes(k) ? "" : "?"}:${p.type ?? "any"}`).join(", ") : "";
  return `Tool call "${name}" was not run: ${errors.join("; ")}.${need ? ` Expected arguments: ${need}.` : ""} Fix the arguments and call it again.`;
}
