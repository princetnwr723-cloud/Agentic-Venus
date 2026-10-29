import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { acquire, releaseNow } from "@/lib/computers";
import { ensureNode, followPcJob, proofUrl, startPcJob, type PcPending } from "@/lib/pc-agent";
import { providerMeta, PROVIDERS, type ProviderId } from "@/lib/providers";
import { CATALOG, byId, personaOf, type Member } from "@/lib/team-catalog";
import type { TeamRunDoc, TeamStepDoc } from "@/lib/steps";

export type TMsg = { role: "user" | "assistant"; content: string; at: number };
export type Feed = { from: string; to: string; text: string; at: number; kind: "task" | "result" | "note" };
export type TeamDoc = { members: string[]; threads: Record<string, TMsg[]>; feed: Feed[]; working: Record<string, string>; /** the live step list of the latest goal (shown in the chat's Progress panel) */ run?: TeamRunDoc };
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
  const list: any[] = Array.isArray(raw?.members) ? raw.members : [];
  let ids: string[] = Array.from(new Set(list.map((x: any) => String(x)))).filter((x: string) => !!byId(x));
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

// ---------- planning: split the task into steps, decide parallel or series ----------

export type Step = { member: string; task: string; after: number[] };

// A step needs the live browser only when the work itself is about real websites, lists, downloads or logins.
const LIVE = /\b(website|web ?site|webpage|url|directory|directories|linkedin|google maps|listing|listings|scrape|scraping|crawl|download|upload|login|log in|sign ?in|sign ?up|form|forms|booking|csv|spreadsheet|verify|verified|contact details|email addresses|phone numbers?|leads?|prospects?)\b/i;
// "find / collect / verify N leads|companies|contacts": always real browsing, even if the planner gave it to a writer.
const LIST_JOB = /\b(find|collect|gather|scrape|extract|verify|enrich|compile|dhund\w*|nikal\w*)\b[\s\S]{0,60}\b(leads?|prospects?|contacts?|companies|clinics?|businesses|emails?|profiles?|listings?)\b/i;
const WRITING = /\b(write|draft|compose|rewrite|edit|proofread|summari[sz]e|translate|subject line|copy)\b/i;
// Venus Pro downloads assets on the chat's computer when the brief asks for them.
const ASSET = /\b(assets?|footage|stock|photos?|images?|logos?|clips?|b-?roll|download)\b/i;
// A step that talks about the result of an earlier step.
const DEPENDS = /\b(them|those|these|uske|unhe|inhe|usse|us ?ko|is ?ko|result|results|above|previous|earlier|same|ye sab|wahi|jo mila|jo nikla)\b/i;

function pcMemberFor(task: string, planned: string[]): string {
  const t = task.toLowerCase();
  const pick = /\b(login|log in|sign in|form|booking|book|upload|fill)\b/.test(t) ? "errand"
    : /\b(scrape|crawl|table|dataset|csv)\b/.test(t) ? "scrape"
    : /\b(verify|enrich|details|company size|public contact)\b/.test(t) ? "intel"
    : "hunter";
  return planned.includes(pick) ? pick : planned[0] ?? pick;
}

/**
 * Routing by NEED, not by blanket rule. Research steps that really need live websites go to a computer member;
 * writing / analysis / email-draft / coding / video steps stay with the member the planner chose.
 */
function enforceToolRouting(steps: Step[]): Step[] {
  if (!steps.length) return steps;
  const planned = steps.filter((s) => byId(s.member)?.tool === "pc").map((s) => s.member);
  return steps.map((s) => {
    const tool = byId(s.member)?.tool;
    if (tool === "research" && LIVE.test(s.task)) return { ...s, member: pcMemberFor(s.task, planned) };
    if (tool === "think" && LIST_JOB.test(s.task) && !WRITING.test(s.task.slice(0, 80))) return { ...s, member: pcMemberFor(s.task, planned) };
    return s;
  });
}

/** The steps the user wrote down themselves (1. 2. 3. lines, or "pehle X phir Y then Z"). */
export function splitSteps(goal: string): Array<{ task: string; serial: boolean }> {
  const lines = goal.split("\n").map((l) => l.trim()).filter(Boolean);
  const listed = lines
    .map((l) => /^(?:\d{1,2}\s*[.)]|[-*•]|step\s*\d+\s*[:.)-]?)\s*(.+)$/i.exec(l))
    .filter((m): m is RegExpExecArray => Boolean(m));
  if (listed.length >= 2) return listed.slice(0, 7).map((m) => ({ task: m[1].trim(), serial: false }));
  const parts = goal
    .split(/\s*,?\s*\b(?:and then|after that|uske baad|uske bad|phir|fir|then|next)\b\s*/i)
    .map((s) => s.trim().replace(/^(?:pehle|first)\s+/i, ""))
    .filter((s) => s.length > 8);
  if (parts.length >= 2 && parts.length <= 7) return parts.map((task, i) => ({ task, serial: i > 0 }));
  return [];
}

function memberFor(task: string): string {
  if (/\b(video|reel|reels|shorts?|animation|motion graphics?)\b/i.test(task)) return /9:16|reel|shorts?|vertical/i.test(task) ? "reel" : "frame";
  if (/\b(website|web ?site|landing|app|script|api|bug|code|component|page|dashboard)\b/i.test(task) && !LIST_JOB.test(task)) return "forge";
  if (LIST_JOB.test(task) || LIVE.test(task)) return "hunter";
  if (/\b(e-?mails?|outreach|newsletter)\b/i.test(task)) return "mailer";
  if (/\b(research|compare|analy[sz]e|market|competitors?)\b/i.test(task)) return "sage";
  if (WRITING.test(task)) return "quill";
  return "chief";
}

function stepsFromExplicit(goal: string, list: Array<{ task: string; serial: boolean }>): Step[] {
  return list.map((e, i) => ({
    member: memberFor(e.task),
    task: `${e.task}\n\n(Overall goal: ${goal.slice(0, 400)})`,
    after: i > 0 && (e.serial || DEPENDS.test(e.task)) ? [i - 1] : [],
  }));
}

export async function planTeam(llm: LlmFn, goal: string, ctx: string): Promise<Step[]> {
  const roster = CATALOG.map((x) => `${x.id}|${x.name}|${x.title}|${x.tool}`).join("\n");
  const explicit = splitSteps(goal);
  let steps: Step[] = [];
  try {
    const reply = await llm(
      personaOf(byId("chief")!),
      `You are the planner of an agent. Split the goal into STEPS, pick the right specialist for each step from the roster, and decide what can run in parallel.
Roster (id|name|title|tool): tool "pc" = a real computer with browser + terminal (each pc member gets its OWN computer, so pc members run in parallel); "code" = Venus Code coding workspace; "video" = Venus Pro motion-graphics video; "research" = quick web research; "think" = writing/analysis; "email" = drafts emails (sending needs the Gmail connector).
${roster}

HOW TO SPLIT
- If the user listed steps (1, 2, 3 / pehle... phir... / then), keep EXACTLY those steps in that order: one step per item, none merged, none dropped. Example: 3 listed steps = 3 steps.
- Otherwise split by distinct pieces of work. A single small job stays ONE step.
- Each step = {"member": id, "task": complete self-contained instruction with every detail the member needs, "after": [indices of EARLIER steps whose RESULT this step needs]}.
- PARALLEL: steps that do not need each other's output get an empty "after" and run at the same time (for example a website with Venus Code and a video with Venus Pro, or two research jobs).
- SERIES: a step that uses the result of another step lists it in "after" (for example write emails after the leads are found).
- Use a member ONLY if the work needs that skill. The team is brought in automatically: the user never has to ask for it. Never add members to look busy.
- Tools: lists of leads / live websites / downloads / logins -> pc; build a website or app -> code; video -> video; writing -> think; emails -> email.
- Maximum 7 steps.
Reply with JSON only: {"steps":[...]}${ctx ? `\n\nKnown about the user:${ctx.slice(0, 1200)}` : ""}

GOAL: ${goal}`
    );
    const raw = parseJson(reply);
    steps = (Array.isArray(raw?.steps) ? raw.steps : []).slice(0, 7).map((s: any, i: number) => ({
      member: byId(String(s?.member)) ? String(s.member) : "chief",
      task: String(s?.task ?? "").slice(0, 2500),
      after: (Array.isArray(s?.after) ? s.after : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n < i),
    })).filter((s: Step) => s.task);
  } catch { steps = []; }

  // The user wrote N steps: never end up with fewer.
  let planned: Step[] = steps;
  if (explicit.length >= 2 && steps.length < explicit.length) planned = stepsFromExplicit(goal, explicit);
  if (!planned.length) planned = [{ member: "chief", task: goal, after: [] }];

  const routed = enforceToolRouting(planned);
  return routed.map((s, i) => ({ ...s, after: Array.from(new Set(s.after)).filter((n) => Number.isInteger(n) && n >= 0 && n < i) }));
}

// ---------- every computer member gets its OWN computer ----------

type WorkerEnv = { e2bKey: string; provider: ProviderId; model: string; apiKey: string; creds: Record<string, unknown> };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const hasCred = (creds: Record<string, unknown>, site: string) => {
  const n = norm(site);
  if (n.length < 2) return false;
  return Object.keys(creds).some((k) => k === n || (k.length >= 3 && n.includes(k)) || (n.length >= 3 && k.includes(n)));
};

/** Values are vault placeholders ("vault:..."): the server resolves them, the browser never sees real secrets. */
async function loadWorkerEnv(uid: string, chatId: string): Promise<WorkerEnv | null> {
  try {
    const u = (await getDoc(doc(db, "users", uid))).data() as { e2bKey?: string; apiKeys?: Partial<Record<ProviderId, string>>; pcCredentials?: Record<string, unknown> } | undefined;
    const c = (await getDoc(doc(db, "users", uid, "chats", chatId))).data() as { provider?: ProviderId; model?: string } | undefined;
    const keys = u?.apiKeys ?? {};
    if (!u?.e2bKey) return null;
    let provider = c?.provider as ProviderId | undefined;
    let model = c?.model;
    if (!provider || !keys[provider]) {
      const alt = PROVIDERS.find((p) => keys[p.id]);
      if (!alt) return null;
      provider = alt.id;
      model = providerMeta(alt.id).models[0];
    }
    if (!model) model = providerMeta(provider).models[0];
    return { e2bKey: u.e2bKey, provider, model, apiKey: keys[provider] as string, creds: u.pcCredentials ?? {} };
  } catch { return null; }
}

// at most 3 computers work at the same time (keeps E2B cost and rate limits under control)
let active = 0;
const waiters: Array<() => void> = [];
async function takeSlot(max = 3) {
  while (active >= max) await new Promise<void>((r) => waiters.push(r));
  active++;
}
function freeSlot() {
  active = Math.max(0, active - 1);
  waiters.shift()?.();
}

async function runWorkerPc(a: { uid: string; chatId: string; who: Member; task: string; ctx: string; env: WorkerEnv; onLine: (l: string) => void }): Promise<string> {
  const { uid, chatId, who, env: w } = a;
  const env = { uid, token: async () => (await auth.currentUser?.getIdToken()) ?? "", e2bKey: w.e2bKey };
  let abort = "";
  const onAsk = async (p: PcPending): Promise<Record<string, unknown>> => {
    if (p.kind === "login") {
      if (hasCred(w.creds, p.site ?? "")) return { type: "login_saved", site: p.site ?? "" };
      abort = `a login for ${p.site || "a site"} (save it in vPassword or run this step yourself on the computer panel)`;
      return { type: "self" };
    }
    if (p.kind === "choice") {
      const opts = p.options ?? [];
      const cancel = opts.find((o) => /^(cancel|no|decline)/i.test(o));
      if (cancel) return { type: "answer", text: cancel }; // the owner is not here to approve anything risky
      return { type: "answer", text: opts[0] ?? "" };
    }
    if (p.kind === "handoff") { abort = abort || "a manual step on the computer"; return { type: "handoff_done" }; }
    return { type: "answer", text: "The owner is not available. Use your best judgment, and list anything that needs the owner under 'Needs you'." };
  };

  await takeSlot();
  let sid = "";
  try {
    sid = await acquire({ uid, e2bKey: w.e2bKey }, chatId, "worker_" + who.id.replace(/[^A-Za-z0-9]/g, ""));
    a.onLine(`🖥️ ${who.name} is working on its own computer`);
    await ensureNode(env, sid, a.onLine);
    const context = `${personaOf(who)}\n${a.ctx}`.slice(0, 9000);
    const jobKey = `${chatId}_w_${who.id}`;
    const jobId = await startPcJob(env, { sandboxId: sid, chatId, jobKey, task: a.task, provider: w.provider, model: w.model, apiKey: w.apiKey, context });
    const out = await followPcJob({
      env, chatId, jobKey, sandboxId: sid, jobId,
      onStep: a.onLine, onAsk, cancelled: () => Boolean(abort),
    });
    if (abort) return `⚠️ ${who.name} needs you: ${abort}. Nothing was invented. Do that, then run the goal again.`;
    if (out.status === "stopped") return "⚠️ Stopped before finishing.";
    if (out.status !== "done") return `⚠️ ${out.summary}`;
    let replay = "";
    if (out.proof) {
      const url = await proofUrl(env, out.proof).catch(() => "");
      if (url) replay = `\n\n🎥 [Watch ${who.name}'s replay](${url}) (link works for 6 hours)`;
    }
    return out.summary + replay;
  } finally {
    freeSlot();
    if (sid) void releaseNow(w.e2bKey, sid); // work is over: switch this member's computer off
  }
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
  return llm(personaOf(who), `${task}\n\nSEARCH RESULTS:\n${hits.slice(0, 2500)}\n\nPAGES:\n${pages.join("\n---\n")}\n\nWrite your findings with source links (one claim per line, each line ending with its source URL). Do not invent facts.`);
}

type Worker = { uid: string; chatId: string; ctx: string; env: WorkerEnv };

async function execMember(who: Member, task: string, host: TeamHost, onLine: (l: string) => void, wk: Worker | null): Promise<string> {
  switch (who.tool) {
    case "pc": return wk ? runWorkerPc({ uid: wk.uid, chatId: wk.chatId, who, task, ctx: wk.ctx, env: wk.env, onLine }) : host.runPc(task, who, onLine);
    case "code": return host.runCode(task, who);
    case "video": return host.runVideo(task, who);
    case "research": return research(task, who, host.llm);
    default: return host.llm(personaOf(who), task);
  }
}

const FAILED = /^Failed:|^⚠️|^❌|^Skipped:/i;

type PatchRun = (fn: (r: TeamRunDoc) => void) => Promise<void>;

const clipOne = (v: string, n: number) => v.replace(/\s+/g, " ").trim().slice(0, n);
const statusOf = (r: string): TeamStepDoc["status"] => (/^Skipped:/i.test(r.trim()) ? "skipped" : FAILED.test(r.trim()) ? "failed" : "done");
const noteOf = (r: string): string => clipOne(r.replace(/^(Failed:|Skipped:|⚠️|❌)\s*/i, "").replace(/[#*_`>]/g, ""), 220);

/** Starts the live step list for this goal, runs the team, and always leaves a truthful final state (also when it throws). */
export async function runTeamGoal(a: { uid: string; chatId: string; goal: string; ctx: string; host: TeamHost }): Promise<string> {
  const { uid, chatId } = a;
  const runId = Date.now().toString(36);
  const t0 = Date.now();
  await updateTeam(uid, chatId, (t) => { t.run = { id: runId, goal: a.goal.slice(0, 400), status: "planning", steps: [], startedAt: t0, updatedAt: t0 }; });
  const patchRun: PatchRun = (fn) => updateTeam(uid, chatId, (t) => {
    if (!t.run || t.run.id !== runId) return; // a newer goal replaced this run
    fn(t.run);
    t.run.updatedAt = Date.now();
  });
  try {
    return await runTeamGoalInner(a, patchRun);
  } catch (e) {
    const why = e instanceof Error ? e.message : "unknown error";
    await patchRun((r) => {
      const now = Date.now();
      r.status = "failed";
      r.endedAt = now;
      for (const x of r.steps) {
        if (x.status === "running") { x.status = "failed"; x.note = x.note || `Run ruk gaya: ${clipOne(why, 160)}`; x.endedAt = now; }
        else if (x.status === "queued") { x.status = "skipped"; x.note = "Pehle ka step/team run ruk gaya, ye chala nahi."; x.endedAt = now; }
      }
      if (!r.steps.length) r.steps = [{ i: 0, member: "chief", name: "Chief", task: "Goal ko steps me todna", after: [], status: "failed", note: clipOne(why, 200), startedAt: r.startedAt, endedAt: now }];
    });
    throw e;
  }
}

async function runTeamGoalInner(a: { uid: string; chatId: string; goal: string; ctx: string; host: TeamHost }, patchRun: PatchRun): Promise<string> {
  const { uid, chatId, host } = a;
  const feed = (from: string, to: string, text: string, kind: Feed["kind"]) =>
    updateTeam(uid, chatId, (t) => { t.feed.push({ from, to, text: text.slice(0, 900), at: Date.now(), kind }); });
  const say = (id: string, role: TMsg["role"], content: string) =>
    updateTeam(uid, chatId, (t) => { (t.threads[id] ||= []).push({ role, content: content.slice(0, 3500), at: Date.now() }); });

  await feed("You", "Chief", a.goal, "task");
  await say("chief", "user", a.goal);

  // 1) split the task into steps (the team is brought in automatically, nobody has to ask for it)
  const steps = await planTeam(host.llm, a.goal, a.ctx);
  const ids = Array.from(new Set(steps.map((s) => s.member)));
  let joined: string[] = [];
  await updateTeam(uid, chatId, (t) => {
    joined = ids.filter((id) => !t.members.includes(id));
    for (const id of ids) if (!t.members.includes(id)) t.members.push(id);
  });
  if (joined.length) await feed("Chief", "Team", `Joined automatically for this task: ${joined.map((id) => byId(id)?.name ?? id).join(", ")}.`, "note");
  // the owner sees every step right away (queued), then each one turns active / done / failed as it runs
  await patchRun((r) => {
    r.status = "running";
    r.steps = steps.map((s, i) => ({ i, member: s.member, name: byId(s.member)?.name ?? s.member, task: clipOne(s.task.split("\n\n(Overall goal:")[0], 260), after: s.after, status: "queued" as const }));
  });

  // own computers per member when the account has an E2B key and a model key; otherwise the chat's shared computer (one at a time)
  const needsPc = steps.some((s) => byId(s.member)?.tool === "pc");
  const wenv = needsPc ? await loadWorkerEnv(uid, chatId) : null;
  const wk: Worker | null = wenv ? { uid, chatId, ctx: a.ctx, env: wenv } : null;

  // 2) lanes: steps in the same lane run one after the other (they share one workspace / computer),
  //    steps in different lanes run at the same time. Venus Code and Venus Pro are different lanes.
  const laneOf = (i: number): string => {
    const who = byId(steps[i].member)!;
    if (who.tool === "pc") return wk ? "pc:" + who.id : "pc";
    if (who.tool === "code") return "code";
    if (who.tool === "video") return !wk && ASSET.test(steps[i].task) ? "pc" : "video";
    return "s" + i;
  };

  const level: number[] = [];
  steps.forEach((s, i) => { level[i] = s.after.length ? 1 + Math.max(...s.after.map((k) => level[k] ?? 0)) : 0; });
  const phases: string[] = [];
  for (let lv = 0; lv <= Math.max(...level); lv++) {
    const groups = new Map<string, number[]>();
    steps.forEach((_, i) => { if (level[i] === lv) groups.set(laneOf(i), [...(groups.get(laneOf(i)) ?? []), i]); });
    phases.push(Array.from(groups.values()).map((l) => l.map((i) => `${i + 1}.${byId(steps[i].member)?.name}`).join(" → ")).join(" ∥ "));
  }
  const planText = `Plan (${steps.length} step${steps.length > 1 ? "s" : ""}, ∥ = parallel, → = one after the other): ${phases.join("  ⟶  ")}`;
  await feed("Chief", "Team", planText, "note");
  await say("chief", "assistant", `${planText}\n\n${steps.map((s, i) => `${i + 1}. ${byId(s.member)?.name}${s.after.length ? ` (after ${s.after.map((k) => k + 1).join(", ")})` : " (can start at once)"}: ${s.task.slice(0, 160)}`).join("\n")}`);
  if (needsPc) await feed("Chief", "Team", wk ? "Each computer member works on its own computer, in parallel (max 3 at once)." : "Using this chat's shared computer, one step at a time.", "note");

  // 3) run: a step starts as soon as the steps it needs are finished AND its lane is free
  const results: string[] = new Array(steps.length).fill("");
  const laneTails = new Map<string, Promise<unknown>>();
  const inLane = <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = laneTails.get(key) ?? Promise.resolve();
    const p = prev.then(fn);
    laneTails.set(key, p.catch(() => undefined));
    return p;
  };

  const runOne = async (i: number): Promise<void> => {
    const s = steps[i];
    const who = byId(s.member)!;
    try {
      const deps = s.after.map((k) => `Result of step ${k + 1} (${byId(steps[k].member)?.name}):\n${results[k].slice(0, 2500)}`).join("\n\n");
      await patchRun((r) => { const x = r.steps[i]; if (x) { x.status = "running"; x.startedAt = Date.now(); } });
      await feed("Chief", who.name, `Step ${i + 1}: ${s.task}`, "task");
      await say(who.id, "user", `📋 From Chief (step ${i + 1}):\n${s.task}`);
      await say(who.id, "assistant", "▶ Got it — starting now.");
      await updateTeam(uid, chatId, (t) => { t.working[who.id] = s.task.slice(0, 140); });
      let lastLine = 0;
      const onLine = (line: string) => {
        if (Date.now() - lastLine < 2500) return;
        lastLine = Date.now();
        void updateTeam(uid, chatId, (t) => { t.working[who.id] = line.slice(0, 140); });
      };
      try {
        const blocked = s.after.some((k) => FAILED.test(results[k].trim()));
        if (blocked) {
          results[i] = "Skipped: a required earlier step failed, so this step was not run with incomplete inputs.";
          await say(who.id, "assistant", results[i]);
        } else {
          results[i] = await execMember(who, deps ? `${s.task}\n\n${deps}` : s.task, host, onLine, wk);
        }
      } catch (e) {
        results[i] = `Failed: ${e instanceof Error ? e.message : "unknown error"}`;
      }
      await patchRun((r) => {
        const x = r.steps[i];
        if (!x) return;
        x.status = statusOf(results[i]);
        x.note = noteOf(results[i]) || undefined;
        if (!x.note) delete x.note;
        x.endedAt = Date.now();
      });
      await feed(who.name, "Chief", results[i], "result");
      await say(who.id, "assistant", results[i]);
    } catch (e) {
      results[i] = results[i] || `Failed: ${e instanceof Error ? e.message : "unknown error"}`;
    } finally {
      // safety net: a step can never stay "running" after its code is over
      await patchRun((r) => {
        const x = r.steps[i];
        if (x && x.status === "running") { x.status = statusOf(results[i] || "Failed: no result"); x.endedAt = Date.now(); if (x.status === "failed") x.note = x.note || "Koi result nahi mila."; }
      });
      await updateTeam(uid, chatId, (t) => { delete t.working[who.id]; });
    }
  };

  const finished: Array<Promise<void>> = [];
  steps.forEach((s, i) => {
    finished[i] = (async () => {
      await Promise.all(s.after.map((k) => finished[k]));
      await inLane(laneOf(i), () => runOne(i));
    })();
  });
  await Promise.all(finished);

  const failures = results.filter((r) => FAILED.test(r.trim())).length;
  await patchRun((r) => {
    const ok = r.steps.filter((x) => x.status === "done").length;
    r.status = ok === r.steps.length ? "done" : ok === 0 ? "failed" : "partial";
    r.endedAt = Date.now();
  });
  const report = await host.llm(
    personaOf(byId("chief")!),
    `Write the final report to the user in clear English (markdown). Start with one outcome line (use ❌ failed if the core goal failed, ⚠️ partly if any required step failed or was skipped, otherwise ✅ done), then what each member did, concrete results (links, names, files) and what still needs the user. Keep every "UNVERIFIED", "UNCHECKED", "FACT CHECK" and "VERIFIED:" line from the members exactly as written. Never invent anything and NEVER claim a skipped/failed step was completed.\n\nGOAL: ${a.goal}\nSTEPS WITH FAILURE/SKIP SIGNALS: ${failures}\n\n${steps.map((s, i) => `STEP ${i + 1} — ${byId(s.member)?.name} (${s.task.slice(0, 160)}):\n${results[i].slice(0, 1800)}`).join("\n\n")}`
  );
  await say("chief", "assistant", report);
  return report;
}
