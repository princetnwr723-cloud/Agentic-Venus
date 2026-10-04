import { addMemory, bumpSkillUse, brainPrompt, loadBrain, reflect, type Brain } from "@/lib/brain";
import { listChats } from "@/lib/chats";
import { touch } from "@/lib/computers";
import { codeSystemPrompt, parseTools, type ToolCall } from "@/lib/code-prompts";
import { saveCodeProject, watchCodeProject, type CodeLog, type CodeProject } from "@/lib/code-store";
import type { ProviderId } from "@/lib/providers";

export type CodeEnv = {
  uid: string; token: () => Promise<string>; e2bKey: string;
  apiKeys: Partial<Record<ProviderId, string>>; provider: ProviderId; model: string;
  chatId: string; sandboxId?: string;
};
export type DiffLine = { t: "+" | "-" | " "; n?: number; text: string };
export type CodeEvent = {
  kind: "info" | "thought" | "tool" | "result" | "term" | "todo" | "error" | "checkpoint" | "done" | "user" | "diff";
  text: string; depth?: number; lines?: DiffLine[]; path?: string;
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
  if (typeof extra.sandboxId === "string") touch(extra.sandboxId, env.e2bKey);
  return data;
}

/** Venus Code runs on its own computer (the dashboard passes it in as env.sandboxId). */
export async function resolveSandbox(env: CodeEnv): Promise<string> {
  if (env.sandboxId) return env.sandboxId;
  const c = (await listChats(env.uid)).find((x) => x.id === env.chatId);
  const id = (c as unknown as { computers?: Record<string, string> } | undefined)?.computers?.code;
  if (!id) throw new Error("This chat has no coding computer yet. Ask for code in the chat and it starts automatically.");
  return id;
}

async function ensureCodeTools(env: CodeEnv, sid: string, hooks: CodeHooks) {
  const s = await wsCall(env, "status", { sandboxId: sid });
  if (s.state === "ready") return;
  if (s.state !== "installing") {
    hooks.event({ kind: "info", text: "Installing coding tools on the computer (one time, a few minutes)…" });
    await wsCall(env, "setup", { sandboxId: sid });
  }
  for (let i = 0; i < 160; i++) {
    if (hooks.cancelled()) throw new Error("Stopped.");
    await sleep(5000);
    const t = await wsCall(env, "status", { sandboxId: sid });
    const last = String(t.log || "").split("\n").filter(Boolean).slice(-1)[0];
    if (last) hooks.event({ kind: "info", text: "⚙️ " + last.slice(0, 120) });
    if (t.state === "ready") return;
    if (t.state === "failed") throw new Error("Coding tools setup failed:\n" + String(t.log).slice(-500));
  }
  throw new Error("Coding tools setup timed out.");
}

type Ctx = { env: CodeEnv; hooks: CodeHooks; project: CodeProject; sandboxId: string; brain: Brain; venusMd: string; tree: string; persona?: string };

async function llm(env: CodeEnv, messages: Msg[]): Promise<string> {
  const apiKey = env.apiKeys[env.provider];
  if (!apiKey) throw new Error("No API key saved for the selected model's provider.");
  const res = await fetch("/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: env.provider, apiKey, model: env.model, messages }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error || "Model request failed.");
  return String(data.reply ?? "");
}

const SERVER_TOOLS = new Set(["read", "ls", "glob", "grep", "write", "edit", "bash", "bash_output", "look"]);
const WRITE_TOOLS = new Set(["write", "edit", "bash"]);

function diffOf(c: ToolCall): DiffLine[] {
  if (c.name === "write") {
    return c.body.replace(/^\n/, "").replace(/\n$/, "").split("\n").slice(0, 80).map((l, i) => ({ t: "+" as const, n: i + 1, text: l }));
  }
  const o = (c.old ?? "").split("\n").slice(0, 40).map((l) => ({ t: "-" as const, text: l }));
  const n = (c.new ?? "").split("\n").slice(0, 40).map((l) => ({ t: "+" as const, text: l }));
  return [...o, ...n];
}

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
    default: return `${c.name} ${c.attrs.path ?? c.attrs.url ?? c.attrs.name ?? ""}`.trim();
  }
}

async function agentLoop(ctx: Ctx, instruction: string, o: { readOnly: boolean; maxSteps: number; depth: number }): Promise<string> {
  const { env, hooks } = ctx;
  const d = o.depth;
  const skillList = ctx.brain.skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  const system = codeSystemPrompt({
    readOnly: o.readOnly, ws: ctx.project.id, persona: ctx.persona,
    memory: brainPrompt(ctx.brain, instruction, { noSkills: true }),
    skills: skillList ? `## Skills (load one with <skill name="..."/> when it matches)\n${skillList}` : "",
    venusMd: ctx.venusMd, tree: ctx.tree,
  });
  const earlier = d === 0 && ctx.project.ctx ? `\n\n# Earlier work in this codespace\n${ctx.project.ctx.slice(-3500)}` : "";
  let messages: Msg[] = [{ role: "user", content: `${system}${earlier}\n\n# TASK\n${instruction}` }];
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
    if (thought) hooks.event({ kind: "thought", text: thought.slice(0, 700), depth: d });
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
      (r.results as Array<{ text: string; image?: Msg["image"] }>).forEach((res, j) => {
        const c = batch[j].call;
        out[batch[j].idx] = res.text;
        if (res.image) image = res.image;
        hooks.event({ kind: c.name === "bash" ? "term" : "result", text: c.name === "bash" ? `$ ${c.body.trim()}\n${res.text}` : res.text.slice(0, 300), depth: d });
      });
      if (r.checkpoint) hooks.event({ kind: "checkpoint", text: String(r.checkpoint), depth: d });
    };

    for (let i = 0; i < calls.length && finish === null; i++) {
      const c = calls[i];
      hooks.event({ kind: "tool", text: toolLabel(c), depth: d });

      if (SERVER_TOOLS.has(c.name)) {
        if (WRITE_TOOLS.has(c.name) && o.readOnly) { out[i] = "Blocked: this is a read-only agent."; continue; }
        if (c.name === "write" || c.name === "edit") hooks.event({ kind: "diff", text: c.name, path: c.attrs.path, lines: diffOf(c), depth: d });
        pending.push({ idx: i, call: c });
        continue;
      }
      await flush();

      if (c.name === "todo") {
        hooks.event({ kind: "todo", text: parseTodo(c.body), depth: d });
        out[i] = "Todo list updated.";
      } else if (c.name === "ask") {
        const [q, ...opts] = c.body.split("|").map((x) => x.trim()).filter(Boolean);
        out[i] = `User answered: ${await hooks.ask(q || "Need your input", opts)}`;
      } else if (c.name === "skill") {
        const s = ctx.brain.skills.find((x) => x.name.toLowerCase() === (c.attrs.name ?? "").toLowerCase());
        if (s) { out[i] = `# Skill: ${s.name}\n${s.instructions.slice(0, 12000)}`; bumpSkillUse(env.uid, s); }
        else out[i] = `ERROR: no skill named "${c.attrs.name}". Available: ${ctx.brain.skills.map((x) => x.name).join(", ") || "none"}`;
      } else if (c.name === "remember") {
        out[i] = (await addMemory(env.uid, c.body, true)) ? "Saved to memory." : "Not saved (duplicate or not allowed).";
      } else if (c.name === "web_search" || c.name === "web_fetch") {
        try {
          out[i] = String((await wsCall(env, "web", c.name === "web_search" ? { query: c.body.trim() } : { url: c.body.trim() })).text);
        } catch (e) { out[i] = "ERROR: " + (e instanceof Error ? e.message : "failed"); }
      } else if (c.name === "task") {
        if (d >= 2) out[i] = "ERROR: sub-agents cannot start more sub-agents.";
        else {
          const readOnly = (c.attrs.type ?? "explore") === "explore" || o.readOnly;
          try { out[i] = await agentLoop(ctx, c.body.trim(), { readOnly, maxSteps: 30, depth: d + 1 }); }
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

/** One codespace per chat: the workspace id is the chat id. Events are saved live so the Code page can follow along. */
export async function runCodeAgent(
  env: CodeEnv, hooks: CodeHooks, project: CodeProject, instruction: string,
  opts: { brain?: Brain; maxSteps?: number; persona?: string } = {}
): Promise<{ ok: boolean; summary: string; project: CodeProject }> {
  let p: CodeProject = { ...project, running: true, stop: false };
  const log: CodeLog[] = [...(p.log ?? [])];
  let last = 0;
  let stopped = false;
  const flush = async (force = false) => {
    if (!force && Date.now() - last < 2500) return;
    last = Date.now();
    await saveCodeProject(env.uid, { ...p, log, updatedAt: Date.now() }).catch(() => {});
  };
  const emit = (e: CodeEvent) => {
    hooks.event(e);
    if (e.kind === "todo") p.todo = e.text;
    log.push({ kind: e.kind, text: e.text.slice(0, e.kind === "term" ? 1200 : 800), depth: e.depth, path: e.path, lines: e.lines?.slice(0, 40) });
    void flush();
  };
  const wrapped: CodeHooks = { ...hooks, event: emit, cancelled: () => stopped || hooks.cancelled() };
  await flush(true);
  const unsub = watchCodeProject(env.uid, p.id, (d) => { if (d?.stop) stopped = true; });

  try {
    emit({ kind: "user", text: instruction });
    const sandboxId = await resolveSandbox(env);
    await ensureCodeTools(env, sandboxId, wrapped);
    const brain = opts.brain ?? (await loadBrain(env.uid));
    const ensured = await wsCall(env, "ensure", { sandboxId, ws: p.id, backupPath: p.backupPath });
    if (ensured.restored) emit({ kind: "info", text: "Codespace restored from your backup." });
    const ctx: Ctx = { env, hooks: wrapped, project: p, sandboxId, brain, venusMd: ensured.venusMd, tree: ensured.tree, persona: opts.persona };

    const summary = await agentLoop(ctx, instruction, { readOnly: false, maxSteps: opts.maxSteps ?? 80, depth: 0 });
    emit({ kind: "done", text: summary });
    p = { ...p, ctx: (p.ctx + `\n- ${instruction.slice(0, 120)} → ${summary.slice(0, 300)}`).slice(-4000) };
    try { p = { ...p, backupPath: (await wsCall(env, "backup", { sandboxId, ws: p.id })).path }; } catch { /* best-effort */ }

    reflect(env.uid, { apiKeys: env.apiKeys, provider: env.provider, model: env.model }, brain, { task: instruction, outcome: summary })
      .then((l) => { if (l.length) hooks.event({ kind: "info", text: "🧠 Learned: " + l.join("; ") }); })
      .catch(() => {});
    unsub();
    p = { ...p, running: false, stop: false };
    await flush(true);
    return { ok: true, summary, project: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The coding agent failed.";
    emit({ kind: "error", text: msg });
    unsub();
    p = { ...p, running: false, stop: false };
    await flush(true);
    return { ok: false, summary: msg, project: p };
  }
}