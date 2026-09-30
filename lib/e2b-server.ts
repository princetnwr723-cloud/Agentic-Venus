// SAVE AS: lib/e2b-server.ts
// Server-only. One E2B Desktop sandbox is shared by the whole account (every
// chat controls the same computer, like Grok Bot's shared-computer model).
//
// Resilience: every function below reconnects with Sandbox.connect(id)
// instead of holding a live object across requests. E2B auto-resumes a
// paused sandbox on the next connect when the sandbox was created with
// autoPause: true — so if the computer times out mid-task, the very next
// step (screenshot or action) transparently wakes it back up and the task
// continues from the same screen, same open apps, same logins. No special
// "resume" call is needed from the caller.
//
// A handful of calls (stream URL, resource sizing at create time) aren't
// pinned down to one exact method signature across SDK versions, so they go
// through a loose cast — a mismatch surfaces as a clear runtime error
// instead of failing the whole Vercel build.

import { Sandbox } from "@e2b/desktop";

const TEMPLATE = process.env.E2B_TEMPLATE || "desktop";
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // Hobby's own ~1h ceiling; pauses (not kills) at this point.

type DesktopSandbox = InstanceType<typeof Sandbox>;

async function connect(apiKey: string, sandboxId: string): Promise<DesktopSandbox> {
  // Sandbox.connect resumes a paused sandbox automatically — this one call
  // covers both "still running" and "was paused, wake it up".
  return Sandbox.connect(sandboxId, { apiKey } as never) as unknown as Promise<DesktopSandbox>;
}

function loose(sandbox: DesktopSandbox) {
  return sandbox as unknown as {
    stream: {
      start: (opts?: Record<string, unknown>) => Promise<unknown>;
      getUrl: (opts?: Record<string, unknown>) => string | Promise<string>;
      isRunning?: () => Promise<boolean>;
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

/** One-time setup on a freshly created sandbox: Google Chrome + VS Code. */
async function provision(sandbox: DesktopSandbox) {
  const script = `
set -e
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y

# Google Chrome
if ! command -v google-chrome >/dev/null 2>&1; then
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt-get install -y /tmp/chrome.deb || sudo apt-get -f install -y
fi

# VS Code
if ! command -v code >/dev/null 2>&1; then
  curl -fsSL -o /tmp/vscode.deb https://go.microsoft.com/fwlink/?LinkID=760868
  sudo apt-get install -y /tmp/vscode.deb || sudo apt-get -f install -y
fi

mkdir -p ~/Desktop ~/Documents ~/Downloads
echo provisioned
`.trim();

  await loose(sandbox).commands.run(script, { timeoutMs: 10 * 60_000 });
}

/**
 * Returns the account's shared sandbox id, creating (and provisioning) one
 * if it doesn't exist yet. Callers persist the returned id on the user's
 * Firestore doc themselves (lib/keys-context.tsx).
 */
export async function createSandbox(apiKey: string): Promise<string> {
  const sandbox = await Sandbox.create(TEMPLATE, {
    apiKey,
    timeoutMs: IDLE_TIMEOUT_MS,
    // Best-effort resource hint — ignored harmlessly if this SDK version
    // only honors specs baked into a custom template. See README → Computer.
    resolution: [1440, 900],
    ...( { autoPause: true } as Record<string, unknown> ),
  } as never);

  try {
    await provision(sandbox as unknown as DesktopSandbox);
  } catch {
    // Provisioning failing shouldn't strand the person without a computer at
    // all — Chrome/VS Code can be installed by hand from the desktop later.
  }

  return (sandbox as unknown as { sandboxId: string }).sandboxId;
}

export async function deleteSandbox(apiKey: string, sandboxId: string): Promise<void> {
  try {
    const sandbox = await connect(apiKey, sandboxId);
    await (sandbox as unknown as { kill: () => Promise<void> }).kill();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/not found|404/i.test(message)) return; // already gone
    throw err;
  }
}

/** Starts the live stream (if needed) and returns an embeddable URL. */
export async function getScreenUrl(apiKey: string, sandboxId: string): Promise<string> {
  const sandbox = await connect(apiKey, sandboxId);
  const s = loose(sandbox);

  try {
    await s.stream.start();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!/already|running/i.test(message)) throw err;
  }

  const raw = await s.stream.getUrl();
  const url = pickString(raw);
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