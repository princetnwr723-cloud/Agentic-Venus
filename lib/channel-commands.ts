// Pure helpers for chat-app control (Telegram, WhatsApp, SMS, Slack): command parsing and PIN handling.
// No imports from the app on purpose, so it can be unit-tested directly with `node --test`.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type Cmd =
  | { kind: "help" }
  | { kind: "jobs" }
  | { kind: "status"; id?: string }
  | { kind: "stop"; id?: string }
  | { kind: "skip" }
  | { kind: "approve"; id: string; pin?: string }
  | { kind: "deny"; id: string }
  | { kind: "callback"; action: "ap" | "dn" | "an" | "sk"; value: string }
  | { kind: "text"; text: string };

const ID = "[A-Za-z0-9_-]{1,60}";

/**
 * Slash commands (/jobs /status /stop /skip /help) and `approve <id> [pin]` / `deny <id>` work the same in every chat app.
 * Telegram buttons send "@cb ap:<id>" style text, which the Telegram route builds itself.
 */
export function parseCommand(raw: string): Cmd {
  const t = String(raw ?? "").trim();
  const cb = new RegExp(`^@cb\\s+(ap|dn|an|sk)(?::(.{0,80}))?$`).exec(t);
  if (cb) return { kind: "callback", action: cb[1] as "ap" | "dn" | "an" | "sk", value: (cb[2] ?? "").trim() };
  const ap = new RegExp(`^/?approve(?:@\\w+)?\\s+(${ID})(?:\\s+(\\d{4,8}))?$`, "i").exec(t);
  if (ap) return { kind: "approve", id: ap[1], pin: ap[2] };
  const dn = new RegExp(`^/?(?:deny|decline|reject)(?:@\\w+)?\\s+(${ID})$`, "i").exec(t);
  if (dn) return { kind: "deny", id: dn[1] };
  const m = new RegExp(`^/(help|start|jobs|status|stop|skip)(?:@\\w+)?(?:\\s+(${ID}))?$`, "i").exec(t);
  if (m) {
    const c = m[1].toLowerCase();
    if (c === "help" || c === "start") return { kind: "help" };
    if (c === "jobs") return { kind: "jobs" };
    if (c === "skip") return { kind: "skip" };
    return c === "status" ? { kind: "status", id: m[2] } : { kind: "stop", id: m[2] };
  }
  return { kind: "text", text: t };
}

export const isPin = (s: string) => /^\d{4,8}$/.test(String(s ?? "").trim());

/** null = fine, otherwise why the PIN is not acceptable. */
export function pinProblem(pin: string): string | null {
  const p = String(pin ?? "").trim();
  if (!/^\d{4,8}$/.test(p)) return "PIN 4 se 8 digits ka hona chahiye.";
  if (/^(\d)\1+$/.test(p)) return "PIN me saare digits same nahi ho sakte (jaise 1111).";
  const seq = "01234567890123456789", rev = "98765432109876543210";
  if (seq.includes(p) || rev.includes(p)) return "PIN seedha sequence nahi ho sakta (jaise 1234).";
  return null;
}

/** `pepper` is a server-side secret mixed in, so a stolen salt+hash alone cannot be brute-forced offline. */
export function hashPin(pin: string, pepper = "", salt: string = randomBytes(16).toString("hex")): { salt: string; hash: string } {
  return { salt, hash: scryptSync(String(pin).trim(), salt + pepper, 32).toString("hex") };
}

export function verifyPin(pin: string, salt: string, hash: string, pepper = ""): boolean {
  try {
    const a = scryptSync(String(pin).trim(), salt + pepper, 32);
    const b = Buffer.from(hash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

export const MAX_PIN_FAILS = 5;
export const PIN_LOCK_MS = 30 * 60_000;

/** After MAX_PIN_FAILS wrong PINs in a row, payments from chat are locked for 30 minutes. */
export function lockAfterFail(fails: number, now = Date.now()): { fails: number; lockedUntil: number } {
  const n = fails + 1;
  return n >= MAX_PIN_FAILS ? { fails: 0, lockedUntil: now + PIN_LOCK_MS } : { fails: n, lockedUntil: 0 };
}

/** A question with options: "2", "approve" or "Approve" all pick the matching option. */
export function matchOption(text: string, options: string[]): string | null {
  const t = String(text ?? "").trim();
  if (!t || !options.length) return null;
  if (/^\d{1,2}$/.test(t)) { const i = Number(t) - 1; return options[i] ?? null; }
  const low = t.toLowerCase();
  return options.find((o) => o.toLowerCase() === low) ?? options.find((o) => o.toLowerCase().startsWith(low)) ?? null;
}