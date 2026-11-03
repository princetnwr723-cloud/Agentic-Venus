// Called by your scheduler (GitHub Actions) every few minutes with the same secret as /api/routines/run.
// 1) keeps background jobs alive, 2) finishes jobs nobody is watching (reports to the chat and to every connected chat app,
// forwards questions and payment approvals, switches the computer off), 3) restarts the real-time watcher for running jobs
// and for tasks queued from chat apps, 4) pauses idle computers (saves money).
// Plans: it also counts the time of computer-agent jobs (even with the tab closed) and stops a job
// when the plan's computer time for the current window is used up.
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { connect, GONE_PREFIX, pauseSandbox } from "@/lib/e2b-server";
import { runnerStatus, stopRunner, type RunnerEvent, type RunnerState } from "@/lib/runner-server";
import { resolveValue } from "@/lib/vault";
import { cronDenied } from "@/lib/cron-auth";
import { postChat, processPcJob, switchOff } from "@/lib/pc-tick";
import { kickWatcher } from "@/lib/pc-start-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const IDLE_MS = 30 * 60_000;

type Job = { id: string; sandboxId: string; offset?: number; hb?: number };
type ProjectDoc = { running?: boolean; stop?: boolean; updatedAt?: number; runnerJob?: Job; log?: unknown[]; ctx?: string; chatId?: string };
/** A chat can have several Venus Code projects ("<chatId>__<suffix>"); the chat is what gets the report and switches off the computer. */
const chatOf = (id: string, p?: ProjectDoc) => (p?.chatId && String(p.chatId)) || id.split("__")[0];
type Db = ReturnType<typeof getAdminDb>;
type Ref = FirebaseFirestore.DocumentReference;

export async function POST(req: Request) {
  const t0 = Date.now();
  const denied = cronDenied(req);
  if (denied) return denied;

  try {
    const db: Db = getAdminDb();
    const out: Array<Record<string, unknown>> = [];
    const keyCache = new Map<string, string | undefined>();
    const e2bFor = async (userRef: Ref) => {
      if (!keyCache.has(userRef.path)) {
        const raw = ((await userRef.get()).data() as { e2bKey?: string } | undefined)?.e2bKey;
        keyCache.set(userRef.path, raw ? await resolveValue(userRef.id, raw) : undefined);
      }
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
      const chatId = chatOf(d.id, p);
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
          await postChat(userRef, chatId, `${ok ? "✅ Venus Code finished while you were away." : "⚠️ Venus Code stopped: "}\n\n${summary}\n\n[Open the Code page](/code?chat=${chatId}&project=${d.id})`);
          await switchOff(userRef, chatId, e2bKey, job.sandboxId);
        }
        out.push({ id: d.id, status: state.status, finalized });
      } catch (e) {
        out.push({ id: d.id, error: e instanceof Error ? e.message : "failed" });
      }
    }

    // ---------------- 2) background computer-agent jobs ----------------
    const pcs = await db.collectionGroup("pcJobs").where("running", "==", true).get();
    const kicked = new Set<string>();
    for (const d of pcs.docs) {
      const r = await processPcJob(d, e2bFor);
      out.push(r);
      // nobody has the site open: make sure the real-time watcher is running (it exits at once if one already is)
      if (r.status === "running" && r.watched === false && typeof r.uid === "string" && !kicked.has(r.uid)) { kicked.add(r.uid); kickWatcher(r.uid); }
    }

    // ---------------- 2b) tasks queued from chat apps ----------------
    try {
      const queued = await db.collectionGroup("pcQueue").where("status", "in", ["queued", "setup"]).get();
      const uids = new Set<string>();
      for (const x of queued.docs) { const u = x.ref.parent.parent?.id; if (u) uids.add(u); }
      for (const u of [...uids].slice(0, 20)) if (!kicked.has(u)) { kicked.add(u); kickWatcher(u); }
      out.push({ queued: queued.size });
    } catch (e) {
      out.push({ queue: e instanceof Error ? e.message : "failed" }); // usually the missing collection-group index; the message has the link
    }

    // ---------------- 3) idle reaper: pause computers nobody is using ----------------
    let paused = 0;
    const codeRunning = new Map<string, Set<string>>();
    const runningCodeChats = async (userRef: Ref) => {
      if (!codeRunning.has(userRef.path)) {
        const set = new Set<string>();
        for (const x of (await userRef.collection("codeProjects").where("running", "==", true).get()).docs) set.add(chatOf(x.id, x.data() as ProjectDoc));
        codeRunning.set(userRef.path, set);
      }
      return codeRunning.get(userRef.path) as Set<string>;
    };
    try {
      const chats = await db.collectionGroup("chats").where("pcPaused", "==", false).get();
      for (const c of chats.docs) {
        if (paused >= 10 || Date.now() - t0 > 45_000) break;
        const ch = c.data() as { pcSandboxId?: string | null; pcActiveAt?: number };
        if (!ch.pcSandboxId || !ch.pcActiveAt || Date.now() - ch.pcActiveAt < IDLE_MS) continue;
        const userRef = c.ref.parent.parent;
        if (!userRef) continue;
        const [pj, busyCode] = await Promise.all([userRef.collection("pcJobs").doc(c.id).get(), runningCodeChats(userRef)]);
        if ((pj.data() as { running?: boolean } | undefined)?.running || busyCode.has(c.id)) continue;
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