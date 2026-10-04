import { NextResponse } from "next/server";
import { connect, exec } from "@/lib/e2b-server";
import { verifyUser } from "@/lib/server-auth";
import { q, wsRoot } from "@/lib/code-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const b = await req.json();
    await verifyUser(req, b.uid);
    const e2bKey = String(b.e2bKey || "");
    const sandboxId = String(b.sandboxId || "");
    const token = String(b.vercelToken || "").trim();
    if (!e2bKey || !sandboxId) return fail("This chat's computer is not available.", 400);
    if (!token) return fail("Connect Vercel first (Connectors button).", 400);

    const ws = String(b.ws || "");
    const root = wsRoot(ws);
    const sb = await connect(e2bKey, sandboxId);

    const script = `cd ${q(root)} 2>/dev/null || { echo NOWS; exit 3; }
git ls-files -co --exclude-standard | head -400 | while IFS= read -r f; do
  [ -f "$f" ] || continue
  [ "$f" = "VENUS.md" ] && continue
  s=$(stat -c %s "$f"); [ "$s" -le 3000000 ] || continue
  printf '@@%s\\n' "$f"; base64 -w0 "$f"; printf '\\n'
done`;
    const r = await exec(sb, script, 40_000);
    if (r.stdout.startsWith("NOWS")) return fail("This chat has no codespace yet — build something first with /code.", 400);

    const files: Array<{ file: string; data: string; encoding: "base64" }> = [];
    let cur = "";
    for (const line of r.stdout.split("\n")) {
      if (line.startsWith("@@")) cur = line.slice(2);
      else if (cur && line.trim()) { files.push({ file: cur, data: line.trim(), encoding: "base64" }); cur = ""; }
    }
    if (files.length === 0) return fail("The codespace is empty — nothing to deploy yet.", 400);

    const hasPkg = files.some((f) => f.file === "package.json");
    const name = slug(String(b.name || "")) || `venus-${slug(ws)}`;

    const res = await fetch("https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, files, target: "production", ...(hasPkg ? {} : { projectSettings: { framework: null } }) }),
      signal: AbortSignal.timeout(40_000),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return fail("Vercel said: " + (d?.error?.message || `HTTP ${res.status}`));

    let dep = d as { id: string; url: string; alias?: string[]; readyState?: string; errorMessage?: string };
    while (dep.readyState && !["READY", "ERROR", "CANCELED"].includes(dep.readyState) && Date.now() - t0 < 54_000) {
      await sleep(3000);
      const g = await fetch(`https://api.vercel.com/v13/deployments/${dep.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (g.ok) dep = await g.json();
    }
    if (dep.readyState === "ERROR") return fail("Vercel build failed: " + (dep.errorMessage || "see the deployment logs on Vercel."));

    const host = dep.alias?.[0] || dep.url;
    return NextResponse.json({ url: `https://${host}`, state: dep.readyState || "QUEUED", files: files.length });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Deploy failed.");
  }
}