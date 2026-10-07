// Server-only. Installs and controls the background runner inside a computer.
import { exec } from "@/lib/e2b-server";
import { writeFiles, type Sb } from "@/lib/venus-server";
import { codeSystemPrompt } from "@/lib/code-prompts";
import { ensureWorkspace } from "@/lib/code-server";
import { RUNNER_SOURCE, RUNNER_VERSION } from "@/lib/runner-script";
import { signJob } from "@/lib/job-token";

export const RDIR = "/home/user/runner";
const okId = (s: string) => /^[a-z0-9]{4,24}$/.test(s);
const wsId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "");

export type RunnerEvent = {
  k: string; text: string; depth?: number; path?: string;
  lines?: Array<{ t: string; n?: number; text: string }>;
};
export type RunnerState = {
  status: "running" | "done" | "error" | "stopped" | "unknown";
  step?: number; summary?: string; memories?: string[]; updatedAt?: number; crashed?: boolean;
};

export class BusyError extends Error {
  code = "BUSY";
}

export async function installRunner(sb: Sb) {
  const v = await exec(sb, `cat ${RDIR}/.version 2>/dev/null`, 8_000);
  if (v.stdout.trim() === RUNNER_VERSION) return;
  await writeFiles(sb, { [`${RDIR}/runner.mjs`]: RUNNER_SOURCE, [`${RDIR}/.version`]: RUNNER_VERSION });
}

export async function runnerStatus(sb: Sb, jobId: string, offset = 0): Promise<{ state: RunnerState; events: RunnerEvent[]; next: number }> {
  if (!okId(jobId)) throw new Error("Bad job id.");
  const off = Math.max(0, Math.floor(offset) || 0);
  const r = await exec(
    sb,
    `cd ${RDIR}/jobs/${jobId} 2>/dev/null || { echo NOJOB; exit 0; }
cat state.json 2>/dev/null; echo
echo @@EXIT
cat exit 2>/dev/null; echo
echo @@LOG
tail -c 600 runner.log 2>/dev/null; echo
echo @@EV
tail -n +${off + 1} events.jsonl 2>/dev/null | head -n 300`,
    15_000
  );
  if (r.stdout.startsWith("NOJOB")) {
    return { state: { status: "unknown", crashed: true, summary: "The background job was not found on the computer." }, events: [], next: off };
  }
  const [statePart, afterState = ""] = r.stdout.split("@@EXIT\n");
  const [exitPart, afterExit = ""] = afterState.split("@@LOG\n");
  const [logPart, evPart = ""] = afterExit.split("@@EV\n");

  let state: RunnerState = { status: "running" };
  try { state = JSON.parse(statePart.trim()) as RunnerState; } catch { /* not written yet */ }
  const exitCode = exitPart.trim();
  if (state.status === "running" && exitCode !== "") {
    state = {
      ...state, status: "error", crashed: true,
      summary: `The background runner stopped unexpectedly (exit ${exitCode}). ${logPart.trim().slice(-400)}`.trim(),
    };
  }

  const events: RunnerEvent[] = [];
  for (const line of evPart.split("\n")) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line) as RunnerEvent); } catch { break; }
  }
  return { state, events, next: off + events.length };
}

export async function stopRunner(sb: Sb, jobId: string) {
  if (!okId(jobId)) throw new Error("Bad job id.");
  await exec(sb, `touch ${RDIR}/jobs/${jobId}/stop`, 8_000);
}

const BG_NOTE = `

# BACKGROUND MODE
You run as a detached background worker inside the computer. The user may have closed the browser. Nobody can answer questions (<ask> is auto-answered with "use your best judgment"). Work autonomously and finish with the finish tool.
Sub-agents work: task type=explore is read-only research, task type=write starts a WRITER in its own git worktree on exactly the files you list (up to 3 in parallel, disjoint files, merged back when done). Up to 4 task calls in ONE reply run in parallel.
Connected tools (GitHub, MCP servers...) are used through the tool function; write actions need the user's approval, so when the user is away they are NOT done: list them under "Needs you" in your final summary.
Big projects: keep a todo plan of milestones. After every milestone you get a clean context with your saved state (.venus/state.json), so put what matters into VENUS.md and the todo list.
Dev servers: start them with bash background=true on port 3000 bound to 0.0.0.0 (for example: npx next dev -H 0.0.0.0 -p 3000, npx vite --host 0.0.0.0 --port 3000, or python3 -m http.server 3000 --bind 0.0.0.0). The user opens them from the Preview tab ("Live server"). Never block on a foreground server command.
The look tool also works for a running dev server: look url=http://localhost:3000.`;

export async function startRunnerJob(
  sb: Sb,
  o: {
    ws: string; instruction: string; provider: string; model: string; apiKey: string; uid?: string; appUrl?: string;
    persona?: string; memory?: string;
    skills?: Array<{ name: string; description: string; instructions: string }>;
    earlier?: string; maxSteps?: number; restoreUrl?: string;
  }
): Promise<{ jobId: string }> {
  const id = wsId(o.ws);
  if (!id) throw new Error("Bad workspace id.");

  // one job per workspace
  const act = await exec(sb, `cat ${RDIR}/active-${id} 2>/dev/null`, 8_000);
  const prev = act.stdout.trim();
  if (okId(prev)) {
    const s = await runnerStatus(sb, prev, 0).catch(() => null);
    if (s && s.state.status === "running") throw new BusyError("This codespace already has a background job running. Wait for it to finish or stop it first.");
  }

  await installRunner(sb);
  const ws = await ensureWorkspace(sb, o.ws, o.restoreUrl);
  const skills = (o.skills ?? []).slice(0, 40);
  const skillList = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  const system =
    codeSystemPrompt({
      readOnly: false, ws: o.ws, persona: o.persona, memory: o.memory ?? "",
      skills: skillList ? `## Skills (load one with the skill tool when it matches)\n${skillList}` : "",
      venusMd: ws.venusMd, tree: ws.tree,
    }) + BG_NOTE;
  // keep a leading "[mode:...]" at the very start: the runner reads it from there
  const modeMatch = /^\s*\[mode:(plan|strict|auto)\]\s*/i.exec(o.instruction);
  const body = modeMatch ? o.instruction.slice(modeMatch[0].length) : o.instruction;
  const instruction = (modeMatch ? `[mode:${modeMatch[1].toLowerCase()}] ` : "") + (o.earlier ? `${body}\n\n# Earlier work in this codespace\n${o.earlier.slice(-3500)}` : body);

  const jobId = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const dir = `${RDIR}/jobs/${jobId}`;
  let token = "";
  try { if (o.uid && o.appUrl && /^https?:\/\//i.test(o.appUrl)) token = signJob(o.uid, o.ws, jobId); } catch { /* tools are simply unavailable */ }
  await writeFiles(sb, {
    [`${dir}/job.json`]: JSON.stringify({
      jobId, ws: o.ws, instruction, provider: o.provider, model: o.model, system, skills,
      appUrl: o.appUrl && /^https?:\/\//i.test(o.appUrl) ? o.appUrl : "", token,
      maxSteps: Math.min(500, Math.max(10, o.maxSteps ?? 250)), maxMinutes: 360, budgetChars: 9_000_000,
    }),
    [`${dir}/key`]: o.apiKey,
  });
  const r = await exec(
    sb,
    `chmod 600 ${dir}/key && cd ${RDIR} && (setsid nohup bash -lc 'cd ${RDIR} && node runner.mjs ${jobId} > jobs/${jobId}/runner.log 2>&1; echo $? > jobs/${jobId}/exit' >/dev/null 2>&1 &) ; echo ${jobId} > active-${id}; echo started`,
    20_000
  );
  if (!r.stdout.includes("started")) throw new Error("Could not start the background runner: " + (r.stderr || r.stdout).slice(0, 200));
  return { jobId };
}