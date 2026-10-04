import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { CATALOG, byId, personaOf, type Member } from "@/lib/team-catalog";

export type TMsg = { role: "user" | "assistant"; content: string; at: number };
export type Feed = { from: string; to: string; text: string; at: number; kind: "task" | "result" | "note" };
export type TeamDoc = { members: string[]; threads: Record<string, TMsg[]>; feed: Feed[]; working: Record<string, string> };
export type LlmFn = (system: string, prompt: string) => Promise<string>;
export type TeamHost = {
  llm: LlmFn;
  runPc: (task: string, who: Member, onLine?: (line: string) => void) => Promise<string>;
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

function parseJson(reply: string): any {
  const a = reply.indexOf("{"), b = reply.lastIndexOf("}");
  try { return a >= 0 && b > a ? JSON.parse(reply.slice(a, b + 1)) : null; } catch { return null; }
}

// ---------- assembling a team (no work is started) ----------

export async function pickRoster(llm: LlmFn, brief: string, ctx: string): Promise<string[]> {
  const roster = CATALOG.map((x) => `${x.id}|${x.name}|${x.title}`).join("\n");
  const reply = await llm(
    personaOf(byId("chief")!),
    `Pick the team (5-9 members) that this person or company needs, from the roster. Cover leadership, the skills that fit their business, and the computer / coding / video specialists when relevant. Reply with JSON only: {"members":["id", ...]}\n\nROSTER (id|name|title):\n${roster}\n\nWHAT THEY TOLD YOU:\n${brief}${ctx ? `\n\nKnown about the user:${ctx.slice(0, 1000)}` : ""}`
  );
  const raw: any = parseJson(reply);
  let ids: string[] = Array.from(new Set((Array.isArray(raw?.members) ? raw.members : []).map(String))).filter((id) => Boolean(byId(id))) as string[];
  if (!ids.includes("chief")) ids.unshift("chief");
  if (ids.length < 3) ids = ["chief", "compass", "sprint", "sage", "forge", "quill"];
  return ids.slice(0, 10);
}

export async function assembleTeam(a: { uid: string; chatId: string; brief: string; ctx: string; llm: LlmFn }): Promise<Member[]> {
  const ids = await pickRoster(a.llm, a.brief, a.ctx);
  const members = ids.map((id) => byId(id)).filter(Boolean) as Member[];
  await updateTeam(a.uid, a.chatId, (t) => {
    for (const id of ids) if (!t.members.includes(id)) t.members.push(id);
    t.feed.push({ from: "Chief", to: "Team", text: `Team assembled: ${members.map((m) => m.name).join(", ")}. Waiting for the first task.`, at: Date.now(), kind: "note" });
    (t.threads["chief"] ||= []).push({ role: "assistant", content: `Team assembled: ${members.map((m) => `${m.name} (${m.title})`).join(", ")}. Waiting for your first task.`, at: Date.now() });
  });
  return members;
}

// ---------- planning ----------

export type Step = { member: string; task: string; after: number[] };

export async function planTeam(llm: LlmFn, goal: string, ctx: string): Promise<Step[]> {
  const roster = CATALOG.map((x) => `${x.id}|${x.name}|${x.title}|${x.tool}`).join("\n");
  const reply = await llm(
    personaOf(byId("chief")!),
    `Assemble the SMALLEST team (2-5 members) from this roster to achieve the goal, and plan the steps.
Roster (id|name|title|tool): tool "pc" = its own real computer with browser + terminal; "code" = Venus Code coding workspace; "video" = Venus Pro motion-graphics video; "research" = web research; "think" = writing/analysis; "email" = drafts emails (sending needs the Gmail connector, not connected yet).
${roster}

Rules: each step = {"member": id, "task": complete self-contained instruction incl. every detail the member needs, "after": [indices of EARLIER steps whose results this step needs]}. Steps that do not depend on each other must have an empty "after" so they run in parallel. Maximum 7 steps. Use the tool that fits the job (find leads → pc; build a website → code; emails → email; video → video).
Reply with JSON only: {"steps":[...]}${ctx ? `\n\nKnown about the user:${ctx.slice(0, 1200)}` : ""}

GOAL: ${goal}`
  );
  const raw = parseJson(reply);
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
  const urls = (hits.match(/https?:\/\/[^\s)]+/g) ?? []).slice(0, 3);
  const pages = await Promise.all(urls.map((u) => webCall({ action: "web", url: u }).then((x) => x.slice(0, 2500)).catch(() => "")));
  return llm(personaOf(who), `${task}\n\nSEARCH RESULTS:\n${hits.slice(0, 2500)}\n\nPAGES:\n${pages.join("\n---\n")}\n\nWrite your findings with source links. Do not invent facts.`);
}

async function execMember(who: Member, task: string, host: TeamHost, onLine: (l: string) => void): Promise<string> {
  switch (who.tool) {
    case "pc": return host.runPc(task, who, onLine);
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
  const say = (id: string, role: TMsg["role"], content: string) =>
    updateTeam(uid, chatId, (t) => { (t.threads[id] ||= []).push({ role, content: content.slice(0, 3500), at: Date.now() }); });

  await feed("You", "Chief", a.goal, "task");
  await say("chief", "user", a.goal);
  const steps = await planTeam(host.llm, a.goal, a.ctx);
  const ids = Array.from(new Set(steps.map((s) => s.member)));
  await updateTeam(uid, chatId, (t) => { for (const id of ids) if (!t.members.includes(id)) t.members.push(id); });
  const planText = `Plan: ${steps.map((s, i) => `${i + 1}. ${byId(s.member)?.name}`).join(" → ")}`;
  await feed("Chief", "Team", planText, "note");
  await say("chief", "assistant", `${planText}\n\n${steps.map((s, i) => `${i + 1}. ${byId(s.member)?.name}: ${s.task.slice(0, 160)}`).join("\n")}`);

  const results: string[] = new Array(steps.length).fill("");
  const level: number[] = [];
  steps.forEach((s, i) => { level[i] = s.after.length ? 1 + Math.max(...s.after.map((k) => level[k] ?? 0)) : 0; });

  for (let lv = 0; lv <= Math.max(...level); lv++) {
    const idxs = steps.map((_, i) => i).filter((i) => level[i] === lv);
    // The coding workspace and Venus Pro are single per chat → one after another.
    // Everything else (each computer member has its OWN computer) runs in parallel.
    const groups = new Map<string, number[]>();
    for (const i of idxs) {
      const tool = byId(steps[i].member)!.tool;
      const k = tool === "code" || tool === "video" ? tool : "s" + i;
      groups.set(k, [...(groups.get(k) ?? []), i]);
    }
    await Promise.all(Array.from(groups.values()).map(async (list) => {
      for (const i of list) {
        const s = steps[i];
        const who = byId(s.member)!;
        const deps = s.after.map((k) => `Result of step ${k + 1} (${byId(steps[k].member)?.name}):\n${results[k].slice(0, 2500)}`).join("\n\n");
        await feed("Chief", who.name, s.task, "task");
        await say(who.id, "user", `📋 From Chief:\n${s.task}`);
        await say(who.id, "assistant", "▶ Got it — starting now.");
        await updateTeam(uid, chatId, (t) => { t.working[who.id] = s.task.slice(0, 140); });
        let lastLine = 0;
        const onLine = (line: string) => {
          if (Date.now() - lastLine < 2500) return;
          lastLine = Date.now();
          void updateTeam(uid, chatId, (t) => { t.working[who.id] = line.slice(0, 140); });
        };
        try {
          results[i] = await execMember(who, deps ? `${s.task}\n\n${deps}` : s.task, host, onLine);
        } catch (e) {
          results[i] = `Failed: ${e instanceof Error ? e.message : "unknown error"}`;
        }
        await feed(who.name, "Chief", results[i], "result");
        await say(who.id, "assistant", results[i]);
        await updateTeam(uid, chatId, (t) => { delete t.working[who.id]; });
      }
    }));
  }

  const report = await host.llm(
    personaOf(byId("chief")!),
    `Write the final report to the user in clear English (markdown). Start with one outcome line (✅ done / ⚠️ partly / ❌ failed), then what each member did, concrete results (links, names, files) and what still needs the user. Never invent anything.\n\nGOAL: ${a.goal}\n\n${steps.map((s, i) => `STEP ${i + 1} — ${byId(s.member)?.name} (${s.task.slice(0, 160)}):\n${results[i].slice(0, 1800)}`).join("\n\n")}`
  );
  await say("chief", "assistant", report);
  return report;
}