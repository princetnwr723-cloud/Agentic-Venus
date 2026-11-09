// Server-only. The numbers behind the per-chat Agent Dashboard. Everything is read live from what the agent really did:
// finished tasks (episodes), missions, phone calls, Venus Code projects, emails and calendar actions it was allowed to run,
// decks, videos and the bookings the agent logged. Nothing here is invented: a number is 0 until the work exists.
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";

export type DashRange = "week" | "month" | "all";
export type DashEventKind = "task" | "call" | "code" | "booking" | "mail" | "deck" | "video" | "mission" | "note";
export type DashEvent = { at: number; kind: DashEventKind; text: string };
export type DashKpi = { value: number; delta: number | null; chip?: string; sub: string };
export type DashSlice = { key: string; label: string; count: number; pct: number };
export type DashStats = {
  enabled: boolean;
  generatedAt: number;
  createdAt?: number;
  agent?: { name: string; model: string; provider: string; since: number; activeDays: number; messages: number; successPct: number | null };
  kpis?: { tasks: DashKpi; calls: DashKpi; code: DashKpi; bookings: DashKpi };
  extra?: { callMinutes: number; answeredCalls: number; emails: number; decks: number; videos: number; missions: number; files: number; commands: number; linesRemoved: number; projects: number };
  series?: { labels: string[]; tasks: number[]; calls: number[]; bookings: number[] };
  breakdown?: Record<DashRange, { total: number; slices: DashSlice[] }>;
  recent?: DashEvent[];
  bookingsList?: Array<{ at: number; who: string; source: string }>;
};

const db = () => getAdminDb();
const userRef = (uid: string) => db().collection("users").doc(uid);
const chatRef = (uid: string, chatId: string) => userRef(uid).collection("chats").doc(chatId);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch { return fallback; } };
const rows = async (q: FirebaseFirestore.Query): Promise<Array<Record<string, unknown>>> => {
  const snap = await safe<FirebaseFirestore.QuerySnapshot | null>(q.get(), null);
  return snap ? snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) : [];
};

export async function isDashboardOn(uid: string, chatId: string): Promise<{ exists: boolean; on: boolean; createdAt?: number }> {
  const s = await chatRef(uid, chatId).get();
  if (!s.exists) return { exists: false, on: false };
  const d = (s.data() as { dashboard?: { enabled?: boolean; createdAt?: number } }).dashboard;
  return { exists: true, on: d?.enabled === true, createdAt: d?.createdAt };
}

/** One dashboard per chat. Returns created:false when it already existed. */
export async function enableDashboard(uid: string, chatId: string): Promise<{ created: boolean; createdAt: number }> {
  const st = await isDashboardOn(uid, chatId);
  if (!st.exists) throw new Error("Chat not found.");
  if (st.on) return { created: false, createdAt: st.createdAt ?? Date.now() };
  const createdAt = Date.now();
  await chatRef(uid, chatId).update({ dashboard: { enabled: true, createdAt } });
  return { created: true, createdAt };
}

/** Puts messages into the chat from the server (shown live in the open chat). */
export async function postToChat(uid: string, chatId: string, msgs: Array<{ role: "user" | "assistant"; content: string }>) {
  const base = Date.now();
  await chatRef(uid, chatId).update({ messages: FieldValue.arrayUnion(...msgs.map((m, i) => ({ role: m.role, content: m.content, at: base + i }))) });
}

/** The agent writes down a client win. Shown as "Clients booked" and in the recent activity. */
export async function logDashboard(uid: string, chatId: string, e: { kind: "booking" | "client" | "note"; who?: string; note?: string }) {
  const at = Date.now();
  await chatRef(uid, chatId).collection("dashLog").add({ kind: e.kind, who: clip(e.who, 120), note: clip(e.note, 300), at });
  return at;
}

// ---------------- detection helpers ----------------
const BOOKED = /\b(booked|appointment\s+(?:is\s+)?(?:set|fixed|confirmed|booked|scheduled)|meeting\s+(?:is\s+)?(?:set|fixed|confirmed|booked|scheduled)|scheduled\s+(?:a|the|an)\s+(?:meeting|call|demo|visit|appointment)|confirmed\s+(?:the\s+)?(?:slot|booking|appointment|meeting)|slot\s+(?:is\s+)?(?:booked|confirmed)|book\s+ho\s+gaya|fix\s+ho\s+gaya|appointment\s+fix)\b/i;
const NOT_BOOKED = /\b(no\s+answer|voicemail|not\s+interested|declined|couldn'?t|could\s+not|unable|failed|cancel(?:l)?ed|no\s+conversation|nahi\s+(?:hua|mila))\b/i;
const MAIL_TOOL = /^(?:mail\.send|gmail\.(?:send|draft_send)|[a-z0-9_]+\.(?:send_email|send_mail|send_message))\b/i;
const CAL_TOOL = /(?:^|[._])(?:create|insert|add|schedule|book)[_-]?(?:calendar[_-]?)?(?:event|meeting|appointment|booking|reservation|slot)\b/i;

type Counted = { at: number; text: string };
const inRange = (at: number, from: number) => at >= from;

export async function collectStats(uid: string, chatId: string, tzOffsetMin = 0): Promise<DashStats> {
  const now = Date.now();
  const st = await isDashboardOn(uid, chatId);
  if (!st.exists || !st.on) return { enabled: false, generatedAt: now };

  const chat = chatRef(uid, chatId);
  const [chatSnap, eps, missions, calls, codeA, codeB, videos, decks, audit, dlog] = await Promise.all([
    chat.get(),
    rows(chat.collection("episodes").orderBy("at", "desc").limit(600)),
    rows(userRef(uid).collection("missions").where("chatId", "==", chatId).limit(300)),
    rows(userRef(uid).collection("voiceCalls").where("chatId", "==", chatId).limit(500)),
    rows(userRef(uid).collection("codeProjects").where("chatId", "==", chatId).limit(100)),
    safe(userRef(uid).collection("codeProjects").doc(chatId).get(), null),
    rows(userRef(uid).collection("venusProjects").where("chatId", "==", chatId).limit(200)),
    rows(userRef(uid).collection("decks").where("chatId", "==", chatId).limit(300)),
    rows(userRef(uid).collection("audit").where("chatId", "==", chatId).limit(600)),
    rows(chat.collection("dashLog").orderBy("at", "desc").limit(400)),
  ]);

  const c = (chatSnap.data() ?? {}) as { agentName?: string; model?: string; provider?: string; createdAt?: { toMillis?: () => number }; messages?: Array<{ role?: string; at?: number }> };
  const msgs = Array.isArray(c.messages) ? c.messages : [];

  // ---- the code of this chat: every project (the first one uses the chat id itself)
  const projects = [...codeA];
  if (codeB && codeB.exists && !projects.some((p) => p.id === chatId)) projects.push({ id: chatId, ...(codeB.data() as Record<string, unknown>) });
  const files = new Set<string>();
  let added = 0, removed = 0, commands = 0;
  const codeInRange: Record<DashRange, number> = { week: 0, month: 0, all: 0 };
  const w7 = now - 7 * 86_400_000, d30 = now - 30 * 86_400_000;
  for (const p of projects) {
    const log = Array.isArray(p.log) ? (p.log as Array<{ kind?: string; text?: string; path?: string; lines?: Array<{ t?: string }> }>) : [];
    const pf = new Set<string>();
    for (const e of log) {
      if (e?.kind === "diff" && e.path) {
        pf.add(String(e.path)); files.add(`${p.id}:${e.path}`);
        for (const l of e.lines ?? []) { if (l?.t === "+") added++; else if (l?.t === "-") removed++; }
      } else if (e?.kind === "tool" && typeof e.text === "string" && e.text.startsWith("$ ")) commands++;
    }
    const at = num(p.updatedAt) || num(p.createdAt);
    codeInRange.all += pf.size;
    if (inRange(at, d30)) codeInRange.month += pf.size;
    if (inRange(at, w7)) codeInRange.week += pf.size;
  }

  // ---- phone calls
  const callList: Counted[] = [];
  let callSeconds = 0, answered = 0;
  const bookedCalls: Array<{ at: number; who: string; source: string }> = [];
  for (const k of calls) {
    const at = num(k.createdAt) || num(k.updatedAt);
    const dur = num(k.durationSeconds);
    const talked = (k.status === "completed" && dur > 0) || (Array.isArray(k.transcript) && k.transcript.length > 1);
    if (talked) answered++;
    callSeconds += dur;
    const who = clip(k.direction === "inbound" ? k.from : k.to, 40) || "unknown";
    callList.push({ at, text: `${k.direction === "inbound" ? "Call from" : "Called"} ${who}${dur ? ` · ${Math.floor(dur / 60)}m ${Math.round(dur % 60)}s` : ""}${k.status ? ` · ${clip(k.status, 20)}` : ""}` });
    const sum = clip(k.summary, 1200);
    if (talked && sum && BOOKED.test(sum) && !NOT_BOOKED.test(sum)) bookedCalls.push({ at, who, source: "phone call" });
  }

  // ---- emails and calendar actions the agent was allowed to run
  const mails: Counted[] = [];
  const cal: Array<{ at: number; who: string; source: string }> = [];
  for (const a of audit) {
    if (a.kind !== "tool_write") continue;
    const text = String(a.text ?? "");
    if (!/approved=true/.test(text)) continue;
    const name = text.split(/\s+/)[0] ?? "";
    const at = num(a.at);
    if (MAIL_TOOL.test(name)) mails.push({ at, text: `Sent an email (${name})` });
    else if (CAL_TOOL.test(name)) cal.push({ at, who: clip(text.slice(name.length), 70) || "calendar event", source: "calendar" });
  }

  // ---- bookings the agent wrote down
  const logged = dlog.filter((d) => d.kind === "booking" || d.kind === "client").map((d) => ({ at: num(d.at), who: clip(d.who, 70) || clip(d.note, 70) || "client", source: "logged by the agent" }));
  const bookings = [...logged, ...cal, ...bookedCalls].sort((a, b) => b.at - a.at);

  // ---- tasks (what the agent finished) = chat tasks + finished missions
  const tasks: Counted[] = [];
  let pass = 0, judged = 0;
  for (const e of eps) {
    tasks.push({ at: num(e.at), text: clip(e.task, 110) });
    if (e.verdict === "pass" || e.verdict === "partial" || e.verdict === "fail") { judged++; if (e.verdict === "pass") pass++; else if (e.verdict === "partial") pass += 0.5; }
  }
  const doneMissions = missions.filter((m) => m.status === "done");
  for (const m of doneMissions) tasks.push({ at: num(m.updatedAt) || num(m.createdAt), text: "Mission: " + clip(m.goal, 100) });

  // ---- time buckets in the owner's time zone
  const shift = -tzOffsetMin * 60_000;
  const local = (t: number) => new Date(t + shift);
  const nowL = local(now);
  const monthIdx = (t: number) => { const d = local(t); return (nowL.getUTCFullYear() - d.getUTCFullYear()) * 12 + (nowL.getUTCMonth() - d.getUTCMonth()); };
  const perMonth = (list: Array<{ at: number }>) => { const out = new Array(10).fill(0); for (const x of list) { const i = monthIdx(x.at); if (x.at > 0 && i >= 0 && i < 10) out[9 - i]++; } return out; };
  const labels = Array.from({ length: 10 }, (_, i) => new Date(Date.UTC(nowL.getUTCFullYear(), nowL.getUTCMonth() - (9 - i), 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" }));
  const series = { labels, tasks: perMonth(tasks), calls: perMonth(callList), bookings: perMonth(bookings) };
  const delta = (arr: number[]): number | null => { const cur = arr[9], prev = arr[8]; if (!prev) return cur ? 100 : 0; return Math.round(((cur - prev) / prev) * 100); };

  // ---- decks / videos / missions
  const deckList = decks.map((d) => ({ at: num(d.createdAt), text: `Made the deck “${clip(d.title, 60)}” (${Array.isArray(d.slides) ? d.slides.length : num(d.slideCount)} slides)` }));
  const videoList = videos.map((v) => ({ at: num(v.createdAt), text: `Made the video “${clip(v.title ?? v.name ?? "Venus Pro video", 60)}”` }));

  // ---- donut: what the agent spent its work on
  const slice = (from: number, scope: DashRange): DashSlice[] => {
    const inR = (l: Array<{ at: number }>) => l.filter((x) => inRange(x.at, from)).length;
    const raw: Array<[string, string, number]> = [
      ["tasks", "Tasks done", inR(tasks)], ["calls", "Calls made", inR(callList)], ["code", "Code files", codeInRange[scope]],
      ["mail", "Emails sent", inR(mails)], ["bookings", "Clients booked", inR(bookings)], ["decks", "Decks made", inR(deckList)], ["videos", "Videos made", inR(videoList)],
    ];
    const total = raw.reduce((s, r) => s + r[2], 0);
    return raw.filter((r) => r[2] > 0).sort((a, b) => b[2] - a[2]).map(([key, label, count]) => ({ key, label, count, pct: total ? Math.round((count / total) * 100) : 0 }));
  };
  const breakdown = {} as NonNullable<DashStats["breakdown"]>;
  (["week", "month", "all"] as DashRange[]).forEach((r) => {
    const sl = slice(r === "week" ? w7 : r === "month" ? d30 : 0, r);
    breakdown[r] = { total: sl.reduce((s, x) => s + x.count, 0), slices: sl };
  });

  // ---- recent activity
  const recent: DashEvent[] = [
    ...tasks.map((x) => ({ at: x.at, kind: "task" as const, text: x.text })),
    ...callList.map((x) => ({ at: x.at, kind: "call" as const, text: x.text })),
    ...mails.map((x) => ({ at: x.at, kind: "mail" as const, text: x.text })),
    ...bookings.map((x) => ({ at: x.at, kind: "booking" as const, text: `Booked: ${x.who} (${x.source})` })),
    ...deckList.map((x) => ({ at: x.at, kind: "deck" as const, text: x.text })),
    ...videoList.map((x) => ({ at: x.at, kind: "video" as const, text: x.text })),
    ...projects.map((p) => ({ at: num(p.updatedAt) || num(p.createdAt), kind: "code" as const, text: `Worked on the project “${clip(p.name, 50)}”` })),
    ...dlog.filter((d) => d.kind === "note").map((d) => ({ at: num(d.at), kind: "note" as const, text: clip(d.note, 140) })),
  ].filter((e) => e.at > 0).sort((a, b) => b.at - a.at).slice(0, 14);

  const days = new Set<string>();
  for (const m of msgs) if (num(m?.at)) days.add(local(num(m.at)).toISOString().slice(0, 10));
  for (const t of tasks) if (t.at) days.add(local(t.at).toISOString().slice(0, 10));
  const since = num(c.createdAt?.toMillis?.()) || Math.min(...[now, ...msgs.map((m) => num(m?.at)).filter(Boolean)]);

  const codeDelta = (() => { const mk = (a: number, b: number) => projects.filter((p) => { const t = num(p.createdAt); return t >= a && t < b; }).length; const cur = mk(now - 30 * 86_400_000, now + 1), prev = mk(now - 60 * 86_400_000, now - 30 * 86_400_000); return !prev ? (cur ? 100 : 0) : Math.round(((cur - prev) / prev) * 100); })();

  return {
    enabled: true, generatedAt: now, createdAt: st.createdAt,
    agent: { name: c.agentName ?? "Agent", model: c.model ?? "", provider: c.provider ?? "", since, activeDays: days.size, messages: msgs.length, successPct: judged ? Math.round((pass / judged) * 100) : null },
    kpis: {
      tasks: { value: tasks.length, delta: delta(series.tasks), sub: "From last month" },
      calls: { value: callList.length, delta: delta(series.calls), sub: "From last month" },
      code: { value: added, delta: codeDelta, chip: `${files.size} files`, sub: "Lines written" },
      bookings: { value: bookings.length, delta: delta(series.bookings), sub: "From last month" },
    },
    extra: { callMinutes: Math.round(callSeconds / 60), answeredCalls: answered, emails: mails.length, decks: deckList.length, videos: videoList.length, missions: missions.length, files: files.size, commands, linesRemoved: removed, projects: projects.length },
    series, breakdown, recent,
    bookingsList: bookings.slice(0, 20),
  };
}