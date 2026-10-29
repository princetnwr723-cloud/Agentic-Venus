import { NextResponse } from "next/server";
import { runAfter } from "@/lib/channels";
import { claimRoutine, routineRef, runClaimed, verifyHook } from "@/lib/routines-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST https://your-app/api/routines/hook?t=<signed link from the Routines panel>
// Anything can call it (GitHub webhooks, Zapier, a form, curl). The body (max 4 KB) is handed to the routine as untrusted event data.
export async function POST(req: Request) {
  try {
    const h = verifyHook(new URL(req.url).searchParams.get("t") || "");
    if (!h) return NextResponse.json({ error: "Invalid link." }, { status: 401 });
    const snap = await routineRef(h.uid, h.id).get();
    const d = snap.data() as { hook?: boolean; hookVersion?: number } | undefined;
    if (!d || d.hook !== true || (Number(d.hookVersion) || 1) !== h.ver) {
      return NextResponse.json({ error: "This link is switched off or was replaced." }, { status: 404 });
    }
    if (Number(req.headers.get("content-length") || 0) > 64 * 1024) return NextResponse.json({ error: "Body too large." }, { status: 413 });
    const payload = (await req.text()).slice(0, 4096).trim();
    const c = await claimRoutine(h.uid, h.id, { trigger: "hook", payload: payload || undefined });
    if (!c.ok) return NextResponse.json({ ok: false, reason: c.reason }, { status: 429 });
    runAfter(runClaimed(c));
    return NextResponse.json({ ok: true, runId: c.runId }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Hook failed." }, { status: 500 });
  }
}