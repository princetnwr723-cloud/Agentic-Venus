import { http } from "./net";
import type { Def } from "./plugins";

const s = (v: unknown) => String(v ?? "").trim();
const REPO = /^[\w.-]+\/[\w.-]+$/;
const repoOf = (v: unknown) => { const r = s(v); if (!REPO.test(r)) throw new Error('repo must look like "owner/name".'); return r; };
const gh = (t: string) => ({ Authorization: `Bearer ${t}`, "User-Agent": "agenticvenus", Accept: "application/vnd.github+json" });
const J = { "Content-Type": "application/json" };
type Res = { status: number; json: any; text: string };
const must = (r: Res, what: string) => {
  if (r.status >= 400) throw new Error(`${what}: HTTP ${r.status} ${s(r.json?.message ?? r.text).slice(0, 200)}`);
  return r;
};
const API = "https://api.github.com/repos";

export const GITHUB_EXTRA: Def[] = [
  {
    name: "github.list_pull_requests", description: "List pull requests of a repo.", params: "repo:owner/name, state?:open|closed|all", risk: "read",
    run: async (a, [t]) => {
      const st = ["open", "closed", "all"].includes(s(a.state)) ? s(a.state) : "open";
      const r = must(await http(`${API}/${repoOf(a.repo)}/pulls?state=${st}&per_page=10`, { headers: gh(t) }), "GitHub");
      return ((r.json ?? []) as any[]).map((p) => `#${p.number} ${p.title} (${p.state}) ${p.head?.ref} -> ${p.base?.ref} ${p.html_url}`).join("\n") || "No pull requests.";
    },
  },
  {
    name: "github.get_pull_request", description: "A pull request with its changed files.", params: "repo:owner/name, number:number", risk: "read",
    run: async (a, [t]) => {
      const repo = repoOf(a.repo), n = Math.floor(Number(a.number));
      if (!n) throw new Error("number is required.");
      const p = must(await http(`${API}/${repo}/pulls/${n}`, { headers: gh(t) }), "GitHub").json;
      const f = must(await http(`${API}/${repo}/pulls/${n}/files?per_page=30`, { headers: gh(t) }), "GitHub").json as any[];
      return `#${p.number} ${p.title} (${p.state}, mergeable: ${p.mergeable ?? "unknown"})\n${s(p.body).slice(0, 800)}\n\nFiles:\n` +
        f.map((x) => `${x.status} ${x.filename} (+${x.additions} -${x.deletions})${x.patch ? "\n" + String(x.patch).slice(0, 600) : ""}`).join("\n");
    },
  },
  {
    name: "github.comment", description: "Comment on an issue or pull request.", params: "repo:owner/name, number:number, body:string", risk: "write",
    run: async (a, [t]) => {
      const n = Math.floor(Number(a.number));
      if (!n || !s(a.body)) throw new Error("number and body are required.");
      const r = must(await http(`${API}/${repoOf(a.repo)}/issues/${n}/comments`, { method: "POST", headers: { ...gh(t), ...J }, body: JSON.stringify({ body: s(a.body).slice(0, 6000) }) }), "GitHub");
      return `Comment posted: ${r.json?.html_url}`;
    },
  },
  {
    name: "github.create_pull_request", description: "Open a pull request from an existing branch.", params: "repo:owner/name, head:string, base?:string, title:string, body?:string", risk: "write",
    run: async (a, [t]) => {
      const repo = repoOf(a.repo);
      const base = s(a.base) || must(await http(`${API}/${repo}`, { headers: gh(t) }), "GitHub").json.default_branch;
      const r = must(await http(`${API}/${repo}/pulls`, { method: "POST", headers: { ...gh(t), ...J }, body: JSON.stringify({ title: s(a.title).slice(0, 200), head: s(a.head), base, body: s(a.body).slice(0, 6000) }) }), "GitHub");
      return `Opened pull request #${r.json?.number}: ${r.json?.html_url}`;
    },
  },
  {
    name: "github.commit_files",
    description: "Commit text files to a NEW or existing branch (never main/master). In a coding job pass from_workspace:true to commit the files you changed.",
    params: "repo:owner/name, branch:string, message:string, files?:[{path,content}], from_workspace?:boolean", risk: "write",
    run: async (a, [t]) => {
      const repo = repoOf(a.repo), branch = s(a.branch), message = s(a.message).slice(0, 200) || "Update";
      if (!/^[\w./-]{1,100}$/.test(branch) || branch.includes("..")) throw new Error("Bad branch name.");
      if (/^(main|master)$/i.test(branch)) throw new Error("Never commit straight to main/master: use a new branch and open a pull request.");
      const files = (Array.isArray(a.files) ? a.files : []).slice(0, 40).map((f: any) => ({ path: s(f?.path).replace(/^\/+/, ""), content: String(f?.content ?? "") }));
      if (!files.length) throw new Error("No files to commit.");
      let total = 0;
      for (const f of files) {
        if (!f.path || f.path.includes("..") || /^\.git\//.test(f.path)) throw new Error(`Bad path: ${f.path}`);
        total += f.content.length;
      }
      if (total > 600_000) throw new Error("Too much content for one commit (limit 600 KB).");

      const info = must(await http(`${API}/${repo}`, { headers: gh(t) }), "GitHub").json;
      const existing = await http(`${API}/${repo}/git/ref/heads/${branch}`, { headers: gh(t) });
      const parentRef = existing.status === 200 ? existing : must(await http(`${API}/${repo}/git/ref/heads/${s(a.base) || info.default_branch}`, { headers: gh(t) }), "GitHub");
      const parent = parentRef.json.object.sha as string;
      const baseTree = must(await http(`${API}/${repo}/git/commits/${parent}`, { headers: gh(t) }), "GitHub").json.tree.sha as string;
      const tree: Array<{ path: string; mode: string; type: string; sha: string }> = [];
      for (const f of files) {
        const b = must(await http(`${API}/${repo}/git/blobs`, { method: "POST", headers: { ...gh(t), ...J }, body: JSON.stringify({ content: f.content, encoding: "utf-8" }) }), "GitHub");
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: b.json.sha });
      }
      const nt = must(await http(`${API}/${repo}/git/trees`, { method: "POST", headers: { ...gh(t), ...J }, body: JSON.stringify({ base_tree: baseTree, tree }) }), "GitHub").json.sha as string;
      const c = must(await http(`${API}/${repo}/git/commits`, { method: "POST", headers: { ...gh(t), ...J }, body: JSON.stringify({ message, tree: nt, parents: [parent] }) }), "GitHub").json;
      if (existing.status === 200) must(await http(`${API}/${repo}/git/refs/heads/${branch}`, { method: "PATCH", headers: { ...gh(t), ...J }, body: JSON.stringify({ sha: c.sha }) }), "GitHub");
      else must(await http(`${API}/${repo}/git/refs`, { method: "POST", headers: { ...gh(t), ...J }, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: c.sha }) }), "GitHub");
      return `Committed ${files.length} file(s) to branch ${branch}: ${c.html_url}`;
    },
  },
];