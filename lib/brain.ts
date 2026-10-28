import { auth } from "@/lib/firebase";
import { hybrid } from "@/lib/bm25";
import { parseSkillMarkdown as parseSkillMd, rankSkillList, skillsPromptBlock } from "@/lib/skills-core";
import { agentFilesPrompt } from "@/lib/agent-files";
import { parseJsonLoose, slugOf, stepCountOf } from "@/lib/learn-utils";
import type { ProviderId } from "@/lib/providers";

/**
 * Memory and skills belong to ONE chat (its role, memories, skills, soul.md and memory.md).
 * The only thing shared between chats is the OWNER PROFILE (lasting facts about the owner as a person/business), and the owner can switch that off.
 * Storage is the server API (not client Firestore); every write is a server transaction, so two tabs or two runs can never overwrite each other.
 */
export type Scope = { uid: string; chatId: string };
export type MemoryKind = "fact" | "preference" | "lesson" | "role" | "profile";
export type Memory = { id: string; text: string; at: number; auto?: boolean; kind?: MemoryKind; weight?: number };
export type Skill = {
  id: string; name: string; description: string; instructions: string; source?: string; auto?: boolean; tags?: string[];
  uses?: number; wins?: number; fails?: number; version?: number; trial?: boolean; disabled?: boolean; prev?: string;
  files?: Record<string, string>; updatedAt: number;
};
/** files = the agent's soul.md and memory.md (loaded into every prompt). owner = the shared owner profile. */
export type Brain = {
  memories: Memory[]; skills: Skill[]; files?: { soul: string; memory: string };
  owner?: Memory[]; shareOwner?: boolean;
};
export type LlmEnv = { apiKeys: Partial<Record<ProviderId, string>>; provider: ProviderId; model: string };
export type Verdict = "pass" | "partial" | "fail";

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
  return { memories: d.memories ?? [], skills: d.skills ?? [], files: d.files ?? undefined, owner: d.owner ?? [], shareOwner: d.shareOwner !== false };
}
const readMem = async (s: Scope) => (await bcall<{ items: Memory[] }>(s, "mem_get")).items ?? [];

// ---------------- memory ----------------
type AddOpts = boolean | { auto?: boolean; kind?: MemoryKind; weight?: number };

/** Saves one memory on the server (secret check, duplicate check and the size limit all happen there). kind "profile" goes to the shared owner profile. */
export async function addMemory(s: Scope, text: string, o: AddOpts = false): Promise<Memory | null> {
  const opt = typeof o === "boolean" ? { auto: o } : o;
  const t = text.replace(/\s+/g, " ").trim().slice(0, 400);
  if (t.length < 3) return null;
  const d = await bcall<{ mem: Memory | null }>(s, "mem_add", { text: t, auto: Boolean(opt.auto), kind: opt.kind ?? "fact", weight: opt.weight ?? 1 });
  return d.mem ?? null;
}

/** The job the user gave this agent in this chat ("you are my CEO ..."). Pinned: always in the prompt. */
export async function setRole(s: Scope, text: string) { await bcall(s, "role_set", { text }); }
export async function removeMemory(s: Scope, id: string) { await bcall(s, "mem_remove", { id }); }
export async function forgetMemory(s: Scope, query: string): Promise<number> {
  if (query.trim().length < 3) return 0;
  return (await bcall<{ removed: number }>(s, "mem_forget", { query })).removed ?? 0;
}
/** Owner profile sharing between chats: on (default) or off. */
export async function setOwnerSharing(s: Scope, on: boolean) { await bcall(s, "owner_settings", { shareOwnerProfile: on }); }

// ---------------- skills ----------------
export async function saveSkill(
  s: Scope,
  k: {
    name: string; description: string; instructions: string; source?: string; auto?: boolean; trial?: boolean; prev?: string; version?: number;
    resetStats?: boolean; tags?: string[]; files?: Record<string, string> | null;
  }
): Promise<Skill> {
  return (await bcall<{ skill: Skill }>(s, "skill_put", { skill: k })).skill;
}
export const deleteSkill = async (s: Scope, id: string) => { await bcall(s, "skill_del", { id }); };
export const setSkillDisabled = async (s: Scope, id: string, disabled: boolean) => { await bcall(s, "skill_patch", { id, patch: { disabled } }); };
export async function bumpSkillUse(s: Scope, skill: Skill) { await bcall(s, "skill_patch", { id: skill.id, patch: { incUses: true } }).catch(() => {}); }

/** Small find-and-replace inside a skill (or one of its files). */
export async function patchSkill(s: Scope, name: string, oldStr: string, newStr: string, o: { file?: string; replaceAll?: boolean } = {}): Promise<Skill> {
  return (await bcall<{ skill: Skill }>(s, "skill_edit", { name, oldStr, newStr, file: o.file, replaceAll: Boolean(o.replaceAll) })).skill;
}
export async function rollbackSkill(s: Scope, name: string): Promise<Skill> {
  return (await bcall<{ skill: Skill }>(s, "skill_rollback", { name })).skill;
}
export async function setSkillFile(s: Scope, name: string, path: string, content: string): Promise<Skill> {
  return (await bcall<{ skill: Skill }>(s, "skill_file_put", { name, path, content })).skill;
}
export async function removeSkillFile(s: Scope, name: string, path: string) { await bcall(s, "skill_file_del", { name, path }); }

/** Did the skills that were used actually work? Trial skills get promoted, failing skills get paused (decided on the server, atomically). */
export async function recordSkillOutcome(s: Scope, brain: Brain, names: string[], verdict: Verdict): Promise<string[]> {
  const ids = names.map((n) => brain.skills.find((x) => x.name === n)?.id).filter((x): x is string => Boolean(x));
  if (!ids.length) return [];
  try { return (await bcall<{ events: string[] }>(s, "skill_outcome", { ids, verdict })).events ?? []; } catch { return []; }
}
/** Owner's thumbs up/down on the skills used in an answer. Counts as a pass/fail for them. */
export async function skillFeedback(s: Scope, names: string[], thumbs: 1 | -1): Promise<string[]> {
  return (await bcall<{ events: string[] }>(s, "skill_feedback", { names, thumbs })).events ?? [];
}

export const parseSkillMarkdown = parseSkillMd;

/** Best skills for a job: hybrid relevance (keywords + fuzzy) + a boost when the skill's type (video, code, email ...) matches the job. */
export function rankSkills(skills: Skill[], text: string, n = 3): Skill[] {
  return rankSkillList(skills, text, n);
}

function pickMem(list: Memory[], text: string, max: number): Memory[] {
  if (list.length <= max) return list;
  const top = text.trim() ? hybrid(list, (m) => m.text, text, { limit: Math.ceil(max * 0.6) }).map((x) => x.doc) : [];
  const heavy = list.filter((m) => (m.weight ?? 1) >= 3).slice(-4);
  return [...top, ...heavy, ...list.slice(-4)].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i).slice(0, max);
}

/**
 * What goes into the agent's prompt: soul.md + memory.md FIRST (read before every task), then ITS role, what it knows about the owner
 * (shared owner profile + this chat's profile facts), ITS memory, and skills.
 * Skills are loaded progressively: a one-line INDEX of every skill stays in the prompt, only the 1-2 best matches come in full,
 * everything else is loaded on demand with skill.read (saves tokens, like Hermes).
 * noSkills = the caller (Venus Pro, Venus Code, team planning) has no skill loader, so there is no index, only the best matches in full.
 */
export function brainPrompt(brain: Brain, text: string, opts: { noSkills?: boolean } = {}): string {
  const parts: string[] = [];
  if (brain.files && (brain.files.soul || brain.files.memory)) parts.push(agentFilesPrompt(brain.files));
  const role = brain.memories.find((m) => m.kind === "role");
  if (role) parts.push("## Your role (set by the user — always act in it)\n" + role.text);
  const seen = new Set<string>();
  const profile = [...(brain.shareOwner === false ? [] : brain.owner ?? []), ...brain.memories.filter((m) => m.kind === "profile")].filter((m) => {
    const k = m.text.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ").trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (profile.length) parts.push("## What you know about your owner (use it naturally, never recite it)\n" + pickMem(profile, text, 30).map((m) => `- ${m.text}`).join("\n"));
  const all = brain.memories.filter((m) => m.kind !== "role" && m.kind !== "profile");
  const mems = all.length > 12 ? pickMem(all, text, 20) : all;
  if (mems.length) parts.push("## What you remember in THIS chat\n" + mems.map((m) => `- ${m.kind === "lesson" ? "(lesson) " : ""}${m.text}`).join("\n"));
  parts.push(...skillsPromptBlock(brain.skills, text, opts.noSkills ? { full: 2, fullChars: 2500, index: false } : { full: 2, fullChars: 3000 }));
  return parts.length ? "\n\n" + parts.join("\n\n") : "";
}

/** Ask the model for JSON. Weak models add prose or break the format, so the parser is tolerant and it retries once. */
async function llmJson(env: LlmEnv, prompt: string): Promise<any | null> {
  const apiKey = env.apiKeys[env.provider];
  if (!apiKey) return null;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: env.provider, apiKey, model: env.model, messages: [{ role: "user", content: i === 0 ? prompt : `${prompt}\n\nIMPORTANT: reply with ONE valid JSON object only. No explanation, no code fences.` }] }),
      });
      const j = parseJsonLoose(String((await res.json()).reply ?? ""));
      if (j) return j;
    } catch { /* retry once */ }
  }
  return null;
}

export async function skillFromText(env: LlmEnv, text: string): Promise<{ name: string; description: string; instructions: string } | null> {
  const r = await llmJson(env, `Convert the following material into ONE reusable agent skill. Reply with JSON only: {"name":"short-kebab-case-name","description":"one sentence: what it does and when to use it","instructions":"clear step-by-step instructions in markdown"}. Keep the important details, code snippets and rules.\n\nMATERIAL:\n${text.slice(0, 14000)}`);
  return r?.name && r?.instructions ? { name: String(r.name), description: String(r.description ?? r.name), instructions: String(r.instructions) } : null;
}

/** Merges the auto-learned memories when there are too many (the user's own, the role and the profile are never touched). The swap is one server transaction. */
async function consolidate(s: Scope, env: LlmEnv) {
  const items = await readMem(s);
  if (items.length <= 150) return;
  const auto = items.filter((i) => i.auto && i.kind !== "role" && i.kind !== "profile");
  if (auto.length < 40) return;
  const r = await llmJson(env, `You tidy the long-term memory of an AI agent. Merge near-duplicates, drop trivia and outdated notes, keep EVERY durable fact, preference and lesson. Never invent anything. Reply with JSON only: {"items":[{"text":"short sentence","kind":"fact|preference|lesson","weight":1-3}]} (at most 60)\n\n${auto.map((i) => `- (${i.kind}) ${i.text}`).join("\n").slice(0, 14000)}`);
  const merged = (Array.isArray(r?.items) ? r.items : []).slice(0, 60);
  if (merged.length < 5 || merged.length >= auto.length) return;
  await bcall(s, "mem_merge", { removeIds: auto.map((i) => i.id), merged });
}

/** Self-improvement after a task (this chat only): log progress in memory.md, score used skills, keep facts, make trial skills, patch used skills, store lessons, rewrite failing skills. */
export async function reflect(
  s: Scope, env: LlmEnv, brain: Brain,
  input: { task: string; outcome: string; steps?: string; verdict?: Verdict; skillsUsed?: string[]; stepCount?: number }
): Promise<string[]> {
  const learned: string[] = [];
  const verdict = input.verdict ?? "pass";
  const used = input.skillsUsed ?? [];
  const stepCount = stepCountOf(input.steps, input.stepCount);
  const forceSkill = verdict === "pass" && stepCount >= 5;

  // progress line in memory.md (kept even if the learning model call below fails)
  void bcall(s, "files_log", { line: `${verdict}: ${input.task.replace(/\s+/g, " ").slice(0, 110)} → ${input.outcome.replace(/\s+/g, " ").slice(0, 170)}` }).catch(() => {});

  if (used.length) learned.push(...(await recordSkillOutcome(s, brain, used, verdict)));

  const usedSkills = brain.skills.filter((x) => used.includes(x.name));
  const steps = input.steps ?? "";
  const stepsText = steps.length > 2000 ? `${steps.slice(0, 600)}\n…\n${steps.slice(-1400)}` : steps;
  const r = await llmJson(env, `You are the learning module of an AI agent that works for ONE user in ONE chat. Decide what is worth keeping from the task below.
Reply with JSON only:
{"memories":[{"text":"durable fact or preference","kind":"fact|preference|profile","weight":1-3}],
 "skill":null | {"name":"kebab-case","description":"what it does + when to use it","instructions":"markdown steps that worked","files":{"references/notes.md":"optional longer reference text"}},
 "patches":[{"skill":"name of a skill that was used","old":"exact text inside that skill","new":"better text"}],
 "revisions":[{"skill":"name","instructions":"the FULL improved instructions"}],
 "lessons":["what to do differently next time"]}
Rules:
- at most 3 memories. kind "profile" = a lasting fact about the owner as a person or business. Only durable, reusable, non-sensitive things (NEVER passwords, keys, tokens, card data, private data).
- "skill": ${forceSkill ? `this task passed and needed ${stepCount} steps, so a reusable procedure very likely exists: write it unless it is clearly one-off` : "only when a multi-step procedure worked AND is likely to repeat"}. Write real steps (what to open, what to check, what went wrong and how to avoid it), not a story. Not a duplicate of: ${brain.skills.map((x) => x.name).join(", ") || "(none)"}.
- "patches": if a used skill was slightly wrong, outdated or missing a step, give a small find-and-replace (old must be copied exactly from the skill text below). Prefer patches over revisions.
- "revisions" and "lessons" ONLY if the result is not "pass": explain the real cause. Otherwise empty lists.

RESULT: ${verdict}
TASK: ${input.task.slice(0, 600)}
OUTCOME: ${input.outcome.slice(0, 900)}
STEPS (${stepCount}): ${stepsText}
${usedSkills.length ? "SKILLS THAT WERE USED:\n" + usedSkills.map((x) => `### ${x.name}\n${x.instructions.slice(0, 1500)}`).join("\n\n") : ""}`);
  if (!r) return learned;

  for (const m of (Array.isArray(r.memories) ? r.memories : []).slice(0, 3)) {
    const kind: MemoryKind = m?.kind === "preference" ? "preference" : m?.kind === "profile" ? "profile" : "fact";
    const saved = await addMemory(s, String(m?.text ?? m), { auto: true, kind, weight: Number(m?.weight) || 1 }).catch(() => null);
    if (saved) learned.push(`remembered: ${saved.text}`);
  }
  const sk = r.skill;
  if (verdict === "pass" && sk?.name && sk?.instructions && String(sk.instructions).length > 150 && !brain.skills.some((x) => x.id === slugOf(String(sk.name)))) {
    try {
      await saveSkill(s, { name: String(sk.name), description: String(sk.description ?? ""), instructions: String(sk.instructions), files: sk.files ?? undefined, auto: true, source: "learned", trial: true });
      learned.push(`new skill (on trial): ${sk.name}`);
    } catch { /* the server refused it (secret, instruction-like text, limit): fine */ }
  }
  for (const p of (Array.isArray(r.patches) ? r.patches : []).slice(0, 2)) {
    const target = usedSkills.find((x) => x.name.toLowerCase() === String(p?.skill ?? "").toLowerCase());
    if (!target) continue;
    try {
      const done = await patchSkill(s, target.name, String(p.old ?? ""), String(p.new ?? ""));
      learned.push(`improved skill: ${target.name} (v${done.version ?? "?"})`);
    } catch { /* the quoted text did not match: ignore */ }
  }
  if (verdict !== "pass") {
    for (const l of (Array.isArray(r.lessons) ? r.lessons : []).slice(0, 2)) {
      const saved = await addMemory(s, String(l), { auto: true, kind: "lesson", weight: 2 }).catch(() => null);
      if (saved) learned.push(`lesson: ${saved.text}`);
    }
    for (const v of (Array.isArray(r.revisions) ? r.revisions : []).slice(0, 1)) {
      const old = usedSkills.find((x) => x.name.toLowerCase() === String(v?.skill ?? "").toLowerCase());
      if (old && String(v?.instructions ?? "").length > 120) {
        try {
          await saveSkill(s, { name: old.name, description: old.description, instructions: String(v.instructions), auto: old.auto, source: old.source, trial: true, resetStats: true });
          learned.push(`rewrote skill: ${old.name} (v${(old.version ?? 1) + 1})`);
        } catch { /* refused */ }
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
