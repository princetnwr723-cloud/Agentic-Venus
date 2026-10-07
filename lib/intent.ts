export type Intent = "chat" | "set_role" | "assemble" | "pc" | "code" | "video" | "team" | "remember" | "forget" | "clarify";
export type Then = "pc" | "assemble" | "team" | "code";
export type Understanding = { intent: Intent; task: string; reply: string; role: string; why: string; facts: string[]; then: Then[] };

const INTENTS: Intent[] = ["chat", "set_role", "assemble", "pc", "code", "video", "team", "remember", "forget", "clarify"];

const SYSTEM = `You are the "understand first" brain of an AI agent. Read the user's latest message and decide what they REALLY want right now. Reply with ONE JSON object only (no prose, no fences):
{"intent":"...","task":"...","reply":"...","role":"...","facts":[],"then":[],"why":"..."}

HOW THE AGENT WORKS: ALL real work happens on a computer the user can watch (intent "pc"): research, collecting leads or any list, scraping, reading websites or a whole GitHub repository, forms, logins, downloads, files, terminal/system work, signing up for services, sending email through a website, audits, comparisons that need live data. The coding studio ("code") is ONLY for building or changing software. Chat is ONLY for conversation.

INTENTS
- set_role: the user tells you WHO you are or gives your job ("you are my CEO", "from now on you are the lead developer of this project", "tum meri company ke head ho"). Put the role in one sentence in "role". If the same message ALSO asks for work (read the repo, assign a team...), put those steps in "then" and the remaining work as ONE self-contained instruction in "task".
- assemble: the user asks you to hire / assemble / assign / set up a team. Nothing is started.
- chat: questions, discussion, advice, writing, brainstorming, opinions, simple status, and small lookups a connected tool answers in one call (weather, currency, one GitHub issue). NEVER for work that needs collecting, reading many pages or files, or checking live data. Leave "reply" empty.
- pc: any TASK that needs doing in the world (see HOW THE AGENT WORKS). If no single tool call can do it, it is pc.
- code: the user explicitly wants SOFTWARE built or changed in a project (website, app, script, bug fix). NEVER for research, leads, reading, writing, plans, company/role setup.
- video: a motion-graphics video or reel.
- team: ONE clear goal that needs 2+ different areas of work.
- remember / forget: the user states a lasting fact or preference / asks to forget something.
- clarify: the user wants work done but an essential detail is missing. "reply" = ONE short question.

FIELDS
- facts: durable facts or preferences the user stated about themselves, their business, their projects or how they want things done ([] if none). Max 3, each one short sentence. Never passwords, keys, tokens, card data.
- then: ONLY with set_role. Ordered steps from "pc", "assemble", "team", "code".

RULES
- Between chat and pc for a TASK (not a question) choose pc. Between code and pc: code ONLY if software must be written.
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

export function forcePc(t: string): boolean {
  if (CODE_RE.test(t)) return false;
  if (QUOTA.test(t) && VERB_RE.test(t)) return true;
  if (/\b(leads?|prospects?)\b/i.test(t) && VERB_RE.test(t) && !/^\s*(what|kya|how|why|explain)\b/i.test(t)) return true;
  if (/\b(scrape|scraping|crawl|crawler)\b/i.test(t)) return true;
  if (READ_REPO.test(t) && !/\b(fix|bug|change|edit|refactor)\b/i.test(t)) return true;
  return false;
}

// Used ONLY when the model call fails or answers nothing usable.
function heuristic(text: string): Understanding | null {
  const base = { task: text, reply: "", role: "", why: "keyword fallback (the model step failed)", facts: [] as string[], then: [] as Then[] };
  if (SET_ROLE.test(text) && !CODE_RE.test(text)) {
    const then: Then[] = [];
    if (READ_REPO.test(text) || forcePc(text)) then.push("pc");
    if (TEAM_ASSIGN.test(text)) then.push("assemble");
    return { ...base, intent: "set_role", role: text.slice(0, 300), then };
  }
  if (CODE_RE.test(text)) return { ...base, intent: "code" };
  if (forcePc(text)) return { ...base, intent: "pc" };
  return null;
}

export async function understand(
  llm: (system: string, prompt: string) => Promise<string>,
  a: { text: string; recent: Array<{ role: "user" | "assistant"; content: string }>; role: string; tools: string[]; hasComputer: boolean }
): Promise<Understanding> {
  const forced = forcePc(a.text);
  const fallback: Understanding = heuristic(a.text) ?? { intent: "chat", task: "", reply: "", role: "", why: "fallback", facts: [], then: [] };
  try {
    const ctx = a.recent.slice(-6).map((m) => `${m.role === "user" ? "USER" : "YOU"}: ${m.content.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
    const raw = await llm(
      SYSTEM,
      `YOUR ROLE (set by the user): ${a.role || "(none yet)"}
CONNECTED TOOLS: ${a.tools.slice(0, 30).join(", ") || "(none)"}
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
    // A work order must never be answered as plain chat (that is how fake "verified leads" appeared).
    if (forced && (intent === "chat" || intent === "clarify")) { u.intent = intent = "pc"; u.why = "work order: forced to the computer"; }
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