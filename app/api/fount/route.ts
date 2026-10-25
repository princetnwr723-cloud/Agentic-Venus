import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import {
  deriveVerdict, episodeScore, fnv1a, hasInjection, isHoldout, looksSecret, personalExample, scrub, summarize, tierOf,
  type Episode, type Example, type Signals, type Verdict,
} from "@/lib/fount/core";
import { LABELS } from "@/lib/fount/seed";
import * as S from "@/lib/fount/store";

export const runtime = "nodejs";
export const maxDuration = 30;

const TOOL = /^[a-z0-9_:.-]{2,80}$/i;
const fail = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const strs = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : []).map((x) => String(x)).filter((x) => TOOL.test(x)).slice(0, max);
const thumbsOf = (v: unknown): 1 | 0 | -1 => (Number(v) > 0 ? 1 : Number(v) < 0 ? -1 : 0);

function verdictOf(ep: Pick<Episode, "tools" | "toolErrors" | "signals" | "lastFail">): Verdict {
  return deriveVerdict({
    verifier: ep.signals.verdict,
    toolCount: ep.tools.length,
    errorCount: ep.toolErrors.length,
    lastToolFailed: ep.lastFail === true,
    thumbs: ep.signals.thumbs ?? 0,
  });
}

/** A run has a final verdict: it counts for the playbooks that were used AND for the owner's own record. */
async function settle(ep: Pick<Episode, "uk" | "intent" | "tools" | "toolErrors" | "injected">, verdict: Verdict) {
  if (verdict === "partial") return;
  if (ep.injected.length) await S.bumpOutcome(ep.injected, verdict);
  if (ep.intent !== "general.chat") await S.recordPersonal(ep.uk, ep.intent, ep.tools, ep.toolErrors, verdict);
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 24_000 });
    const uid = String(body.uid);
    const action = String(body.action || "");
    const uk = S.userKey(uid);

    if (!S.enabled()) return NextResponse.json({ enabled: false, optIn: false, holdout: false, playbooks: [] });

    switch (action) {
      case "boot": {
        const holdout = isHoldout(uk, S.holdoutPct());
        const [optIn, all, mine] = await Promise.all([
          S.getConsent(uid),
          holdout ? Promise.resolve([] as Example[]) : S.listPlaybooks(),
          holdout ? Promise.resolve([]) : S.listPersonal(uk),
        ]);
        const personal = mine.map((p) => personalExample(LABELS[p.intent] ?? p.intent, p)).filter((x): x is Example => x !== null);
        // live playbooks go to everyone; canary ones only to a quarter of the users, so a bad one does little harm
        const playbooks = all.filter((p) => p.status === "live" || (p.status === "canary" && Number.parseInt(fnv1a(uk + p.id).slice(0, 4), 16) % 100 < 25));
        return NextResponse.json({ enabled: true, optIn, holdout, playbooks, personal });
      }

      case "consent": {
        if (typeof body.optIn === "boolean") await S.setConsent(uid, body.optIn);
        return NextResponse.json({ optIn: await S.getConsent(uid) });
      }

      case "forget": {
        await S.setConsent(uid, false);
        const deleted = await S.forgetUser(uk);
        return NextResponse.json({ ok: true, deleted });
      }

      case "capture": {
        if (!(await S.getConsent(uid))) return NextResponse.json({ ok: true, stored: false });
        const holdout = isHoldout(uk, S.holdoutPct());
        const tools = strs(body.tools, 40);
        const toolErrors = strs(body.toolErrors, 40);
        const intentRaw = String(body.intent || "general.chat");
        const signals: Signals = { ...(["pass", "partial", "fail"].includes(String(body.verifier)) ? { verdict: String(body.verifier) as Verdict } : {}) };
        const at = Date.now();
        const ep: Episode = {
          id: `${uk.slice(0, 8)}-${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          uk,
          chatKey: fnv1a(`${uid}:${String(body.chatId || "").slice(0, 60)}`),
          intent: LABELS[intentRaw] ? intentRaw : "general.chat",
          task: scrub(String(body.task || ""), 200),
          tools, toolErrors, lastFail: body.lastToolFailed === true,
          verdict: "partial", signals, score: 0,
          model: String(body.model || "").slice(0, 80),
          tier: tierOf(String(body.model || "")),
          steps: Math.max(0, Math.min(200, Math.round(Number(body.steps) || tools.length))),
          fountOn: !holdout,
          injected: strs(body.injected, 6),
          at,
        };
        if (looksSecret(ep.task)) ep.task = "[removed]";
        ep.verdict = verdictOf(ep);
        ep.score = episodeScore({ ...ep.signals, verdict: ep.verdict });
        const counted = ep.verdict !== "partial";
        await S.saveEpisode({ ...ep, counted });
        if (counted) await settle(ep, ep.verdict);
        return NextResponse.json({ ok: true, stored: true, episodeId: ep.id });
      }

      case "feedback": {
        const ep = await S.getEpisode(String(body.episodeId || ""));
        if (!ep || ep.uk !== uk) return fail("Unknown run.", 404);
        const signals: Signals = {
          ...ep.signals,
          thumbs: thumbsOf(body.thumbs),
          ...(body.edited === true ? { edited: true } : {}),
          ...(body.retried === true ? { retried: true } : {}),
        };
        const next = { ...ep, signals };
        const verdict = verdictOf(next);
        const score = episodeScore({ ...signals, verdict });
        let counted = ep.counted === true;
        if (!counted && verdict !== "partial") {
          counted = true;
          await settle(ep, verdict);
        }
        await S.patchEpisode(ep.id, { signals, verdict, score, counted });
        return NextResponse.json({ ok: true, verdict });
      }

      case "stats": {
        if (!S.isAdmin(uid)) return fail("Admins only.", 403);
        const eps = await S.episodesSince(Date.now() - 14 * 86400000, 5000);
        const byIntent: Record<string, number> = {};
        for (const e of eps) byIntent[e.intent] = (byIntent[e.intent] ?? 0) + 1;
        const playbooks = (await S.listPlaybooks()).map((p) => ({
          id: p.id, intent: p.intent, title: p.title, source: p.source, status: p.status, uses: p.uses ?? 0, wins: p.wins ?? 0, fails: p.fails ?? 0, users: p.users ?? 0,
        }));
        return NextResponse.json({ ...summarize(eps), episodes: eps.length, byIntent, playbooks, holdoutPct: S.holdoutPct(), digests: await S.listDigests(14) });
      }

      case "curate": {
        if (!S.isAdmin(uid)) return fail("Admins only.", 403);
        const op = String(body.op || "upsert");
        if (op === "pause" || op === "resume") {
          const ok = await S.setPlaybookStatus(String(body.id || ""), op === "pause" ? "paused" : "live");
          return NextResponse.json({ ok });
        }
        const intent = String(body.intent || "");
        if (!LABELS[intent]) return fail("Unknown intent.");
        const lines = (v: unknown, n: number) => (Array.isArray(v) ? v : []).map((x) => String(x).slice(0, 300)).filter(Boolean).slice(0, n);
        const ex: Example = {
          id: String(body.id || `curated-${intent}-${fnv1a(String(body.title || "") + Date.now())}`).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80),
          intent, task: String(body.task || "").slice(0, 200), title: String(body.title || LABELS[intent]).slice(0, 120),
          steps: lines(body.steps, 10), tools: strs(body.tools, 12), pitfalls: lines(body.pitfalls, 6), verify: lines(body.verify, 5),
          source: "curated", weight: Math.max(1, Math.min(3, Number(body.weight) || 2)), status: "live", version: 1, uses: 0, wins: 0, fails: 0,
        };
        const text = [ex.title, ex.task, ...ex.steps, ...ex.pitfalls, ...ex.verify].join(" ");
        if (!ex.steps.length) return fail("A playbook needs at least one step.");
        if (hasInjection(text) || looksSecret(text)) return fail("That text looks like an instruction to the AI or contains a secret.");
        await S.upsertPlaybook(ex);
        return NextResponse.json({ ok: true, id: ex.id });
      }

      default:
        return fail("Unknown action.");
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "FOUNT error." }, { status: requestStatus(e, 500) });
  }
}
