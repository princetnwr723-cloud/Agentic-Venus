import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { CATALOG, byId, personaOf, type Member } from "@/lib/team-catalog";

export type TMsg = { role: "user" | "assistant"; content: string; at: number };
export type Feed = { from: string; to: string; text: string; at: number; kind: "task" | "result" | "note" };
export type TeamDoc = { members: string[]; threads: Record<string, TMsg[]>; feed: Feed[]; working: Record<string, string> };
export type LlmFn = (system: string, prompt: string) => Promise<string>;
export type TeamHost = {
  llm: LlmFn;
  runPc: (task: string, who: Member) => Promise<string>;
  runCode: (task: string, who: Member) => Promise<string>;
  runVideo: (task: string, who: Member) => Promise<string>;
};

const empty = (): TeamDoc => ({ members: ["chief"], threads: {}, feed: [], working: {} });
const ref = (uid: string, chatId: string) => doc(db, "users", uid, "teams", chatId);

export function watchTeam(uid: string, chatId: string, cb: (t: TeamDoc) => void) {
  return onSnapshot(ref(uid, chatId), (s) => cb(s.exists() ? { ...empty(), ...(s.data() as Partial<TeamDoc>) } : empty()), () => cb(empty()));
}

const queues = new Map<string, Promise<unknown>>();
/** Serialized read-modify-write so parallel members never overwrite each other. */
export function updateTeam(uid: string, chatId: string, fn: (t: TeamDoc) => void): Promise<void> {
  const key = uid + chatId;
  const next = (queues.get(key) ?? Promise.resolve()).then(async () => {
    const s = await getDoc(ref(uid, chatId)).catch(() => null);
    const t: TeamDoc = s?.exists() ? { ...empty(), ...(s.data() as Partial<TeamDoc>) } : empty();
    fn(t);
    t.feed = t.feed.slice(-80);
    t.threads = Object.fromEntries(Object.entries(t.threads).map(([k, v]) => [k, v.slice(-40)]));
    await setDoc(ref(uid, chatId), JSON.parse(JSON.stringify(t)));
  }).catch(() => {});
  queues.set(key, next);
  return next as Promise<void>;
}
export const addMember = (uid: string, chatId: string, id: string) => updateTeam(uid, chatId, (t) => { if (!t.members.includes(id)) t.members.push(id); });
export const removeMember = (uid: string, chatId: string, id: string) => updateTeam(uid, chatId, (t) => { t.members = t.members.filter((x) => x !== id || x === "chief"); });

// ---------- planning ----------

export type Step = { member: string; task: string; after: number[] };

export async function planTeam(llm: LlmFn, goal: string, ctx: string): Promise<Step[]> {
  const roster = CATALOG.map((x) => `${x.id}|${x.name}|${x.title}|${x.tool}`).join("\n");
  const reply = await llm(
    personaOf(byId("chief")!),
    `Assemble the SMALLEST team (2-5 members) from this roster to achieve the goal, and plan the steps.
Roster (id|name|title|tool): tool "pc" = a real computer with browser + terminal; "code" = Venus Code coding workspace; "video" = Venus Pro motion-graphics video; "research" = web research; "think" = writing/analysis; "email" = drafts emails (sending needs the Gmail connector, not connected yet).
${roster}

Rules: each step = {"member": id, "task": complete self-contained instruction incl. every detail the member needs, "after": [indices of EARLIER steps whose results this step needs]}. Steps that do not depend on each other must have an empty "after" so they run in parallel. Maximum 7 steps. Use the tool that fits the job (find leads → pc; build a website → code; emails → email; video → video).
Reply with JSON only: {"steps":[...]}${ctx ? `\n\nKnown about the user:${ctx.slice(0, 1200)}` : ""}

GOAL: ${goal}`
  );
  const a = reply.indexOf("{"), b = reply.lastIndexOf("}");
  let raw: any = null;
  try { raw = a >= 0 && b > a ? JSON.parse(reply.slice(a, b + 1)) : null; } catch { /* fall through */ }
  const steps: Step[] = (Array.isArray(raw?.steps) ? raw.steps : []).slice(0, 7).map((s: any, i: number) => ({
    member: byId(String(s?.member)) ? String(s.member) : "chief",
    task: String(s?.task ?? "").slice(0, 2500),
    after: (Array.isArray(s?.after) ? s.after : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n < i),
  })).filter((s: Step) => s.task);
  return steps.length ? steps : [{ member: "chief", task: goal, after: [] }];
}

// ---------- running a member's step ----------

async function webCall(body: Record<string, unknown>): Promise<string> {
  const res = await fetch("/api/code/ws", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "web failed");
  return String(d.text ?? "");
}

async function research(task: string, who: Member, llm: LlmFn): Promise<string> {
  const q = (await llm("Reply with ONE short web search query (max 8 words) and nothing else.", task)).replace(/["\n]/g, "").slice(0, 100);
  const hits = await webCall({ action: "web", query: q }).catch(() => "");
  const urls = (hits.match(/https?:\/\/[^\s)]+/g) ?? []).slice(0, 2);
  const pages: string[] = [];
  for (const u of urls) pages.push((await webCall({ action: "web", url: u }).catch(() => "")).slice(0, 2500));
  return llm(personaOf(who), `${task}\n\nSEARCH RESULTS:\n${hits.slice(0, 2500)}\n\nPAGES:\n${pages.join("\n---\n")}\n\nWrite your findings with source links. Do not invent facts.`);
}

async function execMember(who: Member, task: string, host: TeamHost): Promise<string> {
  switch (who.tool) {
    case "pc": return host.runPc(task, who);
    case "code": return host.runCode(task, who);
    case "video": return host.runVideo(task, who);
    case "research": return research(task, who, host.llm);
    default: return host.llm(personaOf(who), task);
  }
}

export async function runTeamGoal(a: { uid: string; chatId: string; goal: string; ctx: string; host: TeamHost }): Promise<string> {
  const { uid, chatId, host } = a;
  const feed = (from: string, to: string, text: string, kind: Feed["kind"]) =>
    updateTeam(uid, chatId, (t) => { t.feed.push({ from, to, text: text.slice(0, 900), at: Date.now(), kind }); });

  await feed("You", "Chief", a.goal, "task");
  const steps = await planTeam(host.llm, a.goal, a.ctx);
  const ids = Array.from(new Set(steps.map((s) => s.member)));
  await updateTeam(uid, chatId, (t) => { for (const id of ids) if (!t.members.includes(id)) t.members.push(id); });
  await feed("Chief", "Team", `Plan: ${steps.map((s, i) => `${i + 1}. ${byId(s.member)?.name}`).join(" → ")}`, "note");

  const results: string[] = new Array(steps.length).fill("");
  const level: number[] = [];
  steps.forEach((s, i) => { level[i] = s.after.length ? 1 + Math.max(...s.after.map((k) => level[k] ?? 0)) : 0; });

  for (let lv = 0; lv <= Math.max(...level); lv++) {
    const idxs = steps.map((_, i) => i).filter((i) => level[i] === lv);
    const groups = new Map<string, number[]>(); // same tool → run one after another
    for (const i of idxs) { const k = byId(steps[i].member)!.tool; groups.set(k, [...(groups.get(k) ?? []), i]); }
    await Promise.all(Array.from(groups.values()).map(async (list) => {
      for (const i of list) {
        const s = steps[i];
        const who = byId(s.member)!;
        const deps = s.after.map((k) => `Result of step ${k + 1} (${byId(steps[k].member)?.name}):\n${results[k].slice(0, 2500)}`).join("\n\n");
        await feed("Chief", who.name, s.task, "task");
        await updateTeam(uid, chatId, (t) => { t.working[who.id] = s.task.slice(0, 140); });
        try {
          results[i] = await execMember(who, deps ? `${s.task}\n\n${deps}` : s.task, host);
        } catch (e) {
          results[i] = `Failed: ${e instanceof Error ? e.message : "unknown error"}`;
        }
        await feed(who.name, "Chief", results[i], "result");
        await updateTeam(uid, chatId, (t) => { delete t.working[who.id]; });
      }
    }));
  }

  return host.llm(
    personaOf(byId("chief")!),
    `Write the final report to the user in clear English (markdown). Start with one outcome line (✅ done / ⚠️ partly / ❌ failed), then what each member did, concrete results (links, names, files) and what still needs the user. Never invent anything.\n\nGOAL: ${a.goal}\n\n${steps.map((s, i) => `STEP ${i + 1} — ${byId(s.member)?.name} (${s.task.slice(0, 160)}):\n${results[i].slice(0, 1800)}`).join("\n\n")}`
  );
}