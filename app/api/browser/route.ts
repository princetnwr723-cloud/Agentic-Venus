import { NextResponse } from "next/server";
import { verifyUser } from "@/lib/server-auth";
import { runBrowser } from "@/lib/browser-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await verifyUser(req, body.uid);
    const r = await runBrowser({
      session: body.session ?? null,
      url: typeof body.url === "string" ? body.url : undefined,
      ops: Array.isArray(body.ops) ? body.ops : [],
      creds: body.creds ?? undefined,
    });
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Browser failed." }, { status: 500 });
  }
}