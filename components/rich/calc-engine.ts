// A tiny, SAFE formula engine for the chat widgets (calculators, plans). No eval, no Function():
// a tokenizer and a recursive-descent parser that only knows numbers, variables, + - * / % ^, comparisons and a few functions.
// A bad formula never throws: it gives NaN, which the widgets show as "—".

export type Vars = Record<string, number>;
type Node =
  | { t: "n"; v: number }
  | { t: "v"; name: string }
  | { t: "u"; op: string; a: Node }
  | { t: "b"; op: string; a: Node; b: Node }
  | { t: "f"; name: string; args: Node[] };

const FN: Record<string, (...a: number[]) => number> = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  abs: Math.abs,
  sqrt: Math.sqrt,
  floor: Math.floor,
  ceil: Math.ceil,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  pow: Math.pow,
  round: (x, d = 0) => { const k = 10 ** Math.max(0, Math.min(6, Math.floor(d))); return Math.round(x * k) / k; },
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
  if: (c, a, b) => (c ? a : b),
  // loan payment per period: rate per period, number of periods, amount borrowed
  pmt: (r, n, pv) => (r === 0 ? pv / n : (pv * r) / (1 - (1 + r) ** -n)),
  // future value: rate per period, periods, payment added each period, starting amount
  fv: (r, n, p, pv = 0) => (r === 0 ? pv + p * n : pv * (1 + r) ** n + p * (((1 + r) ** n - 1) / r)),
};
const CONST: Vars = { pi: Math.PI, e: Math.E };

type Tok = { k: "n" | "id" | "op"; v: string };

function tokenize(src: string): Tok[] | null {
  const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").replace(/\*\*/g, "^");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) { out.push({ k: "n", v: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) { out.push({ k: "id", v: id[0] }); i += id[0].length; continue; }
    const two = s.slice(i, i + 2);
    if ([">=", "<=", "==", "!=", "&&", "||"].includes(two)) { out.push({ k: "op", v: two }); i += 2; continue; }
    if ("+-*/%^(),<>!".includes(c)) { out.push({ k: "op", v: c }); i++; continue; }
    return null;
  }
  return out.length && out.length <= 300 ? out : null;
}

function parse(toks: Tok[]): Node | null {
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const eat = (v: string) => (toks[p]?.k === "op" && toks[p].v === v ? (p++, true) : false);

  const bin = (next: () => Node, ops: string[]): Node => {
    let a = next();
    while (peek()?.k === "op" && ops.includes(peek().v)) {
      const op = toks[p++].v;
      a = { t: "b", op, a, b: next() };
    }
    return a;
  };
  const orE = (): Node => bin(andE, ["||"]);
  const andE = (): Node => bin(cmp, ["&&"]);
  const cmp = (): Node => bin(add, [">", "<", ">=", "<=", "==", "!="]);
  const add = (): Node => bin(mul, ["+", "-"]);
  const mul = (): Node => bin(unary, ["*", "/", "%"]);
  const unary = (): Node => {
    if (++depth > 40) throw new Error("deep");
    try {
      const t = peek();
      if (t?.k === "op" && (t.v === "-" || t.v === "+" || t.v === "!")) { p++; return { t: "u", op: t.v, a: unary() }; }
      const base = primary();
      if (eat("^")) return { t: "b", op: "^", a: base, b: unary() }; // right-associative
      return base;
    } finally { depth--; }
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new Error("end");
    if (t.k === "n") return { t: "n", v: Number(t.v) };
    if (t.k === "id") {
      if (eat("(")) {
        const args: Node[] = [];
        if (!eat(")")) {
          do { args.push(orE()); } while (eat(","));
          if (!eat(")")) throw new Error(")");
        }
        return { t: "f", name: t.v.toLowerCase(), args };
      }
      return { t: "v", name: t.v };
    }
    if (t.v === "(") { const e = orE(); if (!eat(")")) throw new Error(")"); return e; }
    throw new Error("tok");
  };

  try {
    const tree = orE();
    return p === toks.length ? tree : null;
  } catch { return null; }
}

function run(n: Node, vars: Vars): number {
  switch (n.t) {
    case "n": return n.v;
    case "v": {
      if (n.name in vars) return vars[n.name];
      const c = CONST[n.name.toLowerCase()];
      return c === undefined ? NaN : c;
    }
    case "u": {
      const a = run(n.a, vars);
      return n.op === "-" ? -a : n.op === "!" ? (a ? 0 : 1) : a;
    }
    case "b": {
      const a = run(n.a, vars), b = run(n.b, vars);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b === 0 ? NaN : a / b;
        case "%": return b === 0 ? NaN : a % b;
        case "^": return a ** b;
        case ">": return a > b ? 1 : 0;
        case "<": return a < b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case "==": return a === b ? 1 : 0;
        case "!=": return a !== b ? 1 : 0;
        case "&&": return a && b ? 1 : 0;
        case "||": return a || b ? 1 : 0;
      }
      return NaN;
    }
    case "f": {
      const f = FN[n.name];
      if (!f) return NaN;
      return f(...n.args.map((x) => run(x, vars)));
    }
  }
}

const cache = new Map<string, Node | null>();

/** Evaluates a formula with the given variables. Returns NaN when the formula or a variable is bad. */
export function evalFormula(src: string, vars: Vars): number {
  const key = String(src ?? "").slice(0, 300);
  let tree = cache.get(key);
  if (tree === undefined) {
    const toks = tokenize(key);
    tree = toks ? parse(toks) : null;
    if (cache.size > 400) cache.clear();
    cache.set(key, tree);
  }
  if (!tree) return NaN;
  try {
    const v = run(tree, vars);
    return Number.isFinite(v) ? v : NaN;
  } catch { return NaN; }
}
