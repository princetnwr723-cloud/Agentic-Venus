import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { createSignedUpload } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Only the background job itself (job token) can ask for an upload link. Download links go through /api/venus/media.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await authFromRequest(req, body.uid);
    if (!auth.job || !auth.chatId) return NextResponse.json({ error: "Only a background job can upload a replay." }, { status: 403 });
    if (body.action !== "upload") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    const jobId = String(req.headers.get("x-job") || "").replace(/[^a-z0-9]/g, "");
    const path = `${auth.uid}/proof/${auth.chatId}-${Date.now().toString(36)}${jobId}.mp4`;
    return NextResponse.json({ uploadUrl: await createSignedUpload(path), path });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload link failed." }, { status: 500 });
  }
}
