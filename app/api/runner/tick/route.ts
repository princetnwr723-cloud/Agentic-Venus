// Called by your scheduler (GitHub Actions) every few minutes with the same secret as /api/routines/run.
// 1) keeps computers that run background jobs alive, 2) finishes jobs nobody is watching and posts the report in the chat.
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { connect } from "@/lib/e2b-server";
import { runnerStatus, stopRunner, type RunnerEvent, type RunnerState } from "@/lib/runner-server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Job = { id: string; sandboxId: string; offset?: number; hb?: number };
type ProjectDoc = { running?: boolean; stop?: boolean; updatedAt?: number; runnerJob?: Job; log?: unknown[]; ctx?: string };

export async function POST(req: Request) {
  const secret = process.env.ROUTINE_RUNNER_SECRET;
  if (!secret) return NextResponse.json({ error: "ROUTINE_RUNNER_SECRET is not set on the server." }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const db = getAdminDb();
    const snap = await db.collectionGroup("codeProjects").where("running", "==", true).get();
    const out: Array<Record<string, unknown>> = [];

    for (const d of snap.docs) {
      const p = d.data() as ProjectDoc;
      const job = p.runnerJob;

      // a foreground run whose tab died long ago: clear the stuck flag
      if (!job) {
        if (Date.now() - (p.updatedAt ?? 0) > 30 * 60_000) {
          await d.ref.update({ running: false, stop: false });
          out.push({ id: d.id, cleaned: true });
        }
        continue;
      }

      const userRef = d.ref.parent.parent;
      if (!userRef) continue;
      try {
        const userData = (await userRef.get()).data() as { e2bKey?: string } | undefined;
        const e2bKey = userData?.e2bKey;
        if (!e2bKey) { out.push({ id: d.id, skipped: "no E2B key" }); continue; }

        let state: RunnerState = { status: "error", summary: "The computer expired or was deleted while the job was running." };
        let events: RunnerEvent[] = [];
        let next = job.offset ?? 0;

        let sb: Awaited<ReturnType<typeof connect>> | null = null;
        try { sb = await connect(e2bKey, job.sandboxId); } catch { sb = null; } // connect() also extends the computer's life

        if (sb) {
          if (p.stop) await stopRunner(sb, job.id).catch(() => {});
          let off = next;
          for (let i = 0; i < 6; i++) {
            const s = await runnerStatus(sb, job.id, off);
            state = s.state;
            events = events.concat(s.events);
            off = s.next;
            if (s.events.length < 300) break;
          }
          next = off;
          const watched = Date.now() - (job.hb ?? 0) < 90_000;
          if (state.status === "running" || watched) { out.push({ id: d.id, status: state.status, watched }); continue; }
        }

        const ok = state.status === "done";
        const summary = String(state.summary || (ok ? "Done." : "Stopped."));
        const add = events
          .filter((e) => e.k !== "done")
          .map((e) => ({
            kind: e.k, text: e.text,
            ...(e.depth !== undefined ? { depth: e.depth } : {}),
            ...(e.path ? { path: e.path } : {}),
            ...(e.lines ? { lines: e.lines.slice(0, 40) } : {}),
          }));
        add.push({ kind: ok ? "done" : "error", text: summary });
        const lastTodo = [...events].reverse().find((e) => e.k === "todo")?.text;

        let finalized = false;
        await db.runTransaction(async (tx) => {
          const cur = await tx.get(d.ref);
          const c = cur.data() as ProjectDoc | undefined;
          if (!c?.runnerJob || c.runnerJob.id !== job.id) return; // someone else finished it
          const log = JSON.parse(JSON.stringify([...(c.log ?? []), ...add])).slice(-300);
          tx.update(d.ref, {
            log, running: false, stop: false, updatedAt: Date.now(),
            ctx: ((c.ctx ?? "") + `\n- background job → ${summary.slice(0, 300)}`).slice(-4000),
            ...(lastTodo ? { todo: lastTodo } : {}),
            runnerJob: FieldValue.delete(),
          });
          finalized = true;
        });

        if (finalized) {
          const chatRef = userRef.collection("chats").doc(d.id);
          const chat = await chatRef.get();
          if (chat.exists) {
            const msgs = Array.isArray((chat.data() as { messages?: unknown[] }).messages) ? ((chat.data() as { messages: unknown[] }).messages) : [];
            await chatRef.update({
              messages: [...msgs, {
                role: "assistant", at: Date.now(),
                content: `${ok ? "✅ Venus Code finished while you were away." : "⚠️ Venus Code stopped: "}\n\n${summary}\n\n[Open the Code page](/code?chat=${d.id})`,
              }],
            });
          }
        }
        out.push({ id: d.id, status: state.status, finalized });
      } catch (e) {
        out.push({ id: d.id, error: e instanceof Error ? e.message : "failed" });
      }
    }
    return NextResponse.json({ checked: snap.size, results: out });
  } catch (err) {
    // Most common cause: the collection-group index for codeProjects.running is missing - the message contains a link to create it.
    return NextResponse.json({ error: err instanceof Error ? err.message : "Runner tick failed." }, { status: 500 });
  }
}