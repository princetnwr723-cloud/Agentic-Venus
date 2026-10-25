import { NextResponse } from "next/server";
import { DEFAULT_MINE, gaps, gateReasons, judge, mine, summarize, type MineOpts } from "@/lib/fount/core";
import { LABELS } from "@/lib/fount/seed";
import * as S from "@/lib/fount/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// Called every night by .github/workflows/fount-mine.yml with the same secret as the other ticks.
// 1) mines new "learned" playbooks from verified runs, 2) lets canary playbooks go live or pause from their real results,
// 3) deletes episodes older than the retention period.
/** Gates can be loosened a little while the app is small (never below 2 different users), see FOUNT.md. */
function gates(): MineOpts {
  const num = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && v ? Math.max(min, Math.min(max, Math.round(n))) : d;
  };
  return { ...DEFAULT_MINE, minGold: num(process.env.FOUNT_MIN_RUNS, DEFAULT_MINE.minGold, 3, 50), minUsers: num(process.env.FOUNT_MIN_USERS, DEFAULT_MINE.minUsers, 2, 20) };
}

export async function POST(req: Request) {
  const secret = process.env.ROUTINE_RUNNER_SECRET;
  if (!secret) return NextResponse.json({ error: "ROUTINE_RUNNER_SECRET is not set." }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!S.enabled()) return NextResponse.json({ skipped: "FOUNT_ENABLED is not 1." });
  try {
    const eps = await S.episodesSince(Date.now() - 30 * 86400000, 5000);
    const existing = await S.listPlaybooks();
    const known = new Map(existing.map((p) => [p.id, p]));

    // new playbooks: only those that pass every gate
    const added: string[] = [];
    const rejected: Array<{ id: string; why: string[] }> = [];
    const opts = gates();
    for (const c of mine(eps, LABELS, opts)) {
      const why = gateReasons(c, opts);
      if (why.length) { if (rejected.length < 40) rejected.push({ id: c.example.id, why }); continue; }
      const old = known.get(c.example.id);
      if (old) { await S.upsertPlaybook({ ...old, users: c.users }); continue; } // keep its real results, refresh the user count
      if (added.length >= 200) break;
      await S.upsertPlaybook({ ...c.example, updatedAt: Date.now() });
      added.push(c.example.id);
    }

    // canary -> live / paused from what really happened (the control group gives the baseline)
    const { control, fount } = summarize(eps);
    const baseline = control.passRate ?? fount.passRate ?? 0.5;
    const moved: Array<{ id: string; to: string }> = [];
    for (const p of existing) {
      if (p.source === "seed") continue;
      const next = judge(p, baseline);
      if (next !== (p.status ?? "live")) { await S.setPlaybookStatus(p.id, next); moved.push({ id: p.id, to: next }); }
    }

    const pruned = await S.pruneOlderThan(Date.now() - S.retentionDays() * 86400000);
    // the daily digest: one small document per day so you can watch FOUNT grow (no user text in it)
    const digest = {
      episodes: eps.length, added: added.length, rejected: rejected.length, moved, pruned, baseline, control, fount,
      playbooks: existing.length + added.length, gates: opts,
      gaps: gaps(eps), // jobs people do successfully that no job type covers yet: write a playbook for these next
    };
    await S.saveDigest(new Date().toISOString().slice(0, 10), digest);
    return NextResponse.json(digest);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "FOUNT mining failed." }, { status: 500 });
  }
}
