// Pure helpers for memory + skills (NO imports on purpose: runs in the browser, on the server and in `node --test`).

export const MEM_CAP = 400;          // memories per chat
export const OWNER_CAP = 150;        // account-wide owner profile facts
export const MEM_TEXT_MAX = 400;
export const SKILL_CAP = 200;        // skills per chat
export const SKILL_FILE_COUNT = 12;  // supporting files per skill
export const SKILL_FILE_CHARS = 20_000;
export const SKILL_FILES_TOTAL = 80_000;

// ---------------- secrets: never store these in memory or skills ----------------
const SECRET_KV = /\b(pass(?:word|wd|code)?|api[_ -]?key|secret|token|card\s*number|cvv|cvc|otp|pin)\b\s*(?:is|=|:)\s*\S+/i;
const SECRET_SHAPES: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\b(?:sk|pk|rk|xox[abprs]|ghp|gho|ghs|github_pat|glpat|shpat|whsec)[-_][A-Za-z0-9_-]{12,}/,
  /\b(?:AKIA|AIza|ya29)[A-Za-z0-9_-]{12,}/,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:\d[ -]?){13,19}\b/,
];
export function looksSecret(text: string): boolean {
  const t = String(text ?? "");
  return SECRET_KV.test(t) || SECRET_SHAPES.some((re) => re.test(t));
}

// ---------------- tolerant JSON (weak models wrap JSON in prose / code fences / trailing commas) ----------------
export function parseJsonLoose(raw: string): any | null {
  const s = String(raw ?? "").replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const body = s.slice(start, end + 1);
  for (const cand of [body, body.replace(/,\s*([}\]])/g, "$1")]) {
    try { return JSON.parse(cand); } catch { /* try the next repair */ }
  }
  return null;
}

// ---------------- find-and-replace patch (like Hermes skill_manage "patch") ----------------
export type PatchResult = { ok: true; text: string; count: number } | { ok: false; error: string };
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function applyPatch(text: string, oldStr: string, newStr: string, replaceAll = false): PatchResult {
  const src = String(text ?? "");
  const old = String(oldStr ?? "");
  const neu = String(newStr ?? "");
  if (!old.trim()) return { ok: false, error: "old_text is empty: copy the exact text you want to change." };
  const exact = src.split(old).length - 1;
  if (exact > 1 && !replaceAll) return { ok: false, error: `old_text appears ${exact} times: add more surrounding text so it is unique, or set replace_all.` };
  if (exact >= 1) return { ok: true, text: replaceAll ? src.split(old).join(neu) : src.replace(old, () => neu), count: replaceAll ? exact : 1 };
  // Forgiving fallback: same words, different spaces / line breaks.
  const parts = old.trim().split(/\s+/).map(escRe);
  const re = new RegExp(parts.join("\\s+"), "g");
  const hits = src.match(re)?.length ?? 0;
  if (hits === 0) return { ok: false, error: "old_text was not found. Read the current text first and copy it exactly." };
  if (hits > 1 && !replaceAll) return { ok: false, error: `old_text matches ${hits} places: add more surrounding text, or set replace_all.` };
  return { ok: true, text: src.replace(re, () => neu), count: hits };
}

// ---------------- supporting files of a skill (references/, scripts/, templates/ ...) ----------------
const FILE_RE = /^(references|scripts|templates|assets|examples)\/[A-Za-z0-9._\-/]{1,90}$/;
const FILE_EXT = /\.(md|txt|json|csv|ya?ml|py|js|mjs|ts|sh|html|css|sql)$/i;

export function validateSkillPath(p: string): string | null {
  const x = String(p ?? "").trim().replace(/^\.\//, "").replace(/\\/g, "/");
  if (!FILE_RE.test(x) || !FILE_EXT.test(x) || x.includes("..") || x.includes("//") || x.endsWith("/")) return null;
  return x;
}

export function filesTotal(files: Record<string, string> | undefined | null): number {
  return Object.values(files ?? {}).reduce((n, v) => n + String(v).length, 0);
}

/** Accepts {path: content}, [{path, content}] or a JSON string. Returns only valid files + the reasons others were dropped. */
export function sanitizeFiles(input: unknown): { files: Record<string, string>; errors: string[] } {
  const errors: string[] = [];
  const files: Record<string, string> = {};
  let raw: unknown = input;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return { files, errors };
    try { raw = JSON.parse(t); } catch { return { files, errors: ["files must be JSON like {\"references/guide.md\":\"text\"}"] }; }
  }
  const pairs: Array<[string, unknown]> = [];
  if (Array.isArray(raw)) {
    for (const it of raw) if (it && typeof it === "object") pairs.push([String((it as any).path ?? ""), (it as any).content]);
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) pairs.push([k, v]);
  }
  let total = 0;
  for (const [k, v] of pairs) {
    const path = validateSkillPath(k);
    if (!path) { errors.push(`bad file path: ${String(k).slice(0, 60)} (use references/, scripts/, templates/, assets/ or examples/)`); continue; }
    const content = String(v ?? "");
    if (!content.trim()) { errors.push(`${path} is empty`); continue; }
    if (content.length > SKILL_FILE_CHARS) { errors.push(`${path} is longer than ${SKILL_FILE_CHARS} characters`); continue; }
    if (Object.keys(files).length >= SKILL_FILE_COUNT) { errors.push(`max ${SKILL_FILE_COUNT} files per skill`); break; }
    if (total + content.length > SKILL_FILES_TOTAL) { errors.push(`${path} would push the skill over ${SKILL_FILES_TOTAL} characters of files`); continue; }
    total += content.length;
    files[path] = content;
  }
  return { files, errors };
}

// ---------------- skill statistics: trial -> proven -> paused ----------------
export type SkillStats = { wins: number; fails: number; trial: boolean; disabled: boolean };
export type SkillEvent = "proven" | "paused";

/** One run finished. pass = +1 win, fail = +1 fail, partial = unproven (nothing changes). */
export function nextSkillState(s: SkillStats, verdict: "pass" | "partial" | "fail"): { next: SkillStats; event: SkillEvent | null } {
  const next: SkillStats = { ...s };
  let event: SkillEvent | null = null;
  if (verdict === "pass") next.wins = s.wins + 1;
  else if (verdict === "fail") next.fails = s.fails + 1;
  else return { next, event };
  if (next.trial && next.wins >= 2) { next.trial = false; event = "proven"; }
  if (!next.disabled && next.fails >= 3 && next.fails > next.wins * 2) { next.disabled = true; event = "paused"; }
  return { next, event };
}

/** How many steps did a run take? (explicit number wins, else count the non-empty lines of the log) */
export function stepCountOf(steps?: string, explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
  return String(steps ?? "").split("\n").filter((l) => l.trim()).length;
}

export const slugOf = (x: string) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "skill";
export const clipText = (s: string, n: number) => (String(s ?? "").length > n ? String(s).slice(0, n) + "…" : String(s ?? ""));
