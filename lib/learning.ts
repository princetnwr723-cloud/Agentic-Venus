import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { bm25, jaccard } from "@/lib/bm25";
import { callProvider } from "@/lib/ai-providers-server";
import { loadAgent } from "@/lib/voice-calls";

export type Mem = { id: string; text: string; at: number; auto?: boolean; kind?: string; weight?: number };
export type SkillDoc = {
  id: string; name: string; description: string; instructions: string; auto?: boolean; uses?: number; wins?: number;
  fails?: number; version?: number; trial?: boolean; disabled?: boolean; prev?: string; updatedAt: number;
};

const chatRef = (uid: string, chatId: string) => getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId);
const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "skill";
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
const SECRET = /(password|passwd|api[_ -]?key|secret|token|card number|cvv|otp)\s*[:=]/i;

// ---------------- memory ----------------
export async function readMem(uid: string, chatId: string): Promise<Mem[]> {
  const s = await chatRef(uid, chatId).collection("brain").doc("memories").get();
  return ((s.data() as { items?: Mem[] } | undefined)?.items ?? []);
}
async function writeMem(uid: string, chatId: string, items: Mem[]) {
  await chatRef(uid, chatId).collection("brain").doc("memories").set({ items: JSON.parse(JSON.stringify(items.slice(-200))) });
}

export async function addMemoryServer(uid: string, chatId: string, text: string, o: { auto?: boolean; kind?: string; weight?: number } = {}): Promise<string | null> {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (t.length < 3 || SECRET.test(t)) return null; // never store secrets
  const items = await readMem(uid, chatId);
  if (items.some((i) => norm(i.text) === norm(t))) return null;
  const similar = items.find((i) => i.kind !== "role" && jaccard(i.text, t) > 0.7);
  if (similar) { await writeMem(uid, chatId, items.map((i) => (i.id === similar.id ? { ...i, text: t, at: Date.now() } : i))); return null; }
  const mem: Mem = {
    id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: t, at: Date.now(),
    kind: o.kind ?? "fact", weight: Math.min(3, Math.max(1, o.weight ?? 1)), ...(o.auto ? { auto: true } : {}),
  };
  let next = [...items, mem];
  if (next.length > 200) {
    const drop = next.filter((i) => i.auto && i.kind !== "role" && i.id !== mem.id).sort((a, b) => (a.weight ?? 1) - (b.weight ?? 1) || a.at - b.at)[0] ?? next[0];
    next = next.filter((i) => i.id !== drop.id);
  }
  await writeMem(uid, chatId, next);
  return t;
}

export async function forgetMemoryServer(uid: string, chatId: string, query: string): Promise<number> {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return 0;
  const items = await readMem(uid, chatId);
  const keepers = items.filter((i) => i.kind === "role" || !i.text.toLowerCase().includes(q));
  await writeMem(uid, chatId, keepers);
  return items.length - keepers.length;
}

// ---------------- skills ----------------
export async function listSkills(uid: string, chatId: string): Promise<SkillDoc[]> {
  const s = await chatRef(uid, chatId).collection("skills").get();
  return s.docs.map((d) => d.data() as SkillDoc);
}
export function rankSkills(skills: SkillDoc[], text: string, n = 3): SkillDoc[] {
  return bm25(skills.filter((x) => !x.disabled), (x) => `${x.name} ${x.name} ${x.description} ${x.instructions.slice(0, 600)}`, text).slice(0, n).map((x) => x.doc);
}

/** Same name = a new VERSION: the old text is kept in `prev` so the owner can roll back on the Skills page. */
export async function saveSkillServer(
  uid: string, chatId: string,
  k: { name: string; description: string; instructions: string; auto?: boolean; trial?: boolean; resetStats?: boolean }
): Promise<SkillDoc> {
  const name = k.name.trim().slice(0, 80);
  const instructions = k.instructions.trim().slice(0, 20000);
  if (!name || !instructions) throw new Error("A skill needs a name and instructions.");
  const skills = chatRef(uid, chatId).collection("skills");
  const id = slug(name);
  const ref = skills.doc(id);
  const old = (await ref.get()).data() as SkillDoc | undefined;
  if (!old && (await skills.get()).size >= 80) throw new Error("This chat already has 80 skills. Delete one first.");
  const changed = Boolean(old && old.instructions !== instructions);
  const skill: SkillDoc = {
    id, name, description: k.description.trim().slice(0, 300) || old?.description || name, instructions,
    ...(k.auto ? { auto: true } : old?.auto ? { auto: true } : {}),
    uses: old?.uses ?? 0, wins: k.resetStats ? 0 : old?.wins ?? 0, fails: k.resetStats ? 0 : old?.fails ?? 0,
    version: old ? (old.version ?? 1) + (changed ? 1 : 0) : 1,
    trial: typeof k.trial === "boolean" ? k.trial : old?.trial ?? false,
    disabled: k.resetStats ? false : old?.disabled ?? false,
    ...(changed && old ? { prev: old.instructions.slice(0, 20000) } : old?.prev ? { prev: old.prev } : {}),
    updatedAt: Date.now(),
  };
  await ref.set(JSON.parse(JSON.stringify(skill)));
  return skill;
}

// ---------------- what goes into every agent prompt (chat apps, calls, missions) ----------------
export async function brainContext(uid: string, chatId: string, query = ""): Promise<{ role: string; mem: string }> {
  const [mems, skills] = await Promise.all([readMem(uid, chatId), listSkills(uid, chatId)]);
  const role = mems.find((i) => i.kind === "role")?.text ?? "";
  let list = mems.filter((i) => i.kind !== "role");
  if (list.length > 12) {
    const top = bm25(list, (m) => m.text, query).slice(0, 10).map((x) => x.doc);
    const heavy = list.filter((m) => (m.weight ?? 1) >= 3).slice(-4);
    list = [...top, ...heavy, ...list.slice(-4)].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i).slice(0, 18);
  }
  const parts: string[] = [];
  if (list.length) parts.push(list.map((m) => `- ${m.kind === "lesson" ? "(lesson) " : ""}${m.text}`).join("\n"));
  const live = skills.filter((s) => !s.disabled);
  if (live.length) {
    const top = rankSkills(live, query, 3);
    if (top.length) parts.push("SKILLS YOU LEARNED (follow them when they apply):\n" + top.map((s) => `### ${s.name}${s.trial ? " (on trial)" : ""}\n${clip(s.instructions, 2500)}`).join("\n\n"));
    const rest = live.filter((s) => !top.some((t) => t.id === s.id));
    if (rest.length) parts.push("Other skills you have: " + rest.map((s) => `${s.name} — ${s.description}`).join("; "));
  }
  return { role, mem: parts.join("\n\n") };
}

// ---------------- recall: search your own past ----------------
export async function recallSearch(uid: string, chatId: string, query: string): Promise<string> {
  const user = getAdminDb().collection("users").doc(uid);
  const docs: Array<{ src: string; text: string; at: number }> = [];
  const cs = await chatRef(uid, chatId).get();
  const msgs = ((cs.data() as { messages?: Array<{ role: string; content: string; at: number }> } | undefined)?.messages ?? []).slice(-400);
  for (const m of msgs) docs.push({ src: m.role === "user" ? "owner said" : "I said", text: String(m.content), at: Number(m.at) || 0 });
  const ms = await user.collection("missions").orderBy("createdAt", "desc").limit(30).get();
  for (const d of ms.docs) { const x = d.data(); docs.push({ src: "mission", text: `${x.goal ?? ""}\n${x.result ?? ""}`, at: Number(x.createdAt) || 0 }); }
  const cl = await user.collection("voiceCalls").orderBy("createdAt", "desc").limit(30).get();
  for (const d of cl.docs) { const x = d.data(); docs.push({ src: "phone call", text: `${x.to ?? x.from ?? ""} ${x.goal ?? ""}\n${x.summary ?? ""}`, at: Number(x.createdAt) || 0 }); }
  const hits = bm25(docs, (d) => d.text, query).slice(0, 6);
  if (!hits.length) return "Nothing found in past chats, missions or calls.";
  return hits.map((h) => `[${h.doc.src} · ${h.doc.at ? new Date(h.doc.at).toISOString().slice(0, 10) : "?"}] ${clip(h.doc.text.replace(/\s+/g, " "), 400)}`).join("\n");
}

// ---------------- self-improvement ----------------
export async function learnFromRun(
  uid: string, chatId: string,
  input: { task: string; outcome: string; steps?: string; verdict: "pass" | "partial" | "fail" }
): Promise<string[]> {
  const learned: string[] = [];
  try {
    const agent = await loadAgent(uid, chatId);
    const skills = await listSkills(uid, chatId);
    const used = rankSkills(skills, input.task, 3);
    const col = chatRef(uid, chatId).collection("skills");

    // 1) Score the skills that applied: proven ones leave "trial", the ones that keep failing are paused.
    for (const s of used) {
      const wins = (s.wins ?? 0) + (input.verdict === "pass" ? 1 : 0);
      const fails = (s.fails ?? 0) + (input.verdict === "fail" ? 1 : 0);
      await col.doc(s.id).set({
        wins, fails, uses: (s.uses ?? 0) + 1,
        ...(s.trial && wins >= 2 ? { trial: false } : {}),
        ...(!s.disabled && fails >= 3 && fails > wins * 2 ? { disabled: true } : {}),
      }, { merge: true });
      if (s.trial && wins >= 2) learned.push(`skill proven: ${s.name}`);
      if (!s.disabled && fails >= 3 && fails > wins * 2) learned.push(`skill paused (keeps failing): ${s.name}`);
    }

    // 2) Ask the model what is worth keeping.
    const raw = await callProvider({
      provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 1500,
      messages: [{ role: "user", content:
`You are the learning module of an AI agent that works for ONE owner. Decide what is worth keeping from the task below.
Reply with JSON only:
{"memories":[{"text":"durable fact or preference about the owner's work","kind":"fact|preference","weight":1-3}],
 "skill":null | {"name":"kebab-case","description":"what it does + when to use it","instructions":"markdown steps that worked"},
 "revisions":[{"skill":"name of a skill that was used","instructions":"the FULL improved instructions"}],
 "lessons":["what to do differently next time"]}
Rules: at most 3 memories; only durable, reusable, non-sensitive things (NEVER passwords, keys, tokens, card data, private data). Create "skill" only when a multi-step procedure worked AND is likely to repeat, and it is not a duplicate of: ${skills.map((x) => x.name).join(", ") || "(none)"}. "revisions" and "lessons" ONLY if the result is not "pass": explain the real cause. Otherwise return empty lists.

RESULT: ${input.verdict}
TASK: ${clip(input.task, 600)}
OUTCOME: ${clip(input.outcome, 900)}
STEPS: ${clip(input.steps ?? "", 1800)}
${input.verdict !== "pass" ? "SKILLS THAT WERE USED:\n" + used.map((x) => `### ${x.name}\n${clip(x.instructions, 1500)}`).join("\n\n") : ""}` }],
    });
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    const r = a >= 0 && b > a ? (JSON.parse(raw.slice(a, b + 1)) as {
      memories?: Array<{ text?: string; kind?: string; weight?: number }>;
      skill?: { name?: string; description?: string; instructions?: string } | null;
      revisions?: Array<{ skill?: string; instructions?: string }>; lessons?: string[];
    }) : null;
    if (r) {
      for (const m of (r.memories ?? []).slice(0, 3)) {
        const saved = await addMemoryServer(uid, chatId, String(m?.text ?? ""), { auto: true, kind: m?.kind === "preference" ? "preference" : "fact", weight: Number(m?.weight) || 1 });
        if (saved) learned.push(`remembered: ${saved}`);
      }
      const sk = r.skill;
      if (sk?.name && sk.instructions && sk.instructions.length > 150 && !skills.some((x) => x.id === slug(sk.name as string))) {
        await saveSkillServer(uid, chatId, { name: sk.name, description: sk.description ?? "", instructions: sk.instructions, auto: true, trial: true });
        learned.push(`new skill (on trial): ${sk.name}`);
      }
      if (input.verdict !== "pass") {
        for (const l of (r.lessons ?? []).slice(0, 2)) {
          const saved = await addMemoryServer(uid, chatId, String(l), { auto: true, kind: "lesson", weight: 2 });
          if (saved) learned.push(`lesson: ${saved}`);
        }
        for (const v of (r.revisions ?? []).slice(0, 1)) {
          const old = used.find((x) => x.name.toLowerCase() === String(v?.skill ?? "").toLowerCase());
          if (old && String(v?.instructions ?? "").length > 120) {
            const nv = await saveSkillServer(uid, chatId, { name: old.name, description: old.description, instructions: String(v.instructions), auto: old.auto, trial: true, resetStats: true });
            learned.push(`improved skill: ${old.name} (v${nv.version})`);
          }
        }
      }
    }
    if (learned.length) {
      await chatRef(uid, chatId).update({ messages: FieldValue.arrayUnion({ role: "assistant", content: "🧠 Learned: " + learned.join("; "), at: Date.now() }) }).catch(() => {});
    }
  } catch { /* learning is best-effort and never breaks the run */ }
  return learned;
}