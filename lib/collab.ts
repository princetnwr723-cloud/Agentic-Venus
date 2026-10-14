// Server-only. Lets one agent (chat) use the work of the owner's other agents (chats):
// briefings (role, profile, memory, skills, recent work), workspace files, and the permission checks.
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveValue } from "@/lib/vault";
import { connect, exec, pauseSandbox } from "@/lib/e2b-server";
import { listTree, q, resolvePath } from "@/lib/code-server";
import { bm25 } from "@/lib/bm25";
import { splitSuggestions } from "@/lib/suggest";
import { rankSkillList } from "@/lib/skills-core";

type Msg = { role: string; content: string; at: number };
type Mem = { id: string; text: string; kind?: string; weight?: number };
type SkillLite = { name: string; description: string; instructions: string; tags?: string[]; disabled?: boolean };

export type AgentCard = { id: string; name: string; role: string; last: string; lastAt: number; code: boolean };

const db = () => getAdminDb();
const userRef = (uid: string) => db().collection("users").doc(uid);
const chatRef = (uid: string, id: string) => userRef(uid).collection("chats").doc(id);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g, "");
const plain = (m: string) => splitSuggestions(String(m ?? "")).body.replace(/\s+/g, " ").trim();
const ID = /^[A-Za-z0-9_-]{4,160}$/;
export const validId = (v: unknown) => typeof v === "string" && ID.test(v);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

// ---------------- who may be used ----------------
/** all = "Agent cooperation" switch is ON; ids = agents the owner @-mentioned recently (valid 2 hours). */
export async function accessOf(uid: string, chatId: string): Promise<{ all: boolean; ids: string[] }> {
  const d = (await chatRef(uid, chatId).get()).data() as { cooperation?: boolean; collabGrant?: { ids?: unknown; at?: number } } | undefined;
  const g = d?.collabGrant;
  const fresh = Boolean(g && Date.now() - Number(g.at ?? 0) < 2 * 3600_000 && Array.isArray(g.ids));
  return { all: d?.cooperation === true, ids: fresh ? (g!.ids as unknown[]).map(String) : [] };
}

export async function grant(uid: string, chatId: string, ids: string[]) {
  const cur = await accessOf(uid, chatId);
  const merged = Array.from(new Set([...cur.ids, ...ids])).slice(0, 12);
  await chatRef(uid, chatId).update({ collabGrant: { ids: merged, at: Date.now() } }).catch(() => {});
}

// ---------------- list / find ----------------
export async function listAgents(uid: string, except?: string): Promise<AgentCard[]> {
  const snap = await userRef(uid).collection("chats").limit(60).get();
  const docs = snap.docs.filter((d) => d.id !== except);
  const cards = await Promise.all(docs.map(async (d): Promise<AgentCard> => {
    const c = d.data() as { agentName?: string; messages?: Msg[] };
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    const last = [...msgs].reverse().find((m) => m.role === "assistant" && plain(m.content).length > 3);
    const mem = (await d.ref.collection("brain").doc("memories").get().catch(() => null))?.data() as { items?: Mem[] } | undefined;
    const proj = await userRef(uid).collection("codeProjects").doc(d.id).get().catch(() => null);
    return {
      id: d.id, name: c.agentName || "Agent", role: clip(mem?.items?.find((i) => i.kind === "role")?.text ?? "", 120),
      last: last ? clip(plain(last.content), 140) : "", lastAt: Number(msgs[msgs.length - 1]?.at) || 0, code: Boolean(proj?.exists),
    };
  }));
  return cards.sort((a, b) => b.lastAt - a.lastAt);
}

export async function findAgent(uid: string, from: string, ref: string): Promise<{ id: string; name: string } | null> {
  const snap = await userRef(uid).collection("chats").select("agentName").limit(60).get();
  const all = snap.docs.filter((d) => d.id !== from).map((d) => ({ id: d.id, name: String((d.data() as { agentName?: string }).agentName || "Agent") }));
  const r = String(ref ?? "").trim().replace(/^@/, "");
  const n = norm(r);
  if (!n) return null;
  return all.find((a) => a.id === r) ?? all.find((a) => norm(a.name) === n) ?? all.find((a) => norm(a.name).startsWith(n)) ?? all.find((a) => norm(a.name).includes(n)) ?? null;
}

// ---------------- the other agent's code workspace ----------------
const TEXT = /\.(tsx?|jsx?|mjs|css|scss|html|vue|svelte|json|md|py)$/i;
const SKIP = /(^|\/)(node_modules|\.next|dist|build)\/|package-lock\.json|yarn\.lock|pnpm-lock|\.min\./i;

async function openWorkspace(uid: string, id: string): Promise<{ sb: Awaited<ReturnType<typeof connect>>; done: () => void } | null> {
  const user = (await userRef(uid).get()).data() as { e2bKey?: string } | undefined;
  const chat = (await chatRef(uid, id).get()).data() as { computers?: Record<string, string> } | undefined;
  const sid = chat?.computers?.code;
  if (!user?.e2bKey || !sid) return null;
  const key = await resolveValue(uid, user.e2bKey);
  const proj = (await userRef(uid).collection("codeProjects").doc(id).get().catch(() => null))?.data() as { running?: boolean } | undefined;
  const sb = await withTimeout(connect(key, sid), 14_000);
  // wake it for a moment only; pause again unless that agent is working on it right now
  return { sb, done: () => { if (!proj?.running) void pauseSandbox(key, sid).catch(() => {}); } };
}

async function codeSnapshot(uid: string, id: string, query: string, max: number): Promise<string> {
  try {
    const ws = await openWorkspace(uid, id);
    if (!ws) return "";
    try {
      const files = (await listTree(ws.sb, id, 400)).filter((f) => !SKIP.test(f));
      if (!files.length) return "";
      const cand = files.filter((f) => TEXT.test(f));
      let pick = bm25(cand, (f) => f.replace(/[/._-]+/g, " "), query).slice(0, 4).map((x) => x.doc);
      if (pick.length < 4) {
        const pref = cand.filter((f) => !pick.includes(f) && /(component|ui|style|index|app|page|layout|theme)/i.test(f));
        pick = [...pick, ...pref].slice(0, 4);
      }
      const root = resolvePath(id, ".");
      const md = (await exec(ws.sb, `head -c 1200 ${q(root + "/VENUS.md")} 2>/dev/null`, 8_000)).stdout.trim();
      const parts: string[] = [`WORKSPACE FILES (${files.length}): ${files.slice(0, 70).join(", ")}${files.length > 70 ? ", …" : ""}`];
      if (md) parts.push(`PROJECT NOTES (VENUS.md):\n${md}`);
      for (const f of pick) {
        const r = await exec(ws.sb, `head -c 2200 ${q(resolvePath(id, f))}`, 10_000);
        if (r.stdout.trim()) parts.push(`FILE ${f}:\n\`\`\`\n${r.stdout}\n\`\`\``);
      }
      return clip(parts.join("\n\n"), max);
    } finally { ws.done(); }
  } catch { return ""; }
}

export async function readAgentFile(uid: string, id: string, path: string): Promise<string> {
  const abs = resolvePath(id, path); // refuses "..", .git and anything outside the workspace
  const ws = await openWorkspace(uid, id);
  if (!ws) throw new Error("That agent has no code workspace on a computer (or no E2B key is saved).");
  try {
    const r = await exec(ws.sb, `test -f ${q(abs)} || { echo NOFILE; exit 3; }; head -c 14000 ${q(abs)}`, 15_000);
    if (r.stdout.startsWith("NOFILE")) throw new Error(`File not found in that agent's workspace: ${path}`);
    return r.stdout;
  } finally { ws.done(); }
}

// ---------------- the briefing ----------------
export async function briefAgent(uid: string, id: string, query: string, o: { budget: number; code: boolean }): Promise<{ name: string; text: string } | null> {
  const snap = await chatRef(uid, id).get();
  if (!snap.exists) return null;
  const c = snap.data() as { agentName?: string; messages?: Msg[] };
  const name = c.agentName || "Agent";
  const msgs = (Array.isArray(c.messages) ? c.messages : []).filter((m) => plain(m.content).length > 2 && !String(m.content).startsWith("🧠") && !String(m.content).startsWith("🔌"));
  const [memSnap, skillSnap] = await Promise.all([snap.ref.collection("brain").doc("memories").get(), snap.ref.collection("skills").get()]);
  const mems = ((memSnap.data() as { items?: Mem[] } | undefined)?.items ?? []);
  const skills = skillSnap.docs.map((d) => d.data() as SkillLite);

  const parts: string[] = [];
  const role = mems.find((m) => m.kind === "role")?.text;
  if (role) parts.push(`ROLE: ${role}`);
  const profile = mems.filter((m) => m.kind === "profile").slice(-8);
  if (profile.length) parts.push(`WHAT IT KNOWS ABOUT THE OWNER:\n${profile.map((m) => `- ${m.text}`).join("\n")}`);
  const rest = mems.filter((m) => m.kind !== "role" && m.kind !== "profile");
  const topMem = (rest.length > 6 ? bm25(rest, (m) => m.text, query).slice(0, 6).map((x) => x.doc) : rest).slice(-6);
  if (topMem.length) parts.push(`ITS NOTES:\n${topMem.map((m) => `- ${m.text}`).join("\n")}`);

  const live = skills.filter((s) => !s.disabled);
  const topSk = rankSkillList(live, query, 2);
  if (topSk.length) parts.push(`ITS SKILLS THAT FIT:\n${topSk.map((s) => `### ${s.name}\n${clip(s.instructions, 900)}`).join("\n")}`);
  const otherSk = live.filter((s) => !topSk.includes(s)).map((s) => s.name).slice(0, 12);
  if (otherSk.length) parts.push(`OTHER SKILLS: ${otherSk.join(", ")}`);

  const recent = msgs.slice(-8);
  const rel = bm25(msgs.slice(-200).filter((m) => !recent.includes(m)), (m) => plain(m.content), query).slice(0, 4).map((x) => x.doc);
  const fmt = (m: Msg) => `${m.role === "user" ? "owner" : "agent"}: ${clip(plain(m.content), 420)}`;
  if (rel.length) parts.push(`RELEVANT EARLIER WORK:\n${rel.map(fmt).join("\n")}`);
  if (recent.length) parts.push(`MOST RECENT CONVERSATION:\n${recent.map(fmt).join("\n")}`);

  let head = parts.join("\n\n");
  let code = "";
  if (o.code) {
    const reserve = Math.floor(o.budget * 0.55);
    head = clip(head, o.budget - reserve);
    code = await codeSnapshot(uid, id, query, reserve);
  } else head = clip(head, o.budget);
  return { name, text: [head, code].filter(Boolean).join("\n\n") || "(this agent has no saved work yet)" };
}