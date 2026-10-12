import { parseRepo } from "@/lib/repo-parse";

export type RepoIntent =
  | { kind: "clone"; repo: string; branch?: string; then?: string }
  | { kind: "push"; branch?: string; message?: string; direct?: boolean };

const URL_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+(?:\/tree\/[^\s]+)?|git@github\.com:[\w.-]+\/[\w.-]+(?:\.git)?/i;
const CLONE_VERB = /\b(clone|import|checkout|download|le\s?aao|laao|la\s?do|le\s?aa)\b/i;
const WORK = /\b(fix|add|build|test|refactor|explain|review|update|implement|debug|run|improve|analy[sz]e|summari[sz]e|create|write)\b/i;
const STOP = new Set(["new", "the", "this", "my", "your", "same", "current", "another", "separate", "a", "an", "it"]);

function pushFrom(s: string): RepoIntent {
  let branch: string | undefined;
  let direct = false;
  const b = /\bbranch\s+(?:named\s+|called\s+)?([\w./-]{2,80})/i.exec(s)?.[1];
  if (b && !STOP.has(b.toLowerCase())) branch = b;
  const d = /\b(?:to|on|into)\s+(main|master)\b/i.exec(s)?.[1];
  if (d) { branch = d.toLowerCase(); direct = true; }
  if (/\bdirect(?:ly)?\b/i.test(s)) direct = true;
  const message = /\bmessage\s*[:=]?\s*["“']?([^"”'\n]{3,100})/i.exec(s)?.[1]?.trim();
  return { kind: "push", ...(branch ? { branch } : {}), ...(message ? { message } : {}), ...(direct ? { direct } : {}) };
}

/** Direct commands: /clone owner/name [branch], /push, or plain sentences like "clone github.com/a/b" and "push all changes". */
export function repoIntent(text: string): RepoIntent | null {
  const t = String(text ?? "").trim();
  if (!t || t.length > 600) return null;

  const sc = /^\/clone\s+(\S+)(?:\s+(\S+))?\s*$/i.exec(t);
  if (sc) {
    const r = parseRepo(sc[1]);
    if (r) return { kind: "clone", repo: `${r.owner}/${r.name}`, branch: sc[2] || r.branch };
  }
  const sp = /^\/push\b\s*([\s\S]*)$/i.exec(t);
  if (sp) return pushFrom(sp[1]);
  if (t.startsWith("/")) return null;

  const url = URL_RE.exec(t)?.[0];
  if (url && CLONE_VERB.test(t) && !/\bpush\b/i.test(t)) {
    const r = parseRepo(url);
    if (r) {
      const rest = t.replace(url, "this repository (already cloned into the workspace)");
      return { kind: "clone", repo: `${r.owner}/${r.name}`, branch: r.branch, ...(WORK.test(t.replace(CLONE_VERB, "")) ? { then: rest } : {}) };
    }
  }
  const short = /\bclone\s+([\w.-]+\/[\w.-]+)\b/i.exec(t)?.[1];
  if (!url && short) {
    const r = parseRepo(short);
    if (r) return { kind: "clone", repo: `${r.owner}/${r.name}` };
  }

  if (!url && /\bpush\b/i.test(t) && /\b(all|changes?|everything|code|work|repo|repository|github|branch|commit)\b/i.test(t) && !/\bnotifications?\b/i.test(t)) return pushFrom(t);
  return null;
}

const FILE_VERB = "(?:add|create|upload|put|commit|save|update|edit|change|delete|remove|rename|likho|daal|dal|bana)\\w*";
const FILE_NOUN = "(?:\\bfiles?\\b|\\breadme\\b|\\blicense\\b|\\bchangelog\\b|\\.gitignore|\\.md\\b|\\.txt\\b|\\.json\\b|\\.ya?ml\\b|\\bfolder\\b|\\bdocs?\\b|\\bdocument\\b)";

/**
 * "Add this file to my GitHub repo" is NOT a coding task. It must never start Venus Code or the computer:
 * the agent uses repo.write_file + repo.push (repo cloned) or github.put_files (not cloned).
 */
export function repoFileIntent(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.length > 1500 || t.startsWith("/")) return false;
  const aboutRepo = /\b(github|repo|repos|repository)\b/i.test(t) || URL_RE.test(t);
  if (!aboutRepo) return false;
  const fileAct =
    new RegExp(`\\b${FILE_VERB}\\b[\\s\\S]{0,60}${FILE_NOUN}`, "i").test(t) ||
    new RegExp(`${FILE_NOUN}[\\s\\S]{0,40}\\b${FILE_VERB}\\b`, "i").test(t);
  const coding = /\b(build|implement|refactor|debug|fix|bugs?|feature|website|component|function|rewrite|migrate|deploy)\b/i.test(t);
  return fileAct && !coding;
}
