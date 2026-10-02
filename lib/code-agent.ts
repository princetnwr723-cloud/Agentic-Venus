import { addMemory, bumpSkillUse, brainPrompt, loadBrain, reflect, type Brain } from "@/lib/brain";
import { codeSystemPrompt, parseTools, type ToolCall } from "@/lib/code-prompts";
import { getCodeComputer, saveCodeComputer, saveCodeProject, type CodeProject } from "@/lib/code-store";
import type { ProviderId } from "@/lib/providers";

export type CodeEnv = {
  uid: string; token: () => Promise<string>; e2bKey: string;
  apiKeys: Partial<Record<ProviderId, string>>; provider: ProviderId; model: string;
};
export type CodeEvent = {
  kind: "info" | "thought" | "tool" | "result" | "term" | "todo" | "error" | "preview" | "checkpoint" | "done" | "user";
  text: string; depth?: number;
};
export type CodeHooks = {
  event: (e: CodeEvent) => void;
  ask: (q: string, options: string[]) => Promise<string>;
  cancelled: () => boolean;
};

type Msg = { role: "user" | "assistant"; content: string; image?: { mediaType: string; data: string } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function readJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: `Server returned ${res.status}: ${text.slice(0, 200) || "(empty response)"}` }; }
}

export async function wsCall(env: CodeEnv, action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch("/api/code/ws", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await env.token()) },
    body: JSON.stringify({ action, uid: env.uid, e2bKey: env.e2bKey, ...extra }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error || "Workspace request failed.");
  return data;
}

export async function ensureCodeComputer(env: CodeEnv, hooks: CodeHooks): Promise<string> {
  let id = (await getCodeComputer(env.uid))?.sandboxId ?? null;
  const waitReady = async (sid: string) => {
    for (let i = 0; i < 120; i++) {
      if (hooks.cancelled()) throw new Error("Stopped.");
      await sleep(5000);
      const s = await wsCall(env, "status", { sandboxId: sid });
      const last = String(s.log || "").split("\n").filter(Boolean).slice(-1)[0];
      if (last) hooks.event({ kind: "info", text: "⚙️ " + last.slice(0, 120) });
      if (s.state === "ready") return;
      if (s.state === "failed") throw new Error("Code computer setup failed:\n" + String(s.log).slice(-500));
    }
    throw new Error("Code computer setup timed out.");
  };
  if (id) {
    try {
      const s = await wsCall(env, "status", { sandboxId: id });
      if (s.state === "ready") return id;
      if (s.state !== "installing") await wsCall(env, "setup", { sandboxId: id });
      await waitReady(id);
      return id;
    } catch (e) {
      if (!String((e as Error).message).includes("SANDBOX_GONE")) throw e;
    }
  }
  hooks.event({ kind: "info", text: "Creating your Code computer — the first setup takes 2-4 minutes." });
  const c = await wsCall(env, "create");
  id = c.sandboxId as string;
  await saveCodeComputer(env.uid, id);
  await wsCall(env, "setup", { sandboxId: id });
  await waitReady(id);
  return id;
}

type Ctx = {
  env: CodeEnv; hooks: CodeHooks; project: CodeProject; sandboxId: string; brain: Brain;
  venusMd: string; tree: string; previewUrl?: string;
};

async function llm(env: CodeEnv, messages: Msg[]): Promise<string> {
  const apiKey = env.apiKeys[env.provider];
  if (!apiKey) throw new Error("No API key saved for the selected model's provider.");
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: env.provider, apiKey, model: env.model, messages }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error || "Model request failed.");
  return String(data.reply ?? "");
}

const SERVER_TOOLS = new Set(["read", "ls", "glob", "grep", "write", "edit", "bash", "bash_output", "preview", "screenshot"]);
const WRITE_TOOLS = new Set(["write", "edit", "bash"]);

function parseTodo(body: string) {
  return body.split("\n")
    .map((l) => /^\s*[-*]\s*\[(.)\]\s*(.+)$/.exec(l))
    .filter(Boolean)
    .map((m) => `${m![1] === "x" ? "✓" : m![1] === "~" ? "…" : "○"} ${m![2].trim()}`)
    .join("\n");
}

function toolLabel(c: ToolCall): string {
  switch (c.name) {
    case "bash": return `$ ${c.body.trim().slice(0, 140)}${c.attrs.background === "true" ? "  (background)" : ""}`;
    case "grep": return `grep ${c.attrs.pattern ?? ""} ${c.attrs.path ?? ""}`;
    case "glob": return `glob ${c.attrs.pattern ?? ""}`;
    case "web_search": case "web_fetch": case "remember": return `${c.name} ${c.body.trim().slice(0, 100)}`;
    case "task": return `sub-agent (${c.attrs.type || "general"}): ${c.body.trim().slice(0, 100)}`;
    default: return `${c.name} ${c.attrs.path ?? c.attrs.url ?? c.attrs.port ?? c.attrs.name ?? ""}`.trim();
  }
}

async function agentLoop(
  ctx: Ctx, instruction: string,
  o: { readOnly: boolean; plan: boolean; maxSteps: number; depth: number }
): Promise<string> {
  const { env, hooks } = ctx;
  const d = o.depth;
  const skillList = ctx.brain.skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  const system = codeSystemPrompt({
    plan: o.plan, readOnly: o.readOnly, ws: ctx.project.id,
    memory: brainPrompt(ctx.brain, instruction, { noSkills: true }),
    skills: skillList ? `## Skills (load one with <skill name="..."/> when it matches)\n${skillList}` : "",
    venusMd: ctx.venusMd, tree: ctx.tree,
  });
  const earlier = d === 0 && ctx.project.ctx ? `\n\n# Earlier sessions in this workspace\n${ctx.project.ctx.slice(-3500)}` : "";
  let messages: Msg[] = [{ role: "user", content: `${system}${earlier}\n\n# TASK\n${instruction}` }];
  let allowWrite = !o.readOnly && !o.plan;
  let noTool = 0;
  const sigs: string[] = [];

  for (let step = 0; step < o.maxSteps; step++) {
    if (hooks.cancelled()) throw new Error("Stopped.");

    const size = messages.reduce((n, m) => n + m.content.length, 0);
    if (size > 90_000 && messages.length > 4) {
      const summary = await llm(env, [...messages, { role: "user", content: "Summarize the progress so far in under 400 words: goal, what is done, files changed, current state, open problems, next steps. No tool calls." }]).catch(() => "");
      messages = [messages[0], { role: "assistant", content: "Progress summary so far:\n" + (summary || "(summary unavailable)") }, { role: "user", content: "Continue from the summary. Re-read files before editing them." }];
      hooks.event({ kind: "info", text: "Context compacted.", depth: d });
    }

    const reply = await llm(env, messages);
    const { calls, thought } = parseTools(reply);
    if (thought) hooks.event({ kind: "thought", text: thought.slice(0, 600), depth: d });
    messages.push({ role: "assistant", content: reply });

    if (calls.length === 0) {
      if (++noTool >= 2) return thought || reply.slice(0, 2000);
      messages.push({ role: "user", content: "Use a tool, or call <finish>…</finish> if you are done." });
      continue;
    }
    noTool = 0;

    const sig = calls.map((c) => c.name + JSON.stringify(c.attrs) + c.body.slice(0, 60)).join("|");
    sigs.push(sig);
    if (sigs.length >= 3 && new Set(sigs.slice(-3)).size === 1) {
      messages.push({ role: "user", content: "You repeated the same tool calls 3 times. Change your approach." });
      continue;
    }

    const out: string[] = new Array(calls.length).fill("");
    let image: Msg["image"];
    let pending: Array<{ idx: number; call: ToolCall }> = [];
    let finish: string | null = null;

    const flush = async () => {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      const r = await wsCall(env, "tools", {
        sandboxId: ctx.sandboxId, ws: ctx.project.id,
        calls: batch.map((p) => ({ name: p.call.name, attrs: p.call.attrs, body: p.call.body, old: p.call.old, new: p.call.new })),
      });
      (r.results as Array<{ text: string; image?: Msg["image"]; preview?: string }>).forEach((res, j) => {
        const c = batch[j].call;
        out[batch[j].idx] = res.text;
        if (res.image) image = res.image;
        if (res.preview) { ctx.previewUrl = res.preview; hooks.event({ kind: "preview", text: res.preview, depth: d }); }
        hooks.event({ kind: c.name === "bash" ? "term" : "result", text: c.name === "bash" ? `$ ${c.body.trim()}\n${res.text}` : res.text.slice(0, 300), depth: d });
      });
      if (r.checkpoint) hooks.event({ kind: "checkpoint", text: String(r.checkpoint), depth: d });
    };

    for (let i = 0; i < calls.length && finish === null; i++) {
      const c = calls[i];
      hooks.event({ kind: "tool", text: toolLabel(c), depth: d });

      if (SERVER_TOOLS.has(c.name)) {
        if (WRITE_TOOLS.has(c.name) && !allowWrite) {
          out[i] = o.readOnly ? "Blocked: this is a read-only agent." : "Blocked: plan mode — get the plan approved with <ask> first.";
          continue;
        }
        pending.push({ idx: i, call: c });
        continue;
      }
      await flush();

      if (c.name === "todo") {
        const t = parseTodo(c.body);
        hooks.event({ kind: "todo", text: t, depth: d });
        out[i] = "Todo list updated.";
      } else if (c.name === "ask") {
        const [q, ...opts] = c.body.split("|").map((x) => x.trim()).filter(Boolean);
        const ans = await hooks.ask(q || "Need your input", opts);
        if (o.plan && /^approve/i.test(ans)) allowWrite = true;
        out[i] = `User answered: ${ans}`;
      } else if (c.name === "skill") {
        const s = ctx.brain.skills.find((x) => x.name.toLowerCase() === (c.attrs.name ?? "").toLowerCase());
        if (s) { out[i] = `# Skill: ${s.name}\n${s.instructions.slice(0, 12000)}`; bumpSkillUse(env.uid, s); }
        else out[i] = `ERROR: no skill named "${c.attrs.name}". Available: ${ctx.brain.skills.map((x) => x.name).join(", ") || "none"}`;
      } else if (c.name === "remember") {
        const m = await addMemory(env.uid, c.body, true);
        out[i] = m ? "Saved to memory." : "Not saved (duplicate or not allowed).";
      } else if (c.name === "web_search" || c.name === "web_fetch") {
        try {
          const r = await wsCall(env, "web", c.name === "web_search" ? { query: c.body.trim() } : { url: c.body.trim() });
          out[i] = String(r.text);
        } catch (e) { out[i] = "ERROR: " + (e instanceof Error ? e.message : "failed"); }
      } else if (c.name === "task") {
        if (d >= 2) out[i] = "ERROR: sub-agents cannot start more sub-agents.";
        else {
          const readOnly = (c.attrs.type ?? "explore") === "explore" || o.readOnly;
          try { out[i] = await agentLoop(ctx, c.body.trim(), { readOnly, plan: false, maxSteps: 30, depth: d + 1 }); }
          catch (e) { out[i] = "Sub-agent failed: " + (e instanceof Error ? e.message : "error"); }
        }
      } else if (c.name === "finish") {
        finish = c.body.trim() || "Done.";
      }
    }
    await flush();
    if (finish !== null) return finish;

    const results = calls.map((c, i) => `<result tool="${c.name}"${c.attrs.path ? ` path="${c.attrs.path}"` : ""}>\n${out[i].slice(0, 14_000)}\n</result>`).join("\n");
    messages.push({ role: "user", content: `<results>\n${results.slice(0, 40_000)}\n</results>\nContinue. Call <finish> when the task is complete and verified.`, ...(image ? { image } : {}) });
  }
  return "Reached the step limit before finishing — see the todo list and files for progress.";
}

export async function runCodeAgent(
  env: CodeEnv, hooks: CodeHooks, project: CodeProject, instruction: string,
  opts: { plan?: boolean; brain?: Brain; maxSteps?: number } = {}
): Promise<{ ok: boolean; summary: string; project: CodeProject }> {
  let p: CodeProject = { ...project };
  try {
    const sandboxId = await ensureCodeComputer(env, hooks);
    const brain = opts.brain ?? (await loadBrain(env.uid));
    const ensured = await wsCall(env, "ensure", { sandboxId, ws: p.id, backupPath: p.backupPath });
    if (ensured.restored) hooks.event({ kind: "info", text: "Workspace restored from your backup." });
    const ctx: Ctx = { env, hooks, project: p, sandboxId, brain, venusMd: ensured.venusMd, tree: ensured.tree };

    const summary = await agentLoop(ctx, instruction, { readOnly: false, plan: Boolean(opts.plan), maxSteps: opts.maxSteps ?? 80, depth: 0 });
    hooks.event({ kind: "done", text: summary });
    p = { ...p, ctx: (p.ctx + `\n- ${instruction.slice(0, 120)} → ${summary.slice(0, 300)}`).slice(-4000), previewUrl: ctx.previewUrl ?? p.previewUrl, updatedAt: Date.now() };

    try {
      const b = await wsCall(env, "backup", { sandboxId, ws: p.id });
      p = { ...p, backupPath: b.path };
    } catch { /* backup is best-effort */ }
    await saveCodeProject(env.uid, p).catch(() => {});

    reflect(env.uid, { apiKeys: env.apiKeys, provider: env.provider, model: env.model }, brain, { task: instruction, outcome: summary })
      .then((l) => { if (l.length) hooks.event({ kind: "info", text: "🧠 Learned: " + l.join("; ") }); })
      .catch(() => {});
    return { ok: true, summary, project: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The coding agent failed.";
    hooks.event({ kind: "error", text: msg });
    await saveCodeProject(env.uid, p).catch(() => {});
    return { ok: false, summary: msg, project: p };
  }
}