import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { createSignedDownload, removeObjects, supabaseConfigured } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Tells the page which optional services are configured (never any secrets).
export async function GET() {
  return NextResponse.json({
    supabase: supabaseConfigured(),
    pexels: Boolean(process.env.PEXELS_API_KEY),
  });
}

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