// Server-only. One E2B Desktop sandbox is shared by the whole account.
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

function loose(sandbox: DesktopSandbox) {
  return sandbox as unknown as {
    stream: {
      start: (opts?: Record<string, unknown>) => Promise<unknown>;
      getUrl: (opts?: Record<string, unknown>) => string;
    };
    commands: { run: (cmd: string, opts?: Record<string, unknown>) => Promise<unknown> };
  };
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
    await loose(sandbox).commands.run(cmd, { timeoutMs: 20_000 });
  } catch {
    // Not fatal.
  }
}

export async function createSandbox(apiKeyInput: string): Promise<string> {
  const apiKey = cleanKey(apiKeyInput);
  if (!apiKey) {
    throw new Error("The E2B API key is empty after trimming — re-save it in Settings.");
  }

  const { Sandbox } = await loadSdk();
  const base = { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS };

  let sandbox: DesktopSandbox;
  try {
    // Preferred: when the timer runs out the computer PAUSES (data kept)
    // instead of being killed. Older SDKs may not know these options, so
    // we fall back to a plain create below.
    sandbox = (await Sandbox.create({
      ...base,
      autoPause: true,
      lifecycle: { onTimeout: "pause", autoResume: true },
    } as never)) as unknown as DesktopSandbox;
  } catch {
    try {
      sandbox = (await Sandbox.create(base as never)) as unknown as DesktopSandbox;
    } catch (err) {
      throw new Error(describeError(err, "Could not create a computer."));
    }
  }

  await startProvisioningInBackground(sandbox);
  return (sandbox as unknown as { sandboxId: string }).sandboxId;
}

/** Turns the computer OFF without losing anything (files, apps, logins stay). */
export async function pauseSandbox(apiKeyInput: string, sandboxId: string): Promise<void> {
  const apiKey = cleanKey(apiKeyInput);
  const { Sandbox } = await loadSdk();
  const S = Sandbox as unknown as {
    betaPause?: (id: string, o?: Record<string, unknown>) => Promise<unknown>;
    pause?: (id: string, o?: Record<string, unknown>) => Promise<unknown>;
  };

  try {
    if (typeof S.betaPause === "function") {
      await S.betaPause(sandboxId, { apiKey });
      return;
    }
    if (typeof S.pause === "function") {
      await S.pause(sandboxId, { apiKey });
      return;
    }
    const sb = (await connect(apiKey, sandboxId)) as unknown as {
      betaPause?: () => Promise<unknown>;
      pause?: () => Promise<unknown>;
    };
    if (typeof sb.betaPause === "function") {
      await sb.betaPause();
      return;
    }
    if (typeof sb.pause === "function") {
      await sb.pause();
      return;
    }
  } catch (err) {
    const msg = describeError(err, "Could not pause the computer.");
    if (/already.*paus|paused/i.test(msg)) return; // already off
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
};

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
      await d.press(keys.includes("+") ? keys.split("+") : keys);
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
    default:
      throw new Error(`Unknown action type "${action.type}".`);
  }
}