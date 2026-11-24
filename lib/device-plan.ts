// Server-only. The list of routine times the phone should wake up for. The phone never has to understand cron:
// it just arms one exact alarm per time in this list, and asks for a fresh list after every alarm.
import { getAdminDb } from "@/lib/firebase-admin";
import { effectiveSchedule, type Routine } from "@/lib/routines-core";
import { occurrences } from "@/lib/schedule";

export type PlanItem = { id: string; name: string; chatId: string; at: number };

const HOUR = 3600_000;
const PER_ROUTINE = 12;
const MAX_ITEMS = 60; // Android allows far more alarms, but 60 is plenty because the plan is refreshed after every alarm

export async function buildPlan(uid: string, now = Date.now(), horizonMs = 48 * HOUR): Promise<PlanItem[]> {
  const snap = await getAdminDb().collection("users").doc(uid).collection("routines").where("enabled", "==", true).get();
  const items: PlanItem[] = [];
  for (const d of snap.docs) {
    const r = { id: d.id, ...(d.data() as Omit<Routine, "id">) } as Routine;
    if (r.expiresAt && now > r.expiresAt) continue;
    if (r.maxRuns && (r.runCount ?? 0) >= r.maxRuns) continue;
    if ((r.leaseUntil ?? 0) > now) continue; // already running (the server or another phone has it)
    const eff = effectiveSchedule(r, now);
    // an overdue run is claimed right away; the ones after it follow the schedule
    const first = Math.max(Number(r.nextRunAt) || 0, now + 2_000);
    const times = [first, ...occurrences(eff, Math.max(Number(r.nextRunAt) || 0, now), PER_ROUTINE - 1)];
    const seen = new Set<number>();
    for (const at of times) {
      if (at > now + horizonMs || seen.has(at)) continue;
      seen.add(at);
      items.push({ id: r.id, name: String(r.name ?? "Routine").slice(0, 60), chatId: String(r.chatId ?? ""), at });
    }
  }
  return items.sort((a, b) => a.at - b.at).slice(0, MAX_ITEMS);
}
