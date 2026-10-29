import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { createSignedDownload, createSignedUpload, removeObjects, supabaseConfigured } from "@/lib/supabase-server";
import { voiceStatus } from "@/lib/venus-voice";
import { ensureLocalVoice } from "@/lib/voice-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tells the page which optional services are configured (never any secrets).
export async function GET() {
  return NextResponse.json({
    supabase: supabaseConfigured(),
    pexels: Boolean(process.env.PEXELS_API_KEY),
  });
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(-60) || "video.mp4";

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const uid = String(body.uid);

    if (body.action === "url") {
      const path = String(body.path || "");
      if (!path.startsWith(uid + "/")) return NextResponse.json({ error: "Not your video." }, { status: 403 });
      let url = await createSignedDownload(path);
      if (body.download) url += (url.includes("?") ? "&" : "?") + "download=" + encodeURIComponent(String(body.download));
      return NextResponse.json({ url });
    }

    // The user's own video (edit mode): the browser uploads it straight to storage with this one-time link.
    if (body.action === "source-upload-url") {
      const pid = String(body.pid || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
      if (!pid) return NextResponse.json({ error: "Missing project id." }, { status: 400 });
      const path = `${uid}/src/${pid}/${safeName(String(body.name || "video.mp4"))}`;
      return NextResponse.json({ path, uploadUrl: await createSignedUpload(path) });
    }

    // Which voice will speak the voice-over (the same voice system as phone calls).
    if (body.action === "voice-status") {
      return NextResponse.json(await voiceStatus(uid));
    }

    // Wakes the local voice model on the cloud PC (installs it if needed). One request waits up to ~50 s; the pipeline asks again until it is ready.
    if (body.action === "voice-warm") {
      const chatId = typeof body.chatId === "string" && body.chatId ? body.chatId : undefined;
      const st = await ensureLocalVoice(uid, chatId, 48_000);
      return NextResponse.json({ state: st.state, detail: st.state === "ready" ? "" : st.detail });
    }

    if (body.action === "delete") {
      const paths = (Array.isArray(body.paths) ? body.paths : [])
        .map(String)
        .filter((p: string) => p.startsWith(uid + "/"));
      await removeObjects(paths);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Media request failed." }, { status: requestStatus(err) });
  }
}
