// Server-only helpers that talk to the Studio computer (an E2B sandbox).
import { connect, exec } from "@/lib/e2b-server";
import { TEMPLATE_FILES, TEMPLATE_VERSION } from "@/lib/venus-template";

export type Sb = Awaited<ReturnType<typeof connect>>;
export const DIR = "/home/user/venus";

export function safeId(s: unknown): string {
  const v = String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  if (!v) throw new Error("Missing id.");
  return v;
}

export async function writeFiles(sb: Sb, files: Record<string, string>) {
  const batches: string[] = [];
  let cur = "";
  for (const [path, content] of Object.entries(files)) {
    const b64 = Buffer.from(content, "utf8").toString("base64");
    const piece = `mkdir -p "$(dirname '${path}')" && echo ${b64} | base64 -d > '${path}'\n`;
    if (cur && cur.length + piece.length > 70_000) {
      batches.push(cur);
      cur = "";
    }
    cur += piece;
  }
  if (cur) batches.push(cur);
  for (const b of batches) {
    const r = await exec(sb, b, 30_000);
    if (r.exitCode !== 0) throw new Error("Files likhne mein dikkat: " + (r.stderr || r.stdout).slice(0, 300));
  }
}

export async function writeBinary(sb: Sb, path: string, bytes: Buffer) {
  const b64 = bytes.toString("base64");
  await exec(sb, `mkdir -p "$(dirname '${path}')" && : > '${path}.b64'`, 10_000);
  for (let i = 0; i < b64.length; i += 60_000) {
    await exec(sb, `echo ${b64.slice(i, i + 60_000)} >> '${path}.b64'`, 15_000);
  }
  const r = await exec(sb, `base64 -d '${path}.b64' > '${path}' && rm -f '${path}.b64'`, 15_000);
  if (r.exitCode !== 0) throw new Error("Audio file save nahi hui.");
}

export async function startJob(sb: Sb, jobId: string, script: string) {
  if (!/^[a-z0-9]+$/.test(jobId)) throw new Error("Bad job id.");
  const b64 = Buffer.from(script, "utf8").toString("base64");
  await exec(
    sb,
    `mkdir -p /tmp/jobs && rm -f /tmp/jobs/${jobId}.exit /tmp/jobs/${jobId}.log && echo ${b64} | base64 -d > /tmp/jobs/${jobId}.sh && (nohup bash -lc 'bash /tmp/jobs/${jobId}.sh > /tmp/jobs/${jobId}.log 2>&1; echo $? > /tmp/jobs/${jobId}.exit' >/dev/null 2>&1 &); echo ok`,
    15_000
  );
}

function tidy(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "\n").trim();
}

function parsePercent(log: string, total: number): number {
  let best = 0;
  for (const m of log.matchAll(/(\d+)\s*\/\s*(\d+)/g)) {
    if (Number(m[2]) === total) best = Math.max(best, Number(m[1]));
  }
  return total > 0 ? Math.min(1, best / total) : 0;
}

export async function jobStatus(sb: Sb, jobId: string, total = 0) {
  if (!/^[a-z0-9]+$/.test(jobId)) throw new Error("Bad job id.");
  const r = await exec(
    sb,
    `cat /tmp/jobs/${jobId}.exit 2>/dev/null; echo ---; tail -c 6000 /tmp/jobs/${jobId}.log 2>/dev/null`,
    10_000
  );
  const idx = r.stdout.indexOf("---\n");
  const exitStr = (idx >= 0 ? r.stdout.slice(0, idx) : "").trim();
  const log = tidy(idx >= 0 ? r.stdout.slice(idx + 4) : r.stdout);
  const done = exitStr !== "";
  return {
    done,
    exitCode: done ? Number(exitStr) : undefined,
    log: log.slice(-1800),
    percent: total ? parsePercent(log, total) : 0,
  };
}

const INSTALL_SCRIPT = `set -e
export DEBIAN_FRONTEND=noninteractive
cd ${DIR}
echo "== [1/5] Node.js"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v
echo "== [2/5] ffmpeg and system libraries"
sudo apt-get update -y || true
sudo apt-get install -y ffmpeg fonts-liberation fonts-noto-color-emoji
sudo apt-get install -y libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 || sudo apt-get install -y libnss3 libgbm1 libasound2t64 libatk-bridge2.0-0 libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 || true
echo "== [3/5] Remotion packages"
npm install --save-exact --no-audit --no-fund react@18.3.1 react-dom@18.3.1 remotion@^4 @remotion/cli@^4 @remotion/google-fonts@^4
echo "== [4/5] Headless Chrome"
npx remotion browser ensure
echo "== [5/5] Self-test render"
mkdir -p out
npx remotion still src/index.ts Main out/selftest.png --frame=20 --log=error
echo "STUDIO READY"
`;

export async function setupStudio(sb: Sb) {
  await exec(sb, `mkdir -p ${DIR}/src ${DIR}/out ${DIR}/work ${DIR}/public`, 15_000);
  const files: Record<string, string> = {};
  for (const [p, c] of Object.entries(TEMPLATE_FILES)) files[`${DIR}/${p}`] = c;
  files[`${DIR}/.template-version`] = TEMPLATE_VERSION;
  await writeFiles(sb, files);
  await startJob(sb, "install", INSTALL_SCRIPT);
}

export async function studioState(sb: Sb): Promise<{ state: "none" | "installing" | "ready" | "failed"; log: string }> {
  const r = await exec(
    sb,
    `cd ${DIR} 2>/dev/null || { echo none; exit 0; }
echo "v=$(cat .template-version 2>/dev/null)"
echo "e=$(cat /tmp/jobs/install.exit 2>/dev/null)"
[ -d node_modules/remotion ] && echo ok=1 || echo ok=0
echo ---
tail -c 1500 /tmp/jobs/install.log 2>/dev/null`,
    12_000
  );
  if (r.stdout.trim().startsWith("none")) return { state: "none", log: "" };
  const idx = r.stdout.indexOf("---\n");
  const head = idx >= 0 ? r.stdout.slice(0, idx) : r.stdout;
  const log = tidy(idx >= 0 ? r.stdout.slice(idx + 4) : "");
  const v = /v=(.*)/.exec(head)?.[1]?.trim() ?? "";
  const e = /e=(.*)/.exec(head)?.[1]?.trim() ?? "";
  const ok = /ok=(\d)/.exec(head)?.[1] === "1";
  if (v !== TEMPLATE_VERSION) return { state: "none", log };
  if (e === "") return { state: "installing", log };
  if (e === "0" && ok) return { state: "ready", log };
  return { state: "failed", log };
}