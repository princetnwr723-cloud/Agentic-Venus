import { acquire, releaseNow, setComputer, touch } from "@/lib/computers";
import type { ProviderId } from "@/lib/providers";

export type WorkerEnv = {
  uid: string; e2bKey: string; provider: ProviderId; apiKey: string; model: string; chatId: string; context?: string;
};

async function readJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: `Server returned ${res.status}: ${text.slice(0, 200) || "(empty response)"}` }; }
}

export async function runWorker(
  env: WorkerEnv,
  o: { slot: string; task: string; sandboxId?: string; keep?: boolean; maxActions?: number; onLine?: (l: string) => void }
): Promise<string> {
  const max = o.maxActions ?? 40;
  let sid = o.sandboxId ?? (await acquire(env, env.chatId, o.slot));
  const history: string[] = [];
  const notes: string[] = [];
  let lastOutput = "";
  let job: { id: string; command: string } | null = null;
  let actions = 0, guard = 0, invalid = 0;
  let summary = "";

  try {
    while (actions < max && guard < max * 3) {
      guard++;
      const tail = history.slice(-3).map((l) => l.split("→").pop()?.trim() ?? "");
      const hint = tail.length === 3 && tail[0] && tail[0] === tail[1] && tail[1] === tail[2]
        ? "You repeated the same action 3 times with no progress. Use a different tool or approach." : undefined;

      const res = await fetch("/api/e2b/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          e2bKey: env.e2bKey, sandboxId: sid, provider: env.provider, apiKey: env.apiKey, model: env.model,
          task: o.task, history: history.slice(-14), notes: notes.slice(-20), hint,
          stepNo: actions + 1, maxSteps: max, lastOutput: lastOutput || undefined,
          runningJob: job ?? undefined, context: env.context || undefined,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error || "A step failed.");
      touch(sid, env.e2bKey);

      if (data.newSandboxId) {
        sid = data.newSandboxId as string;
        if (!o.sandboxId) await setComputer(env, env.chatId, o.slot, sid);
        history.push(String(data.actionText));
        job = null;
        continue;
      }
      if (data.invalid) {
        if (++invalid >= 4) throw new Error("The model keeps answering in the wrong format — pick a stronger model.");
        continue;
      }
      invalid = 0;
      if (data.done) { summary = data.summary || "Done."; break; }

      if (data.ask) {
        lastOutput = "";
        const a = data.ask as { kind: string; site?: string; question?: string; options?: string[] };
        if (a.kind === "login") {
          history.push("Nobody can log in right now (unattended mode). If this task needs a login, call done and report that the user must log in.");
        } else if (a.kind === "choice") {
          const opts = a.options ?? [];
          const pick = opts.find((x) => /cancel|skip|no\b/i.test(x)) ?? opts[0] ?? "Cancel";
          history.push(`Asked "${a.question}" → unattended mode answered "${pick}". Outward-facing actions (sending, posting, buying, deleting) are NOT allowed unattended — report them as pending for the user.`);
        } else {
          history.push(`Asked "${a.question}" → nobody is available; use your best judgment or finish with what you have.`);
        }
        continue;
      }

      if (data.note) notes.push(String(data.note));
      if (data.job) job = data.job.done ? null : { id: data.job.id, command: data.job.command };
      lastOutput = typeof data.output === "string" ? data.output : "";
      actions++;
      const line = `${actions}. ${data.thought ? data.thought + " → " : ""}${data.actionText}`;
      history.push(line);
      o.onLine?.(line);
    }
    if (!summary) summary = "Reached the step limit — only partial work was done.";
    return notes.length ? `${summary}\n\nNotes:\n${notes.map((n) => "- " + n).join("\n")}` : summary;
  } catch (e) {
    return `Failed: ${e instanceof Error ? e.message : "unknown error"}`;
  } finally {
    if (!o.keep) await releaseNow(env.e2bKey, sid);
  }
}