// Server-only. Installs and starts the background PC agent inside a computer.
import { exec } from "@/lib/e2b-server";
import { writeFiles, type Sb } from "@/lib/venus-server";
import { BusyError, RDIR, runnerStatus } from "@/lib/runner-server";
import { PC_RUNNER_SOURCE, PC_RUNNER_VERSION } from "@/lib/pc-runner-script";
import { signJob } from "@/lib/job-token";

const wsId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "");

async function installPcRunner(sb: Sb) {
  const v = await exec(sb, `cat ${RDIR}/.pcversion 2>/dev/null`, 8_000);
  if (v.stdout.trim() === PC_RUNNER_VERSION) return;
  await writeFiles(sb, { [`${RDIR}/pc-runner.mjs`]: PC_RUNNER_SOURCE, [`${RDIR}/.pcversion`]: PC_RUNNER_VERSION });
}

export async function startPcJob(
  sb: Sb,
  o: {
    uid: string; chatId: string; task: string; provider: string; model: string; apiKey: string; appUrl: string;
    context?: string; maxSteps?: number; proof?: boolean; session?: unknown; healSnapshot?: string; startUrl?: string;
  }
): Promise<{ jobId: string }> {
  const chat = wsId(o.chatId);
  if (!chat) throw new Error("Bad chat id.");
  if (!/^https?:\/\//i.test(o.appUrl)) throw new Error("appUrl is missing.");

  const act = await exec(sb, `cat ${RDIR}/active-pc-${chat} 2>/dev/null`, 8_000);
  const prev = act.stdout.trim();
  if (/^[a-z0-9]{4,24}$/.test(prev)) {
    const s = await runnerStatus(sb, prev, 0).catch(() => null);
    if (s && s.state.status === "running") throw new BusyError("This computer already has a background task running. Wait for it or stop it first.");
  }

  await installPcRunner(sb);
  const jobId = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const dir = `${RDIR}/jobs/${jobId}`;
  await writeFiles(sb, {
    [`${dir}/job.json`]: JSON.stringify({
      jobId, instruction: o.task.slice(0, 6000), provider: o.provider, model: o.model, appUrl: o.appUrl,
      token: signJob(o.uid, o.chatId, jobId), context: (o.context ?? "").slice(0, 6000),
      maxSteps: Math.min(200, Math.max(10, o.maxSteps ?? 90)), proof: o.proof !== false,
      session: o.session ?? null, healSnapshot: o.healSnapshot?.slice(0, 6000), startUrl: o.startUrl,
    }),
    [`${dir}/key`]: o.apiKey,
  });
  const r = await exec(
    sb,
    `chmod 600 ${dir}/key && cd ${RDIR} && (setsid nohup bash -lc 'cd ${RDIR} && node pc-runner.mjs ${jobId} > jobs/${jobId}/runner.log 2>&1; echo $? > jobs/${jobId}/exit' >/dev/null 2>&1 &) ; echo ${jobId} > active-pc-${chat}; echo started`,
    20_000
  );
  if (!r.stdout.includes("started")) throw new Error("Could not start the background agent: " + (r.stderr || r.stdout).slice(0, 200));
  return { jobId };
}

export async function answerPcJob(sb: Sb, jobId: string, qid: string, reply: unknown) {
  if (!/^[a-z0-9]{4,24}$/.test(jobId) || !/^q\d{1,4}$/.test(qid)) throw new Error("Bad id.");
  await writeFiles(sb, { [`${RDIR}/jobs/${jobId}/answers/${qid}.json`]: JSON.stringify(reply ?? {}) });
}
