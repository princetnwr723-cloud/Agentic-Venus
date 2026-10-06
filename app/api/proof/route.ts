import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { createSignedDownload, createSignedUpload } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Only the background job itself (job token) can use this: screen replays (mp4) and verified result files (csv).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await authFromRequest(req, body.uid);
    if (!auth.job || !auth.chatId) return NextResponse.json({ error: "Only a background job can use this." }, { status: 403 });
    const rand = Math.random().toString(36).slice(2, 7);

    if (body.action === "upload") {
      const csv = body.ext === "csv";
      const path = `${auth.uid}/${csv ? "files" : "proof"}/${auth.chatId}-${Date.now().toString(36)}${rand}.${csv ? "csv" : "mp4"}`;
      return NextResponse.json({ uploadUrl: await createSignedUpload(path), path });
    }
    if (body.action === "download") {
      const p = String(body.path || "");
      if (!p.startsWith(auth.uid + "/files/") || p.includes("..")) return NextResponse.json({ error: "Not your file." }, { status: 403 });
      return NextResponse.json({ url: await createSignedDownload(p, 6 * 3600) });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload link failed." }, { status: 500 });
  }
}