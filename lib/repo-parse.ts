export type RepoRef = { owner: string; name: string; branch?: string };

/** Accepts owner/name, https://github.com/owner/name(.git), git@github.com:owner/name.git, or a /tree/<branch> link. */
export function parseRepo(input: string): RepoRef | null {
  let s = String(input ?? "").trim().replace(/[?#].*$/, "");
  s = s.replace(/^git@github\.com:/i, "https://github.com/");
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/(.+?))?\/?$/i.exec(s);
  const short = url ? null : /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(s);
  const m = url ?? short;
  if (!m) return null;
  const owner = m[1];
  const name = m[2];
  if (!owner || !name || owner === "." || owner === ".." || name === "." || name === "..") return null;
  const branch = url && m[3] ? m[3] : undefined;
  return { owner, name, ...(branch ? { branch } : {}) };
}

export const validBranch = (b: string): boolean =>
  /^[A-Za-z0-9][\w./-]{0,99}$/.test(b) && !b.includes("..") && !b.endsWith(".lock") && !b.endsWith("/");
