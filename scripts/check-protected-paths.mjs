// Fails a pull request that touches billing / auth / secrets files unless the author is an owner or member.
// Usage (CI):  git diff --name-only BASE...HEAD | PR_AUTHOR_ASSOCIATION=CONTRIBUTOR node scripts/check-protected-paths.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TRUSTED = new Set(["OWNER", "MEMBER"]);

export function toRegex(pattern) {
  let p = pattern.trim();
  if (p.endsWith("/")) p += "**";
  const esc = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const src = esc.replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp("^" + src + "$");
}

export function loadPatterns(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map(toRegex);
}

export function protectedHits(files, patterns) {
  return files.map((f) => f.trim().replace(/^\.\//, "")).filter(Boolean).filter((f) => patterns.some((r) => r.test(f)));
}

export function verdict(files, patterns, association) {
  const hits = protectedHits(files, patterns);
  if (!hits.length) return { ok: true, hits };
  if (TRUSTED.has(String(association || "").toUpperCase())) return { ok: true, hits, trusted: true };
  return { ok: false, hits };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const patterns = loadPatterns(readFileSync(join(here, "..", ".github", "protected-paths.txt"), "utf8"));
  const files = readFileSync(0, "utf8").split(/\r?\n/);
  const v = verdict(files, patterns, process.env.PR_AUTHOR_ASSOCIATION);
  if (!v.ok) {
    console.error("This pull request changes protected files (plans, limits, payments, auth or secrets):");
    for (const h of v.hits) console.error("  - " + h);
    console.error("These files can only be changed by the AgenticVenus maintainers. Please open an issue to discuss the change instead.");
    process.exit(1);
  }
  console.log(v.hits.length ? "Protected files changed by a maintainer: OK." : "No protected files changed.");
}