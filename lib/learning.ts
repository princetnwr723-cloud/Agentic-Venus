// Server-only brain: memory (per chat + one owner profile for the whole account), skills (with files, patching, rollback),
// recall over the whole history, and the self-improvement loop that runs after every task.
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { hybrid } from "@/lib/bm25";
import { callProvider, type ChatMsg } from "@/lib/ai-providers-server";
import { loadAgent, type Agent } from "@/lib/voice-calls";
import { categoriesOf, rankSkillList, scoreSkills, skillsPromptBlock, SKILL_FULL_MIN } from "@/lib/skills-core";
import { MEMORY_CAP, SOUL_CAP, addLogLine, agentFilesPrompt, defaultMemory, defaultSoul } from "@/lib/agent-files";
import { INJECTION_PATTERNS } from "@/lib/shield";
import { verifyResult } from "@/lib/critic";
import {
  MEM_CAP, OWNER_CAP, SKILL_CAP, applyPatch, clipText, looksSecret, nextSkillState, parseJsonLoose,
  sanitizeFiles, slugOf, stepCountOf, validateSkillPath,
} from "@/lib/learn-utils";
import { addItem, forgetInList, replaceInList, trimItems, type MemLike } from "@/lib/learn-mem";

export type Mem = MemLike;
export type SkillDoc = {
  id: string; name: string; description: string; instructions: string; auto?: boolean; uses?: number; wins?: number;
  fails?: number; version?: number; trial?: boolean; disabled?: boolean; prev?: string; source?: string; tags?: string[];
  files?: Record<string, string>; updatedAt: number;
};

const db = () => getAdminDb();
const userRef = (uid: string) => db().collection("users").doc(uid);
const chatRef = (uid: string, chatId: string) => userRef(uid).collection("chats").doc(chatId);
const memDoc = (uid: string, chatId: string) => chatRef(uid, chatId).collection("brain").doc("memories");
const ownerDoc = (uid: string) => userRef(uid).collection("brain").doc("owner");
const settingsDoc = (uid: string) => userRef(uid).collection("brain").doc("settings");
const skillsCol = (uid: string, chatId: string) => chatRef(uid, chatId).collection("skills");
const clip = clipText;
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ").trim();

/** Text that tries to boss the agent around must never become a skill the agent trusts later. */
const DANGEROUS = new Set(["override-instructions", "secret-exfil", "fake-system", "role-hijack"]);
export function dangerousFlags(text: string): string[] {
  return INJECTION_PATTERNS.filter(([n, re]) => DANGEROUS.has(n) && re.test(text)).map(([n]) => n);
}

// ---------------- soul.md + memory.md (one pair per chat/agent) ----------------
export type AgentFiles = { soul: string; memory: string; soulIsDefault: boolean; memoryIsDefault: boolean };
const filesDoc = (uid: string, chatId: string) => chatRef(uid, chatId).collection("brain").doc("files");

export async function readAgentFiles(uid: string, chatId: string): Promise<AgentFiles> {
  const [f, c] = await Promise.all([filesDoc(uid, chatId).get(), chatRef(uid, chatId).get()]);
  const d = (f.data() ?? {}) as { soul?: string; memory?: string };
  const name = String((c.data() as { agentName?: string } | undefined)?.agentName || "Agent");
  const soul = String(d.soul ?? "").trim();
  const memory = String(d.memory ?? "").trim();
  return { soul: soul || defaultSoul(name), memory: memory || defaultMemory(), soulIsDefault: !soul, memoryIsDefault: !memory };
}

export async function writeAgentFiles(uid: string, chatId: string, patch: { soul?: string; memory?: string }) {
  const upd: Record<string, unknown> = { updatedAt: Date.now() };
  if (typeof patch.soul === "string") upd.soul = patch.soul.slice(0, SOUL_CAP);
  if (typeof patch.memory === "string") upd.memory = patch.memory.slice(0, MEMORY_CAP);
  await filesDoc(uid, chatId).set(upd, { merge: true });
}

/** Adds one dated line to the progress log in memory.md (never stores secrets). */
export async function appendProgress(uid: string, chatId: string, line: string) {
  const t = line.replace(/\s+/g, " ").trim().slice(0, 320);
  if (t.length < 3 || looksSecret(t)) return;
  const f = await readAgentFiles(uid, chatId);
  await writeAgentFiles(uid, chatId, { memory: addLogLine(f.memory, t) });
}

// ---------------- memory lists (every change is ONE Firestore transaction, so parallel runs never overwrite each other) ----------------
async function mutate<R>(
  ref: ReturnType<typeof memDoc>, cap: number,
  fn: (items: Mem[]) => { items: Mem[] | null; result: R }
): Promise<R> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const items = ((snap.data() as { items?: Mem[] } | undefined)?.items ?? []) as Mem[];
    const out = fn(items);
    if (out.items) tx.set(ref, { items: JSON.parse(JSON.stringify(trimItems(out.items, cap))) });
    return out.result;
  });
}

export async function readMem(uid: string, chatId: string): Promise<Mem[]> {
  const s = await memDoc(uid, chatId).get();
  return ((s.data() as { items?: Mem[] } | undefined)?.items ?? []);
}

// ---- the owner profile: lasting facts about the owner as a person/business, shared by ALL chats (can be switched off) ----
export async function readOwner(uid: string): Promise<Mem[]> {
  const s = await ownerDoc(uid).get();
  return ((s.data() as { items?: Mem[] } | undefined)?.items ?? []);
}
export async function ownerShared(uid: string): Promise<boolean> {
  try {
    const s = await settingsDoc(uid).get();
    return (s.data() as { shareOwnerProfile?: boolean } | undefined)?.shareOwnerProfile !== false;
  } catch { return true; }
}
export async function setOwnerShared(uid: string, on: boolean) {
  await settingsDoc(uid).set({ shareOwnerProfile: on, updatedAt: Date.now() }, { merge: true });
}
export async function removeOwnerFact(uid: string, id: string): Promise<boolean> {
  return mutate(ownerDoc(uid), OWNER_CAP, (items) => {
    const left = items.filter((i) => i.id !== id);
    return { items: left.length === items.length ? null : left, result: left.length !== items.length };
  });
}

/** Saves one memory. kind "profile" goes to the shared owner profile (unless the owner switched sharing off). */
export async function addMemoryDetailed(
  uid: string, chatId: string, text: string, o: { auto?: boolean; kind?: string; weight?: number } = {}
): Promise<{ mem: Mem | null; scope: "owner" | "chat" }> {
  const kind = o.kind ?? "fact";
  const toOwner = kind === "profile" && (await ownerShared(uid));
  const ref = toOwner ? ownerDoc(uid) : memDoc(uid, chatId);
  const mem = await mutate(ref, toOwner ? OWNER_CAP : MEM_CAP, (items) => {
    const r = addItem(items, text, { ...o, kind }, toOwner ? OWNER_CAP : MEM_CAP);
    return { items: r.saved || r.refreshed ? r.items : null, result: r.saved };
  });
  return { mem, scope: toOwner ? "owner" : "chat" };
}

export async function addMemoryServer(uid: string, chatId: string, text: string, o: { auto?: boolean; kind?: string; weight?: number } = {}): Promise<string | null> {
  return (await addMemoryDetailed(uid, chatId, text, o)).mem?.text ?? null;
}

/** Forget by text. Looks in this chat's memories AND in the owner profile. The role is never removed. */
export async function forgetMemoryServer(uid: string, chatId: string, query: string): Promise<number> {
  if (query.trim().length < 3) return 0;
  const a = await mutate(memDoc(uid, chatId), MEM_CAP, (items) => { const r = forgetInList(items, query); return { items: r.removed ? r.items : null, result: r.removed }; });
  const b = await mutate(ownerDoc(uid), OWNER_CAP, (items) => { const r = forgetInList(items, query); return { items: r.removed ? r.items : null, result: r.removed }; });
  return a + b;
}

/** Correct a memory in place (like Hermes memory "replace"): the one memory containing `match` gets the new text. */
export async function replaceMemoryServer(uid: string, chatId: string, match: string, newText: string): Promise<string> {
  for (const [ref, cap] of [[memDoc(uid, chatId), MEM_CAP], [ownerDoc(uid), OWNER_CAP]] as const) {
    const r = await mutate(ref, cap, (items) => {
      const x = replaceInList(items, match, newText);
      return { items: x.status === "ok" ? x.items : null, result: x };
    });
    if (r.status === "ok") return `Updated: ${r.matched[0]} → ${newText.trim().slice(0, 200)}`;
    if (r.status === "many") return `More than one memory contains that text (${r.matched.map((m) => `"${clip(m, 60)}"`).join(", ")}). Use a longer piece of the old text.`;
    if (r.status === "bad") return "Could not replace: text too short, or the new text looks like a secret.";
  }
  return "No memory contains that text. Use memory.save to add it.";
}

export async function removeMemoryById(uid: string, chatId: string, id: string): Promise<boolean> {
  const a = await mutate(memDoc(uid, chatId), MEM_CAP, (items) => {
    const left = items.filter((i) => i.id !== id);
    return { items: left.length === items.length ? null : left, result: left.length !== items.length };
  });
  return a || removeOwnerFact(uid, id);
}

export async function setRoleServer(uid: string, chatId: string, text: string): Promise<Mem | null> {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 400);
  return mutate(memDoc(uid, chatId), MEM_CAP, (items) => {
    const rest = items.filter((i) => i.kind !== "role");
    if (!t) return { items: rest, result: null };
    const role: Mem = { id: "role", text: t, at: Date.now(), kind: "role", weight: 3 };
    return { items: [role, ...rest], result: role };
  });
}

/** Replace a group of memories by their merged version (used by consolidation). New memories added meanwhile are kept. */
export async function mergeMemories(
  uid: string, chatId: string, removeIds: string[], merged: Array<{ text: string; kind?: string; weight?: number }>
): Promise<number> {
  const drop = new Set(removeIds);
  return mutate(memDoc(uid, chatId), MEM_CAP, (items) => {
    let cur = items.filter((i) => !drop.has(i.id) || i.kind === "role");
    let n = 0;
    for (const m of merged.slice(0, 60)) {
      const r = addItem(cur, String(m.text ?? ""), { auto: true, kind: m.kind === "preference" || m.kind === "lesson" ? m.kind : "fact", weight: Number(m.weight) || 1 });
      if (r.saved) n++;
      cur = r.items;
    }
    return { items: cur, result: n };
  });
}

// ---------------- skills ----------------
export async function listSkills(uid: string, chatId: string): Promise<SkillDoc[]> {
  const s = await skillsCol(uid, chatId).get();
  return s.docs.map((d) => d.data() as SkillDoc);
}
export function rankSkills(skills: SkillDoc[], text: string, n = 3): SkillDoc[] {
  return rankSkillList(skills, text, n);
}

/** Find a skill by id, exact name or part of the name. */
export async function getSkill(uid: string, chatId: string, name: string): Promise<SkillDoc | null> {
  const d = await skillsCol(uid, chatId).doc(slugOf(name)).get();
  if (d.exists) return d.data() as SkillDoc;
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const all = await listSkills(uid, chatId);
  return all.find((s) => s.name.toLowerCase() === q) ?? all.find((s) => s.name.toLowerCase().includes(q)) ?? null;
}

export type SkillInput = {
  name: string; description: string; instructions: string; auto?: boolean; trial?: boolean; resetStats?: boolean; source?: string;
  disabled?: boolean; tags?: string[]; files?: Record<string, string> | null;
};

/** Same name = a new VERSION: the old text is kept in `prev` so the owner can roll back. `files` undefined = keep the old files, null = remove them. */
export async function saveSkillServer(uid: string, chatId: string, k: SkillInput): Promise<SkillDoc> {
  const name = k.name.trim().slice(0, 80);
  const instructions = k.instructions.trim().slice(0, 20000);
  if (!name || !instructions) throw new Error("A skill needs a name and instructions.");
  if (k.auto) {
    if (looksSecret(instructions)) throw new Error("The skill text looks like it contains a secret (password, key or card). Remove it and save again.");
    if (dangerousFlags(instructions).length) throw new Error("The skill text contains instruction-like text that tries to control the agent. Not saved.");
  }
  let files: Record<string, string> | undefined;
  if (k.files === null) files = {};
  else if (k.files) {
    const r = sanitizeFiles(k.files);
    if (r.errors.length && !Object.keys(r.files).length) throw new Error(r.errors[0]);
    files = r.files;
  }
  const col = skillsCol(uid, chatId);
  const id = slugOf(name);
  const ref = col.doc(id);
  if (!(await ref.get()).exists && (await col.get()).size >= SKILL_CAP) throw new Error(`This chat already has ${SKILL_CAP} skills. Delete one first.`);

  return db().runTransaction(async (tx) => {
    const old = (await tx.get(ref)).data() as SkillDoc | undefined;
    const keptFiles = files !== undefined ? files : old?.files ?? {};
    const filesChanged = files !== undefined && JSON.stringify(files) !== JSON.stringify(old?.files ?? {});
    const changed = Boolean(old && (old.instructions !== instructions || filesChanged));
    const description = k.description.trim().slice(0, 300) || old?.description || name;
    const found = categoriesOf(`${name} ${description} ${instructions}`, { max: 3, min: 2 });
    const tags = k.tags && k.tags.length ? k.tags.map(String).slice(0, 5) : found.length ? found : ["general"];
    const skill: SkillDoc = {
      id, name, description, instructions, tags,
      ...(k.auto ? { auto: true } : old?.auto ? { auto: true } : {}),
      ...(k.source ? { source: k.source.slice(0, 300) } : old?.source ? { source: old.source } : {}),
      ...(Object.keys(keptFiles).length ? { files: keptFiles } : {}),
      uses: old?.uses ?? 0, wins: k.resetStats ? 0 : old?.wins ?? 0, fails: k.resetStats ? 0 : old?.fails ?? 0,
      version: old ? (old.version ?? 1) + (changed ? 1 : 0) : 1,
      trial: typeof k.trial === "boolean" ? k.trial : old?.trial ?? false,
      disabled: typeof k.disabled === "boolean" ? k.disabled : k.resetStats ? false : old?.disabled ?? false,
      ...(changed && old ? { prev: old.instructions.slice(0, 20000) } : old?.prev ? { prev: old.prev } : {}),
      updatedAt: Date.now(),
    };
    tx.set(ref, JSON.parse(JSON.stringify(skill)));
    return skill;
  });
}

/** Small change inside a skill (or one of its files): find old text, put new text. Much safer than rewriting the whole skill. */
export async function patchSkillServer(
  uid: string, chatId: string,
  p: { name: string; oldStr: string; newStr: string; replaceAll?: boolean; file?: string; auto?: boolean }
): Promise<{ skill: SkillDoc; count: number }> {
  const found = await getSkill(uid, chatId, p.name);
  if (!found) throw new Error(`No skill named "${p.name}". Use skill.list to see the names.`);
  const path = p.file ? validateSkillPath(p.file) : null;
  if (p.file && !path) throw new Error("Bad file path. Files live in references/, scripts/, templates/, assets/ or examples/.");
  const ref = skillsCol(uid, chatId).doc(found.id);
  return db().runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as SkillDoc | undefined;
    if (!cur) throw new Error(`Skill "${p.name}" was deleted.`);
    const target = path ? cur.files?.[path] : cur.instructions;
    if (target === undefined) throw new Error(`The skill has no file ${path}.`);
    const r = applyPatch(target, p.oldStr, p.newStr, p.replaceAll);
    if (!r.ok) throw new Error(r.error);
    if (p.auto && (looksSecret(p.newStr) || dangerousFlags(p.newStr).length)) throw new Error("The new text looks like a secret or like instructions from outside. Not applied.");
    if (path && r.text.length > 20_000) throw new Error("That file would become too long.");
    const next: SkillDoc = path
      ? { ...cur, files: { ...(cur.files ?? {}), [path]: r.text }, version: (cur.version ?? 1) + 1, updatedAt: Date.now() }
      : { ...cur, instructions: r.text.slice(0, 20000), prev: cur.instructions.slice(0, 20000), version: (cur.version ?? 1) + 1, updatedAt: Date.now() };
    tx.set(ref, JSON.parse(JSON.stringify(next)));
    return { skill: next, count: r.count };
  });
}

/** Add or replace one supporting file (references/guide.md, scripts/run.py ...). */
export async function writeSkillFile(uid: string, chatId: string, p: { name: string; path: string; content: string }): Promise<SkillDoc> {
  const path = validateSkillPath(p.path);
  if (!path) throw new Error("Bad file path. Use references/, scripts/, templates/, assets/ or examples/ plus a .md/.txt/.json/.csv/.py/.js/.sh/.html file name.");
  const found = await getSkill(uid, chatId, p.name);
  if (!found) throw new Error(`No skill named "${p.name}".`);
  const ref = skillsCol(uid, chatId).doc(found.id);
  return db().runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as SkillDoc | undefined;
    if (!cur) throw new Error(`Skill "${p.name}" was deleted.`);
    const r = sanitizeFiles({ ...(cur.files ?? {}), [path]: p.content });
    if (!(path in r.files)) throw new Error(r.errors.find((e) => e.includes(path)) ?? r.errors[0] ?? "File not accepted.");
    const next: SkillDoc = { ...cur, files: r.files, version: (cur.version ?? 1) + 1, updatedAt: Date.now() };
    tx.set(ref, JSON.parse(JSON.stringify(next)));
    return next;
  });
}

export async function deleteSkillFile(uid: string, chatId: string, p: { name: string; path: string }): Promise<boolean> {
  const path = validateSkillPath(p.path);
  const found = await getSkill(uid, chatId, p.name);
  if (!path || !found) return false;
  const ref = skillsCol(uid, chatId).doc(found.id);
  return db().runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as SkillDoc | undefined;
    if (!cur?.files || !(path in cur.files)) return false;
    const files = { ...cur.files };
    delete files[path];
    tx.set(ref, JSON.parse(JSON.stringify({ ...cur, files: Object.keys(files).length ? files : undefined, version: (cur.version ?? 1) + 1, updatedAt: Date.now() })));
    return true;
  });
}

/** Go back to the previous version of a skill's instructions (it goes back on trial). */
export async function rollbackSkill(uid: string, chatId: string, name: string): Promise<SkillDoc> {
  const found = await getSkill(uid, chatId, name);
  if (!found) throw new Error(`No skill named "${name}".`);
  const ref = skillsCol(uid, chatId).doc(found.id);
  return db().runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as SkillDoc | undefined;
    if (!cur?.prev) throw new Error("This skill has no earlier version.");
    const next: SkillDoc = { ...cur, instructions: cur.prev, prev: cur.instructions, version: (cur.version ?? 1) + 1, trial: true, updatedAt: Date.now() };
    tx.set(ref, JSON.parse(JSON.stringify(next)));
    return next;
  });
}

export async function deleteSkillServer(uid: string, chatId: string, name: string): Promise<string | null> {
  const found = await getSkill(uid, chatId, name);
  if (!found) return null;
  await skillsCol(uid, chatId).doc(found.id).delete();
  return found.name;
}

/** A run (or a thumbs up/down from the owner) finished: score the skills that were used. Returns what changed. */
export async function outcomeSkills(uid: string, chatId: string, ids: string[], verdict: "pass" | "partial" | "fail"): Promise<string[]> {
  const events: string[] = [];
  for (const id of Array.from(new Set(ids)).slice(0, 5)) {
    const ref = skillsCol(uid, chatId).doc(id);
    const ev = await db().runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data() as SkillDoc | undefined;
      if (!s) return null;
      const { next, event } = nextSkillState({ wins: s.wins ?? 0, fails: s.fails ?? 0, trial: Boolean(s.trial), disabled: Boolean(s.disabled) }, verdict);
      tx.set(ref, { uses: (s.uses ?? 0) + 1, wins: next.wins, fails: next.fails, trial: next.trial, disabled: next.disabled }, { merge: true });
      return event ? (event === "proven" ? `skill proven: ${s.name}` : `skill paused (keeps failing): ${s.name}`) : null;
    }).catch(() => null);
    if (ev) events.push(ev);
  }
  return events;
}

// ---------------- what goes into every agent prompt (chat apps, calls, missions) ----------------
function pick(list: Mem[], query: string, max: number): Mem[] {
  if (list.length <= max) return list;
  const top = query.trim() ? hybrid(list, (m) => m.text, query, { limit: Math.ceil(max * 0.6) }).map((x) => x.doc) : [];
  const heavy = list.filter((m) => (m.weight ?? 1) >= 3).slice(-4);
  return [...top, ...heavy, ...list.slice(-4)].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i).slice(0, max);
}

export async function brainContext(uid: string, chatId: string, query = ""): Promise<{ role: string; mem: string }> {
  const [mems, skills, files, owner] = await Promise.all([
    readMem(uid, chatId), listSkills(uid, chatId),
    readAgentFiles(uid, chatId).catch(() => null),
    ownerShared(uid).then((on) => (on ? readOwner(uid) : [])).catch(() => [] as Mem[]),
  ]);
  const role = mems.find((i) => i.kind === "role")?.text ?? "";
  const seen = new Set<string>();
  const profile = [...owner, ...mems.filter((i) => i.kind === "profile")].filter((m) => { const k = norm(m.text); if (seen.has(k)) return false; seen.add(k); return true; });
  const list = mems.filter((i) => i.kind !== "role" && i.kind !== "profile");
  const shown = list.length > 12 ? pick(list, query, 18) : list;
  const parts: string[] = [];
  if (files) parts.push(agentFilesPrompt(files)); // soul.md + memory.md are read before every task
  if (profile.length) parts.push("WHAT YOU KNOW ABOUT YOUR OWNER (use it naturally, never recite it):\n" + pick(profile, query, 30).map((m) => `- ${m.text}`).join("\n"));
  if (shown.length) parts.push(shown.map((m) => `- ${m.kind === "lesson" ? "(lesson) " : ""}${m.text}`).join("\n"));
  parts.push(...skillsPromptBlock(skills, query, { full: 2, fullChars: 3000 }));
  return { role, mem: parts.join("\n\n") };
}

// ---------------- recall: search your own past (chat history, missions, calls and every finished task) ----------------
export async function recallSearch(uid: string, chatId: string, query: string, o: { deep?: boolean } = {}): Promise<string> {
  const user = userRef(uid);
  const docs: Array<{ src: string; text: string; at: number }> = [];
  const [cs, ms, cl, ep] = await Promise.all([
    chatRef(uid, chatId).get().catch(() => null),
    user.collection("missions").orderBy("createdAt", "desc").limit(60).get().catch(() => null),
    user.collection("voiceCalls").orderBy("createdAt", "desc").limit(60).get().catch(() => null),
    chatRef(uid, chatId).collection("episodes").orderBy("at", "desc").limit(300).get().catch(() => null),
  ]);
  const msgs = ((cs?.data() as { messages?: Array<{ role: string; content: string; at: number }> } | undefined)?.messages ?? []).slice(-800);
  for (const m of msgs) docs.push({ src: m.role === "user" ? "owner said" : "I said", text: clip(String(m.content ?? ""), 1200), at: Number(m.at) || 0 });
  for (const d of ms?.docs ?? []) { const x = d.data(); docs.push({ src: "mission", text: clip(`${x.goal ?? ""}\n${x.result ?? ""}`, 1500), at: Number(x.createdAt) || 0 }); }
  for (const d of cl?.docs ?? []) { const x = d.data(); docs.push({ src: "phone call", text: clip(`${x.to ?? x.from ?? ""} ${x.goal ?? ""}\n${x.summary ?? ""}`, 1500), at: Number(x.createdAt) || 0 }); }
  for (const d of ep?.docs ?? []) { const x = d.data(); docs.push({ src: `task (${x.verdict ?? "?"})`, text: clip(`${x.task ?? ""}\n${x.outcome ?? ""}`, 1500), at: Number(x.at) || 0 }); }

  const now = Date.now();
  const hits = hybrid(docs, (d) => d.text, query)
    .map((h) => ({ ...h, score: h.score * (1 + 0.25 * Math.exp(-(h.doc.at ? (now - h.doc.at) / 86_400_000 : 365) / 60)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  if (!hits.length) return "Nothing found in past chats, missions, calls or finished tasks.";
  const lines = hits.map((h) => `[${h.doc.src} · ${h.doc.at ? new Date(h.doc.at).toISOString().slice(0, 10) : "?"}] ${clip(h.doc.text.replace(/\s+/g, " "), 400)}`);
  if (o.deep) {
    try {
      const agent = await loadAgent(uid, chatId);
      const ans = await callProvider({
        provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 400,
        messages: [{ role: "user", content: `Answer the question using ONLY these notes from past chats, missions and calls. If they do not contain the answer, say so. Max 120 words, in the language of the question. Mention dates when useful.\n\nQUESTION: ${query}\n\nNOTES:\n${lines.join("\n")}` }],
      });
      if (ans.trim()) return `${ans.trim()}\n\nSources:\n${lines.slice(0, 4).join("\n")}`;
    } catch { /* fall back to the raw hits */ }
  }
  return lines.join("\n");
}

async function writeEpisode(uid: string, chatId: string, ep: { task: string; outcome: string; verdict: string; steps: number; skills: string[] }) {
  const col = chatRef(uid, chatId).collection("episodes");
  await col.doc("e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4)).set({
    task: clip(ep.task, 400), outcome: clip(ep.outcome, 900), verdict: ep.verdict, steps: ep.steps, skills: ep.skills, at: Date.now(),
  });
  if (Math.random() < 0.1) { // keep the newest 300
    const old = await col.orderBy("at", "desc").offset(300).limit(60).get();
    await Promise.all(old.docs.map((d) => d.ref.delete()));
  }
}

// ---------------- model helpers ----------------
type Llm = Pick<Agent, "provider" | "apiKey" | "model">;

/** Ask for JSON. Weak models often add prose or break the format: parse tolerantly and retry once. */
async function askJson(agent: Llm, prompt: string, maxTokens = 1500): Promise<any | null> {
  for (let i = 0; i < 2; i++) {
    try {
      const raw = await callProvider({
        provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens,
        messages: [{ role: "user", content: i === 0 ? prompt : `${prompt}\n\nIMPORTANT: reply with ONE valid JSON object only. No explanation, no code fences.` }],
      });
      const j = parseJsonLoose(raw);
      if (j) return j;
    } catch { /* retry once */ }
  }
  return null;
}

/** Many small auto-memories become one tidy set (merge duplicates, drop trivia). Runs when a chat has more than 150. */
export async function consolidateServer(uid: string, chatId: string, agent: Llm): Promise<boolean> {
  const items = await readMem(uid, chatId);
  if (items.length <= 150) return false;
  const auto = items.filter((i) => i.auto && i.kind !== "role" && i.kind !== "profile");
  if (auto.length < 40) return false;
  const j = await askJson(agent,
`You tidy the long-term memory of an AI agent. Merge near-duplicates, drop trivia and anything outdated, keep EVERY durable fact, preference and lesson. Never invent anything.
Reply with JSON only: {"memories":[{"text":"short sentence","kind":"fact|preference|lesson","weight":1-3}]} (at most 60).

MEMORIES:
${auto.map((m) => `- (${m.kind}) ${m.text}`).join("\n").slice(0, 14000)}`, 3000);
  const merged = Array.isArray(j?.memories) ? (j.memories as Array<{ text: string; kind?: string; weight?: number }>) : [];
  if (merged.length < 5 || merged.length >= auto.length) return false;
  await mergeMemories(uid, chatId, auto.map((m) => m.id), merged);
  return true;
}

/** memory.md fills up with progress-log lines. When it is nearly full, old lines are summarised (the structure and the newest lines stay). */
export async function compactMemoryFile(uid: string, chatId: string, agent: Llm): Promise<boolean> {
  const f = await readAgentFiles(uid, chatId);
  if (f.memoryIsDefault || f.memory.length < MEMORY_CAP * 0.9) return false;
  const j = await askJson(agent,
`This is the memory.md file of an AI agent. It is almost full. Rewrite it SHORTER (about 60% of its size):
- keep every heading and every lasting fact, preference, project and lesson
- merge the older "## Progress log" lines into at most 10 summary lines; keep the 15 newest log lines exactly as they are
- never add anything new, never include secrets
Reply with JSON only: {"memory":"the complete new memory.md in markdown"}

MEMORY.MD:
${f.memory}`, 5000);
  const m = String(j?.memory ?? "");
  if (m.length < 300 || m.length > f.memory.length * 0.85 || !/##\s*Progress log/i.test(m) || looksSecret(m)) return false;
  await writeAgentFiles(uid, chatId, { memory: m });
  return true;
}

// ---------------- self-improvement ----------------
export type RunInput = {
  task: string; outcome: string; steps?: string; verdict: "pass" | "partial" | "fail";
  stepCount?: number;            // tool calls / steps used (counted from `steps` when missing)
  judge?: boolean;               // false = trust `verdict` without the independent check
  thumbs?: 1 | -1;               // the owner's own verdict beats everything
  skillsUsed?: string[];         // names, when the caller knows them
};

function usedSkills(skills: SkillDoc[], task: string, steps: string, names: string[] = []): SkillDoc[] {
  const hay = steps.toLowerCase();
  const out: SkillDoc[] = [];
  const add = (s: SkillDoc) => { if (!out.some((x) => x.id === s.id)) out.push(s); };
  for (const s of skills) {
    const n = s.name.toLowerCase();
    if (names.some((x) => x.toLowerCase() === n) || (n.length >= 6 && hay.includes(n))) add(s);
  }
  for (const x of scoreSkills(skills, task).filter((y) => y.score >= SKILL_FULL_MIN).slice(0, 2)) add(x.s);
  return out.slice(0, 3);
}

/** The agent that did the work does not get to grade itself: a separate strict reviewer checks the outcome against the evidence. */
async function finalVerdict(agent: Llm, input: RunInput, stepCount: number): Promise<"pass" | "partial" | "fail"> {
  if (input.thumbs === -1) return "fail";
  if (input.thumbs === 1) return "pass";
  if (input.verdict !== "pass" || input.judge === false || stepCount < 3 || !input.steps) return input.verdict;
  try {
    const v = await verifyResult(
      async (system, prompt) => callProvider({
        provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 300,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }] as ChatMsg[],
      }),
      { task: input.task, summary: input.outcome, evidence: [clip(input.steps, 3000)] }
    );
    return v.verdict;
  } catch { return input.verdict; }
}

export async function learnFromRun(uid: string, chatId: string, input: RunInput): Promise<string[]> {
  const learned: string[] = [];
  try {
    // progress goes into memory.md first, so even a failing learning step never loses it
    await appendProgress(uid, chatId, `${input.verdict}: ${clip(input.task.replace(/\s+/g, " "), 110)} → ${clip(input.outcome.replace(/\s+/g, " "), 170)}`).catch(() => {});

    const agent = await loadAgent(uid, chatId);
    const skills = await listSkills(uid, chatId);
    const stepCount = stepCountOf(input.steps, input.stepCount);
    const verdict = await finalVerdict(agent, input, stepCount);
    const used = usedSkills(skills, input.task, input.steps ?? "", input.skillsUsed);

    // 1) Score the skills that applied: proven ones leave "trial", the ones that keep failing are paused.
    learned.push(...(await outcomeSkills(uid, chatId, used.map((s) => s.id), verdict)));

    // 2) Ask the model what is worth keeping.
    const forceSkill = verdict === "pass" && stepCount >= 5;
    const steps = input.steps ?? "";
    const stepsText = steps.length > 2000 ? `${steps.slice(0, 600)}\n…\n${steps.slice(-1400)}` : steps;
    const r = await askJson(agent,
`You are the learning module of an AI agent that works for ONE owner. Decide what is worth keeping from the task below.
Reply with JSON only:
{"memories":[{"text":"durable fact or preference","kind":"fact|preference|profile","weight":1-3}],
 "skill":null | {"name":"kebab-case","description":"what it does + when to use it","instructions":"markdown steps that worked","files":{"references/notes.md":"optional longer reference text"}},
 "patches":[{"skill":"name of a skill that was used","old":"exact text inside that skill","new":"better text"}],
 "revisions":[{"skill":"name","instructions":"the FULL improved instructions"}],
 "lessons":["what to do differently next time"]}
Rules:
- at most 3 memories. kind "profile" = a lasting fact about the owner as a person or business. Only durable, reusable, non-sensitive things (NEVER passwords, keys, tokens, card data, private data).
- "skill": ${forceSkill ? "this task passed and needed " + stepCount + " steps, so a reusable procedure very likely exists: write it unless it is clearly one-off" : "only when a multi-step procedure worked AND is likely to repeat"}. Write real steps (what to open, what to check, what went wrong and how to avoid it), not a story. Not a duplicate of: ${skills.map((x) => x.name).join(", ") || "(none)"}.
- "patches": if a used skill was slightly wrong, outdated or missing a step, give a small find-and-replace (old must be copied exactly from the skill text below). Prefer patches over revisions.
- "revisions" and "lessons" ONLY if the result is not "pass": explain the real cause. Otherwise empty lists.

RESULT: ${verdict}${input.thumbs ? ` (the owner gave a thumbs ${input.thumbs === 1 ? "up" : "down"})` : ""}
TASK: ${clip(input.task, 600)}
OUTCOME: ${clip(input.outcome, 900)}
STEPS (${stepCount}): ${stepsText}
${used.length ? "SKILLS THAT WERE USED:\n" + used.map((x) => `### ${x.name}\n${clip(x.instructions, 1500)}`).join("\n\n") : ""}`);

    if (r) {
      for (const m of (Array.isArray(r.memories) ? r.memories : []).slice(0, 3)) {
        const kind = m?.kind === "preference" ? "preference" : m?.kind === "profile" ? "profile" : "fact";
        const saved = await addMemoryServer(uid, chatId, String(m?.text ?? ""), { auto: true, kind, weight: Number(m?.weight) || 1 }).catch(() => null);
        if (saved) learned.push(`remembered: ${saved}`);
      }
      const sk = r.skill;
      if (verdict === "pass" && sk?.name && typeof sk.instructions === "string" && sk.instructions.length > 150 && !skills.some((x) => x.id === slugOf(String(sk.name)))) {
        try {
          await saveSkillServer(uid, chatId, { name: String(sk.name), description: String(sk.description ?? ""), instructions: sk.instructions, files: sk.files ?? undefined, auto: true, trial: true });
          learned.push(`new skill (on trial): ${sk.name}`);
        } catch { /* rejected (secret / injection / cap): fine */ }
      }
      for (const p of (Array.isArray(r.patches) ? r.patches : []).slice(0, 2)) {
        const target = used.find((x) => x.name.toLowerCase() === String(p?.skill ?? "").toLowerCase());
        if (!target) continue;
        try {
          const done = await patchSkillServer(uid, chatId, { name: target.name, oldStr: String(p.old ?? ""), newStr: String(p.new ?? ""), auto: true });
          learned.push(`improved skill: ${target.name} (v${done.skill.version})`);
        } catch { /* the quoted text did not match: ignore */ }
      }
      if (verdict !== "pass") {
        for (const l of (Array.isArray(r.lessons) ? r.lessons : []).slice(0, 2)) {
          const saved = await addMemoryServer(uid, chatId, String(l), { auto: true, kind: "lesson", weight: 2 }).catch(() => null);
          if (saved) learned.push(`lesson: ${saved}`);
        }
        for (const v of (Array.isArray(r.revisions) ? r.revisions : []).slice(0, 1)) {
          const old = used.find((x) => x.name.toLowerCase() === String(v?.skill ?? "").toLowerCase());
          if (old && String(v?.instructions ?? "").length > 120) {
            try {
              const nv = await saveSkillServer(uid, chatId, { name: old.name, description: old.description, instructions: String(v.instructions), auto: old.auto, trial: true, resetStats: true });
              learned.push(`improved skill: ${old.name} (v${nv.version})`);
            } catch { /* rejected */ }
          }
        }
      }
    }

    await writeEpisode(uid, chatId, { task: input.task, outcome: input.outcome, verdict, steps: stepCount, skills: used.map((s) => s.name) }).catch(() => {});
    await consolidateServer(uid, chatId, agent).catch(() => {});
    await compactMemoryFile(uid, chatId, agent).catch(() => {});

    if (learned.length) {
      await chatRef(uid, chatId).update({ messages: FieldValue.arrayUnion({ role: "assistant", content: "🧠 Learned: " + learned.join("; "), at: Date.now() }) }).catch(() => {});
    }
  } catch { /* learning is best-effort and never breaks the run */ }
  return learned;
}
