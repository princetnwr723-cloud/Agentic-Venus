import { http } from "./net";
import type { Def } from "./plugins";

const s = (v: unknown) => String(v ?? "").trim();
const REPO = /^[\w.-]+\/[\w.-]+$/;
const gh = (t: string) => ({ Authorization: `Bearer ${t}`, "User-Agent": "agenticvenus", Accept: "application/vnd.github+json" });
const J = { "Content-Type": "application/json" };
const API = "https://api.github.com/repos";
type Res = { status: number; json: any; text: string };

const must = (r: Res, what: string): Res => {
  if (r.status >= 400) {
    throw new Error(`${what}: HTTP ${r.status} ${s(r.json?.message ?? r.text).slice(0, 200)}${r.status === 403 || r.status === 404 ? " (check that the GitHub token can write to this repository)" : ""}`);
  }
  return r;
};
const okPath = (p: string): string => {
  const x = p.replace(/^\/+/, "");
  if (!x || x.includes("..") || /^\.git(\/|$)/.test(x)) throw new Error(`Bad path: ${p}`);
  return x;
};
const okBranch = (b: string): string => {
  if (!/^[\w./-]{1,100}$/.test(b) || b.includes("..") || b.endsWith("/") || b.endsWith(".lock")) throw new Error(`Bad branch name: ${b}`);
  return b;
};

export const GITHUB_PUT: Def[] = [
  {
    name: "github.put_files", risk: "write",
    params: "repo:owner/name, files?:[{path,content}] (create or overwrite), delete_paths?:string[], message?:string, branch?:string (default: the repo's default branch), new_branch?:string (commit to a NEW branch instead), open_pr?:boolean (with new_branch)",
    description: "Add, update or delete files in a GitHub repository DIRECTLY through the GitHub API, all in ONE commit. No computer and no cloned copy needed. Use it when the repository is NOT cloned in the workspace and the task is just adding or editing files. The owner approves it first.",
    run: async (a, [t]) => {
      const repo = s(a.repo);
      if (!REPO.test(repo)) throw new Error('repo must look like "owner/name".');
      const files = (Array.isArray(a.files) ? a.files : []).slice(0, 40).map((f: any) => ({ path: okPath(s(f?.path)), content: String(f?.content ?? "") }));
      const dels = (Array.isArray(a.delete_paths) ? a.delete_paths : []).slice(0, 40).map((p: unknown) => okPath(s(p)));
      if (!files.length && !dels.length) throw new Error("Give `files` to add or `delete_paths` to remove.");
      let total = 0;
      for (const f of files) total += f.content.length;
      if (total > 600_000) throw new Error("Too much content for one commit (limit 600 KB).");
      const message = s(a.message).slice(0, 200) || (files.length ? `Add ${files.map((f) => f.path).slice(0, 3).join(", ")}` : "Remove files");

      const info = must(await http(`${API}/${repo}`, { headers: gh(t) }), "GitHub").json;
      const base = okBranch(s(a.branch) || String(info.default_branch ?? "main"));
      const newBranch = s(a.new_branch) ? okBranch(s(a.new_branch)) : "";
      const refRes = await http(`${API}/${repo}/git/ref/heads/${base}`, { headers: gh(t) });

      // Empty repository: the Git data API cannot start it, the Contents API can.
      if (refRes.status === 409 || (refRes.status === 404 && Number(info.size) === 0)) {
        if (!files.length || dels.length) throw new Error("This repository is empty: it can only receive new files.");
        for (const f of files) {
          must(await http(`${API}/${repo}/contents/${f.path}`, { method: "PUT", headers: { ...gh(t), ...J }, body: JSON.stringify({ message, content: Buffer.from(f.content, "utf8").toString("base64") }) }), "GitHub");
        }
        return `Committed ${files.length} file(s) to the new repository ${repo}.`;
      }
      if (refRes.status === 404) throw new Error(`Branch "${base}" does not exist in ${repo}.`);
      const parent = must(refRes, "GitHub").json.object.sha as string;
      const baseTree = must(await http(`${API}/${repo}/git/commits/${parent}`, { headers: gh(t) }), "GitHub").json.tree.sha as string;

      const tree: Array<{ path: string; mode: string; type: string; sha: string | null }> = [];
      for (const f of files) {
        const b = must(await http(`${API}/${repo}/git/blobs`, { method: "POST", headers: { ...gh(t), ...J }, body: JSON.stringify({ content: f.content, encoding: "utf-8" }) }), "GitHub");
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: b.json.sha });
      }
      for (const p of dels) tree.push({ path: p, mode: "100644", type: "blob", sha: null });

      const nt = must(await http(`${API}/${repo}/git/trees`, { method: "POST", headers: { ...gh(t), ...J }, body: JSON.stringify({ base_tree: baseTree, tree }) }), "GitHub").json.sha as string;
      const c = must(await http(`${API}/${repo}/git/commits`, { method: "POST", headers: { ...gh(t), ...J }, body: JSON.stringify({ message, tree: nt, parents: [parent] }) }), "GitHub").json;
      if (newBranch) must(await http(`${API}/${repo}/git/refs`, { method: "POST", headers: { ...gh(t), ...J }, body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: c.sha }) }), "GitHub");
      else must(await http(`${API}/${repo}/git/refs/heads/${base}`, { method: "PATCH", headers: { ...gh(t), ...J }, body: JSON.stringify({ sha: c.sha }) }), "GitHub");

      let pr = "";
      if (newBranch && a.open_pr === true) {
        const p = await http(`${API}/${repo}/pulls`, { method: "POST", headers: { ...gh(t), ...J }, body: JSON.stringify({ title: message, head: newBranch, base, body: "" }) });
        if (p.status < 400) pr = String(p.json?.html_url ?? "");
      }
      return `Committed ${files.length} file(s)${dels.length ? ` and removed ${dels.length}` : ""} to ${newBranch || base} of ${repo}: ${c.html_url}${pr ? `\nPull request: ${pr}` : ""}`;
    },
  },
];
