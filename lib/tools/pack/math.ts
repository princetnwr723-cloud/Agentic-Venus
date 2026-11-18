import { family, s, n, b, nums, list, J, r2, fmt } from "./core.ts";

const { t, list: MATH } = family("math");

// ---------------- safe expression evaluator (no eval): + - * / ^ % ( ) , functions and constants ----------------
const FN: Record<string, (...x: number[]) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: (x, d = 0) => { const f = 10 ** d; return Math.round(x * f) / f; },
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  ln: Math.log, log: (x, base) => (base ? Math.log(x) / Math.log(base) : Math.log10(x)), log2: Math.log2, log10: Math.log10, exp: Math.exp,
  min: Math.min, max: Math.max, pow: Math.pow, sign: Math.sign, trunc: Math.trunc, hypot: Math.hypot,
  deg: (x) => (x * 180) / Math.PI, rad: (x) => (x * Math.PI) / 180, fact: (x) => factorial(x),
  avg: (...x) => x.reduce((p, q) => p + q, 0) / x.length, sum: (...x) => x.reduce((p, q) => p + q, 0),
};
const CONST: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 };

function factorial(x: number): number {
  if (!Number.isInteger(x) || x < 0) throw new Error("Factorial needs a whole number ≥ 0.");
  if (x > 170) throw new Error("Factorial above 170 is too big for a normal number (use math.factorial_big).");
  let r = 1; for (let i = 2; i <= x; i++) r *= i; return r;
}

export function evalExpr(src: string): number {
  const text = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\bof\b/gi, "*").replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/(\d+(?:\.\d+)?)\s*%\s*(?=\d|\()/g, "($1/100)*").replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)");
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const num = (): number => {
    ws();
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
    if (m) { i += m[0].length; return parseFloat(m[0]); }
    const id = /^[a-z_][a-z0-9_]*/i.exec(text.slice(i));
    if (id) {
      const name = id[0].toLowerCase(); i += id[0].length; ws();
      if (text[i] === "(") {
        i++; const args: number[] = [];
        ws(); if (text[i] === ")") i++; else { while (true) { args.push(expr()); ws(); if (text[i] === ",") { i++; continue; } if (text[i] === ")") { i++; break; } throw new Error("Missing ) in the expression."); } }
        const f = FN[name]; if (!f) throw new Error(`Unknown function ${name}().`); return f(...args);
      }
      if (name in CONST) return CONST[name];
      throw new Error(`Unknown name "${name}".`);
    }
    throw new Error(`Cannot read the expression near "${text.slice(i, i + 12)}".`);
  };
  const atom = (): number => {
    ws();
    if (text[i] === "(") { i++; const v = expr(); ws(); if (text[i] !== ")") throw new Error("Missing ) in the expression."); i++; return post(v); }
    if (text[i] === "-") { i++; return -pow(); }
    if (text[i] === "+") { i++; return pow(); }
    return post(num());
  };
  const post = (v: number): number => { ws(); while (text[i] === "!") { i++; v = factorial(v); ws(); } return v; };
  const pow = (): number => { const base = atom(); ws(); if (text[i] === "^" || (text[i] === "*" && text[i + 1] === "*")) { i += text[i] === "^" ? 1 : 2; return Math.pow(base, pow()); } return base; };
  const term = (): number => { let v = pow(); while (true) { ws(); const c = text[i]; if (c === "*" && text[i + 1] !== "*") { i++; v *= pow(); } else if (c === "/") { i++; const d = pow(); if (d === 0) throw new Error("Division by zero."); v /= d; } else if (c === "%") { i++; const d = pow(); if (d === 0) throw new Error("Division by zero."); v %= d; } else break; } return v; };
  const expr = (): number => { let v = term(); while (true) { ws(); const c = text[i]; if (c === "+") { i++; v += term(); } else if (c === "-") { i++; v -= term(); } else break; } return v; };
  const out = expr(); ws();
  if (i < text.length) throw new Error(`Unexpected "${text.slice(i, i + 10)}" in the expression.`);
  if (!Number.isFinite(out)) throw new Error("The result is not a finite number.");
  return out;
}

t("math.calc", "expression:string", "Calculate an expression safely: + - * / ^ % ! ( ), sqrt, log, ln, sin, cos, round(x,2), min, max, avg, pi, e; also 20% of 450.", (a) => { const x = s(a, "expression"); const v = evalExpr(x); return `${x.trim()} = ${fmt(v)}`; }, "calculator arithmetic evaluate compute");
t("math.add", "a:number, b:number", "a + b.", (x) => fmt(n(x, "a") + n(x, "b")), "plus sum");
t("math.subtract", "a:number, b:number", "a − b.", (x) => fmt(n(x, "a") - n(x, "b")), "minus difference");
t("math.multiply", "a:number, b:number", "a × b.", (x) => fmt(n(x, "a") * n(x, "b")), "times product");
t("math.divide", "a:number, b:number", "a ÷ b (with remainder).", (x) => { const d = n(x, "b"); if (d === 0) throw new Error("Division by zero."); return `${fmt(n(x, "a") / d)} (quotient ${Math.trunc(n(x, "a") / d)}, remainder ${n(x, "a") % d})`; });
t("math.power", "base:number, exponent:number", "base ^ exponent.", (x) => fmt(Math.pow(n(x, "base"), n(x, "exponent"))), "exponent");
t("math.sqrt", "number:number", "Square root.", (x) => { const v = n(x, "number"); if (v < 0) throw new Error("No real square root of a negative number."); return fmt(Math.sqrt(v)); });
t("math.cbrt", "number:number", "Cube root.", (x) => fmt(Math.cbrt(n(x, "number"))));
t("math.nth_root", "number:number, n:number", "n-th root.", (x) => fmt(Math.pow(n(x, "number"), 1 / n(x, "n"))));
t("math.abs", "number:number", "Absolute value.", (x) => fmt(Math.abs(n(x, "number"))));
t("math.round", "number:number, decimals?:number", "Round to decimals (default 0).", (x) => fmt(r2(n(x, "number"), n(x, "decimals", 0))));
t("math.ceil", "number:number", "Round up.", (x) => String(Math.ceil(n(x, "number"))));
t("math.floor", "number:number", "Round down.", (x) => String(Math.floor(n(x, "number"))));
t("math.modulo", "a:number, b:number", "Remainder of a ÷ b.", (x) => { if (n(x, "b") === 0) throw new Error("Division by zero."); return fmt(n(x, "a") % n(x, "b")); });
t("math.log", "number:number, base?:number", "Logarithm (base 10 by default).", (x) => { if (n(x, "number") <= 0) throw new Error("Logarithm needs a positive number."); return fmt(n(x, "base", 10) === Math.E ? Math.log(n(x, "number")) : Math.log(n(x, "number")) / Math.log(n(x, "base", 10))); });
t("math.ln", "number:number", "Natural logarithm.", (x) => { if (n(x, "number") <= 0) throw new Error("ln needs a positive number."); return fmt(Math.log(n(x, "number"))); });
t("math.exp", "number:number", "e to the power x.", (x) => fmt(Math.exp(n(x, "number"))));
t("math.sin", "degrees:number", "Sine of an angle in degrees.", (x) => fmt(r2(Math.sin((n(x, "degrees") * Math.PI) / 180), 12)), "trigonometry");
t("math.cos", "degrees:number", "Cosine of an angle in degrees.", (x) => fmt(r2(Math.cos((n(x, "degrees") * Math.PI) / 180), 12)), "trigonometry");
t("math.tan", "degrees:number", "Tangent of an angle in degrees.", (x) => fmt(r2(Math.tan((n(x, "degrees") * Math.PI) / 180), 12)), "trigonometry");
t("math.degrees_to_radians", "degrees:number", "Degrees → radians.", (x) => fmt((n(x, "degrees") * Math.PI) / 180));
t("math.radians_to_degrees", "radians:number", "Radians → degrees.", (x) => fmt((n(x, "radians") * 180) / Math.PI));
t("math.hypotenuse", "a:number, b:number", "Hypotenuse of a right triangle.", (x) => fmt(Math.hypot(n(x, "a"), n(x, "b"))), "pythagoras triangle");
t("math.factorial", "n:number", "n! (up to 170).", (x) => fmt(factorial(n(x, "n"))));
t("math.factorial_big", "n:number", "n! exactly with BigInt (up to 2000).", (x) => { const k = n(x, "n"); if (!Number.isInteger(k) || k < 0 || k > 2000) throw new Error("n must be a whole number from 0 to 2000."); let r = BigInt(1); for (let i = BigInt(2); i <= BigInt(k); i++) r *= i; return r.toString(); });
t("math.combinations", "n:number, r:number", "nCr: ways to choose r of n.", (x) => { const N = n(x, "n"), R = n(x, "r"); if (R > N || R < 0) return "0"; let v = BigInt(1); for (let i = BigInt(1); i <= BigInt(Math.min(R, N - R)); i++) v = (v * (BigInt(N) - i + BigInt(1))) / i; return v.toString(); }, "choose binomial");
t("math.permutations", "n:number, r:number", "nPr: ordered ways to pick r of n.", (x) => { const N = n(x, "n"), R = n(x, "r"); if (R > N || R < 0) return "0"; let v = BigInt(1); for (let i = BigInt(0); i < BigInt(R); i++) v *= BigInt(N) - i; return v.toString(); });
t("math.gcd", "numbers:[number]", "Greatest common divisor of numbers.", (x) => { const g = (p: number, q: number): number => (q ? g(q, p % q) : Math.abs(p)); return String(nums(x, "numbers", 2).reduce(g)); }, "hcf");
t("math.lcm", "numbers:[number]", "Least common multiple of numbers.", (x) => { const g = (p: number, q: number): number => (q ? g(q, p % q) : Math.abs(p)); return String(nums(x, "numbers", 2).reduce((p, q) => (p / g(p, q)) * q)); });
t("math.is_prime", "number:number", "Is the number prime?", (x) => { const v = n(x, "number"); if (!Number.isInteger(v) || v < 2) return "false"; for (let i = 2; i * i <= v; i++) if (v % i === 0) return `false (divisible by ${i})`; return "true"; });
t("math.prime_factors", "number:number", "Prime factors of a whole number.", (x) => { let v = n(x, "number"); if (!Number.isInteger(v) || v < 2) throw new Error("Give a whole number ≥ 2."); const f: number[] = []; for (let d = 2; d * d <= v; d++) while (v % d === 0) { f.push(d); v /= d; } if (v > 1) f.push(v); return f.join(" × "); });
t("math.primes_up_to", "limit:number", "All primes up to a limit (max 100000).", (x) => { const L = Math.min(100000, Math.floor(n(x, "limit"))); const sieve = new Uint8Array(L + 1); const out: number[] = []; for (let i = 2; i <= L; i++) { if (!sieve[i]) { out.push(i); for (let j = i * i; j <= L; j += i) sieve[j] = 1; } } return out.join(", ") || "none"; });
t("math.next_prime", "number:number", "The next prime after a number.", (x) => { let v = Math.floor(n(x, "number")) + 1; const p = (q: number) => { if (q < 2) return false; for (let i = 2; i * i <= q; i++) if (q % i === 0) return false; return true; }; while (!p(v)) v++; return String(v); });
t("math.divisors", "number:number", "All divisors of a number.", (x) => { const v = Math.floor(n(x, "number")); if (v < 1 || v > 1e9) throw new Error("Give a whole number from 1 to 1,000,000,000."); const d: number[] = []; for (let i = 1; i * i <= v; i++) if (v % i === 0) { d.push(i); if (i * i !== v) d.push(v / i); } return d.sort((p, q) => p - q).join(", "); });
t("math.fibonacci", "n:number", "The n-th Fibonacci number (exact, BigInt) and the sequence up to n (max 1000).", (x) => { const k = n(x, "n"); if (!Number.isInteger(k) || k < 0 || k > 1000) throw new Error("n must be a whole number from 0 to 1000."); let p = BigInt(0), q = BigInt(1); const seq: string[] = []; for (let i = 0; i < k; i++) { if (i < 30) seq.push(p.toString()); [p, q] = [q, p + q]; } return `F(${k}) = ${p}${k <= 30 ? "\nSequence: " + seq.join(", ") : ""}`; });
t("math.is_perfect_square", "number:number", "Is it a perfect square?", (x) => { const v = n(x, "number"); const r = Math.round(Math.sqrt(v)); return String(v >= 0 && r * r === v); });
t("math.is_even", "number:number", "Is it even?", (x) => String(n(x, "number") % 2 === 0));
t("math.digit_sum", "number:number", "Sum of the digits.", (x) => String([...String(Math.abs(n(x, "number"))).replace(/\D/g, "")].reduce((p, q) => p + +q, 0)));
t("math.reverse_number", "number:number", "Digits in reverse order.", (x) => [...String(Math.abs(n(x, "number")))].reverse().join(""));
t("math.collatz", "number:number", "Collatz sequence from a number.", (x) => { let v = Math.floor(n(x, "number")); if (v < 1) throw new Error("Give a whole number ≥ 1."); const o = [v]; while (v !== 1 && o.length < 1000) { v = v % 2 ? 3 * v + 1 : v / 2; o.push(v); } return `${o.length - 1} steps: ${o.slice(0, 60).join(" → ")}${o.length > 60 ? " …" : ""}`; });

// ---- percentages and ratios
t("math.percent_of", "percent:number, of:number", "X% of Y.", (x) => fmt((n(x, "percent") / 100) * n(x, "of")), "percentage");
t("math.what_percent", "part:number, whole:number", "Part is what % of whole.", (x) => { if (n(x, "whole") === 0) throw new Error("whole cannot be 0."); return fmt(r2((n(x, "part") / n(x, "whole")) * 100, 4)) + "%"; }, "percentage");
t("math.percent_change", "from:number, to:number", "Percent change from → to.", (x) => { if (n(x, "from") === 0) throw new Error("from cannot be 0."); const c = ((n(x, "to") - n(x, "from")) / Math.abs(n(x, "from"))) * 100; return `${c >= 0 ? "+" : ""}${fmt(r2(c, 4))}% (${c >= 0 ? "increase" : "decrease"})`; }, "growth increase decrease");
t("math.add_percent", "value:number, percent:number", "Increase a value by a percent.", (x) => fmt(r2(n(x, "value") * (1 + n(x, "percent") / 100), 6)), "markup");
t("math.subtract_percent", "value:number, percent:number", "Decrease a value by a percent (discount).", (x) => fmt(r2(n(x, "value") * (1 - n(x, "percent") / 100), 6)), "discount");
t("math.reverse_percent", "final:number, percent:number", "The original value before a percent was added.", (x) => fmt(r2(n(x, "final") / (1 + n(x, "percent") / 100), 6)), "tax gst inclusive");
t("math.ratio_simplify", "a:number, b:number", "Simplify a ratio a:b.", (x) => { const g = (p: number, q: number): number => (q ? g(q, p % q) : Math.abs(p)); const d = g(n(x, "a"), n(x, "b")) || 1; return `${n(x, "a") / d}:${n(x, "b") / d}`; });
t("math.proportion", "a:number, b:number, c:number", "If a is to b then c is to ? (rule of three).", (x) => { if (n(x, "a") === 0) throw new Error("a cannot be 0."); return fmt(r2((n(x, "b") * n(x, "c")) / n(x, "a"), 6)); }, "unitary method");
t("math.fraction_simplify", "numerator:number, denominator:number", "Simplify a fraction.", (x) => { const g = (p: number, q: number): number => (q ? g(q, p % q) : Math.abs(p)); const d = g(n(x, "numerator"), n(x, "denominator")) || 1; if (n(x, "denominator") === 0) throw new Error("Denominator cannot be 0."); return `${n(x, "numerator") / d}/${n(x, "denominator") / d}`; });
t("math.decimal_to_fraction", "number:number, max_denominator?:number", "Decimal to a simple fraction.", (x) => { const v = n(x, "number"); const maxD = n(x, "max_denominator", 10000); let h1 = 1, h0 = 0, k1 = 0, k0 = 1, f = Math.abs(v); const sg = v < 0 ? -1 : 1; for (let i = 0; i < 40; i++) { const a0 = Math.floor(f); const h2 = a0 * h1 + h0, k2 = a0 * k1 + k0; if (k2 > maxD) break; h0 = h1; h1 = h2; k0 = k1; k1 = k2; if (Math.abs(Math.abs(v) - h1 / k1) < 1e-12) break; f = 1 / (f - a0); if (!Number.isFinite(f)) break; } return `${sg * h1}/${k1}`; });
t("math.average_of_percentages", "values:[number], weights?:[number]", "Weighted average (weights optional).", (x) => { const v = nums(x, "values"); const w = x.weights ? nums(x, "weights") : v.map(() => 1); if (w.length !== v.length) throw new Error("values and weights need the same length."); const sw = w.reduce((p, q) => p + q, 0); return fmt(r2(v.reduce((p, q, i) => p + q * w[i], 0) / sw, 6)); });

// ---- statistics
const sorted = (v: number[]) => [...v].sort((p, q) => p - q);
const mean = (v: number[]) => v.reduce((p, q) => p + q, 0) / v.length;
const median = (v: number[]) => { const s2 = sorted(v); const m = Math.floor(s2.length / 2); return s2.length % 2 ? s2[m] : (s2[m - 1] + s2[m]) / 2; };
const variance = (v: number[], sample: boolean) => { const m = mean(v); return v.reduce((p, q) => p + (q - m) ** 2, 0) / (v.length - (sample ? 1 : 0)); };
const pct = (v: number[], p: number) => { const s2 = sorted(v); const idx = (p / 100) * (s2.length - 1); const lo = Math.floor(idx), hi = Math.ceil(idx); return s2[lo] + (s2[hi] - s2[lo]) * (idx - lo); };
t("stats.summary", "numbers:[number]", "Count, sum, mean, median, mode, min, max, range, standard deviation, quartiles.", (x) => { const v = nums(x, "numbers"); const f = new Map<number, number>(); v.forEach((q) => f.set(q, (f.get(q) ?? 0) + 1)); const top = Math.max(...f.values()); const mode = top > 1 ? [...f].filter(([, c]) => c === top).map(([k]) => k) : []; return J({ count: v.length, sum: r2(v.reduce((p, q) => p + q, 0), 6), mean: r2(mean(v), 6), median: median(v), mode: mode.length ? mode : "none", min: Math.min(...v), max: Math.max(...v), range: Math.max(...v) - Math.min(...v), std_dev_sample: v.length > 1 ? r2(Math.sqrt(variance(v, true)), 6) : null, std_dev_population: r2(Math.sqrt(variance(v, false)), 6), q1: pct(v, 25), q3: pct(v, 75) }); }, "statistics describe");
t("stats.sum", "numbers:[number]", "Sum of numbers.", (x) => fmt(r2(nums(x, "numbers").reduce((p, q) => p + q, 0), 10)), "total add");
t("stats.mean", "numbers:[number]", "Average (mean).", (x) => fmt(r2(mean(nums(x, "numbers")), 8)), "average");
t("stats.median", "numbers:[number]", "Median.", (x) => fmt(median(nums(x, "numbers"))));
t("stats.mode", "numbers:[number]", "Most frequent value(s).", (x) => { const v = nums(x, "numbers"); const f = new Map<number, number>(); v.forEach((q) => f.set(q, (f.get(q) ?? 0) + 1)); const top = Math.max(...f.values()); return [...f].filter(([, c]) => c === top).map(([k]) => k).join(", ") + ` (×${top})`; });
t("stats.min", "numbers:[number]", "Smallest number.", (x) => String(Math.min(...nums(x, "numbers"))));
t("stats.max", "numbers:[number]", "Largest number.", (x) => String(Math.max(...nums(x, "numbers"))));
t("stats.range", "numbers:[number]", "Max − min.", (x) => { const v = nums(x, "numbers"); return fmt(Math.max(...v) - Math.min(...v)); });
t("stats.variance", "numbers:[number], sample?:boolean", "Variance (sample by default).", (x) => fmt(r2(variance(nums(x, "numbers", 2), b(x, "sample", true)), 8)));
t("stats.std_dev", "numbers:[number], sample?:boolean", "Standard deviation (sample by default).", (x) => fmt(r2(Math.sqrt(variance(nums(x, "numbers", 2), b(x, "sample", true))), 8)), "stdev");
t("stats.percentile", "numbers:[number], percentile:number", "The p-th percentile (0-100).", (x) => fmt(r2(pct(nums(x, "numbers"), n(x, "percentile")), 8)));
t("stats.quartiles", "numbers:[number]", "Q1, median, Q3 and IQR.", (x) => { const v = nums(x, "numbers"); return J({ q1: pct(v, 25), median: pct(v, 50), q3: pct(v, 75), iqr: pct(v, 75) - pct(v, 25) }); });
t("stats.outliers", "numbers:[number]", "Outliers by the 1.5×IQR rule.", (x) => { const v = nums(x, "numbers"); const q1 = pct(v, 25), q3 = pct(v, 75), i = q3 - q1; const o = v.filter((q) => q < q1 - 1.5 * i || q > q3 + 1.5 * i); return o.length ? `Outliers: ${o.join(", ")}` : "No outliers."; }, "anomaly");
t("stats.zscores", "numbers:[number]", "Z-score of each number.", (x) => { const v = nums(x, "numbers", 2); const m = mean(v), sd = Math.sqrt(variance(v, true)) || 1; return v.map((q) => r2((q - m) / sd, 4)).join(", "); });
t("stats.normalize", "numbers:[number]", "Scale numbers to 0-1 (min-max).", (x) => { const v = nums(x, "numbers"); const lo = Math.min(...v), hi = Math.max(...v); return v.map((q) => (hi === lo ? 0 : r2((q - lo) / (hi - lo), 6))).join(", "); });
t("stats.cumulative_sum", "numbers:[number]", "Running total.", (x) => { let c = 0; return nums(x, "numbers").map((q) => (c = r2(c + q, 10))).join(", "); });
t("stats.moving_average", "numbers:[number], window?:number", "Moving average (window default 3).", (x) => { const v = nums(x, "numbers"); const w = Math.max(1, Math.floor(n(x, "window", 3))); return v.map((_, i) => (i + 1 < w ? "-" : r2(mean(v.slice(i + 1 - w, i + 1)), 4))).join(", "); });
t("stats.correlation", "x:[number], y:[number]", "Pearson correlation of two lists.", (a) => { const p = nums(a, "x", 2), q = nums(a, "y", 2); if (p.length !== q.length) throw new Error("x and y need the same length."); const mp = mean(p), mq = mean(q); const num = p.reduce((s2, v, i) => s2 + (v - mp) * (q[i] - mq), 0); const den = Math.sqrt(p.reduce((s2, v) => s2 + (v - mp) ** 2, 0) * q.reduce((s2, v) => s2 + (v - mq) ** 2, 0)); if (!den) throw new Error("A list has no variation."); return fmt(r2(num / den, 6)); });
t("stats.linear_regression", "x:[number], y:[number], predict?:number", "Best-fit line y = a·x + b (and a prediction).", (a) => { const p = nums(a, "x", 2), q = nums(a, "y", 2); if (p.length !== q.length) throw new Error("x and y need the same length."); const mp = mean(p), mq = mean(q); const sxx = p.reduce((s2, v) => s2 + (v - mp) ** 2, 0); if (!sxx) throw new Error("x has no variation."); const slope = p.reduce((s2, v, i) => s2 + (v - mp) * (q[i] - mq), 0) / sxx; const ic = mq - slope * mp; const ssTot = q.reduce((s2, v) => s2 + (v - mq) ** 2, 0); const ssRes = q.reduce((s2, v, i) => s2 + (v - (slope * p[i] + ic)) ** 2, 0); return `y = ${r2(slope, 6)}·x + ${r2(ic, 6)}  (R² = ${ssTot ? r2(1 - ssRes / ssTot, 6) : 1})${a.predict !== undefined ? `\nPrediction at x=${n(a, "predict")}: ${r2(slope * n(a, "predict") + ic, 6)}` : ""}`; }, "forecast trend");
t("stats.growth_rate", "values:[number]", "Period-over-period growth % and the CAGR of a series.", (x) => { const v = nums(x, "values", 2); const g = v.slice(1).map((q, i) => (v[i] === 0 ? "n/a" : r2(((q - v[i]) / Math.abs(v[i])) * 100, 2) + "%")); const cagr = v[0] > 0 && v[v.length - 1] > 0 ? r2((Math.pow(v[v.length - 1] / v[0], 1 / (v.length - 1)) - 1) * 100, 3) + "%" : "n/a"; return `Growth: ${g.join(", ")}\nCAGR per period: ${cagr}`; }, "cagr");
t("stats.frequency", "values:[string]", "How often each value appears.", (x) => { const m = new Map<string, number>(); for (const v of list(x, "values")) m.set(String(v).trim(), (m.get(String(v).trim()) ?? 0) + 1); return [...m].sort((p, q) => q[1] - p[1]).map(([k, c]) => `${k}: ${c}`).join("\n"); }, "count group");
t("stats.histogram", "numbers:[number], bins?:number", "Text histogram.", (x) => { const v = nums(x, "numbers"); const k = Math.max(1, Math.min(30, Math.floor(n(x, "bins", 8)))); const lo = Math.min(...v), hi = Math.max(...v), w = (hi - lo) / k || 1; const c = new Array(k).fill(0); v.forEach((q) => c[Math.min(k - 1, Math.floor((q - lo) / w))]++); const mx = Math.max(...c); return c.map((q, i) => `${r2(lo + i * w, 2)}–${r2(lo + (i + 1) * w, 2)} | ${"█".repeat(Math.round((q / mx) * 30))} ${q}`).join("\n"); }, "chart");
t("stats.confidence_interval", "numbers:[number]", "95% confidence interval of the mean.", (x) => { const v = nums(x, "numbers", 2); const m = mean(v), se = Math.sqrt(variance(v, true)) / Math.sqrt(v.length); return `${r2(m, 4)} ± ${r2(1.96 * se, 4)}  (${r2(m - 1.96 * se, 4)} to ${r2(m + 1.96 * se, 4)})`; });
t("stats.sample_size", "population:number, margin_percent?:number, confidence?:number", "Survey sample size (Cochran; confidence 90/95/99).", (x) => { const z = ({ 90: 1.645, 95: 1.96, 99: 2.576 } as Record<number, number>)[n(x, "confidence", 95)] ?? 1.96; const e = n(x, "margin_percent", 5) / 100; const n0 = (z * z * 0.25) / (e * e); const N = n(x, "population"); return String(Math.ceil(n0 / (1 + (n0 - 1) / N))); }, "survey");
t("stats.ab_test", "a_visitors:number, a_conversions:number, b_visitors:number, b_conversions:number", "A/B test: conversion rates, lift and significance (two-proportion z-test).", (x) => { const n1 = n(x, "a_visitors"), c1 = n(x, "a_conversions"), n2 = n(x, "b_visitors"), c2 = n(x, "b_conversions"); const p1 = c1 / n1, p2 = c2 / n2, pp = (c1 + c2) / (n1 + n2); const se = Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2)); if (!se) throw new Error("Not enough variation to test."); const z = (p2 - p1) / se; const erf = (v: number) => { const t2 = 1 / (1 + 0.3275911 * Math.abs(v)); const y = 1 - (((((1.061405429 * t2 - 1.453152027) * t2) + 1.421413741) * t2 - 0.284496736) * t2 + 0.254829592) * t2 * Math.exp(-v * v); return v >= 0 ? y : -y; }; const pv = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))); return `A ${r2(p1 * 100, 2)}%  vs  B ${r2(p2 * 100, 2)}%  (lift ${p1 ? r2(((p2 - p1) / p1) * 100, 1) : "n/a"}%)\nz = ${r2(z, 3)}, p ≈ ${r2(pv, 4)} → ${pv < 0.05 ? "significant at 95%" : "NOT significant yet: keep testing"}`; }, "marketing conversion");

// ---- number systems and words
t("math.base_convert", "value:string, from_base:number, to_base:number", "Convert a number between bases 2-36.", (x) => { const fb = n(x, "from_base"), tb = n(x, "to_base"); if (fb < 2 || fb > 36 || tb < 2 || tb > 36) throw new Error("Bases must be 2 to 36."); const raw = s(x, "value").trim().toLowerCase().replace(/^0[xbo]/, ""); const digits = "0123456789abcdefghijklmnopqrstuvwxyz"; let v = BigInt(0); for (const c of raw) { const d = digits.indexOf(c); if (d < 0 || d >= fb) throw new Error(`"${c}" is not a base-${fb} digit.`); v = v * BigInt(fb) + BigInt(d); } return v.toString(tb).toUpperCase(); }, "binary hex octal decimal");
t("math.to_binary", "number:number", "Decimal → binary.", (x) => Math.floor(n(x, "number")).toString(2));
t("math.to_hex", "number:number", "Decimal → hexadecimal.", (x) => Math.floor(n(x, "number")).toString(16).toUpperCase());
t("math.to_octal", "number:number", "Decimal → octal.", (x) => Math.floor(n(x, "number")).toString(8));
t("math.from_binary", "binary:string", "Binary → decimal.", (x) => { const v = s(x, "binary").replace(/\s|^0b/gi, ""); if (!/^[01]+$/.test(v)) throw new Error("Only 0 and 1 allowed."); return String(parseInt(v, 2)); });
t("math.from_hex", "hex:string", "Hexadecimal → decimal.", (x) => { const v = s(x, "hex").replace(/^0x/i, ""); if (!/^[0-9a-f]+$/i.test(v)) throw new Error("Not a hex number."); return BigInt("0x" + v).toString(); });
const ROMAN: Array<[number, string]> = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
t("math.to_roman", "number:number", "Number (1-3999) → Roman numerals.", (x) => { let v = Math.floor(n(x, "number")); if (v < 1 || v > 3999) throw new Error("Roman numerals cover 1 to 3999."); let o = ""; for (const [k, r] of ROMAN) while (v >= k) { o += r; v -= k; } return o; });
t("math.from_roman", "roman:string", "Roman numerals → number.", (x) => { const r = s(x, "roman").toUpperCase().trim(); if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(r) || !r) throw new Error("Not a valid Roman numeral."); let v = 0, i = 0; for (const [k, sy] of ROMAN) while (r.startsWith(sy, i)) { v += k; i += sy.length; } return String(v); });
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const below1000 = (v: number): string => (v < 20 ? ONES[v] : v < 100 ? TENS[Math.floor(v / 10)] + (v % 10 ? "-" + ONES[v % 10] : "") : ONES[Math.floor(v / 100)] + " hundred" + (v % 100 ? " and " + below1000(v % 100) : ""));
export function wordsIntl(v: number): string {
  if (v === 0) return "zero"; if (v < 0) return "minus " + wordsIntl(-v);
  const scale = ["", " thousand", " million", " billion", " trillion"]; const parts: string[] = []; let i = 0;
  while (v > 0) { const c = v % 1000; if (c) parts.unshift(below1000(c) + scale[i]); v = Math.floor(v / 1000); i++; if (i > 4) break; }
  return parts.join(" ");
}
export function wordsIndian(v: number): string {
  if (v === 0) return "zero"; if (v < 0) return "minus " + wordsIndian(-v);
  const out: string[] = []; const cr = Math.floor(v / 1e7); v %= 1e7; const lk = Math.floor(v / 1e5); v %= 1e5; const th = Math.floor(v / 1e3); v %= 1e3;
  if (cr) out.push((cr >= 100 ? wordsIndian(cr) : below1000(cr)) + " crore"); if (lk) out.push(below1000(lk) + " lakh"); if (th) out.push(below1000(th) + " thousand"); if (v) out.push(below1000(v));
  return out.join(" ");
}
t("math.number_to_words", "number:number, system?:string", "Number → English words. system: international (million) or indian (lakh, crore).", (x) => { const v = n(x, "number"); if (!Number.isInteger(v) || Math.abs(v) > 9e15) throw new Error("Give a whole number up to 9e15."); return s(x, "system", "international").toLowerCase().startsWith("ind") ? wordsIndian(v) : wordsIntl(v); }, "cheque amount in words");
t("math.amount_in_words", "amount:number, currency?:string", "Money amount in words for cheques / invoices (INR: rupees and paise, USD: dollars and cents).", (x) => { const v = Math.round(Math.abs(n(x, "amount")) * 100) / 100; const whole = Math.floor(v), frac = Math.round((v - whole) * 100); const cur = s(x, "currency", "INR").toUpperCase(); const inr = cur === "INR"; const main = inr ? wordsIndian(whole) : wordsIntl(whole); const [u1, u2] = inr ? ["rupees", "paise"] : cur === "USD" ? ["dollars", "cents"] : cur === "EUR" ? ["euros", "cents"] : cur === "GBP" ? ["pounds", "pence"] : [cur, "cents"]; const w = main.charAt(0).toUpperCase() + main.slice(1); return `${w} ${u1}${frac ? ` and ${inr ? wordsIndian(frac) : wordsIntl(frac)} ${u2}` : ""} only`; }, "invoice cheque");
t("math.format_number", "number:number, style?:string, decimals?:number, currency?:string", "Format with separators. style: international (1,234,567.89), indian (12,34,567.89), compact (1.2M), plain.", (x) => { const v = n(x, "number"), d = n(x, "decimals", 2), st = s(x, "style", "international"); if (st === "indian") return new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v); if (st === "compact") return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v); if (st === "currency") return new Intl.NumberFormat(s(x, "currency", "USD") === "INR" ? "en-IN" : "en-US", { style: "currency", currency: s(x, "currency", "USD") }).format(v); if (st === "plain") return v.toFixed(d); return new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v); }, "lakh crore comma");
t("math.parse_number", "text:string", "Read a messy number ('₹ 1,20,000', '1.2k', '3 lakh', '2 crore', '45%').", (x) => { const raw = s(x, "text").toLowerCase().replace(/[₹$€£,\s]|rs\.?|inr|usd/g, ""); const m = /^(-?\d+(?:\.\d+)?)(k|m|b|l|lac|lakh|lakhs|cr|crore|crores|%)?$/.exec(raw); if (!m) throw new Error(`Cannot read "${s(x, "text")}" as a number.`); const mult: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 }; const v = parseFloat(m[1]) * (m[2] && m[2] !== "%" ? mult[m[2]] : 1); return String(m[2] === "%" ? v / 100 : v); }, "clean number");
t("math.random_number", "min?:number, max?:number, count?:number, integer?:boolean", "Random number(s) in a range (default 1-100, integers).", (x) => { const lo = n(x, "min", 1), hi = n(x, "max", 100), c = Math.min(1000, Math.max(1, Math.floor(n(x, "count", 1)))); const int = b(x, "integer", true); return Array.from({ length: c }, () => { const v = lo + Math.random() * (hi - lo + (int ? 1 : 0)); return int ? Math.floor(v) : r2(v, 6); }).join(", "); }, "dice lottery");
t("math.dice", "sides?:number, count?:number", "Roll dice.", (x) => { const rolls = Array.from({ length: Math.min(100, n(x, "count", 1)) }, () => 1 + Math.floor(Math.random() * Math.max(2, n(x, "sides", 6)))); return `${rolls.join(", ")} (total ${rolls.reduce((p, q) => p + q, 0)})`; });

// ---- equations and geometry
t("math.quadratic", "a:number, b:number, c:number", "Solve ax² + bx + c = 0.", (x) => { const A1 = n(x, "a"), B1 = n(x, "b"), C1 = n(x, "c"); if (A1 === 0) return B1 === 0 ? "No equation." : `Linear: x = ${fmt(-C1 / B1)}`; const D = B1 * B1 - 4 * A1 * C1; if (D > 0) return `Two real roots: x = ${fmt((-B1 + Math.sqrt(D)) / (2 * A1))} and x = ${fmt((-B1 - Math.sqrt(D)) / (2 * A1))}`; if (D === 0) return `One root: x = ${fmt(-B1 / (2 * A1))}`; return `Complex roots: x = ${fmt(-B1 / (2 * A1))} ± ${fmt(Math.sqrt(-D) / (2 * A1))}i`; }, "equation algebra");
t("math.solve_linear_system", "matrix:[[number]], constants:[number]", "Solve a system of linear equations (Gaussian elimination).", (x) => { const M = (list(x, "matrix") as any[]).map((r) => (Array.isArray(r) ? r.map(Number) : [])); const c = nums(x, "constants"); const N = M.length; if (!N || M.some((r) => r.length !== N) || c.length !== N) throw new Error("Give a square matrix and one constant per row."); const m = M.map((r, i) => [...r, c[i]]); for (let i = 0; i < N; i++) { let p = i; for (let k = i + 1; k < N; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k; if (Math.abs(m[p][i]) < 1e-12) throw new Error("No single solution (the equations depend on each other)."); [m[i], m[p]] = [m[p], m[i]]; for (let k = i + 1; k < N; k++) { const f = m[k][i] / m[i][i]; for (let j = i; j <= N; j++) m[k][j] -= f * m[i][j]; } } const sol = new Array<number>(N); for (let i = N - 1; i >= 0; i--) { sol[i] = (m[i][N] - m[i].slice(i + 1, N).reduce((p, q, j) => p + q * sol[i + 1 + j], 0)) / m[i][i]; } return sol.map((v, i) => `x${i + 1} = ${fmt(r2(v, 8))}`).join("\n"); }, "equations algebra");
t("math.matrix_multiply", "a:[[number]], b:[[number]]", "Multiply two matrices.", (x) => { const P = (list(x, "a") as number[][]).map((r) => r.map(Number)), Q = (list(x, "b") as number[][]).map((r) => r.map(Number)); if (!P.length || !Q.length || P[0].length !== Q.length) throw new Error("Columns of a must equal rows of b."); return J(P.map((r) => Q[0].map((_, j) => r.reduce((s2, v, k) => s2 + v * Q[k][j], 0)))); });
t("math.matrix_transpose", "matrix:[[number]]", "Transpose a matrix.", (x) => { const M = list(x, "matrix") as number[][]; return J(M[0].map((_, j) => M.map((r) => r[j]))); });
t("math.matrix_determinant", "matrix:[[number]]", "Determinant of a square matrix.", (x) => { const M = (list(x, "matrix") as any[]).map((r) => r.map(Number)); const N = M.length; if (M.some((r: number[]) => r.length !== N)) throw new Error("The matrix must be square."); const m = M.map((r: number[]) => [...r]); let det = 1; for (let i = 0; i < N; i++) { let p = i; for (let k = i + 1; k < N; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k; if (Math.abs(m[p][i]) < 1e-12) return "0"; if (p !== i) { [m[i], m[p]] = [m[p], m[i]]; det = -det; } det *= m[i][i]; for (let k = i + 1; k < N; k++) { const f = m[k][i] / m[i][i]; for (let j = i; j < N; j++) m[k][j] -= f * m[i][j]; } } return fmt(r2(det, 8)); });
t("geo.circle", "radius:number", "Circle: diameter, circumference, area.", (x) => { const r = n(x, "radius"); return J({ diameter: r * 2, circumference: r2(2 * Math.PI * r, 6), area: r2(Math.PI * r * r, 6) }); }, "geometry");
t("geo.rectangle", "width:number, height:number", "Rectangle: area, perimeter, diagonal.", (x) => J({ area: n(x, "width") * n(x, "height"), perimeter: 2 * (n(x, "width") + n(x, "height")), diagonal: r2(Math.hypot(n(x, "width"), n(x, "height")), 6) }), "geometry");
t("geo.triangle", "a:number, b:number, c:number", "Triangle from three sides: area (Heron), perimeter, type.", (x) => { const p = n(x, "a"), q = n(x, "b"), r = n(x, "c"); if (p + q <= r || p + r <= q || q + r <= p) throw new Error("These sides cannot make a triangle."); const sp = (p + q + r) / 2; return J({ perimeter: p + q + r, area: r2(Math.sqrt(sp * (sp - p) * (sp - q) * (sp - r)), 6), type: p === q && q === r ? "equilateral" : p === q || q === r || p === r ? "isosceles" : "scalene" }); }, "geometry");
t("geo.sphere", "radius:number", "Sphere: surface area and volume.", (x) => { const r = n(x, "radius"); return J({ surface_area: r2(4 * Math.PI * r * r, 6), volume: r2((4 / 3) * Math.PI * r ** 3, 6) }); }, "geometry");
t("geo.cylinder", "radius:number, height:number", "Cylinder: volume and surface area.", (x) => { const r = n(x, "radius"), h = n(x, "height"); return J({ volume: r2(Math.PI * r * r * h, 6), surface_area: r2(2 * Math.PI * r * (r + h), 6) }); }, "geometry");
t("geo.cuboid", "length:number, width:number, height:number", "Cuboid / room / box: volume and surface area.", (x) => { const l = n(x, "length"), w = n(x, "width"), h = n(x, "height"); return J({ volume: l * w * h, surface_area: 2 * (l * w + w * h + l * h) }); }, "geometry room tank");
t("geo.distance_points", "x1:number, y1:number, x2:number, y2:number", "Distance between two points.", (x) => fmt(r2(Math.hypot(n(x, "x2") - n(x, "x1"), n(x, "y2") - n(x, "y1")), 8)), "geometry");
t("geo.haversine", "lat1:number, lon1:number, lat2:number, lon2:number", "Distance in km between two coordinates (great circle).", (x) => { const R = 6371.0088, rad = (d: number) => (d * Math.PI) / 180; const dl = rad(n(x, "lat2") - n(x, "lat1")), dn = rad(n(x, "lon2") - n(x, "lon1")); const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(n(x, "lat1"))) * Math.cos(rad(n(x, "lat2"))) * Math.sin(dn / 2) ** 2; const km = 2 * R * Math.asin(Math.sqrt(h)); return `${r2(km, 2)} km (${r2(km * 0.621371, 2)} mi) in a straight line`; }, "gps location");
t("geo.polygon_area", "points:[[x,y]]", "Area of a polygon from its corner points (shoelace).", (x) => { const p = list(x, "points") as number[][]; if (p.length < 3) throw new Error("Need at least 3 points."); let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return fmt(Math.abs(a) / 2); }, "geometry land plot");
t("math.compare", "a:number, b:number", "Which is bigger, and by how much.", (x) => { const p = n(x, "a"), q = n(x, "b"); return p === q ? "Equal." : `${p > q ? "a" : "b"} is bigger by ${fmt(Math.abs(p - q))}`; });
t("math.clamp", "number:number, min:number, max:number", "Keep a number between min and max.", (x) => fmt(Math.min(n(x, "max"), Math.max(n(x, "min"), n(x, "number")))));
t("math.lerp", "from:number, to:number, t:number", "Linear interpolation between two numbers (t 0-1).", (x) => fmt(n(x, "from") + (n(x, "to") - n(x, "from")) * n(x, "t")));
t("math.sequence", "start:number, step:number, count:number", "Arithmetic sequence.", (x) => Array.from({ length: Math.min(1000, n(x, "count")) }, (_, i) => fmt(r2(n(x, "start") + i * n(x, "step"), 10))).join(", "));
t("math.geometric_sequence", "start:number, ratio:number, count:number", "Geometric sequence.", (x) => Array.from({ length: Math.min(200, n(x, "count")) }, (_, i) => fmt(r2(n(x, "start") * n(x, "ratio") ** i, 10))).join(", "));
t("math.series_sum", "start:number, step:number, count:number", "Sum of an arithmetic series.", (x) => fmt((n(x, "count") / 2) * (2 * n(x, "start") + (n(x, "count") - 1) * n(x, "step"))));
t("math.average_speed", "distance:number, time:number", "Speed = distance ÷ time.", (x) => { if (n(x, "time") === 0) throw new Error("time cannot be 0."); return fmt(r2(n(x, "distance") / n(x, "time"), 6)); });
t("math.mean_of_two_numbers_geometric", "a:number, b:number", "Geometric mean of two numbers.", (x) => fmt(Math.sqrt(n(x, "a") * n(x, "b"))));

export const MATH_TOOLS = MATH;
