import { repoFileIntent } from "@/lib/repo-intent";

export type Intent = "chat" | "set_role" | "assemble" | "pc" | "code" | "video" | "team" | "remember" | "forget" | "clarify";
export type Then = "pc" | "assemble" | "team" | "code";
export type Understanding = { intent: Intent; task: string; reply: string; role: string; why: string; facts: string[]; then: Then[] };

const INTENTS: Intent[] = ["chat", "set_role", "assemble", "pc", "code", "video", "team", "remember", "forget", "clarify"];

const SYSTEM = `You are the "understand first" brain of an AI agent. Read the user's latest message and decide what they REALLY want right now. Reply with ONE JSON object only (no prose, no fences):
{"intent":"...","task":"...","reply":"...","role":"...","facts":[],"then":[],"why":"..."}

HOW THE AGENT WORKS: real work that needs a live computer the user can watch is intent "pc": research on live websites, collecting leads or any list, scraping, reading a whole GitHub repository, forms, logins, downloads, terminal/system work, signing up for services, audits, comparisons that need live data. The coding studio ("code") is ONLY for building or changing software. Chat is for conversation AND for everything a connected tool can do in a call.

INTENTS
- set_role: the user tells you WHO you are or gives your job ("you are my CEO", "from now on you are the lead developer of this project", "tum meri company ke head ho"). Put the role in one sentence in "role". If the same message ALSO asks for work (read the repo, assign a team...), put those steps in "then" and the remaining work as ONE self-contained instruction in "task".
- assemble: the user asks you to hire / assemble / assign / set up a team. Nothing is started.
- chat: questions, discussion, advice, writing, brainstorming, opinions, simple status, small lookups, AND every action a connected tool can do directly: sending, reading or searching email (gmail.*, email.*), messages (whatsapp/sms/telegram/slack), Google Sheets/Calendar/Drive (oauth_google), and adding / editing / deleting files in a GitHub repo (github.put_files, or repo.write_file + repo.push when the repo is cloned). This stays "chat" even for MANY recipients or files: the chat calls the tool. NEVER "pc" or "code" for these. Leave "reply" empty.
- pc: ONE job that needs a live computer (see above). If no tool call can do it, it is pc.
- code: ONE job that is software to build or change (website, app, script, bug fix, new feature). NEVER for research, leads, reading, writing, plans, company/role setup, sending email, or adding a file to a repo.
- video: ONE motion-graphics video or reel.
- team: the request has 2 or more steps (listed 1,2,3 or sequenced with "then / phir / uske baad") or needs 2+ different areas of work (for example website + video + leads). The agent splits it into steps by itself, brings the right specialists in automatically, and runs independent steps in parallel and dependent steps one after the other. The user NEVER has to say "team" or "assemble".
- remember / forget: the user states a lasting fact or preference / asks to forget something.
- clarify: the user wants work done but an essential detail is missing. "reply" = ONE short question.

FIELDS
- facts: durable facts or preferences the user stated about themselves, their business, their projects or how they want things done ([] if none). Max 3, each one short sentence. Never passwords, keys, tokens, card data.
- then: ONLY with set_role. Ordered steps from "pc", "assemble", "team", "code".

RULES
- Between chat and pc for a TASK (not a question): choose chat if a connected tool in the list can do it, otherwise pc. Between code and pc: code ONLY if software must be written.
- One single job = pc / code / video. Two or more steps or areas = team.
- Introductions, role statements and "what would you do" are never work orders by themselves.
- "task" must be self-contained (resolve "do it", "haan kar do" from the recent messages).
- "reply" is short (max 2 lines) for non-chat intents, in clear English. Never claim the work is done.`;

const NOUN = "(?:leads?|prospects?|contacts?|emails?|companies|startups?|businesses|clients?|customers?|agencies|founders?|ceos?|restaurants?|dentists?|doctors?|clinics?|shops?|stores?|profiles?|listings?|products?|jobs?|influencers?|youtubers?|websites?)";
const VERB = "(?:find|get|collect|gather|scrape|extract|research|generate|compile|list|audit|check|nikal\\w*|dhund\\w*|dhoond\\w*|lao|laao|chahiye|bhej\\w*|send)";
const QUOTA = new RegExp("\\b\\d{1,4}\\s+(?:[\\w&-]+\\s+){0,3}?" + NOUN + "\\b", "i");
const VERB_RE = new RegExp("\\b" + VERB + "\\b", "i");
const CODE_RE = /\b(build|create|make|develop|write|banao|bana do|bana de|bana|likho)\b[\s\S]{0,40}\b(website|web ?site|app|landing|page|script|api|bot|extension|game|dashboard|component)\b|\b(fix|debug)\b[\s\S]{0,25}\b(bug|error|code)\b/i;
const SET_ROLE = /\b(you are|you're|tum|aap)\b[\s\S]{0,60}\b(my|meri|mere|hamari|hamare|our|iske|iss|is)?\s*[\s\S]{0,25}\b(ceo|cto|coo|cfo|manager|assistant|head|chief|lead|leads|director|founder|owner|incharge|in-charge|developer|architect|agent)\b[\s\S]{0,15}\b(ho|hai|are|hona)\b/i;
const READ_REPO = /\b(read|padh\w*|analy[sz]e|review|study|understand|explore|samajh\w*)\b[\s\S]{0,50}\b(repo|repository|codebase|github)\b/i;
const TEAM_ASSIGN = /\bteam\b[\s\S]{0,30}\b(assign|assemble|bana\w*|set up|hire|lag\w*)\b|\b(assign|assemble|hire)\b[\s\S]{0,20}\bteam\b/i;

const MAILY = /\b(e-?mails?|mails?)\b/i;
const MAIL_ACT = /\b(send|bhej\w*|write|draft|reply|follow\s?-?up|forward)\b/i;
const FINDY = /\b(find|collect|gather|scrape|extract|research|generate|compile|list|dhund\w*|dhoond\w*|nikal\w*)\b/i;

// ---------- multi-step detection: the agent decides by itself when a team is needed ----------
const D_CODE = /\b(website|web ?site|landing|app|script|api|bot|extension|game|dashboard|component|bug|code|frontend|backend)\b/i;
const D_VIDEO = /\b(video|reel|reels|shorts?|animation|motion graphics?)\b/i;
const D_PC = /\b(leads?|prospects?|scrape|scraping|crawl|research|download|login|log in|linkedin|google maps|competitors?|audit)\b/i;
const D_ACTION = /\b(build|create|make|find|collect|gather|scrape|research|write|banao|bana|dhund\w*|nikal\w*|karo|kar do|kardo|generate|design|download|fix|develop|prepare|compile|audit)\b/i;
const D_QUESTION = /^\s*(what|kya|how|why|explain|kaise|kyu|kyun|which|kaun)\b/i;
const SEQ = /\b(?:and then|after that|uske baad|uske bad|phir|fir|then)\b/gi;

export function stepCount(t: string): number {
  const listed = t.split("\n").filter((l) => /^\s*(?:\d{1,2}\s*[.)]|[-*•]|step\s*\d+)/i.test(l)).length;
  const seq = (t.match(SEQ) ?? []).length + 1;
  return Math.max(listed, seq);
}

/** True when the request has several steps / areas of work, so the agent plans them itself and brings in the right specialists. */
export function needsTeam(t: string, _tools: string[] = []): boolean {
  const text = String(t ?? "").trim();
  if (!text || text.startsWith("/") || text.length > 4000) return false;
  if (repoFileIntent(text)) return false;
  if (D_QUESTION.test(text) && /\?\s*$/.test(text)) return false;
  if (!D_ACTION.test(text)) return false;
  const heavy = [D_CODE, D_VIDEO, D_PC].filter((r) => r.test(text)).length;
  if (heavy >= 2) return true;
  return heavy >= 1 && stepCount(text) >= 2;
}

/**
 * Work that MUST go to the computer. Sending email / messages with a connected tool and adding files to a repo are NOT such work:
 * "send 5 emails" used to be caught here (it looks like "5 <noun>") and opened the computer.
 */
export function forcePc(t: string, tools: string[] = []): boolean {
  if (CODE_RE.test(t)) return false;
  if (repoFileIntent(t)) return false;
  const messageTool = tools.some((n) => /^(mail|gmail|email|oauth_google|oauth_microsoft|whatsapp|sms|telegram|slackbot)\b/.test(n));
  if (messageTool && MAILY.test(t) && MAIL_ACT.test(t) && !FINDY.test(t)) return false;
  if (QUOTA.test(t) && VERB_RE.test(t)) return true;
  if (/\b(leads?|prospects?)\b/i.test(t) && VERB_RE.test(t) && !/^\s*(what|kya|how|why|explain)\b/i.test(t)) return true;
  if (/\b(scrape|scraping|crawl|crawler)\b/i.test(t)) return true;
  if (READ_REPO.test(t) && !/\b(fix|bug|change|edit|refactor)\b/i.test(t)) return true;
  return false;
}

// Used ONLY when the model call fails or answers nothing usable.
function heuristic(text: string, hasComputer: boolean): Understanding | null {
  const base = { task: text, reply: "", role: "", why: "keyword fallback (the model step failed)", facts: [] as string[], then: [] as Then[] };
  if (repoFileIntent(text)) return null; // plain chat with tools
  if (SET_ROLE.test(text) && !CODE_RE.test(text)) {
    const then: Then[] = [];
    if (READ_REPO.test(text) || forcePc(text)) then.push("pc");
    if (TEAM_ASSIGN.test(text)) then.push("assemble");
    return { ...base, intent: "set_role", role: text.slice(0, 300), then };
  }
  if (hasComputer && needsTeam(text)) return { ...base, intent: "team" };
  if (CODE_RE.test(text)) return { ...base, intent: "code" };
  if (forcePc(text)) return { ...base, intent: "pc" };
  return null;
}

export async function understand(
  llm: (system: string, prompt: string) => Promise<string>,
  a: { text: string; recent: Array<{ role: "user" | "assistant"; content: string }>; role: string; tools: string[]; hasComputer: boolean }
): Promise<Understanding> {
  const forced = forcePc(a.text, a.tools);
  const fallback: Understanding = heuristic(a.text, a.hasComputer) ?? { intent: "chat", task: "", reply: "", role: "", why: "fallback", facts: [], then: [] };
  try {
    const ctx = a.recent.slice(-6).map((m) => `${m.role === "user" ? "USER" : "YOU"}: ${m.content.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
    const raw = await llm(
      SYSTEM,
      `YOUR ROLE (set by the user): ${a.role || "(none yet)"}
CONNECTED TOOLS: ${a.tools.slice(0, 40).join(", ") || "(none)"}
COMPUTER AVAILABLE: ${a.hasComputer ? "yes" : "no"}

RECENT MESSAGES:
${ctx || "(none)"}

LATEST USER MESSAGE:
${a.text.slice(0, 1500)}`
    );
    const i = raw.indexOf("{"), j = raw.lastIndexOf("}");
    if (i < 0 || j <= i) return fallback;
    const p = JSON.parse(raw.slice(i, j + 1)) as Partial<Understanding> & { then?: unknown; facts?: unknown };
    let intent: Intent = INTENTS.includes(p.intent as Intent) ? (p.intent as Intent) : "chat";
    const u: Understanding = {
      intent, task: String(p.task ?? "").trim(), reply: String(p.reply ?? "").trim(), role: String(p.role ?? "").trim(), why: String(p.why ?? "").slice(0, 200),
      facts: (Array.isArray(p.facts) ? p.facts : []).map((x) => String(x).trim()).filter((x) => x.length >= 6 && x.length <= 300).slice(0, 3),
      then: (Array.isArray(p.then) ? p.then : []).map(String).filter((x): x is Then => ["pc", "assemble", "team", "code"].includes(x)).slice(0, 3),
    };

    // Several steps / several areas of work: the agent plans the steps and brings in the specialists by itself.
    if (a.hasComputer && ["chat", "pc", "code", "video"].includes(intent) && needsTeam(a.text, a.tools)) {
      u.intent = intent = "team";
      u.task = u.task || a.text;
      u.why = "multi-step task: split into steps, specialists join automatically, independent steps run in parallel";
    }

    // A work order must never be answered as plain chat (that is how fake "verified leads" appeared).
    if (forced && (intent === "chat" || intent === "clarify")) { u.intent = intent = "pc"; u.why = "work order: forced to the computer"; }
    // ...and a job a connected tool does in a call must never open the computer or Venus Code.
    if (!forced && repoFileIntent(a.text) && (intent === "pc" || intent === "code")) { u.intent = intent = "chat"; u.why = "repo file task: handled by chat tools"; }
    if (["pc", "code", "video", "team"].includes(intent) && !u.task) u.task = a.text;
    if (intent === "set_role" && !u.role) u.role = a.text.slice(0, 300);
    if (intent === "set_role" && !u.then.length) {
      if (READ_REPO.test(a.text) || forced) u.then.push("pc");
      if (TEAM_ASSIGN.test(a.text)) u.then.push("assemble");
    }
    return u;
  } catch {
    return fallback;
  }
}
