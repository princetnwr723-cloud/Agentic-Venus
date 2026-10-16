// Server-only helpers that talk to the Studio computer (an E2B sandbox).
import { connect, exec } from "@/lib/e2b-server";
import { TEMPLATE_FILES } from "@/lib/venus-template";
import { EXTRA_FILES, TEMPLATE_VERSION_FINAL } from "@/lib/venus-template-extra";
import { checkCode, type Storyboard } from "@/lib/venus-schema";

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
    if (r.exitCode !== 0) throw new Error("Could not write files: " + (r.stderr || r.stdout).slice(0, 300));
  }
}

export async function writeBinary(sb: Sb, path: string, bytes: Buffer) {
  const b64 = bytes.toString("base64");
  await exec(sb, `mkdir -p "$(dirname '${path}')" && : > '${path}.b64'`, 10_000);
  for (let i = 0; i < b64.length; i += 60_000) {
    await exec(sb, `echo ${b64.slice(i, i + 60_000)} >> '${path}.b64'`, 15_000);
  }
  const r = await exec(sb, `base64 -d '${path}.b64' > '${path}' && rm -f '${path}.b64'`, 15_000);
  if (r.exitCode !== 0) throw new Error("Could not save the audio file.");
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

const INSTALL_SCRIPT = `set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/.npm-global/bin"
cd ${DIR}

log() { printf '\n== %s ==\n' "$1"; }

log "1/6 Install system prerequisites"
if command -v sudo >/dev/null 2>&1; then SUDO=sudo; else SUDO=""; fi

# E2B/base-image startup may run apt-get in parallel. Never kill that process
# or delete apt lock files: wait for the package manager to release its locks.
wait_for_apt() {
  local attempt=0 max_attempts=36
  while [ "$attempt" -lt "$max_attempts" ]; do
    local busy=0
    if command -v fuser >/dev/null 2>&1; then
      fuser /var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock >/dev/null 2>&1 && busy=1 || true
    else
      pgrep -x apt-get >/dev/null 2>&1 && busy=1 || true
      pgrep -x dpkg >/dev/null 2>&1 && busy=1 || true
    fi
    if [ "$busy" -eq 0 ]; then return 0; fi
    attempt=$((attempt + 1))
    echo "Package manager is busy; waiting for its locks (\${attempt}/\${max_attempts})..."
    sleep 5
  done
  echo "ERROR: apt/dpkg locks remained busy for 180 seconds. No lock files were deleted and no package process was killed. Retry Studio setup after the other package operation finishes."
  return 1
}

apt_retry() {
  local attempt=1 max_attempts=4
  until wait_for_apt && $SUDO apt-get -o DPkg::Lock::Timeout=180 -o Acquire::Retries=3 "$@"; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "ERROR: apt-get failed after \${max_attempts} attempts: $*"
      return 1
    fi
    echo "apt-get attempt \${attempt} failed; waiting 10 seconds before retry..."
    sleep 10
    attempt=$((attempt + 1))
  done
}

apt_retry update -y
apt_retry install -y ca-certificates curl xz-utils ffmpeg fonts-liberation fonts-noto-color-emoji

log "2/6 Install a complete Node.js 20 runtime (includes npm and npx)"
# Ubuntu/Debian's nodejs package may be old and may not ship npm. Use the
# official Node.js binary distribution instead of relying on distro packaging.
NODE_BASE="https://nodejs.org/dist/latest-v20.x"
SUMS="$(curl -fsSL --retry 3 --connect-timeout 15 "$NODE_BASE/SHASUMS256.txt")"
NODE_ARCHIVE="$(printf '%s\n' "$SUMS" | awk '$2 ~ /^node-v20\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2; exit}')"
if [ -z "$NODE_ARCHIVE" ]; then
  echo "ERROR: Could not discover the official Node.js 20 Linux x64 archive."
  exit 1
fi
NODE_TMP="/tmp/$NODE_ARCHIVE"
curl -fL --retry 3 --connect-timeout 15 "$NODE_BASE/$NODE_ARCHIVE" -o "$NODE_TMP"
EXPECTED_SHA="$(printf '%s\n' "$SUMS" | awk -v f="$NODE_ARCHIVE" '$2 == f {print $1; exit}')"
ACTUAL_SHA="$(sha256sum "$NODE_TMP" | awk '{print $1}')"
if [ -z "$EXPECTED_SHA" ] || [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  echo "ERROR: Node.js archive checksum verification failed."
  exit 1
fi
$SUDO mkdir -p /opt/venus-node
$SUDO tar -xJf "$NODE_TMP" -C /opt/venus-node --strip-components=1
rm -f "$NODE_TMP"
export PATH="/opt/venus-node/bin:/usr/local/bin:$PATH"
$SUDO ln -sf /opt/venus-node/bin/node /usr/local/bin/node
$SUDO ln -sf /opt/venus-node/bin/npm /usr/local/bin/npm
$SUDO ln -sf /opt/venus-node/bin/npx /usr/local/bin/npx

command -v node
command -v npm
command -v npx
node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 18) process.exit(1); console.log("Node.js", process.version)'
npm --version
npx --version

log "3/6 Install browser runtime libraries"
$SUDO apt-get install -y libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 ||   $SUDO apt-get install -y libnss3 libgbm1 libasound2t64 libatk-bridge2.0-0 libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2

log "4/6 Install Remotion and React"
# Ensure npm is taken from the official runtime even in a non-login job shell.
export PATH="/opt/venus-node/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
npm install --no-audit --no-fund react@18.3.1 react-dom@18.3.1 'remotion@^4' '@remotion/cli@^4' '@remotion/google-fonts@^4'

log "5/6 Install Remotion's browser"
npx remotion browser ensure

log "6/6 Verify a real frame can render"
mkdir -p out
npx remotion still src/index.ts Main out/selftest.png --frame=20 --log=error
if [ ! -s out/selftest.png ]; then
  echo "ERROR: Remotion returned without creating out/selftest.png"
  exit 1
fi
file out/selftest.png || true
echo "STUDIO READY: Node, npm, Remotion browser and a test frame are verified."
`;

export async function setupStudio(sb: Sb) {
  await exec(sb, `mkdir -p ${DIR}/src/custom ${DIR}/out ${DIR}/work ${DIR}/public`, 15_000);
  const files: Record<string, string> = {};
  for (const [p, c] of Object.entries({ ...TEMPLATE_FILES, ...EXTRA_FILES })) files[`${DIR}/${p}`] = c;
  files[`${DIR}/.template-version`] = TEMPLATE_VERSION_FINAL;
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
  if (v !== TEMPLATE_VERSION_FINAL) return { state: "none", log };
  if (e === "") return { state: "installing", log };
  if (e === "0" && ok) return { state: "ready", log };
  return { state: "failed", log };
}

/**
 * Writes the storyboard and the AI-written scene files, checks them for syntax
 * errors, and builds the registry from the scenes that passed. Scenes that
 * failed are reported so the agent can repair them.
 */
export async function prepareProject(
  sb: Sb,
  pid: string,
  storyboard: Storyboard
): Promise<{ errors: Array<{ index: number; message: string }> }> {
  const dir = `${DIR}/src/custom`;
  await exec(
    sb,
    `mkdir -p ${dir} ${DIR}/work/${pid} ${DIR}/public/p/${pid}/img ${DIR}/public/p/${pid}/vo && rm -f ${dir}/${pid}_*.tsx`,
    15_000
  );

  const files: Record<string, string> = {};
  const errors: Array<{ index: number; message: string }> = [];
  const customs: Array<{ index: number; id: string; file: string }> = [];

  const slim = {
    ...storyboard,
    scenes: storyboard.scenes.map((s, i) => {
      if (s.type !== "custom") return s;
      const { code, ...rest } = s as Record<string, unknown>;
      if (typeof code === "string" && code) {
        const problem = checkCode(code);
        if (problem) {
          errors.push({ index: i, message: problem });
        } else {
          const file = `${dir}/${pid}_${String(s.id)}.tsx`;
          files[file] = code;
          customs.push({ index: i, id: String(s.id), file });
        }
      } else {
        errors.push({ index: i, message: "This AI scene has no code yet." });
      }
      return rest;
    }),
  };
  files[`${DIR}/work/${pid}/storyboard.json`] = JSON.stringify(slim);
  await writeFiles(sb, files);

  let good = customs;
  if (customs.length > 0) {
    const r = await exec(sb, `cd ${DIR} && node check.cjs ${customs.map((c) => `'${c.file}'`).join(" ")}`, 30_000);
    try {
      const out = JSON.parse(r.stdout.trim().split("\n").pop() || "{}") as { bad?: Array<{ file: string; message: string }> };
      const badFiles = new Map((out.bad ?? []).map((b) => [b.file, b.message]));
      for (const c of customs) {
        if (badFiles.has(c.file)) errors.push({ index: c.index, message: "Syntax error: " + badFiles.get(c.file) });
      }
      good = customs.filter((c) => !badFiles.has(c.file));
    } catch {
      // checker unavailable: the render itself will reveal problems
    }
  }

  const registry =
    good.map((c, i) => `import C${i} from "./${pid}_${c.id}";`).join("\n") +
    `\nexport const CUSTOM: any = {${good.map((c, i) => `"${c.id}": C${i}`).join(",")}};\n`;
  await writeFiles(sb, { [`${dir}/registry.ts`]: registry });

  return { errors };
}