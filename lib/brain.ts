import { auth } from "@/lib/firebase";
import { bm25, jaccard } from "@/lib/bm25";
import type { ProviderId } from "@/lib/providers";

/** Memory and skills belong to ONE chat. Nothing is shared between chats. Storage is the server API (not client Firestore). */
export type Scope = { uid: string; chatId: string };
export type MemoryKind = "fact" | "preference" | "lesson" | "role";
export type Memory = { id: string; text: string; at: number; auto?: boolean; kind?: MemoryKind; weight?: number };
export type Skill = {
  id: string; name: string; description: string; instructions: string; source?: string; auto?: boolean;
  uses?: number; wins?: number; fails?: number; version?: number; trial?: boolean; disabled?: boolean; prev?: string; updatedAt: number;
};
export type Brain = { memories: Memory[]; skills: Skill[] };
export type LlmEnv = { apiKeys: Partial<Record<ProviderId, string>>; provider: ProviderId; model: string };
export type Verdict = "pass" | "partial" | "fail";

const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "skill";
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

async function bcall<T = any>(s: Scope, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/brain", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify({ action, chatId: s.chatId, ...extra }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || `Memory service error (HTTP ${res.status}).`);
  return d as T;
}

export async function loadBrain(s: Scope): Promise<Brain> {
  const d = await bcall<Brain>(s, "load");
  return { memories: d.memories ?? [], skills: d.skills ?? [] };
}
const readMem = async (s: Scope) => (await bcall<{ items: Memory[] }>(s, "mem_get")).items ?? [];
const writeMem = (s: Scope, items: Memory[]) => bcall(s, "mem_set", { items });

// ---------------- memory ----------------
type AddOpts = boolean | { auto?: boolean; kind?: MemoryKind; weight?: number };

export async function addMemory(s: Scope, text: string, o: AddOpts = false): Promise<Memory | null> {
  const opt = typeof o === "boolean" ? { auto: o } : o;
  const t = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (t.length < 3) return null;
  if (/(password|passwd|api[_ -]?key|secret|token|card number|cvv|otp)\s*[:=]/i.test(t)) return null; // never store secrets
  const items = await readMem(s);
  if (items.some((i) => norm(i.text) === norm(t))) return null;
  const similar = items.find((i) => i.kind !== "role" && jaccard(i.text, t) > 0.7);
  if (similar) {
    await writeMem(s, items.map((i) => (i.id === similar.id ? { ...i, text: t, at: Date.now() } : i)));
    return null;
  }
  const mem: Memory = {
    id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: t, at: Date.now(),
    ...(opt.auto ? { auto: true } : {}), kind: opt.kind ?? "fact", weight: Math.min(3, Math.max(1, opt.weight ?? 1)),
  };
  let next = [...items, mem];
  if (next.length > 200) {
    const drop = next.filter((i) => i.auto && i.kind !== "role" && i.id !== mem.id).sort((a, b) => (a.weight ?? 1) - (b.weight ?? 1) || a.at - b.at)[0] ?? next[0];
    next = next.filter((i) => i.id !== drop.id);
  }
  await writeMem(s, next);
  return mem;
}

/** The job the user gave this agent in this chat ("you are my CEO ..."). Pinned: always in the prompt. */
export async function setRole(s: Scope, text: string) {
  const items = (await readMem(s)).filter((i) => i.kind !== "role");
  await writeMem(s, [{ id: "role", text: text.replace(/\s+/g, " ").trim().slice(0, 400), at: Date.now(), kind: "role", weight: 3 }, ...items]);
}
export async function removeMemory(s: Scope, id: string) { await writeMem(s, (await readMem(s)).filter((i) => i.id !== id)); }
export async function forgetMemory(s: Scope, query: string): Promise<number> {
  const items = await readMem(s);
  const q = query.toLowerCase().trim();
  const keep = items.filter((i) => !i.text.toLowerCase().includes(q));
  await writeMem(s, keep);
  return items.length - keep.length;
}

// ---------------- skills ----------------
export async function saveSkill(
  s: Scope,
  k: { name: string; description: string; instructions: string; source?: string; auto?: boolean; trial?: boolean; prev?: string; version?: number; resetStats?: boolean }
): Promise<Skill> {
  return (await bcall<{ skill: Skill }>(s, "skill_put", { skill: k })).skill;
}
export const deleteSkill = async (s: Scope, id: string) => { await bcall(s, "skill_del", { id }); };
export const setSkillDisabled = async (s: Scope, id: string, disabled: boolean) => { await bcall(s, "skill_patch", { id, patch: { disabled } }); };
export async function bumpSkillUse(s: Scope, skill: Skill) { await bcall(s, "skill_patch", { id: skill.id, patch: { incUses: true } }).catch(() => {}); }

/** Did the skills that were used actually work? Trial skills get promoted, failing skills get paused. */
export async function recordSkillOutcome(s: Scope, brain: Brain, names: string[], verdict: Verdict): Promise<string[]> {
  const out: string[] = [];
  for (const name of names) {
    const sk = brain.skills.find((x) => x.name === name);
    if (!sk) continue;
    const wins = (sk.wins ?? 0) + (verdict === "pass" ? 1 : 0);
    const fails = (sk.fails ?? 0) + (verdict === "fail" ? 1 : 0);
    let trial = Boolean(sk.trial), disabled = Boolean(sk.disabled);
    if (trial && wins >= 2) { trial = false; out.push(`skill proven: ${name}`); }
    if (!disabled && fails >= 3 && fails > wins * 2) { disabled = true; out.push(`skill paused (keeps failing): ${name}`); }
    await bcall(s, "skill_patch", { id: sk.id, patch: { wins, fails, trial, disabled } });
  }
  return out;
}

export function parseSkillMarkdown(text: string): { name: string; description: string; instructions: string } | null {
  const m = /^\uFEFF?---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const get = (k: string) => { const r = new RegExp(`^${k}:\\s*(.+)$`, "im").exec(m[1]); return r ? r[1].trim().replace(/^["']|["']$/g, "") : ""; };
  const name = get("name"), instructions = m[2].trim();
  if (!name || !instructions) return null;
  return { name, description: get("description") || name, instructions };
}

export function rankSkills(skills: Skill[], text: string, n = 3): Skill[] {
  return bm25(skills.filter((x) => !x.disabled), (x) => `${x.name} ${x.name} ${x.description} ${x.instructions.slice(0, 600)}`, text).slice(0, n).map((x) => x.doc);
}

/** What goes into the agent's prompt: ITS role, ITS memory, ITS skills (this chat only). */
export function brainPrompt(brain: Brain, text: string, opts: { noSkills?: boolean } = {}): string {
  const parts: string[] = [];
  const role = brain.memories.find((m) => m.kind === "role");
  if (role) parts.push("## Your role (set by the user — always act in it)\n" + role.text);
  let mems = brain.memories.filter((m) => m.kind !== "role");
  if (mems.length > 12) {
    const top = bm25(mems, (m) => m.text, text).slice(0, 10).map((x) => x.doc);
    const heavy = mems.filter((m) => (m.weight ?? 1) >= 3).slice(-4);
    mems = [...top, ...heavy, ...mems.slice(-4)].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i).slice(0, 20);
  }
  if (mems.length) parts.push("## What you remember in THIS chat\n" + mems.map((m) => `- ${m.kind === "lesson" ? "(lesson) " : ""}${m.text}`).join("\n"));
  const live = brain.skills.filter((x) => !x.disabled);
  if (!opts.noSkills && live.length) {
    const top = rankSkills(live, text, 3);
    if (top.length) parts.push("## Skills you have learned — follow them when they apply\n" + top.map((x) => `### ${x.name}${x.trial ? " (still being tested)" : ""}\n${x.instructions.slice(0, 3500)}`).join("\n\n"));
    const rest = live.filter((x) => !top.some((t) => t.id === x.id));
    if (rest.length) parts.push("Other skills available: " + rest.map((x) => `${x.name} — ${x.description}`).join("; "));
  }
  return parts.length ? "\n\n" + parts.join("\n\n") : "";
}

async function llmJson(env: LlmEnv, prompt: string): Promise<any | null> {
  const apiKey = env.apiKeys[env.provider];
  if (!apiKey) return null;
  try {
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: env.provider, apiKey, model: env.model, messages: [{ role: "user", content: prompt }] }) });
    const text = String((await res.json()).reply ?? "");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    return a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : null;
  } catch { return null; }
}

export async function skillFromText(env: LlmEnv, text: string): Promise<{ name: string; description: string; instructions: string } | null> {
  const r = await llmJson(env, `Convert the following material into ONE reusable agent skill. Reply with JSON only: {"name":"short-kebab-case-name","description":"one sentence: what it does and when to use it","instructions":"clear step-by-step instructions in markdown"}. Keep the important details, code snippets and rules.\n\nMATERIAL:\n${text.slice(0, 14000)}`);
  return r?.name && r?.instructions ? { name: String(r.name), description: String(r.description ?? r.name), instructions: String(r.instructions) } : null;
}

/** Merges the auto-learned memories when there are too many (the user's own and the role are never touched). */
async function consolidate(s: Scope, env: LlmEnv) {
  const items = await readMem(s);
  if (items.length <= 80) return;
  const auto = items.filter((i) => i.auto && i.kind !== "role");
  const r = await llmJson(env, `Merge these notes of an AI agent into at most 40 shorter, non-duplicate notes. Keep every durable fact, preference and lesson; drop trivia. Reply with JSON only: {"items":[{"text":"...","kind":"fact|preference|lesson","weight":1-3}]}\n\n${auto.map((i) => `- ${i.text}`).join("\n").slice(0, 12000)}`);
  const merged = (Array.isArray(r?.items) ? r.items : []).slice(0, 40);
  if (!merged.length) return;
  const keep = items.filter((i) => !(i.auto && i.kind !== "role"));
  const fresh: Memory[] = merged.map((m: any, k: number) => ({ id: "c" + Date.now().toString(36) + k, text: String(m.text).slice(0, 300), at: Date.now(), auto: true, kind: (["fact", "preference", "lesson"].includes(m.kind) ? m.kind : "fact") as MemoryKind, weight: Math.min(3, Math.max(1, Number(m.weight) || 1)) }));
  await writeMem(s, [...keep, ...fresh]);
}

/** Self-improvement after a task (this chat only): score used skills, keep facts, make trial skills, store lessons, rewrite failing skills. */
export async function reflect(
  s: Scope, env: LlmEnv, brain: Brain,
  input: { task: string; outcome: string; steps?: string; verdict?: Verdict; skillsUsed?: string[] }
): Promise<string[]> {
  const learned: string[] = [];
  const verdict = input.verdict ?? "pass";
  const used = input.skillsUsed ?? [];
  if (used.length) learned.push(...(await recordSkillOutcome(s, brain, used, verdict)));

  const usedSkills = brain.skills.filter((x) => used.includes(x.name));
  const r = await llmJson(env, `You are the learning module of an AI agent that works for ONE user in ONE chat. Decide what is worth keeping from the task below.
Reply with JSON only:
{"memories":[{"text":"durable fact or preference about the user's work","kind":"fact|preference","weight":1-3}],
 "skill":null | {"name":"kebab-case","description":"what it does + when to use it","instructions":"markdown steps that worked"},
 "revisions":[{"skill":"name of a skill that was used","instructions":"the FULL improved instructions"}],
 "lessons":["what to do differently next time"]}
Rules: at most 3 memories; only durable, reusable, non-sensitive things (NEVER passwords, keys, tokens, card data, private data). Create "skill" only when a multi-step procedure worked AND is likely to repeat; not a duplicate of: ${brain.skills.map((x) => x.name).join(", ") || "(none)"}. "revisions" and "lessons" ONLY if the result below is "${verdict}" and not "pass": explain the real cause of the problem. Otherwise return empty lists.

RESULT: ${verdict}
TASK: ${input.task.slice(0, 600)}
OUTCOME: ${input.outcome.slice(0, 900)}
STEPS: ${(input.steps ?? "").slice(-1800)}
${verdict !== "pass" ? "SKILLS THAT WERE USED:\n" + usedSkills.map((x) => `### ${x.name}\n${x.instructions.slice(0, 1500)}`).join("\n\n") : ""}`);
  if (!r) return learned;

  for (const m of (Array.isArray(r.memories) ? r.memories : []).slice(0, 3)) {
    const saved = await addMemory(s, String(m?.text ?? m), { auto: true, kind: m?.kind === "preference" ? "preference" : "fact", weight: Number(m?.weight) || 1 });
    if (saved) learned.push(`remembered: ${saved.text}`);
  }
  if (r.skill?.name && r.skill?.instructions && String(r.skill.instructions).length > 150 && !brain.skills.some((x) => x.id === slug(String(r.skill.name)))) {
    await saveSkill(s, { name: String(r.skill.name), description: String(r.skill.description ?? ""), instructions: String(r.skill.instructions), auto: true, source: "learned", trial: true });
    learned.push(`new skill (on trial): ${r.skill.name}`);
  }
  if (verdict !== "pass") {
    for (const l of (Array.isArray(r.lessons) ? r.lessons : []).slice(0, 2)) {
      const saved = await addMemory(s, String(l), { auto: true, kind: "lesson", weight: 2 });
      if (saved) learned.push(`lesson: ${saved.text}`);
    }
    for (const v of (Array.isArray(r.revisions) ? r.revisions : []).slice(0, 1)) {
      const old = usedSkills.find((x) => x.name.toLowerCase() === String(v?.skill ?? "").toLowerCase());
      if (old && String(v?.instructions ?? "").length > 120) {
        await saveSkill(s, { name: old.name, description: old.description, instructions: String(v.instructions), auto: old.auto, source: old.source, prev: old.instructions, version: (old.version ?? 1) + 1, trial: true, resetStats: true });
        learned.push(`rewrote skill: ${old.name} (v${(old.version ?? 1) + 1})`);
      }
    }
  }
  await consolidate(s, env).catch(() => {});
  return learned;
}

/** One-click move of the OLD account-wide memory/skills into one chat (optional). */
export async function importLegacy(s: Scope): Promise<number> {
  const d = await bcall<{ memories: Memory[]; skills: Skill[] }>(s, "legacy");
  let n = 0;
  for (const it of d.memories ?? []) if (await addMemory(s, it.text, { auto: it.auto, kind: "fact" })) n++;
  for (const x of d.skills ?? []) { await saveSkill(s, { name: x.name, description: x.description, instructions: x.instructions, source: x.source, auto: x.auto }); n++; }
  return n;
}