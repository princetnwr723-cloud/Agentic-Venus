// What the owner is allowed to see. The raw event stream (tool names, tool output, provider errors, request ids) stays
// in the database for debugging; the screen shows short human sentences. Pure, no imports: used in the browser and in tests.

export type RawEvent = { id?: string; t?: number; kind: string; text: string };
export type Line = { id: string; t: number; text: string };

/** "web.search" -> "Searching the web". Unknown tools get a readable name, never the raw id. */
const LABELS: Array<[RegExp, string]> = [
  [/^tools[._]/i, "Finding the right tool"],
  [/^leads[._]/i, "Working on leads"],
  [/^(validate|encode|color|dev)[._]/i, "Checking the details"],
  [/^(data|json|xml)[._]/i, "Working on the data"],
  [/^(finance)[._]/i, "Doing the money maths"],
  [/^(math|stats|geo)[._]/i, "Calculating"],
  [/^(date)[._]/i, "Working out the dates"],
  [/^convert[._]/i, "Converting units"],
  [/^text[._]/i, "Working on the text"],
  [/^(field)[._]|^pc[._]recipe/i, "Looking up the best way"],
  [/^(dns|domain)[._]|^email[._]domain|^web[._](extract|find|page|tech|links|social|headers|status|robots|sitemap|ssl|text|fetch_json)/i, "Checking the website"],
  [/^file[._](docx|xlsx|pptx|csv|pdf|zip|create)/i, "Making your file"],
  [/^web[._]?search|search/i, "Searching the web"],
  [/^web[._]?(fetch|read|open)|fetch|browse|browser/i, "Reading a web page"],
  [/mail|gmail|email|inbox/i, "Working with email"],
  [/calendar|event/i, "Checking the calendar"],
  [/github|git\b|repo|commit|push/i, "Working with GitHub"],
  [/drive|docs?|sheet|slide|notion/i, "Working with your documents"],
  [/slack|discord|telegram|whatsapp/i, "Working with messages"],
  [/youtube|video/i, "Working with video"],
  [/post|tweet|reddit|linkedin|instagram|social/i, "Preparing a post"],
  [/pc[._]|desktop|screen|click|type/i, "Using the cloud PC"],
  [/memory|remember/i, "Checking memory"],
  [/plan[._]/i, "Planning the steps"],
  [/file|read|write/i, "Working with files"],
];
export function toolLabel(name: string): string {
  const n = String(name || "").trim();
  const hit = LABELS.find(([re]) => re.test(n));
  if (hit) return hit[1];
  const pretty = n.split(/[.:/]/).filter(Boolean).slice(-1)[0]?.replace(/[-_]+/g, " ").trim();
  return pretty ? `Working: ${pretty}` : "Working";
}

const TECHNICAL = /request_id|<\/?[a-z][^>]*>|\{.*\}|https?:\/\/|\bat\s+\S+\.(ts|js):\d+|\b[45]\d\d\b\s*[:(]|stack|undefined|\[object|NaN/i;

/** A provider / server message the owner can read. Known codes map to a plain sentence, anything technical is replaced. */
export function friendlyError(code: string | undefined, message: string | undefined): string {
  const m = String(message ?? "").trim();
  switch (code) {
    case "no_credit": return "Your AI provider account has no credit left. Add credit at the provider (or pick another provider in Settings), then send the task again.";
    case "unauthorized": return "The AI provider rejected the API key. Open Settings and save a valid key.";
    case "model_not_found": return "This model is not available on your account. Pick another model for this chat.";
    case "context_exceeded": return "The conversation is too long for this model. Start a new chat or use a model with a bigger context.";
    case "refused": return "The AI provider refused this request. Rephrase the task.";
    case "too_long": return "This task ran for too long and was stopped. Split it into smaller tasks.";
    case "cost": return "This task has used its spending limit.";
    case "latch": case "provider": case "plan": return m && !TECHNICAL.test(m) ? m : "The AI provider is limiting requests right now. This task continues by itself.";
    case "usage_limit": case "rate_limited": case "overloaded": case "timeout": case "network": return m && !TECHNICAL.test(m) ? m : "The AI provider is busy right now. This task continues by itself.";
  }
  if (!m) return "Something went wrong. Please try again.";
  if (TECHNICAL.test(m)) return "Something went wrong while working on this. Please try again, or pick another model.";
  return m.slice(0, 240);
}

/** One raw event -> one short line, or null when the owner does not need to see it. */
export function friendlyEvent(e: RawEvent): string | null {
  switch (e.kind) {
    case "tool": return toolLabel(e.text);
    case "pause": return "Waiting for your answer";
    case "retry": return "Trying again…";
    case "compact": return "Tidying up what it has learned so far";
    case "error": case "latch": return friendlyError(undefined, e.text);
    case "info": return /try to give orders|untrusted/i.test(e.text) ? "Careful: a page tried to give orders. Sensitive actions need your OK." : /switching to/i.test(e.text) ? "Switching to your backup AI provider" : null;
    default: return null; // start, text, result, resume, done: the answer and the cards say it better
  }
}

/** The lines for the screen: friendly, no repeats in a row, newest last. */
export function visibleEvents(events: RawEvent[], max = 6): Line[] {
  const out: Line[] = [];
  for (const e of events) {
    const text = friendlyEvent(e);
    if (!text || out[out.length - 1]?.text === text) continue;
    out.push({ id: e.id ?? String(out.length), t: e.t ?? 0, text });
  }
  return out.slice(-max);
}

/** The status line under the task title: no tokens, no NaN, no model ids. */
export function statusText(status: string, round: number, error?: { code?: string } | null, resumeAt?: number | null, now = Date.now()): string {
  switch (status) {
    case "queued": return round ? "Getting back to work…" : "Starting…";
    case "running": return round > 1 ? `Working · step ${round}` : "Working…";
    case "paused": return "Waiting for you";
    case "done": return "Done";
    case "stopped": return "Stopped";
    case "error": return "Could not finish";
    case "budget": {
      if (error?.code === "cost") return "Stopped at the spending limit";
      if (resumeAt && resumeAt > now) { const mins = Math.max(1, Math.ceil((resumeAt - now) / 60_000)); return `Paused · continues by itself in ~${mins >= 90 ? `${Math.round(mins / 60)} h` : `${mins} min`}`; }
      return "Paused · continues by itself";
    }
    default: return status;
  }
}
