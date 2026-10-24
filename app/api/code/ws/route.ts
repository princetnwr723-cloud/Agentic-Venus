import { NextResponse } from "next/server";
import { connect, exec } from "@/lib/e2b-server";
import { readBody, requestStatus } from "@/lib/request";
import { createSignedDownload, createSignedUpload } from "@/lib/supabase-server";
import { webRead, webSearch } from "@/lib/web-tools-server";
import { DIR, safeId, writeBinary } from "@/lib/venus-server";
import {
  ASSETS, ROOT, checkpoint, codeState, ensureWorkspace, htmlBundle, listAssets, listTree, q, resolvePath, runTool,
  startCodeSetup, wsRoot, type ToolResult,
} from "@/lib/code-server";
import type { ToolCall } from "@/lib/code-prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });

/** A failed setup is repaired automatically (the setup script is safe to re-run) before the user ever sees an error. */
const MAX_SETUP_REPAIRS = 2;

type SetupState = Awaited<ReturnType<typeof codeState>>;
type Box = Awaited<ReturnType<typeof connect>>;

/** A setup from an older script version can sit in "waiting for another package install" forever: restart it with the current script. */
async function restartStuckSetup(sb: Box, s: SetupState): Promise<SetupState | null> {
  const last = s.log.split("\n").filter(Boolean).slice(-1)[0] ?? "";
  if (!/waiting for another package install/i.test(last)) return null;
  const r = await exec(sb, "echo $(( $(date +%s) - $(stat -c %Y /tmp/jobs/codesetup.sh 2>/dev/null || date +%s) ))", 8_000);
  const age = parseInt(r.stdout.trim(), 10) || 0;
  if (age < 90) return null;
  await exec(sb, "pkill -f 'codesetup[.]sh'; sleep 1; rm -f /tmp/jobs/codesetup.exit", 12_000).catch(() => null);
  await startCodeSetup(sb);
  return { state: "installing", log: "Setup was stuck waiting for another install. Restarted it with the fixed script..." };
}

async function codeStateWithRepair(sb: Box): Promise<SetupState> {
  const s = await codeState(sb);
  if (s.state === "installing") return (await restartStuckSetup(sb, s)) ?? s;
  if (s.state !== "failed") return s;
  const r = await exec(sb, "cat /tmp/jobs/codesetup.tries 2>/dev/null || echo 0", 8_000);
  const tries = parseInt(r.stdout.trim(), 10) || 0;
  if (tries >= MAX_SETUP_REPAIRS) return s;
  await exec(sb, `mkdir -p /tmp/jobs && echo ${tries + 1} > /tmp/jobs/codesetup.tries`, 8_000);
  await startCodeSetup(sb);
  const why = s.log.split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 220);
  return { state: "installing", log: `Setup hit a problem (${why}). Repairing automatically, attempt ${tries + 2} of ${MAX_SETUP_REPAIRS + 1}...` };
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const uid = String(body.uid);
    const action = String(body.action || "");

    if (action === "web") {
      const text = body.query ? await webSearch(String(body.query)) : await webRead(String(body.url || ""));
      return NextResponse.json({ text: text.slice(0, 6000) });
    }

    const e2bKey = String(body.e2bKey || "");
    const sandboxId = String(body.sandboxId || "");
    if (!e2bKey) return fail("E2B key missing.", 400);
    if (!sandboxId) return fail("This chat has no computer yet — turn it on first.", 400);
    const sb = await connect(e2bKey, sandboxId); // resumes a paused computer
    const ws = String(body.ws || "");

    switch (action) {
      case "setup":
        await exec(sb, "rm -f /tmp/jobs/codesetup.tries", 8_000).catch(() => null);
        await startCodeSetup(sb);
        return NextResponse.json({ ok: true });
      case "status":
        return NextResponse.json(await codeStateWithRepair(sb));

      case "ensure": {
        let restoreUrl: string | undefined;
        if (body.backupPath && String(body.backupPath).startsWith(uid + "/")) {
          restoreUrl = await createSignedDownload(String(body.backupPath), 600).catch(() => undefined);
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

      case "htmlpreview":
        return NextResponse.json(await htmlBundle(sb, ws, body.entry ? String(body.entry) : undefined));

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
        return NextResponse.json({ items: r.stdout.split("\n").filter(Boolean).map((l) => { const [sha, when, ...rest] = l.split("|"); return { sha, when, msg: rest.join("|") }; }) });
      }

      case "restore": {
        const sha = String(body.sha || "");
        if (!/^[0-9a-f]{4,40}$/.test(sha)) return fail("Bad checkpoint id.", 400);
        const r = await exec(sb, `cd ${q(wsRoot(ws))} && git reset --hard ${sha} && git clean -fd`, 25_000);
        return r.exitCode === 0 ? NextResponse.json({ ok: true }) : fail("Restore failed: " + r.stderr.slice(0, 200));
      }

      case "backup": {
        const id = wsRoot(ws).split("/").pop() as string;
        const objectPath = `${uid}/code/${id}.zip`;
        const up = await createSignedUpload(objectPath);
        const r = await exec(sb, `cd ${ROOT} && rm -f /tmp/${id}.zip && zip -qr /tmp/${id}.zip ${id} -x '${id}/node_modules/*' '${id}/.next/*' '${id}/dist/*' '${id}/build/*' && code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 45 -X PUT ${q(up)} -H 'Content-Type: application/zip' -H 'x-upsert: true' --data-binary @/tmp/${id}.zip) && echo "$code"`, 58_000);
        if (r.stdout.trim() !== "200") return fail("Backup upload failed (HTTP " + r.stdout.trim() + ").");
        const url = await createSignedDownload(objectPath, 3600).catch(() => "");
        return NextResponse.json({ path: objectPath, url });
      }

      // ---- assets the PC agent downloaded (Venus Pro uses them) ----
      case "listassets":
        return NextResponse.json({ files: await listAssets(sb) });

      case "copyasset": {
        const pid = safeId(body.pid);
        const name = String(body.name || "");
        if (!/^[A-Za-z0-9._ -]{1,120}$/.test(name) || name.includes("..")) return fail("Bad asset name.", 400);
        const kind = body.kind === "vid" ? "vid" : "img";
        const idx = Math.max(0, Math.min(60, Number(body.index) || 0));
        const ext = (name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
        const rel = `p/${pid}/${kind}/asset-${idx}.${ext}`;
        const r = await exec(sb, `mkdir -p ${DIR}/public/p/${pid}/${kind} && cp ${q(ASSETS + "/" + name)} ${q(DIR + "/public/" + rel)}`, 20_000);
        return r.exitCode === 0 ? NextResponse.json({ path: rel }) : fail("Asset not found: " + name);
      }

      case "fetchasset": {
        const url = String(body.url || "");
        const name = String(body.name || "").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
        let host = "";
        try { host = new URL(url).hostname.toLowerCase(); } catch { /* invalid */ }
        if (!/^https:\/\//.test(url) || !name || !host || host === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return fail("Only public https links can be downloaded.", 400);
        const r = await exec(sb, `mkdir -p ${ASSETS} && curl -fsSL --max-time 50 --max-filesize 83886080 -o ${q(ASSETS + "/" + name)} ${q(url)}`, 56_000);
        return r.exitCode === 0 ? NextResponse.json({ name }) : fail("Download failed.");
      }

      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Workspace request failed.", requestStatus(err));
  }
}
