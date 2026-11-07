// Pure helpers for the "local computer" relay. No imports on purpose: it is tested on its own.
// A local computer is a Linux virtual machine on the user's own PC. The server never talks to it directly:
// the desktop app asks the server for work (jobs) and posts the results back.

export const LOCAL_KEY_PREFIX = "venus-local:";
export const LOCAL_ID_PREFIX = "local-";
const DEVICE_RE = /^[a-f0-9]{32}$/;

export const MAX_CMD_BYTES = 4_000_000;
export const MAX_OUTPUT_CHARS = 200_000;
export const MAX_DATA_CHARS = 900_000; // a Firestore document is limited to 1 MB
export const MAX_PENDING = 40;
export const JOB_TTL_MS = 10 * 60_000;
export const ONLINE_MS = 30_000;

export const makeLocalKey = (deviceId: string) => LOCAL_KEY_PREFIX + deviceId;
export const sandboxIdOf = (deviceId: string) => LOCAL_ID_PREFIX + deviceId;

export function isDeviceId(v: unknown): v is string {
  return typeof v === "string" && DEVICE_RE.test(v);
}
export function isLocalKey(v: unknown): v is string {
  return typeof v === "string" && v.trim().startsWith(LOCAL_KEY_PREFIX) && isDeviceId(v.trim().slice(LOCAL_KEY_PREFIX.length));
}
export function isLocalSandboxId(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(LOCAL_ID_PREFIX) && isDeviceId(v.slice(LOCAL_ID_PREFIX.length));
}
export const deviceFromKey = (k: string) => k.trim().slice(LOCAL_KEY_PREFIX.length);
export const deviceFromSandboxId = (id: string) => id.slice(LOCAL_ID_PREFIX.length);

export const clip = (s: unknown, n: number) => {
  const t = typeof s === "string" ? s : "";
  return t.length > n ? t.slice(0, n) : t;
};

export const isOnline = (lastSeen: number | undefined, now = Date.now()) => Number(lastSeen) > 0 && now - Number(lastSeen) < ONLINE_MS;
export const isExpired = (createdAt: number | undefined, now = Date.now(), ttl = JOB_TTL_MS) => !createdAt || now - createdAt > ttl;

export type RelayOp = "exec" | "screenshot" | "input" | "vm";
export type RelayArgs = Record<string, unknown>;
type Checked = { ok: true; args: RelayArgs } | { ok: false; error: string };

const INPUT_TYPES = new Set(["click", "double_click", "right_click", "type", "key", "scroll"]);
const KEY_RE = /^[A-Za-z0-9_+\-]{1,60}$/;

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Every job is checked on the server before it is queued, and again by the desktop app before it runs. */
export function validateJob(op: unknown, raw: unknown): Checked {
  const a = (raw && typeof raw === "object" ? raw : {}) as RelayArgs;
  if (op === "exec") {
    const cmd = typeof a.cmd === "string" ? a.cmd : "";
    if (!cmd.trim()) return { ok: false, error: "Empty command." };
    if (Buffer.byteLength(cmd, "utf8") > MAX_CMD_BYTES) return { ok: false, error: "Command is too large." };
    return { ok: true, args: { cmd, timeoutMs: num(a.timeoutMs, 1_000, 300_000, 30_000) } };
  }
  if (op === "screenshot") return { ok: true, args: {} };
  if (op === "vm") {
    const action = a.action;
    if (action !== "start" && action !== "stop" && action !== "status") return { ok: false, error: "Unknown computer action." };
    return { ok: true, args: { action } };
  }
  if (op === "input") {
    const type = String(a.type ?? "");
    if (!INPUT_TYPES.has(type)) return { ok: false, error: "Unknown input type." };
    const args: RelayArgs = { type };
    if (type === "click" || type === "double_click" || type === "right_click") {
      args.x = num(a.x, 0, 10_000, 0);
      args.y = num(a.y, 0, 10_000, 0);
    } else if (type === "type") {
      args.text = clip(a.text, 4_000);
    } else if (type === "key") {
      const keys = String(a.keys ?? "");
      if (!keys.split("+").every((k) => KEY_RE.test(k))) return { ok: false, error: "Bad key name." };
      args.keys = keys;
    } else {
      args.direction = a.direction === "up" ? "up" : "down";
      args.amount = num(a.amount, 1, 50, 3);
    }
    return { ok: true, args };
  }
  return { ok: false, error: "Unknown job type." };
}

export type JobResult = { stdout: string; stderr: string; exitCode: number; data: string; error: string };

/** Whatever the desktop app sends back is cut down to a safe, small shape. */
export function normalizeResult(raw: unknown): JobResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const code = Math.round(Number(r.exitCode));
  return {
    stdout: clip(r.stdout, MAX_OUTPUT_CHARS),
    stderr: clip(r.stderr, MAX_OUTPUT_CHARS),
    exitCode: Number.isFinite(code) ? code : 0,
    data: clip(r.data, MAX_DATA_CHARS),
    error: clip(r.error, 500),
  };
}