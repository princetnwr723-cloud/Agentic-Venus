// SAVE AS: lib/daytona-server.ts
// Server-only. Wraps Daytona's official SDK. Each chat gets its own sandbox
// (a Linux desktop with a browser). "Computer use" starts Xvfb + XFCE +
// x11vnc + noVNC inside it; a *signed* preview URL for the noVNC port lets
// us embed the live screen in our own dashboard iframe with no auth header.
//
// Only the SDK surface that's confirmed in Daytona's docs is called with
// real types (Daytona, create, get, start, delete). Computer-use calls go
// through a loose cast so a small signature difference between SDK
// versions shows up as a readable runtime error, never a failed build.

import { Daytona } from "@daytona/sdk";

const NOVNC_PORT = 6080;
const SIGNED_URL_SECONDS = 6 * 60 * 60;

type PcSandbox = Awaited<ReturnType<Daytona["get"]>>;

function client(apiKey: string) {
  return new Daytona({ apiKey });
}

export async function createSandbox(apiKey: string): Promise<string> {
  const daytona = client(apiKey);
  // Stops itself after 30 idle minutes to protect the person's credits;
  // opening the screen again restarts it.
  const sandbox = await daytona.create({ autoStopInterval: 30 });
  return sandbox.id;
}

export async function deleteSandbox(apiKey: string, sandboxId: string): Promise<void> {
  const daytona = client(apiKey);
  try {
    const sandbox = await daytona.get(sandboxId);
    await daytona.delete(sandbox);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // Already gone (deleted from the Daytona dashboard) counts as success.
    if (/not found|404/i.test(message)) return;
    throw err;
  }
}

async function ensureStarted(daytona: Daytona, sandbox: PcSandbox) {
  if (String(sandbox.state) !== "started") {
    await daytona.start(sandbox, 60);
  }
}

function pickString(value: unknown, key: string): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const inner = (value as Record<string, unknown>)[key];
    if (typeof inner === "string") return inner;
  }
  return null;
}

type LooseSandbox = {
  computerUse: {
    start: () => Promise<unknown>;
    screenshot: { takeFullScreen: () => Promise<unknown> };
    mouse: {
      click: (x: number, y: number, button?: string, double?: boolean) => Promise<unknown>;
      scroll: (x: number, y: number, direction: string, amount?: number) => Promise<unknown>;
    };
    keyboard: {
      type: (text: string) => Promise<unknown>;
      press: (key: string) => Promise<unknown>;
      hotkey: (keys: string) => Promise<unknown>;
    };
  };
  getSignedPreviewUrl?: (port: number, expiresInSeconds?: number) => Promise<unknown>;
};

function loose(sandbox: PcSandbox): LooseSandbox {
  return sandbox as unknown as LooseSandbox;
}

/** Boots the desktop (if needed) and returns a URL that embeds the live screen. */
export async function getScreenUrl(apiKey: string, sandboxId: string): Promise<string> {
  const daytona = client(apiKey);
  const sandbox = await daytona.get(sandboxId);
  await ensureStarted(daytona, sandbox);

  const s = loose(sandbox);
  try {
    await s.computerUse.start();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // Starting an already-running desktop isn't a real failure.
    if (!/already|running/i.test(message)) throw err;
  }

  if (typeof s.getSignedPreviewUrl !== "function") {
    throw new Error(
      "This Daytona SDK version has no getSignedPreviewUrl — update @daytona/sdk."
    );
  }
  const signed = await s.getSignedPreviewUrl(NOVNC_PORT, SIGNED_URL_SECONDS);
  const raw = pickString(signed, "url");
  if (!raw) throw new Error("Daytona didn't return a preview URL for the desktop.");

  const url = new URL(raw);
  url.pathname = "/vnc.html";
  url.searchParams.set("autoconnect", "true");
  url.searchParams.set("resize", "scale");
  url.searchParams.set("reconnect", "true");
  return url.toString();
}

export type Screenshot = {
  data: string;
  mediaType: string;
  width: number;
  height: number;
};

export async function takeScreenshot(apiKey: string, sandboxId: string): Promise<Screenshot> {
  const sandbox = await client(apiKey).get(sandboxId);
  const shot = await loose(sandbox).computerUse.screenshot.takeFullScreen();
  const raw = pickString(shot, "screenshot");
  if (!raw) throw new Error("Couldn't capture the screen — is the desktop running?");

  const data = raw.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(data, "base64");
  const isPng = buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG";
  return {
    data,
    mediaType: isPng ? "image/png" : "image/jpeg",
    width: isPng ? buf.readUInt32BE(16) : 1280,
    height: isPng ? buf.readUInt32BE(20) : 720,
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

/** Runs one mouse/keyboard action; returns a short human-readable description. */
export async function performAction(
  apiKey: string,
  sandboxId: string,
  action: PcAction
): Promise<string> {
  const sandbox = await client(apiKey).get(sandboxId);
  const cu = loose(sandbox).computerUse;
  const x = Math.round(action.x ?? 0);
  const y = Math.round(action.y ?? 0);

  switch (action.type) {
    case "click":
      await cu.mouse.click(x, y);
      return `click (${x}, ${y})`;
    case "double_click":
      await cu.mouse.click(x, y, "left", true);
      return `double-click (${x}, ${y})`;
    case "right_click":
      await cu.mouse.click(x, y, "right");
      return `right-click (${x}, ${y})`;
    case "type":
      await cu.keyboard.type(action.text ?? "");
      return `type “${(action.text ?? "").slice(0, 60)}”`;
    case "key": {
      const keys = action.keys ?? "";
      if (keys.includes("+")) await cu.keyboard.hotkey(keys);
      else await cu.keyboard.press(keys);
      return `press ${keys}`;
    }
    case "scroll": {
      const direction = action.direction === "up" ? "up" : "down";
      await cu.mouse.scroll(x, y, direction, action.amount ?? 3);
      return `scroll ${direction}`;
    }
    case "wait": {
      const seconds = Math.min(Math.max(action.seconds ?? 2, 1), 5);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return `wait ${seconds}s`;
    }
    default:
      throw new Error(`Unknown action type “${action.type}”.`);
  }
}