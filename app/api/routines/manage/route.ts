import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { historyServer, hookUrl, routineRef, startManualRun, stopRoutineRun } from "@/lib/routines-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const clip = (v: unknown, n: number) => { const s = String(v ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; };

// Used by the Routines panel (signed-in user): run history, "Run now", stop, webhook link.
export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 8 * 1024 });
    const uid = String(b.uid);
    const action = String(b.action || "");
    const id = String(b.id || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return NextResponse.json({ error: "Bad routine id." }, { status: 400 });
    const ref = routineRef(uid, id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Routine not found." }, { status: 404 });

    if (action === "runs") {
      const runs = (await historyServer(uid, id, 25)).map((r) => ({ ...r, output: clip(r.output, 4000) }));
      return NextResponse.json({ runs });
    }
    if (action === "run_now") {
      // the fast kind finishes inside this request; an agent run starts in the background (the panel follows it in the history)
      const r = await startManualRun(uid, id, { waitLite: true, deadline: Date.now() + 45_000 });
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (action === "stop") return NextResponse.json({ ok: true, message: await stopRoutineRun(uid, id) });
    if (action === "hook") {
      if (b.enable === false) { await ref.update({ hook: false }); return NextResponse.json({ ok: true, url: null }); }
      const cur = Number((snap.data() as { hookVersion?: number }).hookVersion) || 1;
      const ver = b.rotate === true ? cur + 1 : cur; // a new link makes the old one stop working
      await ref.update({ hook: true, hookVersion: ver });
      return NextResponse.json({ ok: true, url: hookUrl(uid, id, ver) });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Routine request failed." }, { status: requestStatus(e) });
  }
}