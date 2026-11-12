import { NextResponse } from "next/server";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { isPlaceholder, vaultDelete, vaultPut } from "@/lib/vault";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import { appBaseUrl } from "@/lib/voice-server";
import { kick, startRun, store } from "@/lib/agent/worker";
import { latchReason } from "@/lib/agent/latch-server";
import { summarizeRuns } from "@/lib/agent/budget";
import { beat, handBack, nextCheck, startTakeover, takeoverSeconds, decline } from "@/lib/agent/takeover";
import { replyFor } from "@/lib/agent/actions";
import type { Reply } from "@/lib/agent/types";
import type { RunDoc } from "@/lib/agent/store";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_ACTIVE = 3;
const PROVIDER_IDS = new Set<string>(PROVIDERS.map((p) => p.id));
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);

/** What the browser may see of a run: no key references, no internal bookkeeping. */
const view = (r: RunDoc) => ({
  id: r.id, chatId: r.chatId, task: r.task, status: r.status, round: r.round, createdAt: r.createdAt, updatedAt: r.updatedAt, endedAt: r.endedAt ?? null,
  pending: r.pending, takeover: r.takeover ?? null, usage: r.usage, costMicros: r.costMicros, calls: r.calls, compactions: r.compactions, tainted: r.tainted,
  result: r.result ?? null, error: r.error ?? null, model: r.model, provider: r.provider,
});

const origin = (req: Request) => { try { return appBaseUrl(req); } catch { return new URL(req.url).origin; } };

export async function POST(req: Request) {
  try {
    const rawReq = req.clone();
    const body = await readBody(req);
    const uid = String(body.uid);
    const S = store();
    const action = String(body.action || "");

    // ---------- start ----------
    if (action === "start") {
      const raw = (await rawReq.json().catch(() => ({}))) as { apiKey?: unknown; fallbacks?: unknown };
      const chatId = str(body.chatId, 200), task = str(body.task, 8000).trim(), model = str(body.model, 120);
      const provider = str(body.provider, 40);
      if (!chatId || !task) throw new RequestError("chatId and task are required.", 400);
      if (!PROVIDER_IDS.has(provider) || !model) throw new RequestError("Pick a provider and a model for this chat.", 400);
      const l = await latchReason(uid);
      if (l) return NextResponse.json({ ok: false, latched: true, until: l.until, error: l.text }, { status: 429 });
      const active = (await S.listRuns(uid, 12)).filter((r) => r.status === "queued" || r.status === "running").length;
      if (active >= MAX_ACTIVE) throw new RequestError(`You already have ${MAX_ACTIVE} tasks running. Wait for one to finish or stop one.`, 429);

      // Only a reference to the key is stored. A plain key (not yet in the vault) gets a private vault slot that is deleted when the run ends.
      let keyRef = typeof raw.apiKey === "string" ? raw.apiKey : "";
      let tempKey: string | undefined;
      if (!isPlaceholder(keyRef)) {
        if (!body.apiKey) throw new RequestError("No API key for this provider. Add it in Settings.", 400);
        tempKey = `agent.tmp.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        keyRef = await vaultPut(uid, tempKey, String(body.apiKey));
      }
      const fallbacks = (Array.isArray(raw.fallbacks) ? (raw.fallbacks as Array<Record<string, unknown>>) : [])
        .filter((f) => PROVIDER_IDS.has(String(f?.provider)) && isPlaceholder(f?.apiKey) && typeof f?.model === "string")
        .slice(0, 3).map((f) => ({ provider: String(f.provider), model: str(f.model, 120), keyRef: String(f.apiKey) }));
      const runId = await startRun(uid, { chatId, task, provider: provider as ProviderId, model, keyRef, fallbacks, tempKey, origin: origin(req), maxRounds: Math.min(80, Math.max(5, Number(body.maxRounds) || 40)) });
      return NextResponse.json({ ok: true, runId });
    }

    if (action === "list") return NextResponse.json({ ok: true, runs: (await S.listRuns(uid, 30)).map(view), latch: await latchReason(uid) });
    if (action === "report") {
      const rows = (await S.listRuns(uid, 200)).map((r) => ({ id: r.id, status: r.status, model: r.model, createdAt: r.createdAt, endedAt: r.endedAt, costMicros: r.costMicros, usage: r.usage, calls: r.calls, rounds: r.round }));
      return NextResponse.json({ ok: true, report: summarizeRuns(rows, Date.now(), Math.min(60, Math.max(1, Number(body.days) || 7))), note: "Costs are estimates from list prices, not a bill." });
    }
    if (action === "latch_clear") { await S.clearLatch(uid); return NextResponse.json({ ok: true }); }

    // ---------- everything below is about one run ----------
    const runId = str(body.runId, 40);
    const run = await S.getRun(uid, runId);
    if (!run) throw new RequestError("Run not found.", 404);
    const go = () => kick(uid, runId, run.chatId, run.origin || origin(req));
    const resume = async (reply: Reply, extra: Record<string, unknown> = {}) => {
      await S.patchRun(uid, runId, { reply, ...extra });
      await S.setQueue(uid, runId, "run", Date.now() + 90_000);
      go();
    };

    if (action === "status") return NextResponse.json({ ok: true, run: view(run) });

    if (action === "stop") {
      if (run.status === "running") { await S.patchRun(uid, runId, { stopRequested: true }); return NextResponse.json({ ok: true, note: "Stopping after the current step." }); }
      if (["queued", "paused", "budget"].includes(run.status)) {
        await S.release(uid, runId, { status: "stopped", endedAt: Date.now(), pending: null, reply: null }, null);
        if (run.tempKey) await vaultDelete(uid, run.tempKey).catch(() => {});
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "continue") {
      if (run.status !== "budget") throw new RequestError("Only a run that was paused by a limit can be continued.", 409);
      const l = await latchReason(uid);
      if (l) return NextResponse.json({ ok: false, latched: true, until: l.until, error: l.text }, { status: 429 });
      // a run stopped by its own cost cap would hit the same cap again at once: every "Continue" grants one more allowance
      const capped = run.error?.code === "cost";
      await S.patchRun(uid, runId, { status: "queued", error: null, stopRequested: false, ...(capped ? { costExtra: (run.costExtra ?? 0) + 1 } : {}) });
      await S.setQueue(uid, runId, "run", Date.now() + 90_000);
      go();
      return NextResponse.json({ ok: true });
    }

    // ---------- answering a card ----------
    const p = run.pending;
    const needCard = () => { if (run.status !== "paused" || !p || p.id !== str(body.pendingId, 60)) throw new RequestError("This card was already answered or has expired.", 409); return p; };

    if (action === "reply") {
      const card = needCard();
      const ans = replyFor(card, body, run.chatId);
      if (ans.secret) await vaultPut(uid, ans.secret.name, ans.secret.value); // straight into the encrypted vault: never written to the run, the chat or the model
      await resume(ans.reply, ans.declineTakeover ? { takeover: decline(run.takeover ?? undefined, Date.now()) } : {});
      return NextResponse.json({ ok: true });
    }

    // ---------- takeover handshake ----------
    if (action.startsWith("takeover_")) {
      const card = needCard();
      if (card.kind !== "request_takeover" || !run.takeover) throw new RequestError("No takeover is waiting.", 409);
      const now = Date.now();
      if (action === "takeover_start") {
        const t = startTakeover(run.takeover, now);
        await S.patchRun(uid, runId, { takeover: t });
        await S.setQueue(uid, runId, "takeover", nextCheck(t));
        return NextResponse.json({ ok: true, takeover: t });
      }
      if (action === "takeover_beat") {
        const t = beat(run.takeover, now);
        await S.patchRun(uid, runId, { takeover: t });
        await S.setQueue(uid, runId, "takeover", nextCheck(t));
        return NextResponse.json({ ok: true, takeover: t });
      }
      if (action === "takeover_handback") {
        const t = handBack(run.takeover, now, "owner");
        await resume({ action: "takeover_done", seconds: takeoverSeconds(t), note: str(body.note, 300), reason: card.summary.slice(0, 80) }, { takeover: t });
        return NextResponse.json({ ok: true });
      }
    }
    throw new RequestError("Unknown action.", 400);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Agent request failed." }, { status: requestStatus(err) });
  }
}
