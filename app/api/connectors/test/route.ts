import { NextResponse } from "next/server";
import { verifyUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { uid, kind, token } = await req.json();
    await verifyUser(req, uid);
    const t = String(token || "").trim();
    if (!t) return NextResponse.json({ ok: false, error: "Token is empty." });

    if (kind === "github") {
      const r = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${t}`, "User-Agent": "agenticvenus", Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(15_000),
      });
      const d = await r.json().catch(() => ({}));
      return r.ok ? NextResponse.json({ ok: true, label: d.login }) : NextResponse.json({ ok: false, error: d.message || "GitHub rejected this token." });
    }
    if (kind === "vercel") {
      const r = await fetch("https://api.vercel.com/v2/user", { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15_000) });
      const d = await r.json().catch(() => ({}));
      return r.ok ? NextResponse.json({ ok: true, label: d.user?.username || d.user?.email }) : NextResponse.json({ ok: false, error: d.error?.message || "Vercel rejected this token." });
    }
    return NextResponse.json({ ok: false, error: "Unknown connector." });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Test failed." });
  }
}