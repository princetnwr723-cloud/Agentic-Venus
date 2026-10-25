// FOUNT core: the pure logic of the AgenticVenus FOUNT layer.
// RULES OF THIS FILE: no imports, no network, no Firebase, no React. It runs in the browser, on the server and in
// `node --test` (Node 22 strips the types), so everything here is deterministic and unit-tested.
// FOUNT never changes a model. It only (1) adds a short, proven "how to do this job here" block to the prompt,
// (2) records what happened (scrubbed, opt-in), and (3) promotes patterns that really worked, through gates.

export type Tier = "lite" | "mid" | "strong";
export type Verdict = "pass" | "partial" | "fail";
export type Source = "seed" | "curated" | "learned";
export type Status = "live" | "canary" | "paused";

/** One playbook example: a concrete job, the steps that work for it, the tools to use and the traps to avoid. */
export type Example = {
  id: string;
  intent: string;
  task: string; // concrete sample task (seed/curated only; learned examples never carry user text)
  title: string;
  steps: string[];
  tools: string[];
  pitfalls: string[];
  verify: string[];
  source: Source;
  weight: number; // 1 = normal; curated playbooks are usually 2-3
  status?: Status; // missing = live
  uses?: number;
  wins?: number;
  fails?: number;
  users?: number; // distinct users that produced the pattern (learned)
  version?: number;
  updatedAt?: number;
};

export type IntentDef = { id: string; label: string; kw: string[]; tools: string[] };

export type Signals = {
  verdict?: Verdict;
  thumbs?: 1 | 0 | -1;
  edited?: boolean; // the user rewrote / corrected the result
  retried?: boolean; // the user asked to redo it
  reasked?: boolean; // the same question again right after
  approvalDenied?: boolean;
  abandoned?: boolean;
};

export type Episode = {
  id: string;
  uk: string; // hashed user key (never the real uid)
  chatKey: string;
  intent: string;
  task: string; // scrubbed, short
  tools: string[]; // tool names in the order they were called
  toolErrors: string[]; // tool names that returned an error
  verdict: Verdict;
  signals: Signals;
  score: number;
  model: string;
  tier: Tier;
  steps: number;
  lastFail?: boolean; // the last tool call of the run failed
  fountOn: boolean; // false = holdout / control run
  injected: string[]; // example ids that were put into the prompt
  at: number;
};

// ---------------------------------------------------------------- small helpers

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Deterministic 0-99 bucket for a user key. Users below `pct` are the HOLDOUT (FOUNT stays off for them). */
export function isHoldout(userKey: string, pct: number): boolean {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  if (p <= 0) return false;
  return parseInt(fnv1a("holdout:" + userKey).slice(0, 6), 16) % 100 < p;
}

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

export function tierOf(model: string): Tier {
  const m = String(model || "").toLowerCase();
  if (/(lite|mini|nano|flash|haiku|small|tiny|instant|fast|\b[0-9]b\b)/.test(m)) return "lite";
  if (/(opus|gpt-?[5-9]|\bo[134]\b|ultra|large|reasoner|sonnet-?[5-9]|grok-?[4-9]\b|heavy|\br1\b|\bpro\b)/.test(m)) return "strong";
  return "mid";
}

// ---------------------------------------------------------------- scrubbing (privacy)

const SCRUBBERS: Array<[RegExp, string | ((m: string) => string)]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[key]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[token]"],
  [/\b(?:sk|pk|rk|xox[abprs]|ghp|gho|ghs|github_pat|AKIA|AIza|ya29|glpat|shpat|whsec)[-_A-Za-z0-9]{12,}\b/g, "[key]"],
  [/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "[token]"],
  [/\b(password|passwd|pwd|passcode|pin|otp|cvv|cvc|secret|token|api[_ -]?key|apikey)\b\s*(?:is|=|:)\s*\S+/gi, "$1: [hidden]"],
  [/[?&](?:key|token|access_token|api_key|apikey|secret|sig|signature|password)=[^&\s]+/gi, "?[secret]"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[number]"],
  [/\+?\d[\d -]{8,16}\d/g, (m) => { const d = m.replace(/\D/g, "").length; return d >= 10 && d <= 15 ? "[phone]" : m; }],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "[blob]"],
];

export function scrub(text: string, max = 240): string {
  let t = String(text ?? "");
  for (const [re, rep] of SCRUBBERS) t = typeof rep === "string" ? t.replace(re, rep) : t.replace(re, rep);
  t = t.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** True when something that must never be stored is still visible after scrubbing. */
export function looksSecret(text: string): boolean {
  return /(-----BEGIN|\beyJ[A-Za-z0-9_-]{8,}\.|\bsk-[A-Za-z0-9]{16,}|\bghp_[A-Za-z0-9]{16,}|\bAKIA[A-Z0-9]{12,})/.test(String(text ?? ""));
}

const INJECTION: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all|any|your)\b.{0,30}\b(instructions?|prompts?|rules?)/i,
  /\b(you are now|from now on you|pretend to be)\b/i,
  /\b(reveal|print|show|send|post|email|upload|leak|exfiltrate)\b.{0,60}\b(system prompt|api[ _-]?keys?|passwords?|credentials?|tokens?)/i,
  /<\/?\s*(system|assistant|developer|instructions?)\s*>/i,
  /[\u200B-\u200F\u2060\uFEFF]/,
];
export const hasInjection = (text: string): boolean => INJECTION.some((re) => re.test(String(text ?? "")));

// ---------------------------------------------------------------- intent classification

const reCache = new Map<string, RegExp | null>();
function rx(src: string): RegExp | null {
  if (reCache.has(src)) return reCache.get(src) ?? null;
  let r: RegExp | null = null;
  try { r = new RegExp(src, "i"); } catch { r = null; }
  reCache.set(src, r);
  return r;
}

export function classify(intents: IntentDef[], task: string): { intent: string; score: number; confidence: number } {
  const text = String(task ?? "").slice(0, 1500);
  let best = { intent: "general.chat", score: 0 };
  let second = 0;
  for (const d of intents) {
    let s = 0;
    for (const k of d.kw) {
      const strong = k.startsWith("!"); // "!" = a very specific pattern (counts 4), e.g. "50 customers ... mail" is bulk mail
      const re = rx(strong ? k.slice(1) : k);
      if (re && re.test(text)) s += strong ? 4 : k.length > 12 ? 2 : 1;
    }
    if (s > best.score) { second = best.score; best = { intent: d.id, score: s }; }
    else if (s > second) second = s;
  }
  const confidence = best.score === 0 ? 0 : best.score / (best.score + second + 0.5);
  return { ...best, confidence: Math.round(confidence * 100) / 100 };
}

// ---------------------------------------------------------------- retrieval (BM25)

const STOP = new Set(("a an the of to in on for and or is are was were be it this that with at by from as i me my we you your our please pls " +
  "can could would should do does did have has had will just about into out up down then than so if not no yes " +
  "bhai yaar ko ka ki ke me mein hai hain kro karo kar kr do de se aur ya ek ye wo is us hum tum mujhe mera meri apna").split(" "));

export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const w of String(text ?? "").toLowerCase().split(/[^a-z0-9\u00c0-\u024f\u0900-\u097f]+/)) {
    if (w.length < 2 || STOP.has(w)) continue;
    out.push(w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);
  }
  return out;
}

type Doc = { ex: Example; tf: Map<string, number>; len: number };
export type Index = { docs: Doc[]; df: Map<string, number>; avg: number };
export type Hit = { ex: Example; score: number };

export function buildIndex(examples: Example[]): Index {
  const docs: Doc[] = [];
  const df = new Map<string, number>();
  let total = 0;
  for (const ex of examples) {
    const toks = tokens(`${ex.task} ${ex.title} ${ex.intent.replace(/[._-]/g, " ")} ${ex.tools.join(" ").replace(/[._]/g, " ")}`);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    docs.push({ ex, tf, len: toks.length });
    total += toks.length;
  }
  return { docs, df, avg: docs.length ? total / docs.length : 1 };
}

function winRate(ex: Example): number {
  const w = ex.wins ?? 0, f = ex.fails ?? 0;
  return (w + 1) / (w + f + 2); // smoothed
}

export function search(index: Index, query: string, opts: { intent?: string; k?: number; exclude?: string } = {}): Hit[] {
  const q = tokens(query);
  const N = index.docs.length;
  if (!q.length || !N) return [];
  const k1 = 1.5, b = 0.75;
  const hits: Hit[] = [];
  for (const d of index.docs) {
    if (d.ex.status === "paused" || d.ex.id === opts.exclude) continue;
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / index.avg)));
    }
    if (s <= 0 && d.ex.intent !== opts.intent) continue;
    let mult = d.ex.source === "curated" ? 1.3 : d.ex.source === "learned" ? 1 + 0.4 * winRate(d.ex) : 1;
    mult *= Math.max(0.5, Math.min(3, d.ex.weight || 1)) ** 0.5;
    if (d.ex.status === "canary") mult *= 0.9;
    if (opts.intent && d.ex.intent === opts.intent) mult *= 1.8;
    hits.push({ ex: d.ex, score: s * mult + (opts.intent && d.ex.intent === opts.intent ? 0.01 : 0) });
  }
  hits.sort((a, b2) => b2.score - a.score);
  return hits.slice(0, opts.k ?? 5);
}

// ---------------------------------------------------------------- routing: keywords + nearest examples

export type Route = { intent: string; confidence: number; via: "examples" | "keywords" | "both" | "none" };

/** Decides the job type of a task. Nearest built-in/learned examples vote, keywords add a bonus; weak evidence means "general.chat". */
export function route(index: Index, intents: IntentDef[], task: string, exclude?: string): Route {
  const kw = classify(intents, task);
  const hits = search(index, task, { k: 8, exclude });
  const vote = new Map<string, number>();
  let total = 0;
  for (const h of hits) { vote.set(h.ex.intent, (vote.get(h.ex.intent) ?? 0) + h.score); total += h.score; }
  const cand = new Set<string>([...vote.keys()]);
  if (kw.score > 0) cand.add(kw.intent);
  let best = { intent: "general.chat", score: 0 };
  for (const id of cand) {
    const share = total > 0 ? (vote.get(id) ?? 0) / total : 0;
    const bonus = kw.intent === id && kw.score > 0 ? 0.45 + 0.2 * Math.min(2, kw.score - 1) : 0;
    const sc = share * 0.75 + bonus;
    if (sc > best.score) best = { intent: id, score: sc };
  }
  const topScore = hits[0]?.score ?? 0;
  if (kw.score === 0 && tokens(task).length <= 2) return { intent: "general.chat", confidence: 0, via: "none" };
  if (topScore < 1.2 && kw.score === 0) return { intent: "general.chat", confidence: 0, via: "none" };
  const viaEx = (vote.get(best.intent) ?? 0) > 0, viaKw = kw.intent === best.intent && kw.score > 0;
  return { intent: best.intent, confidence: Math.round(Math.min(1, best.score) * 100) / 100, via: viaEx && viaKw ? "both" : viaKw ? "keywords" : "examples" };
}

// ---------------------------------------------------------------- the prompt block

const CAPS: Record<Tier, { chars: number; alts: number; verify: boolean; examples: boolean }> = {
  lite: { chars: 2000, alts: 2, verify: true, examples: true },
  mid: { chars: 1300, alts: 1, verify: true, examples: true },
  strong: { chars: 750, alts: 0, verify: false, examples: false },
};

function fit(lines: string[], max: number): string {
  let out = "";
  for (const l of lines) {
    if (out.length + l.length + 1 > max) break;
    out += (out ? "\n" : "") + l;
  }
  return out;
}

export function buildBlock(a: { label: string; hits: Hit[]; tier: Tier }): string {
  const [main, ...rest] = a.hits;
  if (!main) return "";
  const cap = CAPS[a.tier];
  const e = main.ex;
  const lines: string[] = [`## FOUNT playbook: ${a.label} (proven in this app: follow it unless the user asks otherwise)`];
  if (e.source === "seed" || e.source === "curated") lines.push("(N, [the targets] and [the place/topic] mean what the owner asked for in THIS message.)");
  e.steps.slice(0, a.tier === "strong" ? 4 : 7).forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  if (e.tools.length) lines.push(`Tools that fit: ${e.tools.slice(0, 8).join(", ")}`);
  if (e.pitfalls.length) lines.push(`Avoid: ${e.pitfalls.slice(0, a.tier === "strong" ? 2 : 4).join(" | ")}`);
  if (cap.verify && e.verify.length) lines.push(`Before you say done: ${e.verify.slice(0, 3).join(" | ")}`);
  if (cap.examples) {
    const alts = rest.filter((h) => h.ex.intent === e.intent && h.ex.source !== "learned").slice(0, cap.alts);
    for (const h of alts) lines.push(`Similar solved job: "${h.ex.task.slice(0, 110)}" -> ${h.ex.tools.slice(0, 5).join(" > ")}`);
  }
  lines.push("If the playbook clearly does not fit the user's request, ignore it. Never invent tools; use only tools you were given.");
  return "\n\n" + fit(lines, cap.chars);
}

// ---------------------------------------------------------------- tool narrowing (optional, off by default)

const ALWAYS_TOOLS = ["plan.", "memory.", "profile.", "skill.", "mission.", "web.", "verify.", "recall.", "notify.", "attachments."];

/** Returns the names to keep, or null when nothing should be hidden (always safe). Only narrows for small models with huge catalogs. */
export function narrowToolNames(all: Array<{ name: string; source: string }>, wanted: string[], tier: Tier, max = 40): Set<string> | null {
  if (tier !== "lite" || all.length <= max || !wanted.length) return null;
  const fams = new Set(wanted.map((w) => w.split(".")[0]));
  const keep = new Set<string>();
  for (const t of all) {
    const fam = t.name.split(".")[0];
    if (wanted.includes(t.name) || fams.has(fam) || ALWAYS_TOOLS.some((p) => t.name.startsWith(p))) keep.add(t.name);
  }
  return keep.size >= 8 && keep.size < all.length ? keep : null;
}

// ---------------------------------------------------------------- signals -> score -> gold / anti

export function episodeScore(sig: Signals): number {
  let s = 0;
  if (sig.verdict === "pass") s += 0.6;
  else if (sig.verdict === "fail") s -= 0.6;
  // a like or dislike is weak on purpose: "liked" is not the same as "correct"
  s += 0.2 * (sig.thumbs ?? 0);
  if (sig.edited) s -= 0.1;
  if (sig.retried) s -= 0.15;
  if (sig.reasked) s -= 0.15;
  if (sig.approvalDenied) s -= 0.1;
  if (sig.abandoned) s -= 0.2;
  return Math.round(clamp(s, -1, 1) * 100) / 100;
}

/** Gold = verified pass with no strong negative signal. A thumbs-up alone can never make an episode gold. */
export const isGold = (e: Pick<Episode, "verdict" | "score" | "signals">): boolean =>
  e.verdict === "pass" && e.score >= 0.45 && e.signals.thumbs !== -1 && !e.signals.retried;
export const isAnti = (e: Pick<Episode, "verdict" | "score">): boolean => e.verdict === "fail" || e.score <= -0.3;

// ---------------------------------------------------------------- verdict for chat runs (there is no verifier in plain chat)

/**
 * Plain chat runs have no verifier, so an unverified run is only "partial". It becomes "pass" ONLY when tools really ran,
 * the last tool did not fail and the owner confirmed with a thumbs-up. A thumbs-down is always "fail". A like alone
 * (no tools) never creates a playbook: mining needs a tool sequence.
 */
export function deriveVerdict(r: { verifier?: Verdict; toolCount: number; errorCount: number; lastToolFailed: boolean; thumbs: 1 | 0 | -1 }): Verdict {
  if (r.thumbs === -1) return "fail";
  if (r.verifier) return r.verifier === "pass" && r.lastToolFailed ? "partial" : r.verifier;
  if (r.toolCount === 0) return r.thumbs === 1 ? "pass" : "partial";
  if (r.lastToolFailed) return "fail";
  if (r.thumbs === 1 && r.errorCount <= Math.floor(r.toolCount / 3)) return "pass";
  return "partial";
}

// ---------------------------------------------------------------- miner + gates

export type MineOpts = { minGold: number; minUsers: number; minRate: number; maxPerIntent: number };
export const DEFAULT_MINE: MineOpts = { minGold: 5, minUsers: 3, minRate: 0.6, maxPerIntent: 3 };

/** The distinct tools of a run in the order first used (max 8): the "shape" of how a job was done. */
export function toolSequence(tools: string[]): string[] {
  const out: string[] = [];
  for (const t of tools) if (out[out.length - 1] !== t) out.push(t);
  return out.filter((t, i) => out.indexOf(t) === i).slice(0, 8);
}

export type Candidate = { example: Example; support: number; users: number; rate: number };

/** Turns episodes into candidate "learned" playbooks. Uses ONLY tool names and counts: no user text ever enters a global playbook. */
export function mine(episodes: Episode[], labels: Record<string, string>, opts: MineOpts = DEFAULT_MINE): Candidate[] {
  const byIntent = new Map<string, Episode[]>();
  for (const e of episodes) {
    if (e.intent === "general.chat") continue;
    byIntent.set(e.intent, [...(byIntent.get(e.intent) ?? []), e]);
  }
  const out: Candidate[] = [];
  for (const [intent, eps] of byIntent) {
    const gold = eps.filter(isGold).filter((e) => e.tools.length > 0);
    const anti = eps.filter(isAnti);
    const decided = eps.filter((e) => e.verdict !== "partial").length || 1;
    const rate = gold.length / decided;
    const groups = new Map<string, Episode[]>();
    for (const g of gold) {
      const sig = toolSequence(g.tools).join(">");
      groups.set(sig, [...(groups.get(sig) ?? []), g]);
    }
    const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, opts.maxPerIntent);
    const errCount = new Map<string, number>();
    for (const e of [...anti, ...eps.filter((x) => x.verdict !== "pass")]) for (const t of e.toolErrors) errCount.set(t, (errCount.get(t) ?? 0) + 1);
    const worst = [...errCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    ranked.forEach(([sig, list]) => {
      const users = new Set(list.map((x) => x.uk)).size;
      const tools = sig.split(">").filter(Boolean);
      if (!tools.length) return;
      const avgSteps = Math.round(list.reduce((a, x) => a + x.steps, 0) / list.length);
      const label = labels[intent] ?? intent;
      const ex: Example = {
        id: `learned-${intent}-${fnv1a(sig)}`,
        intent, task: "", title: `${label}: pattern seen in ${list.length} successful runs`,
        steps: tools.map((t, k) => `${k === 0 ? "Start with" : "Then"} ${t}${k === tools.length - 1 ? " and confirm the result with the user's goal" : ""}.`),
        tools,
        pitfalls: worst.map(([t, n]) => `${t} failed in ${n} runs of this job: check its arguments and that the connector is connected before calling it`),
        verify: [`The whole request is done (about ${avgSteps} steps is typical), and the result is backed by a tool output.`],
        source: "learned", weight: 1, status: "canary", uses: 0, wins: 0, fails: 0, users, version: 1, updatedAt: 0,
      };
      out.push({ example: ex, support: list.length, users, rate: Math.round(rate * 100) / 100 });
    });
  }
  return out;
}

/** Why a candidate may NOT go live. Empty list = it passes every gate (eval + canary still apply on the server). */
export function gateReasons(c: Candidate, opts: MineOpts = DEFAULT_MINE): string[] {
  const r: string[] = [];
  if (c.support < opts.minGold) r.push(`only ${c.support} successful runs (need ${opts.minGold})`);
  if (c.users < opts.minUsers) r.push(`only ${c.users} different users (need ${opts.minUsers})`);
  if (c.rate < opts.minRate) r.push(`success rate ${c.rate} is below ${opts.minRate}`);
  const text = [c.example.title, ...c.example.steps, ...c.example.pitfalls, ...c.example.verify].join(" ");
  if (hasInjection(text)) r.push("contains instruction-like text");
  if (looksSecret(text)) r.push("contains something that looks like a secret");
  if (c.example.tools.some((t) => !/^[a-z0-9_:.-]{2,80}$/i.test(t))) r.push("a tool name looks invalid");
  return r;
}

/** Canary -> live or paused, from real outcomes. Same idea as the per-chat skills (trial -> proven -> paused). */
export function judge(ex: Example, baselineRate: number): Status {
  const w = ex.wins ?? 0, f = ex.fails ?? 0, n = w + f;
  if (ex.status === "paused") return "paused";
  if (f >= 5 && f > w * 2) return "paused";
  if (ex.status === "canary" && n >= 30 && w / n >= baselineRate) return "live";
  if (ex.status === "canary" && n >= 30 && w / n < baselineRate - 0.1) return "paused";
  return ex.status ?? "live";
}

// ---------------------------------------------------------------- personal playbooks (learn per owner, from day 1)

export type PersonalStat = { intent: string; lastPass: string[]; wins: number; fails: number; errs: Record<string, number> };

/**
 * Each owner's own proven way of doing a job. It needs only 2 verified wins and a 70% success rate (no other users needed),
 * so an owner's agent gets better from their own work the very next day. Only tool names and counts: no text, never shared.
 */
export function personalExample(label: string, p: PersonalStat): Example | null {
  const tools = toolSequence(p.lastPass);
  const n = p.wins + p.fails;
  if (!tools.length || p.wins < 2 || n === 0 || p.wins / n < 0.7) return null;
  const worst = Object.entries(p.errs).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    id: `personal-${p.intent}`,
    intent: p.intent,
    task: "",
    title: `${label}: the way that worked for this owner (${p.wins} verified wins)`,
    steps: tools.map((t, i) => `${i === 0 ? "Start with" : "Then"} ${t}${i === tools.length - 1 ? " and check the result against the owner's goal" : ""}.`),
    tools,
    pitfalls: worst.map(([t, c]) => `${t} failed ${c} times for this owner: check its arguments and connector first`),
    verify: ["The owner's whole request is done and a tool result backs it"],
    source: "learned",
    weight: 2, // the owner's own proven way beats a generic playbook
    status: "live",
    uses: n, wins: p.wins, fails: p.fails, users: 1, version: 1,
  };
}

// ---------------------------------------------------------------- gaps: jobs people do that FOUNT has no playbook for

export type Gap = { tools: string[]; runs: number; users: number };

/** Verified runs that used tools but matched no job type. Shows what to write a playbook for next (no user text). */
export function gaps(episodes: Episode[], minRuns = 3, top = 10): Gap[] {
  const groups = new Map<string, Episode[]>();
  for (const e of episodes) {
    if (e.intent !== "general.chat" || e.verdict !== "pass" || e.tools.length < 2) continue;
    const sig = toolSequence(e.tools).join(">");
    groups.set(sig, [...(groups.get(sig) ?? []), e]);
  }
  return [...groups.entries()]
    .map(([sig, list]) => ({ tools: sig.split(">"), runs: list.length, users: new Set(list.map((x) => x.uk)).size }))
    .filter((g) => g.runs >= minRuns)
    .sort((a, b) => b.runs - a.runs)
    .slice(0, top);
}

// ---------------------------------------------------------------- measuring (control group vs FOUNT)

export function summarize(episodes: Episode[]) {
  const part = (list: Episode[]) => {
    const decided = list.filter((e) => e.verdict !== "partial");
    const pass = list.filter((e) => e.verdict === "pass").length;
    return {
      runs: list.length,
      passRate: decided.length ? Math.round((pass / decided.length) * 100) / 100 : null,
      avgSteps: list.length ? Math.round((list.reduce((a, e) => a + e.steps, 0) / list.length) * 10) / 10 : null,
    };
  };
  return { fount: part(episodes.filter((e) => e.fountOn)), control: part(episodes.filter((e) => !e.fountOn)) };
}

// ---------------------------------------------------------------- escalation (cheap model first, strong model only when needed)

export type Escalation = "stay" | "escalate" | "stop";
export function decideEscalation(s: { tier: Tier; failures: number; strongAvailable: boolean }): Escalation {
  if (s.failures >= 4) return "stop";
  if (s.tier !== "strong" && s.failures >= 2 && s.strongAvailable) return "escalate";
  return "stay";
}

// ---------------------------------------------------------------- lenient JSON (for broken tool arguments)

export function repairJson(raw: string): { ok: boolean; value?: unknown; fixed: boolean } {
  const first = (t: string) => { try { return { ok: true as const, value: JSON.parse(t) as unknown }; } catch { return { ok: false as const }; } };
  let t = String(raw ?? "").trim();
  const a = first(t);
  if (a.ok) return { ok: true, value: a.value, fixed: false };
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  t = t.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  t = t.replace(/,\s*([}\]])/g, "$1");
  t = t.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  t = t.replace(/'([^'\\]*)'/g, (_m, g1: string) => JSON.stringify(g1));
  const b = first(t);
  return b.ok ? { ok: true, value: b.value, fixed: true } : { ok: false, fixed: false };
}
