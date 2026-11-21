// Group chat: the pure rules. No imports on purpose: it runs on the server, in the browser and inside the tests.
// Who speaks (mentions, router answer), what a member may do in one reply (hand off, remember, pin), and the limits that stop loops.

export type GMember = { id: string; name: string; title?: string; tool?: string };
export type GKind = "say" | "result" | "note" | "ask" | "handoff";
export type GMsg = { id: string; at: number; from: string; text: string; kind: GKind; to?: string[]; turn?: string };
export type ItemKind = "chat" | "work";
export type ItemStatus = "queued" | "running" | "done" | "failed" | "skipped";
export type GItem = { n: number; member: string; kind: ItemKind; task: string; depth: number; by: string; status: ItemStatus; runId?: string; startedAt?: number; endedAt?: number; note?: string; result?: string; pendingNoted?: boolean };

export const MAX_ITEMS = 8;          // speakers (chat replies + work runs) in one turn
export const MAX_DEPTH = 3;          // owner -> A -> B -> C, never deeper
export const MAX_PER_MEMBER = 2;     // one member speaks at most twice in a turn
export const MAX_EVERYONE = 6;       // @everyone asks at most 6 members
export const MAX_NOTES = 12;         // lasting notes per member
export const MAX_PINS = 8;           // pinned facts for the whole group
export const NOTE_CHARS = 200;

export const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + "…" : s);
export const oneLine = (s: string, n: number): string => clip(String(s ?? "").replace(/\s+/g, " ").trim(), n);
const norm = (s: string): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Only members that can really use a computer, code, video or the web may get a work run; writers and analysts answer in the chat. */
export const canWork = (tool?: string): boolean => tool === "pc" || tool === "code" || tool === "video" || tool === "research";

/** Messages that ask for real work (not just an opinion). Used when nobody asked the router. */
const WORK = /\b(build|make|create|code|deploy|scrape|crawl|download|upload|find (?:me )?(?:\d+ )?(?:leads?|companies|contacts|clinics|businesses)|research|compare|look ?up|search|login|log in|fill|book|video|reel|website|landing page|dashboard|script|bug|fix|run|install|spreadsheet|csv|dhund\w*|bana\w*|nikal\w*)\b/i;
export const looksLikeWork = (text: string): boolean => WORK.test(String(text ?? ""));

export function findMember(name: string, members: GMember[]): GMember | undefined {
  const k = norm(name);
  if (!k) return undefined;
  return members.find((m) => norm(m.id) === k || norm(m.name) === k);
}

/** "@hunter find leads @everyone" -> who was addressed. Only @names of real members count; an email address is not a mention. */
export function parseMentions(text: string, members: GMember[]): { ids: string[]; everyone: boolean } {
  const ids: string[] = [];
  let everyone = false;
  for (const m of String(text ?? "").matchAll(/(?:^|[\s(,])@([A-Za-z0-9_]{2,24})/g)) {
    const w = m[1].toLowerCase();
    if (w === "everyone" || w === "all" || w === "team") { everyone = true; continue; }
    const hit = findMember(w, members);
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
  }
  return { ids, everyone };
}

// ---------------------------------------------------------------- what a member may add at the end of a reply
// HANDOFF: Hunter | find 20 dentists in Pune      NOTE: owner prefers short replies      PIN: launch date is 5 Dec
// Capital letters only, so an ordinary sentence that starts with "Note:" is never mistaken for a control line.
export type Parsed = { text: string; handoffs: Array<{ to: string; task: string }>; notes: string[]; pins: string[] };

// Anything that looks like a key, token or password never goes into memory.
const SECRET = /(sk-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{20,}\.|\b[A-Fa-f0-9]{32,}\b|(?:password|passwd|pwd|secret|token|api[_ -]?key|otp|cvv)\s*(?:is|=|:)\s*\S+|\b\d{13,19}\b)/i;
export const looksSecret = (s: string): boolean => SECRET.test(String(s ?? ""));

export function parseReply(raw: string, members: GMember[], selfId: string): Parsed {
  const keep: string[] = [];
  const handoffs: Parsed["handoffs"] = [];
  const notes: string[] = [];
  const pins: string[] = [];
  for (const line of String(raw ?? "").split("\n")) {
    const t = line.trim().replace(/^[-*>•\s]+/, "").replace(/^\*\*(HANDOFF|NOTE|PIN)\*\*/, "$1");
    const h = /^HANDOFF\s*:\s*@?([A-Za-z0-9_]{2,24})\s*[|:—-]\s*(.{4,})$/.exec(t);
    if (h) {
      const to = findMember(h[1], members);
      if (to && to.id !== selfId && handoffs.length < 2 && !handoffs.some((x) => x.to === to.id)) handoffs.push({ to: to.id, task: clip(h[2].trim(), 1200) });
      continue;
    }
    const n = /^NOTE\s*:\s*(.{4,})$/.exec(t);
    if (n) { if (!looksSecret(n[1]) && notes.length < 3) notes.push(oneLine(n[1], NOTE_CHARS)); continue; }
    const p = /^PIN\s*:\s*(.{4,})$/.exec(t);
    if (p) { if (!looksSecret(p[1]) && pins.length < 2) pins.push(oneLine(p[1], NOTE_CHARS)); continue; }
    keep.push(line);
  }
  return { text: keep.join("\n").replace(/\n{3,}/g, "\n\n").trim(), handoffs, notes, pins };
}

/** New notes go to the end; duplicates (ignoring case and punctuation) are dropped; the oldest fall out at the cap. */
export function mergeLines(old: string[], incoming: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of [...old, ...incoming]) {
    const line = oneLine(s, NOTE_CHARS);
    const k = norm(line);
    if (!k || seen.has(k) || looksSecret(line)) continue;
    seen.add(k);
    out.push(line);
  }
  return out.slice(-cap);
}

// ---------------------------------------------------------------- who speaks
export type Route = Array<{ member: string; work: boolean; task: string }>;

/** The router's JSON answer, made safe: only real members, at most 3, work only for members that can work. */
export function parseRoute(raw: unknown, members: GMember[], text: string): Route {
  const list = (raw as { speakers?: unknown } | null)?.speakers;
  const out: Route = [];
  for (const s of Array.isArray(list) ? list : []) {
    const m = findMember(String((s as { member?: unknown })?.member ?? ""), members);
    if (!m || out.some((x) => x.member === m.id)) continue;
    const work = Boolean((s as { work?: unknown })?.work) && canWork(m.tool);
    out.push({ member: m.id, work, task: clip(String((s as { task?: unknown })?.task ?? "").trim() || text, 1500) });
    if (out.length >= 3) break;
  }
  return out.length ? out : fallbackRoute(text, members);
}

/** No router answer: the lead (or the first member) takes it; a work-looking message goes to the best computer member if there is one. */
export function fallbackRoute(text: string, members: GMember[]): Route {
  const lead = members.find((m) => m.id === "chief") ?? members[0];
  if (!lead) return [];
  if (looksLikeWork(text)) {
    const w = members.find((m) => canWork(m.tool));
    if (w) return [{ member: w.id, work: true, task: clip(text, 1500) }];
  }
  return [{ member: lead.id, work: false, task: clip(text, 1500) }];
}

/** Items for a message: @mentions win, @everyone is a round table, otherwise the router decides. */
export function itemsFromMentions(text: string, members: GMember[], by = "you"): GItem[] {
  const { ids, everyone } = parseMentions(text, members);
  const who = everyone ? members.slice(0, MAX_EVERYONE).map((m) => m.id) : ids.slice(0, MAX_ITEMS);
  const work = looksLikeWork(text);
  return who.map((id, n) => {
    const m = members.find((x) => x.id === id)!;
    return { n, member: id, kind: (canWork(m.tool) && work && !everyone ? "work" : "chat") as ItemKind, task: clip(text, 1500), depth: 0, by, status: "queued" as ItemStatus };
  });
}

/** Can this member be added to the running turn? Stops endless hand-off loops and floods. */
export function canQueue(items: GItem[], member: string, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  if (items.length >= MAX_ITEMS) return false;
  if (items.filter((i) => i.member === member).length >= MAX_PER_MEMBER) return false;
  return true;
}

export function addItems(items: GItem[], add: Array<{ member: string; kind: ItemKind; task: string; depth: number; by: string }>): { items: GItem[]; added: number } {
  const next = items.slice();
  let added = 0;
  for (const a of add) {
    if (!canQueue(next, a.member, a.depth)) continue;
    next.push({ n: next.length, member: a.member, kind: a.kind, task: clip(a.task, 1500), depth: a.depth, by: a.by, status: "queued" });
    added++;
  }
  return { items: next, added };
}

/** Chat items speak in order (each sees what came before); work items run in the background. A queued item may start when every earlier chat item is over. */
export function nextRunnable(items: GItem[]): GItem | null {
  for (const it of items) {
    if (it.status !== "queued") { if (it.kind === "chat" && it.status === "running") return null; continue; }
    return it;
  }
  return null;
}

export const turnOver = (items: GItem[]): boolean => items.every((i) => i.status === "done" || i.status === "failed" || i.status === "skipped");

/** A wrap-up is worth a call only when several members spoke or real work ran. */
export function needsWrap(items: GItem[]): boolean {
  const spoke = items.filter((i) => i.status === "done");
  return spoke.some((i) => i.kind === "work") || new Set(spoke.map((i) => i.member)).size >= 2;
}

// ---------------------------------------------------------------- what the model sees
export function transcript(msgs: GMsg[], members: GMember[], n = 18, each = 700): string {
  const name = (id: string) => (id === "you" ? "Owner" : members.find((m) => m.id === id)?.name ?? (id === "system" ? "System" : id));
  return msgs.filter((m) => m.kind !== "note").slice(-n).map((m) => `${name(m.from)}: ${clip(m.text.replace(/\s+\n/g, "\n"), each)}`).join("\n");
}

export function memoryBlock(notes: string[], pins: string[]): string {
  const a = pins.length ? `PINNED FOR THE WHOLE GROUP\n${pins.map((p) => `- ${p}`).join("\n")}` : "";
  const b = notes.length ? `YOUR LASTING NOTES (things you learned earlier)\n${notes.map((p) => `- ${p}`).join("\n")}` : "";
  return [a, b].filter(Boolean).join("\n\n");
}

export function rosterLine(members: GMember[]): string {
  return members.map((m) => `${m.name} (${m.title ?? "teammate"})`).join(", ");
}

/** Strips control lines for display (Telegram, notifications). */
export const plain = (s: string): string => parseReply(s, [], "").text;