import type { Def } from "./plugins";
import { runClone, runPush, runStatus, runWriteFile } from "@/lib/repo-server";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const need = <T,>(ctx: T | undefined): T => { if (!ctx) throw new Error("This tool only works from a chat."); return ctx; };

export const REPO_TOOLS: Def[] = [
  {
    name: "repo.status", risk: "read", params: "",
    description: "Is a GitHub repository cloned in this chat's Venus Code workspace? Shows the repo, branch and how many files are changed. Check it before touching repo files.",
    run: async (_a, _c, ctx) => {
      const c = need(ctx);
      const r = await runStatus(c.uid, c.chatId);
      if (!r.cloned) return `No repository is cloned in the workspace.${"note" in r && r.note ? " " + r.note : ""}`;
      return `Cloned: ${r.repo} · branch ${r.branch} · ${r.files} files · ${r.dirty} changed file(s) not pushed yet · last commit: ${r.last}${r.changes ? "\n" + r.changes : ""}`;
    },
  },
  {
    name: "repo.clone", risk: "write", params: "repo:owner/name or GitHub URL, branch?:string",
    description: "Clone a GitHub repository into this chat's Venus Code workspace (an older workspace is kept as a backup folder). Afterwards the files are visible on the Code page. Private repos use the GitHub connector token.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const r = await runClone(c.uid, c.chatId, { repo: s(a.repo, 300), branch: s(a.branch, 100) || undefined });
      return `Cloned ${r.repo} (branch ${r.branch}, ${r.files} files) into the workspace.${r.backup ? ` The old workspace was kept at ${r.backup}.` : ""} It is visible on the Code page.`;
    },
  },
  {
    name: "repo.write_file", risk: "write", params: "path:string (inside the repo), content:string, delete?:boolean",
    description: "Create, overwrite or delete ONE file inside the cloned repository (in the workspace). It does not upload anything yet: call repo.push afterwards. Use this for simple file changes instead of starting Venus Code.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      return runWriteFile(c.uid, c.chatId, { path: s(a.path, 300), content: String(a.content ?? ""), remove: a.delete === true });
    },
  },
  {
    name: "repo.push", risk: "write", params: "message?:string, branch?:string, direct?:boolean",
    description: "Commit ALL changes in the cloned repository and push them to GitHub. On main/master it pushes to a NEW branch (venus/changes-…) unless direct:true or an explicit branch is given. Needs the GitHub connector token.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const r = await runPush(c.uid, c.chatId, { message: s(a.message, 120) || undefined, branch: s(a.branch, 100) || undefined, direct: a.direct === true });
      return `${r.note}\nBranch: ${r.url}${r.compareUrl ? `\nOpen a pull request: ${r.compareUrl}` : ""}`;
    },
  },
];
