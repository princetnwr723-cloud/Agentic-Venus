import { NextResponse } from "next/server";
import { connect } from "@/lib/e2b-server";
import { readBody, requestStatus } from "@/lib/request";
import { bundleHtml, serveStatus, startServe, stopServe } from "@/lib/preview-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const action = String(body.action || "");
    const e2bKey = String(body.e2bKey || "");
    const sandboxId = String(body.sandboxId || "");
    const ws = String(body.ws || "");
    if (!e2bKey) return fail("E2B key missing.", 400);
    if (!sandboxId) return fail("This chat has no computer yet.", 400);
    const sb = await connect(e2bKey, sandboxId); // wakes a paused computer

    switch (action) {
      case "html":
        return NextResponse.json(await bundleHtml(sb, ws, body.entry ? String(body.entry) : undefined));
      case "serve":
        await startServe(sb, ws);
        return NextResponse.json({ ok: true });
      case "serve_status":
        return NextResponse.json(await serveStatus(sb));
      case "serve_stop":
        await stopServe(sb);
        return NextResponse.json({ ok: true });
      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Preview failed.", requestStatus(err));
  }
}