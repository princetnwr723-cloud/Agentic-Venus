import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ProviderId } from "@/lib/providers";

export type Memory = { id: string; text: string; at: number; auto?: boolean };
export type Skill = {
  id: string; name: string; description: string; instructions: string;
  source?: string; auto?: boolean; uses?: number; updatedAt: number;
};
export type Brain = { memories: Memory[]; skills: Skill[] };
export type LlmEnv = { apiKeys: Partial<Record<ProviderId, string>>; provider: ProviderId; model: string };

const memRef = (uid: string) => doc(db, "users", uid, "brain", "memories");
const skillCol = (uid: string) => collection(db, "users", uid, "skills");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "skill";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => norm(s).split(" ").filter((w) => w.length > 3);

export async function loadBrain(uid: string): Promise<Brain> {
  const [m, s] = await Promise.all([getDoc(memRef(uid)).catch(() => null), getDocs(skillCol(uid)).catch(() => null)]);
  const memories = ((m?.data() as { items?: Memory[] } | undefined)?.items ?? []) as Memory[];
  const skills = (s?.docs ?? []).map((d) => d.data() as Skill);
  return { memories, skills };
}

async function readMemories(uid: string): Promise<Memory[]> {
  const m = await getDoc(memRef(uid)).catch(() => null);
  return ((m?.data() as { items?: Memory[] } | undefined)?.items ?? []) as Memory[];
}

export async function addMemory(uid: string, text: string, auto = false): Promise<Memory | null> {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (t.length < 3) return null;
  if (/(password|passwd|api[_ -]?key|secret|token)\s*[:=]/i.test(t)) return null; // never store secrets
  const items = await readMemories(uid);
  const n = norm(t);
  if (items.some((i) => norm(i.text) === n)) return null;
  const mem: Memory = { id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: t, at: Date.now(), ...(auto ? { auto: true } : {}) };
  await setDoc(memRef(uid), { items: [...items, mem].slice(-200) });
  return mem;
}

export async function removeMemory(uid: string, id: string) {
  const items = await readMemories(uid);
  await setDoc(memRef(uid), { items: items.filter((i) => i.id !== id) });
}

export async function forgetMemory(uid: string, query: string): Promise<number> {
  const items = await readMemories(uid);
  const q = query.toLowerCase().trim();
  const keep = items.filter((i) => !i.text.toLowerCase().includes(q));
  await setDoc(memRef(uid), { items: keep });
  return items.length - keep.length;
}

export async function saveSkill(
  uid: string,
  s: { name: string; description: string; instructions: string; source?: string; auto?: boolean }
): Promise<Skill> {
  const id = slug(s.name);
  const prev = await getDoc(doc(skillCol(uid), id)).catch(() => null);
  const old = prev?.exists() ? (prev.data() as Skill) : null;
  const skill: Skill = {
    id,
    name: s.name.trim().slice(0, 80),
    description: s.description.trim().slice(0, 300),
    instructions: s.instructions.trim().slice(0, 20000),
    ...(s.source ? { source: s.source.slice(0, 300) } : {}),
    ...(s.auto ? { auto: true } : {}),
    uses: old?.uses ?? 0,
    updatedAt: Date.now(),
  };
  await setDoc(doc(skillCol(uid), id), JSON.parse(JSON.stringify(skill)));
  return skill;
}

export async function deleteSkill(uid: string, id: string) {
  await deleteDoc(doc(skillCol(uid), id));
}

export async function bumpSkillUse(uid: string, skill: Skill) {
  await setDoc(doc(skillCol(uid), skill.id), { uses: (skill.uses ?? 0) + 1 }, { merge: true }).catch(() => {});
}

/** Parses a SKILL.md (YAML frontmatter with name + description, then instructions). */
export function parseSkillMarkdown(text: string): { name: string; description: string; instructions: string } | null {
  const m = /^\uFEFF?---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const get = (k: string) => {
    const r = new RegExp(`^${k}:\\s*(.+)$`, "im").exec(m[1]);
    return r ? r[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  const name = get("name");
  const description = get("description");
  const instructions = m[2].trim();
  if (!name || !instructions) return null;
  return { name, description: description || name, instructions };
}

export function rankSkills(skills: Skill[], text: string, n = 3): Skill[] {
  const t = new Set(words(text));
  return skills
    .map((s) => {
      const nameW = new Set(words(s.name));
      const descW = new Set(words(s.description));
      let score = 0;
      t.forEach((w) => { if (nameW.has(w)) score += 3; if (descW.has(w)) score += 1; });
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.s);
}

/** Text that is added to an agent's prompt: what it knows about the user + relevant skills. */
export function brainPrompt(brain: Brain, text: string, opts: { noSkills?: boolean } = {}): string {
  const parts: string[] = [];
  let mems = brain.memories;
  if (mems.length > 30) {
    const t = new Set(words(text));
    const hit = mems.filter((m) => words(m.text).some((w) => t.has(w)));
    mems = [...hit, ...mems.slice(-10)].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i).slice(0, 30);
  }
  if (mems.length) parts.push("## What you remember about the user (persistent memory)\n" + mems.map((m) => `- ${m.text}`).join("\n"));
  if (!opts.noSkills && brain.skills.length) {
    const top = rankSkills(brain.skills, text, 3);
    if (top.length) {
      parts.push(
        "## Skills you have learned — follow them when they apply to this task\n" +
          top.map((s) => `### ${s.name}\n${s.instructions.slice(0, 3500)}`).join("\n\n")
      );
    }
    const rest = brain.skills.filter((s) => !top.some((t) => t.id === s.id));
    if (rest.length) parts.push("Other skills available: " + rest.map((s) => `${s.name} — ${s.description}`).join("; "));
  }
  return parts.length ? "\n\n" + parts.join("\n\n") : "";
}

async function llmJson(env: LlmEnv, prompt: string): Promise<any | null> {
  const apiKey = env.apiKeys[env.provider];
  if (!apiKey) return null;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: env.provider, apiKey, model: env.model, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    const text = String(data.reply ?? "");
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    return a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : null;
  } catch {
    return null;
  }
}

/** Turns arbitrary pasted text into a skill (when it has no SKILL.md frontmatter). */
export async function skillFromText(env: LlmEnv, text: string): Promise<{ name: string; description: string; instructions: string } | null> {
  const r = await llmJson(
    env,
    `Convert the following material into ONE reusable agent skill. Reply with JSON only: {"name":"short-kebab-case-name","description":"one sentence: what it does and when to use it","instructions":"clear step-by-step instructions in markdown"}. Keep the important details, code snippets and rules.\n\nMATERIAL:\n${text.slice(0, 14000)}`
  );
  if (!r?.name || !r?.instructions) return null;
  return { name: String(r.name), description: String(r.description ?? r.name), instructions: String(r.instructions) };
}

/**
 * Self-improvement: after a task, the agent reflects and keeps what is worth keeping —
 * durable facts (memory), a reusable procedure (new skill) and lessons for existing skills.
 */
export async function reflect(
  uid: string,
  env: LlmEnv,
  brain: Brain,
  input: { task: string; outcome: string; steps?: string }
): Promise<string[]> {
  const known = brain.skills.map((s) => s.name).join(", ") || "(none)";
  const r = await llmJson(
    env,
    `You are the learning module of an AI agent. Decide what is worth remembering from the task below.
Reply with JSON only:
{"memories":["durable fact about the user's preferences/projects/accounts-in-general"],
 "skill":null | {"name":"kebab-case","description":"what it does + when to use it","instructions":"markdown steps that worked"},
 "lessons":[{"skill":"existing skill name","lesson":"one concrete correction or tip"}]}
Rules: at most 3 memories; only durable, reusable, non-sensitive things (NEVER passwords, keys, tokens, private data). Create a "skill" only when a multi-step procedure worked well AND is likely to be repeated; do not duplicate these existing skills: ${known}. Use "lessons" only for skills that were clearly used and need a fix. If nothing is worth keeping, return {"memories":[],"skill":null,"lessons":[]}.

TASK: ${input.task.slice(0, 600)}
OUTCOME: ${input.outcome.slice(0, 900)}
STEPS: ${(input.steps ?? "").slice(-1800)}`
  );
  const learned: string[] = [];
  if (!r) return learned;
  for (const m of (Array.isArray(r.memories) ? r.memories : []).slice(0, 3)) {
    const saved = await addMemory(uid, String(m), true);
    if (saved) learned.push(`remembered: ${saved.text}`);
  }
  if (r.skill?.name && r.skill?.instructions && String(r.skill.instructions).length > 150) {
    const id = slug(String(r.skill.name));
    if (!brain.skills.some((s) => s.id === id)) {
      await saveSkill(uid, { name: String(r.skill.name), description: String(r.skill.description ?? ""), instructions: String(r.skill.instructions), auto: true, source: "learned" });
      learned.push(`new skill: ${r.skill.name}`);
    }
  }
  for (const l of (Array.isArray(r.lessons) ? r.lessons : []).slice(0, 2)) {
    const s = brain.skills.find((x) => x.name.toLowerCase() === String(l?.skill ?? "").toLowerCase());
    if (s && l?.lesson) {
      await saveSkill(uid, { name: s.name, description: s.description, instructions: s.instructions + `\n\n- Lesson: ${String(l.lesson).slice(0, 300)}`, source: s.source, auto: s.auto });
      learned.push(`improved skill: ${s.name}`);
    }
  }
  return learned;
}