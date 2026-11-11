// Venus describes tools as "name:type (note), other?:type". Native tool calling needs a JSON schema and a name that
// only has letters, digits, "_" and "-". This converts both ways.
import type { JsonSchema, Prop, ToolDef } from "./types.ts";

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function propOf(rest: string): Prop {
  const t = rest.trim();
  const desc = t.slice(0, 400);
  const word = /^(string|number|integer|boolean)\b(\[\])?/i.exec(t);
  if (word) {
    const base = word[1].toLowerCase() as "string" | "number" | "integer" | "boolean";
    return word[2] ? { type: "array", items: { type: base }, description: desc } : { type: base, description: desc };
  }
  if (t.startsWith("[{")) return { type: "array", items: { type: "object" }, description: desc };
  if (t.startsWith("[")) return { type: "array", items: { type: "string" }, description: desc };
  if (t.startsWith("{")) return { type: "object", description: desc };
  return { type: "string", description: desc };
}

export function paramsToSchema(params: string): JsonSchema {
  const properties: Record<string, Prop> = {};
  const required: string[] = [];
  const p = String(params ?? "").trim();
  if (p && !/^\(?none\)?$/i.test(p)) {
    for (const entry of splitTop(p)) {
      const m = /^([A-Za-z_][\w-]*)(\?)?\s*:\s*([\s\S]*)$/.exec(entry);
      if (!m) continue;
      properties[m[1]] = propOf(m[3]);
      if (!m[2]) required.push(m[1]);
    }
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

export type SpecLike = { name: string; description: string; params: string; risk: "read" | "write" };
export const toolDef = (s: SpecLike): ToolDef => ({ name: s.name, description: s.description.slice(0, 1000), schema: paramsToSchema(s.params), risk: s.risk });

export type NameMap = { toNative: (n: string) => string; fromNative: (n: string) => string | undefined };

/** Unique, provider-safe names, with the reverse lookup. */
export function buildNameMap(names: string[]): NameMap {
  const fwd = new Map<string, string>();
  const rev = new Map<string, string>();
  for (const n of names) {
    let base = n.replace(/\./g, "__").replace(/[^A-Za-z0-9_-]/g, "_").replace(/^([^A-Za-z_])/, "_$1").slice(0, 60);
    let cand = base, i = 2;
    while (rev.has(cand) && rev.get(cand) !== n) cand = `${base.slice(0, 56)}_${i++}`;
    fwd.set(n, cand);
    rev.set(cand, n);
  }
  return { toNative: (n) => fwd.get(n) ?? n.replace(/\./g, "__").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64), fromNative: (n) => rev.get(n) };
}
