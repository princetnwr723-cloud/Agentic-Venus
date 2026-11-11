// Browser/Cloud PC takeover handshake. The agent asks, the owner takes the screen, the agent is paused, the owner hands back.
// Safety rules: a takeover never lasts longer than 15 minutes, and if the owner's page stops sending a heartbeat
// (tab closed) the screen is handed back automatically after 90 seconds.
export const TAKEOVER_CAP_MS = 15 * 60_000;
export const TAKEOVER_UNWATCHED_MS = 90_000;
export const TAKEOVER_BEAT_MS = 20_000;

export type Takeover = {
  status: "requested" | "active" | "handed_back" | "expired" | "declined";
  requestedAt: number;
  startedAt?: number;
  lastBeat?: number;
  endedAt?: number;
  endReason?: "owner" | "time_cap" | "unwatched" | "declined";
};

export const requestTakeover = (now: number): Takeover => ({ status: "requested", requestedAt: now });

export function startTakeover(t: Takeover | undefined, now: number): Takeover {
  if (!t || t.status !== "requested") throw new Error("There is no takeover waiting to be started.");
  return { ...t, status: "active", startedAt: now, lastBeat: now };
}

export function beat(t: Takeover, now: number): Takeover {
  return t.status === "active" ? { ...t, lastBeat: now } : t;
}

/** Is an active takeover over? Returns the reason, or null while it can go on. */
export function endedBecause(t: Takeover | undefined, now: number): "time_cap" | "unwatched" | null {
  if (!t || t.status !== "active") return null;
  if (now - (t.startedAt ?? now) >= TAKEOVER_CAP_MS) return "time_cap";
  if (now - (t.lastBeat ?? t.startedAt ?? now) >= TAKEOVER_UNWATCHED_MS) return "unwatched";
  return null;
}

export function handBack(t: Takeover, now: number, reason: "owner" | "time_cap" | "unwatched" = "owner"): Takeover {
  return { ...t, status: reason === "owner" ? "handed_back" : "expired", endedAt: now, endReason: reason };
}

export function decline(t: Takeover | undefined, now: number): Takeover {
  return { ...(t ?? { requestedAt: now }), status: "declined", endedAt: now, endReason: "declined" } as Takeover;
}

export const takeoverSeconds = (t: Takeover): number => Math.max(0, Math.round(((t.endedAt ?? Date.now()) - (t.startedAt ?? t.requestedAt)) / 1000));

/** When the scheduler has to look at this takeover again. */
export function nextCheck(t: Takeover): number {
  if (t.status !== "active") return Number.MAX_SAFE_INTEGER;
  return Math.min((t.startedAt ?? 0) + TAKEOVER_CAP_MS, (t.lastBeat ?? t.startedAt ?? 0) + TAKEOVER_UNWATCHED_MS);
}

export const END_TEXT: Record<"time_cap" | "unwatched", string> = {
  time_cap: "the 15 minute limit was reached",
  unwatched: "the owner's page stopped responding",
};
