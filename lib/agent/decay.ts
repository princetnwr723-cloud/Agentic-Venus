// Memory that fades. Every memory has a half-life by kind; each time it is recalled the strength goes up, so what the
// agent really uses stays, and what it never touches slowly drops out of the prompt and finally into the archive.
export type DecayKind = "fact" | "preference" | "lesson" | "role" | "profile" | "task";
export type DecayMem = { id: string; text: string; at: number; kind?: string; weight?: number; accessCount?: number; lastAccessedAt?: number; pinned?: boolean };

const DAY = 86_400_000;
export const HALF_LIFE_DAYS: Record<DecayKind, number> = { task: 3, preference: 90, lesson: 180, fact: 365, profile: 730, role: Infinity };
export const DORMANT_BELOW = 0.15;
export const ARCHIVE_BELOW = 0.05;

const kindOf = (m: DecayMem): DecayKind => (m.kind && m.kind in HALF_LIFE_DAYS ? (m.kind as DecayKind) : "fact");

/** weight x 0.5^(age/half-life) x (1 + log2(1 + uses)). Age counts from the last use, or from creation. */
export function computeStrength(m: DecayMem, now: number): number {
  const k = kindOf(m);
  if (m.pinned || k === "role") return 10;
  const base = Math.max(0.1, Number(m.weight) || 1);
  const ageDays = Math.max(0, now - (m.lastAccessedAt ?? m.at)) / DAY;
  const life = HALF_LIFE_DAYS[k];
  const decay = Math.pow(0.5, ageDays / life);
  return base * decay * (1 + Math.log2(1 + Math.max(0, m.accessCount ?? 0)));
}

export type Tier = "active" | "dormant" | "archived";
export const tierOf = (m: DecayMem, now: number): Tier => {
  const s = computeStrength(m, now);
  return s >= DORMANT_BELOW ? "active" : s >= ARCHIVE_BELOW ? "dormant" : "archived";
};

export function sweep<T extends DecayMem>(items: T[], now: number): { active: T[]; dormant: T[]; archived: T[] } {
  const out = { active: [] as T[], dormant: [] as T[], archived: [] as T[] };
  for (const m of items) out[tierOf(m, now)].push(m);
  return out;
}

/** Recall counts as use. */
export function touch<T extends DecayMem>(items: T[], ids: Set<string>, now: number): T[] {
  return items.map((m) => (ids.has(m.id) ? { ...m, accessCount: (m.accessCount ?? 0) + 1, lastAccessedAt: now } : m));
}

/** Ranking helper: relevance x strength. Dormant memories only come back when they match very well. */
export function recallScore(relevance: number, m: DecayMem, now: number): number {
  const s = computeStrength(m, now);
  return s < DORMANT_BELOW ? relevance * 0.3 : relevance * Math.min(1.5, 0.5 + s / 2);
}
