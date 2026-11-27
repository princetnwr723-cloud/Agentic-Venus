// Pure rules (no imports on purpose: tested on its own) for choosing the computer of a SERVER-side job.
// "local" = the user's own phone / PC (desktop app or Android app), "cloud" = their E2B computer.

export type PcPref = "auto" | "local" | "cloud";
export type Dev = { id: string; lastSeen: number };
export type Verdict = "local" | "cloud" | "wait" | "none";

/** A device that asked for work this recently is online (its poll lasts about 20 seconds). */
export const FRESH_MS = 90_000;
/** Seen in the last 10 minutes but not just now: it is probably waking up (an alarm, the app opening), so a short wait is worth it. */
export const RECENT_MS = 10 * 60_000;
export const WAIT_MS = 10_000;

export const normPref = (v: unknown): PcPref => (v === "local" || v === "cloud" ? v : "auto");

export const isFresh = (lastSeen: number, now: number) => lastSeen > 0 && now - lastSeen < FRESH_MS;
export const worthWaiting = (lastSeen: number, now: number) => lastSeen > 0 && now - lastSeen >= FRESH_MS && now - lastSeen < RECENT_MS;

/** The device the owner chose, otherwise the one that was seen last. */
export function pickDevice<T extends Dev>(devs: T[], preferredId?: unknown): T | null {
  if (!devs.length) return null;
  const want = typeof preferredId === "string" ? devs.find((d) => d.id === preferredId) : undefined;
  return want ?? [...devs].sort((a, b) => b.lastSeen - a.lastSeen)[0];
}

/**
 * auto  = the own computer when it is online, otherwise the cloud one (when there is one)
 * local = always the own computer (an offline PC gives a clear "PC offline" message instead of a silent switch)
 * cloud = always the E2B computer (when a key exists)
 */
export function decide(i: { pref: PcPref; hasCloud: boolean; dev: Dev | null; now: number; waited?: boolean }): Verdict {
  if (i.pref === "cloud" && i.hasCloud) return "cloud";
  if (!i.dev) return i.hasCloud ? "cloud" : "none";
  if (isFresh(i.dev.lastSeen, i.now)) return "local";
  if (!i.waited && worthWaiting(i.dev.lastSeen, i.now)) return "wait";
  if (i.pref === "local" || !i.hasCloud) return "local";
  return "cloud";
}