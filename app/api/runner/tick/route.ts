// Called by your scheduler (GitHub Actions) every few minutes with the same secret as /api/routines/run.
// 1) keeps background jobs alive, 2) finishes jobs nobody is watching and posts the report in the chat,
// 3) pings you when an unattended job needs an approval, 4) pauses idle computers (saves money).
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { connect, GONE_PREFIX, pauseSandbox } from "@/lib/e2b-server";
import { runnerStatus, stopRunner, type RunnerEvent, type RunnerState } from "@/lib/runner-server";
import { createSignedDownload } from "@/lib/supabase-server";
import { http } from "@/lib/tools/net";
import { unpack } from "@/lib/tools/catalog";

export const runtime = "nodejs";
export const maxDuration = 60;

const IDLE_MS = 30 * 60_000;

type Job = { id: string; sandboxId: string; offset?: number; hb?: number };
type ProjectDoc = { running?: boolean; stop?: boolean; updatedAt?: number; runnerJob?: Job; log?: unknown[]; ctx?: string };
type PcJobDoc = { running?: boolean; task?: string; startedAt?: number; job?: Job; notified?: string };
type Db = ReturnType<typeof getAdminDb>;
type Ref = FirebaseFirestore.DocumentReference;

async function postChat(userRef: Ref, chatId: string, content: string) {
  const ref = userRef.collection("chats").doc(chatId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const msgs = Array.isArray((snap.data() as { messages?: unknown[] }).messages) ? (snap.data() as { messages: unknown[] }).messages : [];
  await ref.update({ messages: [...msgs, { role: "assistant", content, at: Date.now() }] });
}

async function telegram(userRef: Ref, chatId: string, text: string) {
  try {
    const c = ((await userRef.collection("chats").doc(chatId).get()).data() as { connectors?: Record<string, string> } | undefined)?.connectors?.telegram;
    if (!c) return;
    const [token, chat] = unpack(c);
    if (token && chat) await http(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3500) }) });
  } catch { /* notification is best-effort */ }
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const secret = process.env.ROUTINE_RUNNER_SECRET;
  if (!secret) return NextResponse.json({ error: "ROUTINE_RUNNER_SECRET is not set on the server." }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const db: Db = getAdminDb();
    const out: Array<Record<string, unknown>> = [];
    const keyCache = new Map<string, string | undefined>();
    const e2bFor = async (userRef: Ref) => {
      if (!keyCache.has(userRef.path)) keyCache.set(userRef.path, ((await userRef.get()).data() as { e2bKey?: string } | undefined)?.e2bKey);
      return keyCache.get(userRef.path);
    };

    // ---------------- 1) Venus Code jobs ----------------
    const snap = await db.collectionGroup("codeProjects").where("running", "==", true).get();
    for (const d of snap.docs) {
      const p = d.data() as ProjectDoc;
      const job = p.runnerJob;
      if (!job) {
        if (Date.now() - (p.updatedAt ?? 0) > 30 * 60_000) { await d.ref.update({ running: false, stop: false }); out.push({ id: d.id, cleaned: true }); }
        continue;
      }
      const userRef = d.ref.parent.parent;
      if (!userRef) continue;
      try {
        const e2bKey = await e2bFor(userRef);
        if (!e2bKey) { out.push({ id: d.id, skipped: "no E2B key" }); continue; }

        let state: RunnerState = { status: "error", summary: "The computer expired or was deleted while the job was running." };
        let events: RunnerEvent[] = [];
        let next = job.offset ?? 0;
        let sb: Awaited<ReturnType<typeof connect>> | null = null;
        try { sb = await connect(e2bKey, job.sandboxId); } catch { sb = null; }

        if (sb) {
          if (p.stop) await stopRunner(sb, job.id).catch(() => {});
          let off = next;
          for (let i = 0; i < 6; i++) {
            const s = await runnerStatus(sb, job.id, off);
            state = s.state; events = events.concat(s.events); off = s.next;
            if (s.events.length < 300) break;
          }
          next = off;
          const watched = Date.now() - (job.hb ?? 0) < 90_000;
          if (state.status === "running" || watched) { out.push({ id: d.id, status: state.status, watched }); continue; }
        }

        const ok = state.status === "done";
        const summary = String(state.summary || (ok ? "Done." : "Stopped."));
        const add = events.filter((e) => e.k !== "done").map((e) => ({
          kind: e.k, text: e.text,
          ...(e.depth !== undefined ? { depth: e.depth } : {}), ...(e.path ? { path: e.path } : {}), ...(e.lines ? { lines: e.lines.slice(0, 40) } : {}),
        }));
        add.push({ kind: ok ? "done" : "error", text: summary });
        const lastTodo = [...events].reverse().find((e) => e.k === "todo")?.text;

        let finalized = false;
        await db.runTransaction(async (tx) => {
          const cur = await tx.get(d.ref);
          const c = cur.data() as ProjectDoc | undefined;
          if (!c?.runnerJob || c.runnerJob.id !== job.id) return;
          const log = JSON.parse(JSON.stringify([...(c.log ?? []), ...add])).slice(-300);
          tx.update(d.ref, {
            log, running: false, stop: false, updatedAt: Date.now(),
            ctx: ((c.ctx ?? "") + `\n- background job → ${summary.slice(0, 300)}`).slice(-4000),
            ...(lastTodo ? { todo: lastTodo } : {}), runnerJob: FieldValue.delete(),
          });
          finalized = true;
        });
        if (finalized) {
          await postChat(userRef, d.id, `${ok ? "✅ Venus Code finished while you were away." : "⚠️ Venus Code stopped: "}\n\n${summary}\n\n[Open the Code page](/code?chat=${d.id})`);
        }
        out.push({ id: d.id, status: state.status, finalized });
      } catch (e) {
        out.push({ id: d.id, error: e instanceof Error ? e.message : "failed" });
      }
    }

    // ---------------- 2) background computer-agent jobs ----------------
    const pcs = await db.collectionGroup("pcJobs").where("running", "==", true).get();
    for (const d of pcs.docs) {
      const p = d.data() as PcJobDoc;
      const job = p.job;
      const userRef = d.ref.parent.parent;
      if (!userRef) continue;
      if (!job) {
        if (Date.now() - (p.startedAt ?? 0) > 3 * 3600_000) await d.ref.update({ running: false });
        continue;
      }
      try {
        const e2bKey = await e2bFor(userRef);
        if (!e2bKey) { out.push({ pc: d.id, skipped: "no E2B key" }); continue; }
        let state: RunnerState & { pending?: { id: string; question?: string; site?: string; message?: string; kind?: string }; proof?: string | null } = {
          status: "error", summary: "The computer expired or was deleted while the task was running.",
        };
        try {
          const sb = await connect(e2bKey, job.sandboxId); // keeps the computer alive while the job runs
          state = (await runnerStatus(sb, job.id, 0)).state as typeof state;
        } catch { /* expired */ }

        if (state.status === "running") {
          const watched = Date.now() - (job.hb ?? 0) < 90_000;
          const pend = state.pending;
          if (!watched && pend && p.notified !== pend.id) {
            const what = pend.kind === "login" ? `a login for ${pend.site ?? "a site"}` : pend.question ?? pend.message ?? "your input";
            const msg = `⏸️ Your background task is waiting for ${what}. Open AgenticVenus to answer — it waits up to 30 minutes, then cancels the risky step.`;
            await postChat(userRef, d.id, msg);
            await telegram(userRef, d.id, msg);
            await d.ref.update({ notified: pend.id });
          }
          out.push({ pc: d.id, status: "running", watched });
          continue;
        }
        if (Date.now() - (job.hb ?? 0) < 90_000) { out.push({ pc: d.id, status: state.status, watched: true }); continue; } // the open tab will finish it

        const ok = state.status === "done";
        const summary = String(state.summary || (ok ? "Done." : "Stopped."));
        let replay = "";
        if (state.proof) { const url = await createSignedDownload(state.proof, 6 * 3600).catch(() => ""); if (url) replay = `\n\n🎥 [Watch the replay](${url}) (link works for 6 hours)`; }
        let finalized = false;
        await db.runTransaction(async (tx) => {
          const c = (await tx.get(d.ref)).data() as PcJobDoc | undefined;
          if (!c?.job || c.job.id !== job.id) return;
          tx.update(d.ref, { running: false, job: FieldValue.delete() });
          finalized = true;
        });
        if (finalized) {
          const msg = `${ok ? "✅ Your background task finished while you were away." : "⚠️ Your background task stopped:"}\n\n**${(p.task ?? "").slice(0, 120)}**\n\n${summary}${replay}`;
          await postChat(userRef, d.id, msg);
          await telegram(userRef, d.id, `${ok ? "✅" : "⚠️"} ${(p.task ?? "Task").slice(0, 100)}\n${summary.slice(0, 600)}`);
        }
        out.push({ pc: d.id, status: state.status, finalized });
      } catch (e) {
        out.push({ pc: d.id, error: e instanceof Error ? e.message : "failed" });
      }
    }

    // ---------------- 3) idle reaper: pause computers nobody is using ----------------
    let paused = 0;
    try {
      const chats = await db.collectionGroup("chats").where("pcPaused", "==", false).get();
      for (const c of chats.docs) {
        if (paused >= 10 || Date.now() - t0 > 45_000) break;
        const ch = c.data() as { pcSandboxId?: string | null; pcActiveAt?: number };
        if (!ch.pcSandboxId || !ch.pcActiveAt || Date.now() - ch.pcActiveAt < IDLE_MS) continue;
        const userRef = c.ref.parent.parent;
        if (!userRef) continue;
        const [pj, cp] = await Promise.all([userRef.collection("pcJobs").doc(c.id).get(), userRef.collection("codeProjects").doc(c.id).get()]);
        if ((pj.data() as { running?: boolean } | undefined)?.running || (cp.data() as { running?: boolean } | undefined)?.running) continue;
        const e2bKey = await e2bFor(userRef);
        if (!e2bKey) continue;
        try {
          await pauseSandbox(e2bKey, ch.pcSandboxId);
          await c.ref.update({ pcPaused: true });
          paused++;
        } catch (e) {
          if ((e instanceof Error ? e.message : "").startsWith(GONE_PREFIX)) await c.ref.update({ pcSandboxId: null, pcPaused: false });
        }
      }
    } catch (e) {
      out.push({ reaper: e instanceof Error ? e.message : "failed" }); // usually the missing collection-group index; the message has the link
    }
    out.push({ reaperPaused: paused });

    return NextResponse.json({ checked: snap.size, pcChecked: pcs.size, results: out });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Runner tick failed." }, { status: 500 });
  }
}
