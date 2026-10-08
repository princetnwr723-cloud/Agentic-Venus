import { addMemory, brainPrompt, type Brain } from "@/lib/brain";
import { touch } from "@/lib/computers";
import type { CodeEnv, CodeEvent, CodeHooks, DiffLine } from "@/lib/code-agent";
import type { CodeProject, RunnerJob } from "@/lib/code-store";

export class RunnerStartError extends Error {
  constructor(m: string) { super(m); this.name = "RunnerStartError"; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rcall(env: CodeEnv, action: string, extra: Record<string, unknown>) {
  const res = await fetch("/api/runner", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await env.token()) },
    body: JSON.stringify({ action, uid: env.uid, e2bKey: env.e2bKey, ...extra }),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { error: `Server returned ${res.status}: ${text.slice(0, 160) || "(empty response)"}` }; }
  if (!res.ok) {
    const err = new Error(data?.error || "Runner request failed.") as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Starts the agent loop inside the computer (detached) and follows it while this tab is open.
 * If the tab closes, the job keeps running; /api/runner/tick finishes it and posts the report.
 */
export async function runCodeViaRunner(a: {
  env: CodeEnv; hooks: CodeHooks; emit: (e: CodeEvent) => void; project: CodeProject; sandboxId: string; brain: Brain;
  instruction: string; maxSteps?: number; persona?: string; setJob: (j: RunnerJob | null) => void;
}): Promise<string> {
  const { env, hooks, emit, project, sandboxId, brain } = a;
  const apiKey = env.apiKeys[env.provider];
  if (!apiKey) throw new Error("No API key saved for the selected model's provider.");

  let jobId: string;
  try {
    const r = await rcall(env, "start", {
      sandboxId, ws: project.id, instruction: a.instruction, provider: env.provider, model: env.model, apiKey,
      appUrl: window.location.origin, // without this the runner gets no job token, so connected tools (GitHub, MCP) never worked
      persona: a.persona, memory: brainPrompt(brain, a.instruction, { noSkills: true }),
      skills: brain.skills.filter((s) => !s.disabled).map((s) => ({ name: s.name, description: s.description, instructions: s.instructions })),
      earlier: project.ctx || undefined, maxSteps: a.maxSteps, backupPath: project.backupPath,
    });
    jobId = String(r.jobId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 409) throw err; // already busy: surface it
    throw new RunnerStartError(err.message || "start failed");
  }

  let offset = 0;
  const job = (): RunnerJob => ({ id: jobId, sandboxId: env.sandboxId ?? sandboxId, offset, hb: Date.now() });
  a.setJob(job());

  const pump = (events: Array<{ k: string; text: string; depth?: number; path?: string; lines?: unknown[] }>) => {
    for (const ev of events) {
      emit({ kind: ev.k as CodeEvent["kind"], text: ev.text, depth: ev.depth, path: ev.path, lines: ev.lines as DiffLine[] | undefined });
    }
  };

  let fails = 0;
  let stopSent = false;
  let finalState: { status: string; summary?: string; memories?: string[] } | null = null;
  try {
    for (;;) {
      await sleep(2500);
      if (hooks.cancelled() && !stopSent) {
        stopSent = true;
        await rcall(env, "stop", { sandboxId: env.sandboxId ?? sandboxId, jobId }).catch(() => {});
      }
      let st: any;
      try {
        st = await rcall(env, "status", { sandboxId: env.sandboxId ?? sandboxId, jobId, offset });
        fails = 0;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/SANDBOX_GONE|expired|not found|does not exist/i.test(msg) && fails < 1) {
          emit({ kind: "info", text: "⚠️ The computer disappeared. Recovering the coding workspace and continuing from the last saved state…" });
          const create = await fetch("/api/e2b/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey: env.e2bKey, uid: env.uid, recoveryPath: project.backupPath || undefined }),
          });
          const created = await create.json().catch(() => ({}));
          if (create.ok && created?.sandboxId) {
            const next = String(created.sandboxId);
            env.sandboxId = next;
            await import("@/lib/chats").then(({ updateChatPc }) => updateChatPc(env.uid, env.chatId, next, false, { persistence: created.persistence, recoveryPath: project.backupPath ?? null, recovery: true })).catch(() => {});
            const restart = await rcall(env, "start", {
              sandboxId: next, ws: project.id,
              instruction: `The previous computer disappeared. Continue the user's task from the restored workspace and existing git state. Do not redo completed work. Re-read the current files, verify what is already done, then continue until the original task is complete and tested.\n\nORIGINAL TASK:\n${a.instruction}`,
              provider: env.provider, model: env.model, apiKey,
              uid: env.uid, appUrl: window.location.origin, persona: a.persona,
              memory: brainPrompt(brain, a.instruction, { noSkills: true }),
              skills: brain.skills.filter((s) => !s.disabled).map((s) => ({ name: s.name, description: s.description, instructions: s.instructions })),
              earlier: project.ctx || undefined, maxSteps: a.maxSteps, backupPath: project.backupPath,
            });
            jobId = String(restart.jobId);
            offset = 0;
            fails = 0;
            a.setJob({ id: jobId, sandboxId: next, offset, hb: Date.now() });
            continue;
          }
        }
        if (++fails >= 25) throw e;
        continue;
      }
      touch(env.sandboxId ?? sandboxId, env.e2bKey);
      pump(st.events ?? []);
      offset = st.next ?? offset;
      a.setJob(job());
      if (st.state?.status && st.state.status !== "running") { finalState = st.state; break; }
    }
    // drain whatever is left
    for (let i = 0; i < 6; i++) {
      const more = await rcall(env, "status", { sandboxId: env.sandboxId ?? sandboxId, jobId, offset });
      pump(more.events ?? []);
      offset = more.next ?? offset;
      if ((more.events ?? []).length < 300) break;
    }
  } finally {
    if (finalState) a.setJob(null);
  }

  // what the agent chose to remember is saved for THIS chat only
  for (const m of finalState?.memories ?? []) await addMemory({ uid: env.uid, chatId: env.chatId }, m, true).catch(() => null);
  const summary = String(finalState?.summary || "Done.");
  if (finalState?.status === "stopped") throw new Error("Stopped.");
  if (finalState?.status === "error") throw new Error(summary);
  return summary;
}