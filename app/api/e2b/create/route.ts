import { NextResponse } from "next/server";
import { createSandbox, loadSdk, recoveryDownloadUrl, restoreComputerState } from "@/lib/e2b-server";
import { readBody, requestStatus } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Open /api/e2b/create in a browser tab to check that the E2B SDK loads.
export async function GET() {
  try {
    await loadSdk();
    return NextResponse.json({ ok: true, sdk: "loaded", node: process.version });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message, node: process.version }, { status: requestStatus(err) });
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const apiKey = String(body.apiKey || "");
    if (!apiKey) {
      return NextResponse.json({ error: "No E2B API key on file." }, { status: 400 });
    }
    const { sandboxId, persistence } = await createSandbox(apiKey);
    let restored = false;
    const recoveryPath = typeof body.recoveryPath === "string" ? body.recoveryPath : "";
    if (recoveryPath) {
      const owner = typeof body.uid === "string" ? body.uid : "";
      if (!owner || !recoveryPath.startsWith(owner.replace(/[^A-Za-z0-9_-]/g, "") + "/pc-recovery/")) {
        return NextResponse.json({ error: "Invalid recovery path." }, { status: 400 });
      }
      const signed = await recoveryDownloadUrl(recoveryPath, 600);
      const { connect } = await import("@/lib/e2b-server");
      const sb = await connect(apiKey, sandboxId);
      restored = await restoreComputerState(sb, signed).catch(() => false);
    }
    return NextResponse.json({ sandboxId, persistence, restored });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create a computer.";
    return NextResponse.json({ error: message }, { status: requestStatus(err) });
  }
}