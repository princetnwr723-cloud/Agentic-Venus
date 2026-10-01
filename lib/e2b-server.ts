// Server-only. One E2B Desktop sandbox per chat.
import type { Sandbox as SandboxClass } from "@e2b/desktop";

const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour; extended on every connect

type DesktopSandbox = InstanceType<typeof SandboxClass>;

/** Loads the SDK lazily so a broken package can never crash a route at import time. */
export async function loadSdk(): Promise<{ Sandbox: typeof SandboxClass }> {
  try {
    const mod = (await import("@e2b/desktop")) as unknown as {
      Sandbox?: typeof SandboxClass;
      default?: { Sandbox?: typeof SandboxClass };
    };
    const Sandbox = mod.Sandbox ?? mod.default?.Sandbox;
    if (!Sandbox) throw new Error("@e2b/desktop loaded but has no Sandbox export.");
    return { Sandbox };
  } catch (err) {
    const m = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new Error(`E2B SDK failed to load on the server → ${m}`);
  }
}

function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const issues = (err as { issues?: Array<{ path?: unknown[]; message?: string }> }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      return issues
        .map((iss) => {
          const field = Array.isArray(iss.path) && iss.path.length ? iss.path.join(".") : "input";
          return `${field}: ${iss.message ?? "invalid value"}`;
        })
        .join("; ");
    }
    const message = (err as { message?: string }).message;
    const name = (err as { name?: string }).name;
    if (message) return `${name ? name + ": " : ""}${message}`;
  }
  try {
    const raw = JSON.stringify(err);
    if (raw && raw !== "{}") return `${fallback} Raw error: ${raw}`;
  } catch {
    // ignore
  }
  return `${fallback} (${String(err)})`;
}

function cleanKey(apiKey: string): string {
  return apiKey.trim().replace(/^['"]|['"]$/g, "");
}

export const GONE_PREFIX = "SANDBOX_GONE";

/** connect() also RESUMES a paused sandbox and pushes the expiry 1h forward. */
async function connect(apiKey: string, sandboxId: string): Promise<DesktopSandbox> {
  const { Sandbox } = await loadSdk();
  try {
    return (await Sandbox.connect(sandboxId, {
      apiKey: cleanKey(apiKey),
      timeoutMs: SANDBOX_TIMEOUT_MS,
    } as never)) as unknown as DesktopSandbox;
  } catch (err) {
    const msg = describeError(err, "Could not reach the computer.");
    if (/not found|404|does not exist|expired|doesn't exist/i.test(msg)) {
      throw new Error(`${GONE_PREFIX}: this computer has expired or was deleted.`);
    }
    throw new Error(msg);
  }
}

type RunResult = { stdout?: string; stderr?: string; exitCode?: number };

function loose(sandbox: DesktopSandbox) {
  return sandbox as unknown as {
    stream: {
      start: (opts?: Record<string, unknown>) => Promise<unknown>;
      getUrl: (opts?: Record<string, unknown>) => string;
    };
    commands: { run: (cmd: string, opts?: Record<string, unknown>) => Promise<unknown> };
  };
}

/** Runs a shell command; a non-zero exit code is returned, not thrown. */
async function exec(
  sandbox: DesktopSandbox,
  cmd: string,
  timeoutMs = 30_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const r = (await loose(sandbox).commands.run(cmd, { timeoutMs })) as RunResult;
    return { stdout: r?.stdout ?? "", stderr: r?.stderr ?? "", exitCode: r?.exitCode ?? 0 };
  } catch (err) {
    const e = err as RunResult;
    if (e && typeof e.exitCode === "number") {
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.exitCode };
    }
    throw err;
  }
}

function pickString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "url" in value) {
    const u = (value as { url?: unknown }).url;
    if (typeof u === "string") return u;
  }
  return null;
}

/** Installs Chrome + VS Code inside the sandbox in the background; returns immediately. */
async function startProvisioningInBackground(sandbox: DesktopSandbox) {
  const cmd = `
cat > /tmp/provision.sh <<'EOF'
set -e
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
if ! command -v google-chrome >/dev/null 2>&1; then
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt-get install -y /tmp/chrome.deb || sudo apt-get -f install -y
fi
if ! command -v code >/dev/null 2>&1; then
  curl -fsSL -o /tmp/vscode.deb https://go.microsoft.com/fwlink/?LinkID=760868
  sudo apt-get install -y /tmp/vscode.deb || sudo apt-get -f install -y
fi
mkdir -p ~/Desktop ~/Documents ~/Downloads
echo provisioned
EOF
nohup bash /tmp/provision.sh > /tmp/provision.log 2>&1 < /dev/null &
echo started
`.trim();

  try {
    await exec(sandbox, cmd, 20_000);
  } catch {
    // Not fatal.
  }
}

export type PersistenceMode = "lifecycle" | "autoPause" | "none";

export async function createSandbox(
  apiKeyInput: string
): Promise<{ sandboxId: string; persistence: PersistenceMode }> {
  const apiKey = cleanKey(apiKeyInput);
  if (!apiKey) {
    throw new Error("The E2B API key is empty after trimming — re-save it in Settings.");
  }

  const { Sandbox } = await loadSdk();
  const base = { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS };

  // Best option first: when the timer runs out the computer PAUSES (all data
  // kept) instead of being killed. Older SDKs get the older option, and as a
  // last resort a plain computer (then the app pauses it itself before expiry).
  const attempts: Array<{ mode: PersistenceMode; opts: Record<string, unknown> }> = [
    { mode: "lifecycle", opts: { ...base, lifecycle: { onTimeout: "pause", autoResume: true } } },
    { mode: "autoPause", opts: { ...base, autoPause: true } },
    { mode: "none", opts: base },
  ];

  let sandbox: DesktopSandbox | undefined;
  let persistence: PersistenceMode = "none";
  let lastErr: unknown;
  for (const a of attempts) {
    try {
      sandbox = (await Sandbox.create(a.opts as never)) as unknown as DesktopSandbox;
      persistence = a.mode;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!sandbox) throw new Error(describeError(lastErr, "Could not create a computer."));

  await startProvisioningInBackground(sandbox);
  return { sandboxId: (sandbox as unknown as { sandboxId: string }).sandboxId, persistence };
}

/** Turns the computer OFF without losing anything (files, apps, logins stay). */
export async function pauseSandbox(apiKeyInput: string, sandboxId: string): Promise<void> {
  const apiKey = cleanKey(apiKeyInput);
  const { Sandbox } = await loadSdk();
  const S = Sandbox as unknown as {
    pause?: (id: string, o?: Record<string, unknown>) => Promise<unknown>;
    betaPause?: (id: string, o?: Record<string, unknown>) => Promise<unknown>;
  };

  try {
    if (typeof S.pause === "function") {
      await S.pause(sandboxId, { apiKey });
      return;
    }
    if (typeof S.betaPause === "function") {
      await S.betaPause(sandboxId, { apiKey });
      return;
    }
    const sb = (await connect(apiKey, sandboxId)) as unknown as {
      pause?: () => Promise<unknown>;
      betaPause?: () => Promise<unknown>;
    };
    if (typeof sb.pause === "function") {
      await sb.pause();
      return;
    }
    if (typeof sb.betaPause === "function") {
      await sb.betaPause();
      return;
    }
  } catch (err) {
    const msg = describeError(err, "Could not pause the computer.");
    if (/already.*paus|paused/i.test(msg)) return; // already off
    if (/not found|404|does not exist|expired/i.test(msg)) {
      throw new Error(`${GONE_PREFIX}: this computer has expired or was deleted.`);
    }
    throw new Error(msg);
  }
  throw new Error(
    "This version of the E2B SDK has no pause feature, so the computer was left running (nothing was deleted)."
  );
}

export async function deleteSandbox(apiKey: string, sandboxId: string): Promise<void> {
  try {
    const sandbox = await connect(apiKey, sandboxId);
    await (sandbox as unknown as { kill: () => Promise<void> }).kill();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith(GONE_PREFIX)) return; // already gone
    throw err;
  }
}

export async function getScreenUrl(apiKey: string, sandboxId: string): Promise<string> {
  const sandbox = await connect(apiKey, sandboxId);
  const s = loose(sandbox);

  try {
    await s.stream.start();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!/already|running/i.test(message)) throw err;
  }

  const url = pickString(s.stream.getUrl());
  if (!url) throw new Error("E2B didn't return a URL for the live screen.");
  return url;
}

export type Screenshot = { data: string; mediaType: string; width: number; height: number };

export async function takeScreenshot(apiKey: string, sandboxId: string): Promise<Screenshot> {
  const sandbox = await connect(apiKey, sandboxId);
  const bytes = await (
    sandbox as unknown as { screenshot: () => Promise<Uint8Array> }
  ).screenshot();

  const buf = Buffer.from(bytes);
  const isPng = buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG";
  return {
    data: buf.toString("base64"),
    mediaType: isPng ? "image/png" : "image/jpeg",
    width: isPng ? buf.readUInt32BE(16) : 1440,
    height: isPng ? buf.readUInt32BE(20) : 900,
  };
}

// ---- Shell jobs: run commands (even long installs) and read their output ----

export type ShellResult = {
  jobId: string;
  done: boolean;
  exitCode?: number;
  output: string;
};

function cleanOutput(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\r/g, "")
    .trim();
}

async function pollJob(sandbox: DesktopSandbox, jobId: string, maxMs: number): Promise<ShellResult> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const r = await exec(
      sandbox,
      `cat /tmp/jobs/${jobId}.exit 2>/dev/null; echo ---; tail -c 3500 /tmp/jobs/${jobId}.log 2>/dev/null`,
      10_000
    );
    const idx = r.stdout.indexOf("---\n");
    const exitStr = (idx >= 0 ? r.stdout.slice(0, idx) : "").trim();
    const log = cleanOutput(idx >= 0 ? r.stdout.slice(idx + 4) : r.stdout);
    const done = exitStr !== "";
    if (done || Date.now() >= deadline) {
      return { jobId, done, exitCode: done ? Number(exitStr) : undefined, output: log };
    }
    await new Promise((res) => setTimeout(res, 2500));
  }
}

/** Starts a command in the background and waits up to ~30s for it to finish. */
export async function shellStart(
  apiKey: string,
  sandboxId: string,
  command: string
): Promise<ShellResult> {
  const sandbox = await connect(apiKey, sandboxId);
  const jobId = "j" + Date.now().toString(36);
  const b64 = Buffer.from(command, "utf8").toString("base64");
  await exec(
    sandbox,
    `mkdir -p /tmp/jobs && echo ${b64} | base64 -d > /tmp/jobs/${jobId}.sh && (nohup bash -lc 'bash /tmp/jobs/${jobId}.sh > /tmp/jobs/${jobId}.log 2>&1; echo $? > /tmp/jobs/${jobId}.exit' > /dev/null 2>&1 &); echo started`,
    15_000
  );
  return pollJob(sandbox, jobId, 30_000);
}

export async function shellCheck(
  apiKey: string,
  sandboxId: string,
  jobId: string
): Promise<ShellResult> {
  if (!/^j[a-z0-9]+$/.test(jobId)) throw new Error("Invalid job id.");
  const sandbox = await connect(apiKey, sandboxId);
  return pollJob(sandbox, jobId, 30_000);
}

// ---- Screen actions ----

export type PcAction = {
  type: string;
  x?: number;
  y?: number;
  text?: string;
  keys?: string;
  direction?: string;
  amount?: number;
  seconds?: number;
  summary?: string;
  url?: string;
  query?: string;
  command?: string;
  job?: string;
};

const KEY_ALIASES: Record<string, string> = {
  enter: "Return",
  return: "Return",
  esc: "Escape",
  escape: "Escape",
  backspace: "BackSpace",
  delete: "Delete",
  del: "Delete",
  tab: "Tab",
  space: "space",
  control: "ctrl",
  ctrl: "ctrl",
  alt: "alt",
  shift: "shift",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  pageup: "Prior",
  pagedown: "Next",
  home: "Home",
  end: "End",
};

function normalizeKey(k: string): string {
  const t = k.trim();
  return KEY_ALIASES[t.toLowerCase()] ?? t;
}

function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("open_url needs a url.");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  if (!/^https?:\/\//i.test(withScheme)) {
    throw new Error("Only http(s) links can be opened.");
  }
  return withScheme;
}

/** Opens a link in the computer's default browser — far more reliable than clicking around. */
async function openUrl(sandbox: DesktopSandbox, url: string) {
  const d = sandbox as unknown as { open?: (target: string) => Promise<unknown> };
  try {
    if (typeof d.open === "function") {
      await d.open(url);
      return;
    }
  } catch {
    // fall through to the shell fallback
  }
  const safe = url.replace(/'/g, "%27");
  await exec(sandbox, `DISPLAY=:0 nohup xdg-open '${safe}' >/dev/null 2>&1 &`, 15_000);
}

export async function performAction(
  apiKey: string,
  sandboxId: string,
  action: PcAction
): Promise<string> {
  const sandbox = await connect(apiKey, sandboxId);
  const d = sandbox as unknown as {
    leftClick: (x: number, y: number) => Promise<void>;
    doubleClick: (x: number, y: number) => Promise<void>;
    rightClick: (x: number, y: number) => Promise<void>;
    write: (text: string) => Promise<void>;
    press: (key: string | string[]) => Promise<void>;
    scroll: (direction: "up" | "down", amount: number) => Promise<void>;
  };
  const x = Math.round(action.x ?? 0);
  const y = Math.round(action.y ?? 0);

  switch (action.type) {
    case "click":
      await d.leftClick(x, y);
      return `click (${x}, ${y})`;
    case "double_click":
      await d.doubleClick(x, y);
      return `double-click (${x}, ${y})`;
    case "right_click":
      await d.rightClick(x, y);
      return `right-click (${x}, ${y})`;
    case "type":
      await d.write(action.text ?? "");
      return `type "${(action.text ?? "").slice(0, 60)}"`;
    case "key": {
      const keys = action.keys ?? "";
      const parts = keys.includes("+") ? keys.split("+").map(normalizeKey) : normalizeKey(keys);
      await d.press(parts);
      return `press ${keys}`;
    }
    case "scroll": {
      const direction = action.direction === "up" ? "up" : "down";
      await d.scroll(direction, action.amount ?? 3);
      return `scroll ${direction}`;
    }
    case "wait": {
      const seconds = Math.min(Math.max(action.seconds ?? 2, 1), 5);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return `wait ${seconds}s`;
    }
    case "open_url": {
      const url = normalizeUrl(action.url ?? "");
      await openUrl(sandbox, url);
      await new Promise((r) => setTimeout(r, 4000));
      return `open ${url}`;
    }
    case "search": {
      const q = (action.query ?? "").trim();
      if (!q) throw new Error("search needs a query.");
      await openUrl(sandbox, `https://duckduckgo.com/?q=${encodeURIComponent(q)}`);
      await new Promise((r) => setTimeout(r, 4000));
      return `search "${q.slice(0, 80)}"`;
    }
    default:
      throw new Error(`Unknown action type "${action.type}".`);
  }
}