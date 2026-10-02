// Server-only. Executes Venus Code tools inside the Code computer (an E2B sandbox).
import { connect, exec, openUrl } from "@/lib/e2b-server";
import { startJob, writeBinary } from "@/lib/venus-server";
import type { ToolCall } from "@/lib/code-prompts";

export type Sb = Awaited<ReturnType<typeof connect>>;
export const ROOT = "/home/user/work";
export const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function wsRoot(ws: string): string {
  const id = ws.replace(/[^A-Za-z0-9_-]/g, "");
  if (!id) throw new Error("Bad workspace id.");
  return `${ROOT}/${id}`;
}

export function resolvePath(ws: string, p: string): string {
  const root = wsRoot(ws);
  let rel = String(p ?? "").trim();
  if (rel.startsWith(root + "/")) rel = rel.slice(root.length + 1);
  else if (rel === root) rel = ".";
  rel = rel.replace(/^\/+/, "");
  const parts = rel.split("/").filter((x) => x && x !== ".");
  if (parts.some((x) => x === "..")) throw new Error("Paths may not contain '..'.");
  if (parts[0] === ".git") throw new Error("The .git directory is off limits.");
  return parts.length ? `${root}/${parts.join("/")}` : root;
}

export type ToolResult = { text: string; mutated?: boolean; image?: { mediaType: string; data: string }; preview?: string };

const CODE_VERSION = "1";
export const CODE_SETUP_SCRIPT = `set -e
export DEBIAN_FRONTEND=noninteractive
echo 'DPkg::Lock::Timeout "900";' | sudo tee /etc/apt/apt.conf.d/99locktimeout >/dev/null
echo "== [1/3] system packages"
sudo apt-get update -y || true
sudo apt-get install -y git ripgrep zip unzip jq build-essential python3-pip curl ca-certificates
echo "== [2/3] Node.js"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v
echo "== [3/3] tooling"
mkdir -p "$HOME/.npm-global" /home/user/work
npm config set prefix "$HOME/.npm-global"
grep -q npm-global ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
sudo corepack enable >/dev/null 2>&1 || true
echo ${CODE_VERSION} > /home/user/.code-version
touch /home/user/.code-ready
echo "CODE COMPUTER READY"
`;

export async function codeState(sb: Sb): Promise<{ state: "none" | "installing" | "ready" | "failed"; log: string }> {
  const r = await exec(
    sb,
    `echo "v=$(cat /home/user/.code-version 2>/dev/null)"; echo "e=$(cat /tmp/jobs/codesetup.exit 2>/dev/null)"; [ -f /home/user/.code-ready ] && echo ok=1 || echo ok=0; [ -f /tmp/jobs/codesetup.log ] && echo started=1 || echo started=0; echo ---; tail -c 1200 /tmp/jobs/codesetup.log 2>/dev/null`,
    12_000
  );
  const idx = r.stdout.indexOf("---\n");
  const head = idx >= 0 ? r.stdout.slice(0, idx) : r.stdout;
  const log = (idx >= 0 ? r.stdout.slice(idx + 4) : "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim();
  const v = /v=(.*)/.exec(head)?.[1]?.trim() ?? "";
  const e = /e=(.*)/.exec(head)?.[1]?.trim() ?? "";
  const ok = /ok=(\d)/.exec(head)?.[1] === "1";
  const started = /started=(\d)/.exec(head)?.[1] === "1";
  if (ok && v === CODE_VERSION) return { state: "ready", log };
  if (!started) return { state: "none", log };
  if (e === "") return { state: "installing", log };
  return { state: "failed", log };
}

export async function startCodeSetup(sb: Sb) {
  await startJob(sb, "codesetup", CODE_SETUP_SCRIPT);
}

const VENUS_MD = `# Project memory (VENUS.md)
Notes for the coding agent — keep this short and accurate.

## Overview
(not set yet)

## Commands
(install / dev / build / test)

## Conventions & decisions
`;

export async function checkpoint(sb: Sb, ws: string, msg: string): Promise<string | null> {
  const root = wsRoot(ws);
  const r = await exec(
    sb,
    `cd ${q(root)} && git add -A >/dev/null 2>&1; if git diff --cached --quiet; then echo NOCHANGE; else git -c user.name=Venus -c user.email=venus@local commit -qm ${q(msg.slice(0, 100))} >/dev/null 2>&1; git rev-parse --short HEAD; fi`,
    25_000
  );
  const out = r.stdout.trim();
  return out && out !== "NOCHANGE" ? out : null;
}

export async function listTree(sb: Sb, ws: string, max = 1000): Promise<string[]> {
  const r = await exec(sb, `cd ${q(wsRoot(ws))} 2>/dev/null && git ls-files -co --exclude-standard | head -${max}`, 15_000);
  return r.stdout.split("\n").filter(Boolean);
}

export async function ensureWorkspace(sb: Sb, ws: string, restoreUrl?: string): Promise<{ venusMd: string; tree: string; restored: boolean }> {
  const root = wsRoot(ws);
  const has = await exec(sb, `test -d ${q(root + "/.git")} && echo yes || echo no`, 10_000);
  let restored = false;
  if (!has.stdout.includes("yes") && restoreUrl) {
    const r = await exec(sb, `mkdir -p ${ROOT} && curl -fsSL --max-time 50 -o /tmp/restore.zip ${q(restoreUrl)} && unzip -qo /tmp/restore.zip -d ${ROOT} && echo ok`, 58_000);
    restored = r.stdout.includes("ok");
  }
  const again = await exec(sb, `test -d ${q(root + "/.git")} && echo yes || echo no`, 10_000);
  if (!again.stdout.includes("yes")) {
    await exec(sb, `mkdir -p ${q(root)} && cd ${q(root)} && git init -q && printf 'node_modules\\n.next\\ndist\\nbuild\\n.env\\n.env.local\\n*.log\\n.DS_Store\\n' > .gitignore`, 20_000);
    await writeBinary(sb, `${root}/VENUS.md`, Buffer.from(VENUS_MD));
    await checkpoint(sb, ws, "Initial workspace");
  }
  const md = await exec(sb, `head -c 6000 ${q(root + "/VENUS.md")} 2>/dev/null`, 10_000);
  const tree = (await listTree(sb, ws, 200)).join("\n");
  return { venusMd: md.stdout || "(no VENUS.md yet)", tree: tree || "(empty workspace)", restored };
}

function globToRegex(g: string): RegExp {
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") { re += g[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += g[i + 2] === "/" ? 2 : 1; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

async function readJob(sb: Sb, id: string, tail = 8000) {
  const r = await exec(sb, `cat /tmp/jobs/${id}.exit 2>/dev/null; echo ---; tail -c ${tail} /tmp/jobs/${id}.log 2>/dev/null`, 10_000);
  const idx = r.stdout.indexOf("---\n");
  const exitStr = (idx >= 0 ? r.stdout.slice(0, idx) : "").trim();
  const log = (idx >= 0 ? r.stdout.slice(idx + 4) : r.stdout).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").trim();
  return { done: exitStr !== "", exitCode: exitStr !== "" ? Number(exitStr) : undefined, log };
}

export async function runTool(sb: Sb, ws: string, call: ToolCall, budgetMs: number): Promise<ToolResult> {
  const root = wsRoot(ws);
  const a = call.attrs;
  switch (call.name) {
    case "read": {
      const abs = resolvePath(ws, a.path);
      const off = Math.max(1, parseInt(a.offset || "1", 10) || 1);
      const lim = Math.min(2000, Math.max(1, parseInt(a.limit || "400", 10) || 400));
      const r = await exec(sb, `test -f ${q(abs)} || { echo NOFILE; exit 3; }; wc -c < ${q(abs)}; awk -v s=${off} -v e=${off + lim - 1} 'NR>=s && NR<=e {printf "%6d\\t%s\\n", NR, $0}' ${q(abs)}`, 15_000);
      if (r.stdout.startsWith("NOFILE")) return { text: `ERROR: file not found: ${a.path}` };
      const nl = r.stdout.indexOf("\n");
      const size = Number(r.stdout.slice(0, nl));
      if (size > 1_500_000) return { text: `ERROR: ${a.path} is ${size} bytes — too large to read; use grep or offset/limit.` };
      const body = r.stdout.slice(nl + 1);
      return { text: `${a.path} (${size} bytes, lines ${off}-${off + lim - 1})\n${body.slice(0, 24_000)}${body.length > 24_000 ? "\n… (truncated; use offset/limit)" : ""}` };
    }
    case "ls": {
      const abs = resolvePath(ws, a.path || ".");
      const r = await exec(sb, `test -d ${q(abs)} || { echo NODIR; exit 3; }; ls -1Ap ${q(abs)} | head -300`, 10_000);
      return { text: r.stdout.startsWith("NODIR") ? `ERROR: not a directory: ${a.path}` : r.stdout || "(empty)" };
    }
    case "glob": {
      const re = globToRegex(a.pattern || "**/*");
      const r = await exec(sb, `cd ${q(root)} && find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './.next/*' -not -path './dist/*' | sed 's|^\\./||' | head -6000`, 20_000);
      const hits = r.stdout.split("\n").filter((f) => f && re.test(f)).sort().slice(0, 200);
      return { text: hits.length ? hits.join("\n") : "(no matches)" };
    }
    case "grep": {
      const p64 = Buffer.from(a.pattern ?? "", "utf8").toString("base64");
      const target = a.path ? q(resolvePath(ws, a.path)) : ".";
      const g = a.glob ? `-g ${q(a.glob)}` : "";
      const inc = a.glob ? `--include=${q(a.glob)}` : "";
      const r = await exec(sb, `cd ${q(root)} && P=$(echo ${p64} | base64 -d); if command -v rg >/dev/null 2>&1; then rg -n --no-heading -S --max-columns 200 ${g} -e "$P" ${target} 2>&1 | head -200; else grep -rnE --exclude-dir=node_modules --exclude-dir=.git ${inc} -e "$P" ${target} 2>&1 | head -200; fi`, 25_000);
      return { text: r.stdout.trim() || "(no matches)" };
    }
    case "write": {
      const abs = resolvePath(ws, a.path);
      let c = call.body;
      if (c.startsWith("\n")) c = c.slice(1);
      if (c.endsWith("\n")) c = c.slice(0, -1);
      c += "\n";
      if (c.length > 800_000) return { text: "ERROR: file too large." };
      await writeBinary(sb, abs, Buffer.from(c, "utf8"));
      return { text: `Wrote ${a.path} (${c.split("\n").length - 1} lines, ${c.length} bytes).`, mutated: true };
    }
    case "edit": {
      const abs = resolvePath(ws, a.path);
      const oldS = call.old ?? "";
      const newS = call.new ?? "";
      if (!oldS) return { text: "ERROR: <old> is empty." };
      const cur = await exec(sb, `test -f ${q(abs)} && cat ${q(abs)}`, 20_000);
      if (cur.exitCode !== 0) return { text: `ERROR: file not found: ${a.path}` };
      const count = cur.stdout.split(oldS).length - 1;
      if (count === 0) return { text: `ERROR: the <old> text was not found in ${a.path}. Read the file again and copy the exact text (including whitespace).` };
      const all = a.replace_all === "true";
      if (count > 1 && !all) return { text: `ERROR: the <old> text appears ${count} times in ${a.path}. Add more surrounding lines to make it unique, or set replace_all="true".` };
      const next = all ? cur.stdout.split(oldS).join(newS) : cur.stdout.replace(oldS, () => newS);
      await writeBinary(sb, abs, Buffer.from(next, "utf8"));
      const o = oldS.split("\n");
      const n = newS.split("\n");
      return { text: `Edited ${a.path} (${count} replacement${count > 1 ? "s" : ""}: −${o.length} +${n.length} lines).`, mutated: true };
    }
    case "bash": {
      const command = call.body.trim();
      if (!command) return { text: "ERROR: empty command." };
      const bg = a.background === "true";
      const wait = bg ? 4000 : Math.min(Math.max(5, parseInt(a.timeout || "30", 10) || 30) * 1000, Math.max(5000, budgetMs - 4000), 40_000);
      const jobId = "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
      await startJob(sb, jobId, `cd ${q(root)}\nexport PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"\nexport CI=1 DEBIAN_FRONTEND=noninteractive\n${command}\n`);
      const deadline = Date.now() + wait;
      for (;;) {
        await sleep(1200);
        const s = await readJob(sb, jobId);
        if (s.done) return { text: `exit code: ${s.exitCode}\n${s.log.slice(-8000)}`, mutated: true };
        if (Date.now() >= deadline) return { text: `STILL RUNNING (job ${jobId}) — read more with <bash_output job="${jobId}"/>.\n${s.log.slice(-4000)}`, mutated: true };
      }
    }
    case "bash_output": {
      const id = (a.job ?? "").replace(/[^a-z0-9]/g, "");
      if (!id) return { text: "ERROR: job id missing." };
      const s = await readJob(sb, id);
      return { text: `${s.done ? `exit code: ${s.exitCode}` : "STILL RUNNING"}\n${s.log.slice(-8000)}` };
    }
    case "preview": {
      const port = parseInt(a.port || "3000", 10);
      const host = (sb as unknown as { getHost?: (p: number) => string }).getHost?.(port);
      const c = await exec(sb, `curl -s -o /dev/null -m 5 -w '%{http_code}' http://localhost:${port}`, 10_000);
      const code = c.stdout.trim();
      if (!host) return { text: "ERROR: this E2B SDK cannot create preview URLs." };
      return { text: `Preview URL: https://${host}\nlocalhost:${port} answers HTTP ${code || "no response"}${code === "000" || !code ? " — the server is not running or not bound to 0.0.0.0." : ""}`, preview: `https://${host}` };
    }
    case "screenshot": {
      if (a.url) {
        await openUrl(sb, a.url);
        await sleep(4500);
      }
      const bytes = await (sb as unknown as { screenshot: () => Promise<Uint8Array> }).screenshot();
      const buf = Buffer.from(bytes);
      const isPng = buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG";
      return { text: "Screenshot attached (look at it).", image: { mediaType: isPng ? "image/png" : "image/jpeg", data: buf.toString("base64") } };
    }
    default:
      return { text: `ERROR: unknown tool ${call.name}` };
  }
}