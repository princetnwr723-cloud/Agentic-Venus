import { NextResponse } from "next/server";
import { connect, createSandbox, exec } from "@/lib/e2b-server";
import { verifyUser } from "@/lib/server-auth";
import { createSignedDownload, createSignedUpload } from "@/lib/supabase-server";
import { webRead, webSearch } from "@/lib/web-tools-server";
import { writeBinary } from "@/lib/venus-server";
import { ROOT, checkpoint, codeState, ensureWorkspace, listTree, q, resolvePath, runTool, startCodeSetup, wsRoot, type ToolResult } from "@/lib/code-server";
import type { ToolCall } from "@/lib/code-prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "web") {
      const text = body.query ? await webSearch(String(body.query)) : await webRead(String(body.url || ""));
      return NextResponse.json({ text: text.slice(0, 6000) });
    }

    const e2bKey = String(body.e2bKey || "");
    if (!e2bKey) return fail("E2B key missing.", 400);
    if (action === "create") {
      const c = await createSandbox(e2bKey, { provision: false });
      return NextResponse.json({ sandboxId: c.sandboxId });
    }
    const sandboxId = String(body.sandboxId || "");
    if (!sandboxId) return fail("sandboxId missing.", 400);
    const sb = await connect(e2bKey, sandboxId);
    const ws = String(body.ws || "");

    switch (action) {
      case "setup":
        await startCodeSetup(sb);
        return NextResponse.json({ ok: true });
      case "status":
        return NextResponse.json(await codeState(sb));

      case "ensure": {
        let restoreUrl: string | undefined;
        if (body.backupPath) {
          const { uid } = await verifyUser(req, body.uid);
          if (String(body.backupPath).startsWith(uid + "/")) restoreUrl = await createSignedDownload(String(body.backupPath), 600).catch(() => undefined);
        }
        return NextResponse.json(await ensureWorkspace(sb, ws, restoreUrl));
      }

      case "tools": {
        const calls = (Array.isArray(body.calls) ? body.calls : []).slice(0, 8) as ToolCall[];
        const started = Date.now();
        const results: ToolResult[] = [];
        let mutated = false;
        for (const c of calls) {
          const left = 52_000 - (Date.now() - started);
          if (left < 4000) { results.push({ text: "SKIPPED: out of time in this step — repeat this call in your next reply." }); continue; }
          try {
            const r = await runTool(sb, ws, c, left);
            if (r.mutated) mutated = true;
            results.push(r);
          } catch (e) {
            results.push({ text: "ERROR: " + (e instanceof Error ? e.message : "tool failed") });
          }
        }
        const sha = mutated ? await checkpoint(sb, ws, `Step: ${calls.map((c) => c.name + (c.attrs.path ? " " + c.attrs.path : "")).join(", ")}`).catch(() => null) : null;
        return NextResponse.json({ results, checkpoint: sha });
      }

      case "tree":
        return NextResponse.json({ files: await listTree(sb, ws) });

      case "readfile": {
        const abs = resolvePath(ws, String(body.path || ""));
        const r = await exec(sb, `test -f ${q(abs)} || { echo NOFILE; exit 3; }; head -c 200000 ${q(abs)}`, 15_000);
        if (r.stdout.startsWith("NOFILE")) return fail("File not found.", 404);
        return NextResponse.json({ content: r.stdout });
      }

      case "writefile": {
        const abs = resolvePath(ws, String(body.path || ""));
        await writeBinary(sb, abs, Buffer.from(String(body.content ?? ""), "utf8"));
        await checkpoint(sb, ws, `Manual edit: ${String(body.path)}`).catch(() => null);
        return NextResponse.json({ ok: true });
      }

      case "checkpoints": {
        const r = await exec(sb, `cd ${q(wsRoot(ws))} && git log --pretty=format:'%h|%ar|%s' -n 40`, 15_000);
        return NextResponse.json({
          items: r.stdout.split("\n").filter(Boolean).map((l) => { const [sha, when, ...rest] = l.split("|"); return { sha, when, msg: rest.join("|") }; }),
        });
      }

      case "restore": {
        const sha = String(body.sha || "");
        if (!/^[0-9a-f]{4,40}$/.test(sha)) return fail("Bad checkpoint id.", 400);
        const r = await exec(sb, `cd ${q(wsRoot(ws))} && git reset --hard ${sha} && git clean -fd`, 25_000);
        return r.exitCode === 0 ? NextResponse.json({ ok: true }) : fail("Restore failed: " + r.stderr.slice(0, 200));
      }

      case "previewurl": {
        const port = Math.min(65535, Math.max(1, Number(body.port) || 3000));
        const host = (sb as unknown as { getHost?: (p: number) => string }).getHost?.(port);
        if (!host) return fail("This E2B SDK cannot create preview URLs.");
        return NextResponse.json({ url: `https://${host}` });
      }

      case "backup": {
        const { uid } = await verifyUser(req, body.uid);
        const id = wsRoot(ws).split("/").pop() as string;
        const objectPath = `${uid}/code/${id}.zip`;
        const up = await createSignedUpload(objectPath);
        const r = await exec(sb, `cd ${ROOT} && rm -f /tmp/${id}.zip && zip -qr /tmp/${id}.zip ${id} -x '${id}/node_modules/*' '${id}/.next/*' '${id}/dist/*' '${id}/build/*' && code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 45 -X PUT ${q(up)} -H 'Content-Type: application/zip' -H 'x-upsert: true' --data-binary @/tmp/${id}.zip) && echo "$code"`, 58_000);
        if (r.stdout.trim() !== "200") return fail("Backup upload failed (HTTP " + r.stdout.trim() + ").");
        const url = await createSignedDownload(objectPath, 3600).catch(() => "");
        return NextResponse.json({ path: objectPath, url });
      }

      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Workspace request failed.");
  }
}