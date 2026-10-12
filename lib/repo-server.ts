// Server-only. Clone a GitHub repository into the chat's Venus Code workspace, edit files there, push all changes back.
// The GitHub token is only passed to git for a single command (http.extraheader): it is never written into .git/config.
import { getAdminDb } from "@/lib/firebase-admin";
import { connect, createSandbox, exec, GONE_PREFIX } from "@/lib/e2b-server";
import { writeBinary } from "@/lib/venus-server";
import { resolveValue } from "@/lib/vault";
import { resolveConnectorsSafe } from "@/lib/tools/connectors";
import { unpack } from "@/lib/tools/catalog";
import { q, resolvePath, wsRoot, type Sb } from "@/lib/code-server";
import { parseRepo, validBranch } from "@/lib/repo-parse";

export type RepoInfo = { owner: string; name: string; branch: string; at: number };

const ID = /^[A-Za-z0-9_-]{4,160}$/;
const userRef = (uid: string) => getAdminDb().collection("users").doc(uid);
const chatRef = (uid: string, chatId: string) => userRef(uid).collection("chats").doc(chatId);
const bash = (sb: Sb, script: string, ms = 30_000) => exec(sb, `bash -c ${q(script)}`, ms);
const kv = (out: string, key: string) => new RegExp(`^${key}=(.*)$`, "m").exec(out)?.[1]?.trim() ?? "";
const scrub = (s: string, b64: string) => (b64 ? s.split(b64).join("***") : s).replace(/AUTHORIZATION: basic \S+/gi, "AUTHORIZATION: basic ***");
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

export async function repoInfo(uid: string, chatId: string): Promise<RepoInfo | null> {
  if (!ID.test(chatId)) return null;
  const d = (await chatRef(uid, chatId).get()).data() as { repo?: RepoInfo } | undefined;
  return d?.repo?.owner && d.repo.name ? d.repo : null;
}
async function requireRepo(uid: string, chatId: string): Promise<RepoInfo> {
  const r = await repoInfo(uid, chatId);
  if (!r) throw new Error("No repository is cloned in this workspace yet. Clone one first (/clone owner/name).");
  return r;
}

/** The coding computer of this chat (slot "code", the same one Venus Code uses). Created if the chat has none yet. */
export async function codeSandboxFor(uid: string, chatId: string): Promise<{ sb: Sb; sandboxId: string }> {
  if (!ID.test(chatId)) throw new Error("Bad chat id.");
  const user = userRef(uid);
  const udata = (await user.get()).data() as { e2bKey?: string } | undefined;
  if (!udata?.e2bKey) throw new Error("Add your E2B key under API keys first: the repository lives on your coding computer.");
  const key = await resolveValue(uid, udata.e2bKey);
  const cref = chatRef(uid, chatId);
  const cd = ((await cref.get()).data() ?? {}) as { computers?: Record<string, string> };
  let sid = cd.computers?.code || "";
  const fresh = async () => {
    const c = await createSandbox(key, { provision: false });
    await cref.update({ "computers.code": c.sandboxId });
    return c.sandboxId;
  };
  if (!sid) sid = await fresh();
  try {
    return { sb: await connect(key, sid), sandboxId: sid };
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith(GONE_PREFIX)) throw e;
    sid = await fresh();
    return { sb: await connect(key, sid), sandboxId: sid };
  }
}

/** Token of the GitHub connector of this chat (plugin token first, then GitHub OAuth). Empty string = public access only. */
export async function githubTokenFor(uid: string, chatId: string): Promise<string> {
  const snap = await chatRef(uid, chatId).get();
  const stored: Record<string, string> = {};
  for (const [k, v] of Object.entries(((snap.data() as { connectors?: Record<string, unknown> } | undefined)?.connectors) ?? {})) if (typeof v === "string") stored[k] = v;
  const { connectors } = await resolveConnectorsSafe(uid, stored);
  const plugin = connectors.github ? unpack(connectors.github)[0] : "";
  if (plugin) return plugin;
  const o = connectors["oauth:github_oauth"];
  if (o) { try { const j = JSON.parse(o) as { access?: string }; if (j.access) return j.access; } catch { return o; } }
  return "";
}

// ---------------- clone ----------------
export async function runClone(uid: string, chatId: string, o: { repo: string; branch?: string; full?: boolean }) {
  const ref = parseRepo(o.repo);
  if (!ref) throw new Error("Give the repository as owner/name or a github.com link.");
  const branch = (o.branch || ref.branch || "").trim();
  if (branch && !validBranch(branch)) throw new Error("That branch name is not valid.");
  const token = await githubTokenFor(uid, chatId);
  const { sb } = await codeSandboxFor(uid, chatId);
  const root = wsRoot(chatId);
  const url = `https://github.com/${ref.owner}/${ref.name}.git`;
  const b64 = token ? Buffer.from(`x-access-token:${token}`).toString("base64") : "";
  const depth = o.full ? "" : "--depth 1";
  const br = branch ? `--branch ${q(branch)} --single-branch` : "";

  const script = `
export GIT_TERMINAL_PROMPT=0
export GHB64=${q(b64)}
command -v git >/dev/null 2>&1 || sudo apt-get install -y git >/dev/null 2>&1
GA=()
if [ -n "$GHB64" ]; then GA=(-c "http.https://github.com/.extraheader=AUTHORIZATION: basic $GHB64"); fi
ROOT=${q(root)}
URL=${q(url)}
BR=${q(branch)}
mkdir -p "$(dirname "$ROOT")"
BACKUP=""
MODE=clone
if [ -d "$ROOT/.git" ] && [ "$(git -C "$ROOT" remote get-url origin 2>/dev/null)" = "$URL" ]; then
  MODE=update
  if [ -n "$BR" ]; then
    git -C "$ROOT" "\${GA[@]}" fetch origin "+refs/heads/$BR:refs/remotes/origin/$BR" 2>&1 | tail -n 3
    git -C "$ROOT" checkout -B "$BR" "origin/$BR" 2>&1 | tail -n 3
  else
    git -C "$ROOT" "\${GA[@]}" pull --ff-only 2>&1 | tail -n 3
  fi
else
  if [ -n "$(ls -A "$ROOT" 2>/dev/null)" ]; then BACKUP="$ROOT.old-$(date +%s)"; mv "$ROOT" "$BACKUP"; fi
  rm -rf "$ROOT"
  git "\${GA[@]}" clone ${depth} ${br} "$URL" "$ROOT" 2>&1 | tail -n 4
  if [ ! -d "$ROOT/.git" ]; then
    if [ -n "$BACKUP" ]; then mv "$BACKUP" "$ROOT"; fi
    echo "RESULT=FAILED"
    exit 0
  fi
fi
cd "$ROOT"
git config user.name "Venus Code"
git config user.email "venus@users.noreply.github.com"
mkdir -p .git/info
for f in VENUS.md .venus/; do grep -qxF "$f" .git/info/exclude 2>/dev/null || echo "$f" >> .git/info/exclude; done
echo "RESULT=OK"
echo "MODE=$MODE"
echo "BRANCH=$(git rev-parse --abbrev-ref HEAD)"
echo "COMMIT=$(git rev-parse --short HEAD)"
echo "FILES=$(git ls-files | wc -l)"
echo "BACKUP=$BACKUP"
`;
  const r = await bash(sb, script, 56_000);
  const out = scrub(`${r.stdout}\n${r.stderr}`, b64);
  if (kv(out, "RESULT") !== "OK") {
    const tail = out.split("\n").filter((l) => l.trim() && !/^RESULT=/.test(l)).slice(-4).join(" ").slice(0, 300);
    throw new Error(`Could not clone ${ref.owner}/${ref.name}. ${tail || "No output."}${token ? "" : " If the repository is private, connect GitHub in Connectors first."}`);
  }
  const info: RepoInfo = { owner: ref.owner, name: ref.name, branch: kv(out, "BRANCH") || branch || "main", at: Date.now() };
  await chatRef(uid, chatId).update({ repo: info });
  return {
    ok: true as const, owner: ref.owner, name: ref.name, repo: `${ref.owner}/${ref.name}`, branch: info.branch,
    commit: kv(out, "COMMIT"), files: Number(kv(out, "FILES")) || 0, mode: kv(out, "MODE") || "clone", backup: kv(out, "BACKUP"),
  };
}

// ---------------- status ----------------
export async function runStatus(uid: string, chatId: string) {
  const info = await repoInfo(uid, chatId);
  if (!info) return { cloned: false as const };
  const { sb } = await codeSandboxFor(uid, chatId);
  const root = wsRoot(chatId);
  const r = await bash(sb, `cd ${q(root)} 2>/dev/null && [ -d .git ] || { echo RESULT=NOREPO; exit 0; }
echo RESULT=OK
echo BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo DIRTY=$(git status --porcelain | wc -l)
echo FILES=$(git ls-files | wc -l)
echo LAST=$(git log -1 --pretty=%s | head -c 90)
echo @@LIST
git status --porcelain | head -n 15`, 25_000);
  if (kv(r.stdout, "RESULT") !== "OK") return { cloned: false as const, note: "The workspace is empty on the current computer. Clone the repository again." };
  return {
    cloned: true as const, repo: `${info.owner}/${info.name}`, branch: kv(r.stdout, "BRANCH"), dirty: Number(kv(r.stdout, "DIRTY")) || 0,
    files: Number(kv(r.stdout, "FILES")) || 0, last: kv(r.stdout, "LAST"), changes: (r.stdout.split("@@LIST\n")[1] ?? "").trim(),
  };
}

// ---------------- write one file into the cloned repo ----------------
export async function runWriteFile(uid: string, chatId: string, o: { path: string; content: string; remove?: boolean }): Promise<string> {
  const info = await requireRepo(uid, chatId);
  const p = String(o.path ?? "").trim();
  if (!p) throw new Error("path is required.");
  const abs = resolvePath(chatId, p); // refuses "..", .git and anything outside the workspace
  if (abs === wsRoot(chatId)) throw new Error("path must be a file inside the repository.");
  const { sb } = await codeSandboxFor(uid, chatId);
  if (o.remove) {
    await bash(sb, `rm -f ${q(abs)}`, 15_000);
    return `Deleted ${p} in the workspace copy of ${info.owner}/${info.name}. It is not on GitHub yet: call repo.push.`;
  }
  let c = String(o.content ?? "");
  if (c.length > 800_000) throw new Error("The file is too large.");
  if (!c.endsWith("\n")) c += "\n";
  await writeBinary(sb, abs, Buffer.from(c, "utf8"));
  return `Wrote ${p} (${c.length} bytes) in the workspace copy of ${info.owner}/${info.name}. It is not on GitHub yet: call repo.push.`;
}

// ---------------- push ----------------
export async function runPush(uid: string, chatId: string, o: { branch?: string; message?: string; direct?: boolean }) {
  const info = await requireRepo(uid, chatId);
  const token = await githubTokenFor(uid, chatId);
  if (!token) throw new Error("GitHub is not connected for this chat. Open Connectors → GitHub and paste a token that can write to the repository (classic token with the repo scope, or a fine-grained token with Contents: Read and write).");
  const { sb } = await codeSandboxFor(uid, chatId);
  const root = wsRoot(chatId);

  const probe = await bash(sb, `cd ${q(root)} 2>/dev/null && [ -d .git ] || { echo RESULT=NOREPO; exit 0; }
echo RESULT=OK
echo CUR=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
echo ORIGIN=$(git remote get-url origin 2>/dev/null)`, 25_000);
  if (kv(probe.stdout, "RESULT") !== "OK") throw new Error("The workspace on the coding computer is empty. Clone the repository again (/clone owner/name).");
  const cur = kv(probe.stdout, "CUR") || "HEAD";
  const origin = parseRepo(kv(probe.stdout, "ORIGIN")) ?? { owner: info.owner, name: info.name };

  const wanted = (o.branch || "").trim();
  if (wanted && !validBranch(wanted)) throw new Error("That branch name is not valid.");
  const onDefault = cur === "main" || cur === "master";
  let target = wanted || (cur === "HEAD" ? `venus/changes-${stamp()}` : o.direct ? cur : onDefault ? `venus/changes-${stamp()}` : cur);
  if (!validBranch(target)) target = `venus/changes-${stamp()}`;
  const msg = (o.message || "Update from Venus Code").replace(/[\r\n]+/g, " ").slice(0, 120);
  const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");

  const script = `
export GIT_TERMINAL_PROMPT=0
export GHB64=${q(b64)}
cd ${q(root)}
git config user.name "Venus Code"
git config user.email "venus@users.noreply.github.com"
${target !== cur ? `git checkout -B ${q(target)} 2>&1 | tail -n 2` : ""}
git add -A
CHANGED=$(git diff --cached --name-only | wc -l)
if [ "$CHANGED" -gt 0 ]; then git commit -q -m ${q(msg)} 2>&1 | tail -n 2; fi
OUT=$(git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $GHB64" push -u origin ${q(target)} 2>&1)
CODE=$?
echo "CODE=$CODE"
echo "CHANGED=$CHANGED"
echo "COMMIT=$(git rev-parse --short HEAD)"
echo "@@OUT"
echo "$OUT" | tail -n 12
`;
  const r = await bash(sb, script, 56_000);
  const out = scrub(r.stdout, b64);
  const pushOut = (out.split("@@OUT\n")[1] ?? "").trim();
  if (kv(out, "CODE") !== "0") {
    const hint = /403|denied|permission|not authorized/i.test(pushOut) ? " Your GitHub token needs write access to this repository."
      : /rejected|non-fast-forward|fetch first/i.test(pushOut) ? " The remote branch has newer commits: push to a new branch instead (say \"push to branch my-changes\")." : "";
    throw new Error(`Push failed: ${pushOut.slice(-300) || "no output"}${hint}`);
  }
  const changed = Number(kv(out, "CHANGED")) || 0;
  const base = `https://github.com/${origin.owner}/${origin.name}`;
  const branchUrl = `${base}/tree/${encodeURI(target)}`;
  const isDefaultTarget = target === "main" || target === "master";
  return {
    ok: true as const, branch: target, commit: kv(out, "COMMIT"), changed, onDefault: isDefaultTarget, url: branchUrl,
    compareUrl: isDefaultTarget ? "" : `${base}/compare/${encodeURI(target)}?expand=1`,
    note: changed > 0 ? `Pushed ${changed} changed file(s) to branch ${target} of ${origin.owner}/${origin.name}.` : /up-to-date/i.test(pushOut) ? `Nothing new to push: branch ${target} is already up to date.` : `No file changes to commit; pushed branch ${target}.`,
  };
}
