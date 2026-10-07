import { NextResponse } from "next/server";
import { connect } from "@/lib/e2b-server";
import { readBody } from "@/lib/request";
import { createSignedDownload } from "@/lib/supabase-server";
import { BusyError, runnerStatus, startRunnerJob, stopRunner } from "@/lib/runner-server";
import { answerPcJob, startPcJob } from "@/lib/pc-runner-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const uid = String(body.uid);
    const action = String(body.action || "");
    const e2bKey = String(body.e2bKey || "");
    const sandboxId = String(body.sandboxId || "");
    if (!e2bKey) return fail("E2B key missing.", 400);
    if (!sandboxId) return fail("This chat has no computer yet.", 400);
    const sb = await connect(e2bKey, sandboxId); // also wakes a paused computer and extends its life

    switch (action) {
      case "start": {
        const provider = String(body.provider || "");
        const model = String(body.model || "");
        const apiKey = String(body.apiKey || "");
        const instruction = String(body.instruction || "").trim();
        if (!provider || !model || !apiKey || !instruction) return fail("Provider, model, key and instruction are required.", 400);
        let restoreUrl: string | undefined;
        if (body.backupPath && String(body.backupPath).startsWith(uid + "/")) {
          restoreUrl = await createSignedDownload(String(body.backupPath), 600).catch(() => undefined);
        }
        const skills = (Array.isArray(body.skills) ? body.skills : []).slice(0, 40).map((s: Record<string, unknown>) => ({
          name: String(s?.name ?? "").slice(0, 80),
          description: String(s?.description ?? "").slice(0, 300),
          instructions: String(s?.instructions ?? "").slice(0, 12000),
        }));
        try {
          const r = await startRunnerJob(sb, {
            ws: String(body.ws || ""), instruction: instruction.slice(0, 12000), provider, model, apiKey,
            uid, appUrl: typeof body.appUrl === "string" ? body.appUrl : "",
            persona: typeof body.persona === "string" ? body.persona.slice(0, 2000) : undefined,
            memory: typeof body.memory === "string" ? body.memory.slice(0, 12000) : "",
            skills, earlier: typeof body.earlier === "string" ? body.earlier : undefined,
            maxSteps: Number(body.maxSteps) || undefined, restoreUrl,
          });
          return NextResponse.json(r);
        } catch (e) {
          if (e instanceof BusyError) return fail(e.message, 409);
          throw e;
        }
      }
      case "pcstart": {
        const provider = String(body.provider || "");
        const model = String(body.model || "");
        const apiKey = String(body.apiKey || "");
        const task = String(body.task || "").trim();
        if (!provider || !model || !apiKey || !task) return fail("Provider, model, key and task are required.", 400);
        try {
          const r = await startPcJob(sb, {
            uid, chatId: String(body.chatId || ""), task, provider, model, apiKey, appUrl: String(body.appUrl || ""),
            context: typeof body.context === "string" ? body.context : undefined,
            maxSteps: Number(body.maxSteps) || undefined, proof: body.proof !== false,
            session: body.session, healSnapshot: typeof body.healSnapshot === "string" ? body.healSnapshot : undefined,
            startUrl: typeof body.startUrl === "string" ? body.startUrl : undefined,
            contract: body.contract,
          });
          return NextResponse.json(r);
        } catch (e) {
          if (e instanceof BusyError) return fail(e.message, 409);
          throw e;
        }
      }
      case "answer":
        await answerPcJob(sb, String(body.jobId || ""), String(body.qid || ""), body.reply);
        return NextResponse.json({ ok: true });
      case "status":
        return NextResponse.json(await runnerStatus(sb, String(body.jobId || ""), Number(body.offset) || 0));
      case "stop":
        await stopRunner(sb, String(body.jobId || ""));
        return NextResponse.json({ ok: true });
      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Runner request failed.");
  }
}