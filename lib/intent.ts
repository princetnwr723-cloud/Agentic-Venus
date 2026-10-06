export type Intent = "chat" | "set_role" | "assemble" | "pc" | "code" | "video" | "team" | "remember" | "forget" | "clarify";
export type Understanding = { intent: Intent; task: string; reply: string; role: string; why: string };

const INTENTS: Intent[] = ["chat", "set_role", "assemble", "pc", "code", "video", "team", "remember", "forget", "clarify"];

const SYSTEM = `You are the "understand first" brain of an AI agent. Read the user's latest message and decide what they REALLY want right now. Reply with ONE JSON object only (no prose, no fences):
{"intent":"...","task":"...","reply":"...","role":"...","why":"..."}

INTENTS
- set_role: the user tells you WHO you are or gives your job/company context ("you are my CEO", "tum meri AI agent company ke CEO ho", "you handle my sales"). Put the role in one sentence in "role". NEVER start work for this. "reply" = confirm the role in 1-2 lines and ask what the first task is.
- assemble: the user asks you to hire / assemble / set up a team. Nothing is started.
- chat: questions, discussion, planning, advice, writing, brainstorming, opinions, status — AND anything a connected tool can do (GitHub, Telegram, Notion, MCP, APIs, weather, currency, ...). Leave "reply" empty (the main answer is written separately).
- pc: needs a REAL computer the user can watch: browsing or scraping websites, collecting leads from the web, forms, logins, downloads, files, terminal/system work, signing up for services. Only if no connected tool can do it.
- code: the user explicitly wants SOFTWARE built or changed in a project (website, app, script, bug fix). NEVER for research, writing, plans, role/company setup, or anything that is not building software.
- video: the user wants a motion-graphics video or reel.
- team: ONE clear goal that needs 2+ different areas of work (for example site + leads + emails).
- remember / forget: the user states a lasting fact or preference / asks to forget something ("task" = the fact or keyword).
- clarify: the user wants work done but an essential detail is missing. "reply" = ONE short question.

RULES
- When unsure, choose chat or clarify. NEVER choose pc/code/video/team unless the user clearly asked for that work NOW.
- Introductions, role statements, plans and "what would you do" are never work orders.
- "task" must be self-contained (use the recent conversation to resolve "do it", "haan kar do").
- For pc/code/video/team/set_role/assemble/clarify: "reply" is short (max 2 lines), in the user's own language and style (Hinglish stays Hinglish). Never claim the work is done.`;

// Used ONLY when the model call fails or answers nothing usable. Conservative on purpose.
const SET_ROLE = /\b(you are|you're|tum|aap)\b[\s\S]{0,40}\b(my|meri|mere|hamari|hamare|our)\b[\s\S]{0,40}\b(ceo|cto|coo|cfo|manager|assistant|head|chief|lead|director|founder|agent|company)\b/i;
const BUILD = /\b(banao|bana do|bana de|build|create|make|develop|likho|write)\b/i;
const CODE_RE = /\b(build|create|make|develop|write|banao|bana do|bana de|bana|likho)\b[\s\S]{0,40}\b(website|web ?site|app|landing|page|script|api|bot|extension|game|dashboard|component)\b|\b(fix|debug)\b[\s\S]{0,25}\b(bug|error|code)\b/i;
const PC_RE = /\b(scrape|scraping|crawl|extract|download|sign ?up|log ?in|login|fill (the )?form|browse|screenshot|leads?|prospects?)\b|\b(website|site|page|link|url)\b[\s\S]{0,30}\b(khol|kholo|open|visit|check|dekh|dekho|se nikal|se data)\b|\b(computer|pc)\b[\s\S]{0,30}\b(pe|par|me|mein|on|use)\b/i;

function heuristic(text: string, hasComputer: boolean): Understanding | null {
  const base = { task: text, reply: "", role: "", why: "keyword fallback (the model step failed)" };
  if (SET_ROLE.test(text) && !BUILD.test(text)) return { ...base, intent: "set_role", role: text.slice(0, 300) };
  if (CODE_RE.test(text)) return { ...base, intent: "code" };
  if (hasComputer && PC_RE.test(text)) return { ...base, intent: "pc" };
  return null;
}

export async function understand(
  llm: (system: string, prompt: string) => Promise<string>,
  a: { text: string; recent: Array<{ role: "user" | "assistant"; content: string }>; role: string; tools: string[]; hasComputer: boolean }
): Promise<Understanding> {
  const fallback: Understanding = heuristic(a.text, a.hasComputer) ?? { intent: "chat", task: "", reply: "", role: "", why: "fallback" };
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
    const p = JSON.parse(raw.slice(i, j + 1)) as Partial<Understanding>;
    const intent = INTENTS.includes(p.intent as Intent) ? (p.intent as Intent) : "chat";
    const u: Understanding = { intent, task: String(p.task ?? "").trim(), reply: String(p.reply ?? "").trim(), role: String(p.role ?? "").trim(), why: String(p.why ?? "").slice(0, 200) };
    if (["pc", "code", "video", "team"].includes(intent) && !u.task) u.task = a.text;
    if (intent === "set_role" && !u.role) u.role = a.text.slice(0, 300);
    return u;
  } catch {
    return fallback;
  }
}