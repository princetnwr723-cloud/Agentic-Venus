// Proactive engine, server side: scans mail / calendar / GitHub / routines, saves proposals, tells the owner, and starts a mission
// when (and only when) the owner approves. The decisions live in watchers-core.ts (tested); this file only does the I/O.
import { getAdminDb } from "@/lib/firebase-admin";
import { loadAgent } from "@/lib/voice-calls";
import { callTool } from "@/lib/tools/registry";
import { makeCtx } from "@/lib/tools/connectors";
import { notifyOwner } from "@/lib/channels";
import { audit } from "@/lib/audit";
import {
  cleanSettings, DEFAULT_SETTINGS, parseCalendarEvents, parseGithubRows, parseGmailRows, proposalMessage, selectToSend, signalsToProposals,
  type Proposal, type Settings, type Signal,
} from "@/lib/watchers-core";

const db = () => getAdminDb();
const userDoc = (uid: string) => db().collection("users").doc(uid);
const settingsRef = (uid: string) => userDoc(uid).collection("watchers").doc("settings");
const proposals = (uid: string) => userDoc(uid).collection("proposals");
const index = () => db().collection("watcherUsers");
const MIN = 60_000, DAY = 24 * 3600_000;
const RUN_EVERY_MS = 20 * MIN;

const clean = <T extends object>(o: T): T => JSON.parse(JSON.stringify(o));

export async function getSettings(uid: string): Promise<Settings & { lastRunAt?: number }> {
  const d = (await settingsRef(uid).get()).data() as (Record<string, unknown> & { lastRunAt?: number }) | undefined;
  return { ...cleanSettings(d ?? DEFAULT_SETTINGS), ...(d?.lastRunAt ? { lastRunAt: d.lastRunAt } : {}) };
}
export async function saveSettings(uid: string, raw: unknown): Promise<Settings> {
  const s = cleanSettings({ ...(await getSettings(uid)), ...(raw && typeof raw === "object" ? raw : {}) });
  await settingsRef(uid).set(clean(s), { merge: true });
  await index().doc(uid).set({ enabled: s.enabled, updatedAt: Date.now() }, { merge: true });
  return s;
}

/** The owner's proposals, newest first. */
export async function listProposals(uid: string, limit = 30): Promise<Proposal[]> {
  const q = await proposals(uid).orderBy("createdAt", "desc").limit(Math.min(100, limit)).get();
  return q.docs.map((d) => d.data() as Proposal);
}

// ---------------------------------------------------------------- collecting signals (every source is optional and failure-tolerant)
type Agent = Awaited<ReturnType<typeof loadAgent>>;
export async function collectSignals(uid: string, s: Settings, now: number): Promise<{ signals: Signal[]; chatId: string | null }> {
  let agent: Agent;
  try { agent = await loadAgent(uid); } catch { return { signals: [], chatId: null }; }
  const ctx = makeCtx(uid, agent.chatId);
  const call = async (name: string, args: Record<string, unknown>) => {
    try { const r = await callTool(agent.connectors, name, args, false, { ctx }); return r.ok ? r.text : null; } catch { return null; }
  };
  const signals: Signal[] = [];
  const jobs: Array<Promise<void>> = [];

  if (s.sources.includes("gmail")) jobs.push((async () => {
    const t = await call("gmail.search", { q: "is:unread newer_than:3d -category:promotions -category:social", max: 15 });
    if (t) signals.push(...parseGmailRows(t));
  })());

  if (s.sources.includes("calendar")) jobs.push((async () => {
    const min = new Date(now).toISOString(), max = new Date(now + s.leadHours * 3600_000).toISOString();
    const t = await call("oauth_google.request", { method: "GET", path: `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=20&timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}` });
    const body = t ? t.slice(t.indexOf("{")) : "";
    try { if (body) signals.push(...parseCalendarEvents(JSON.parse(body))); } catch { /* truncated or not JSON: skip */ }
  })());

  if (s.sources.includes("github")) jobs.push((async () => {
    const a = await call("github.search_issues", { q: "is:open is:pr review-requested:@me" });
    if (a) signals.push(...parseGithubRows(a, "review requested"));
    const b = await call("github.search_issues", { q: "is:open assignee:@me" });
    if (b) signals.push(...parseGithubRows(b, "assigned to you"));
  })());

  if (s.sources.includes("routine")) jobs.push((async () => {
    const q = await userDoc(uid).collection("routines").where("enabled", "==", true).limit(40).get().catch(() => null);
    for (const d of q?.docs ?? []) {
      const r = d.data() as { name?: string; lastStatus?: string; lastRunAt?: number; lastResult?: string };
      if (/error|fail/i.test(r.lastStatus ?? "") && (r.lastRunAt ?? 0) > now - DAY) signals.push({ source: "routine", id: `${d.id}:${r.lastRunAt}`, title: r.name || d.id, text: r.lastResult ?? r.lastStatus ?? "" });
    }
  })());

  await Promise.all(jobs);
  return { signals, chatId: agent.chatId };
}

// ---------------------------------------------------------------- one user
export async function runWatchersForUser(uid: string, site: string, now = Date.now(), force = false): Promise<{ found: number; sent: number }> {
  const s = await getSettings(uid);
  if (!s.enabled && !force) return { found: 0, sent: 0 };
  if (!force && s.lastRunAt && now - s.lastRunAt < RUN_EVERY_MS) return { found: 0, sent: 0 };
  await settingsRef(uid).set({ lastRunAt: now }, { merge: true });

  const { signals, chatId } = await collectSignals(uid, s, now);
  if (!chatId) return { found: 0, sent: 0 };
  const found = signalsToProposals(signals, now, s);

  const old = await proposals(uid).orderBy("createdAt", "desc").limit(500).get();
  const existing = new Set(old.docs.map((d) => d.id));
  const startOfDay = now - (((now + s.tzOffsetMin * MIN) % DAY) + DAY) % DAY;
  const sentToday = old.docs.filter((d) => ((d.data() as Proposal).sentAt ?? 0) >= startOfDay).length;

  let sent = 0;
  for (const p of selectToSend(found, existing, sentToday, now, s)) {
    const doc: Proposal & { chatId: string } = { ...p, chatId, sentAt: now };
    await proposals(uid).doc(p.id).set(clean(doc));
    await notifyOwner(uid, chatId, proposalMessage(p, `${site}/dashboard`)).catch(() => {});
    sent++;
  }
  if (sent) await audit(uid, { kind: "watchers_proposed", chatId, text: `${sent} proposal(s)` }).catch(() => {});
  return { found: found.length, sent };
}

/** Called by the scheduler (agent/tick and /api/watchers/tick). */
export async function tickWatchers(site: string, now = Date.now(), maxUsers = 15): Promise<{ checked: number; sent: number }> {
  const q = await index().where("enabled", "==", true).limit(60).get().catch(() => null);
  let checked = 0, sent = 0;
  for (const d of q?.docs ?? []) {
    if (checked >= maxUsers) break;
    try { const r = await runWatchersForUser(d.id, site, now); if (r.found || r.sent) { sent += r.sent; } checked++; } catch { checked++; }
  }
  return { checked, sent };
}

// ---------------------------------------------------------------- the owner's answer
/** Approve starts a mission with the proposal's goal (drafts only: writes still need approval); dismiss is final. */
export async function decideProposal(uid: string, id: string, approve: boolean, by = "owner"): Promise<{ ok: boolean; message: string; missionId?: string }> {
  const ref = proposals(uid).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, message: "I could not find that proposal (it may be too old)." };
  const p = snap.data() as Proposal & { chatId: string };
  if (p.status !== "pending") return { ok: false, message: `That proposal is already ${p.status}.` };
  const now = Date.now();
  if (!approve) {
    await ref.set({ status: "dismissed", decidedAt: now, decidedBy: by }, { merge: true });
    return { ok: true, message: "Okay, skipped. I will not suggest this again." };
  }
  try {
    const { startMission } = await import("@/lib/mission");
    const m = await startMission(uid, { chatId: p.chatId, goal: p.goal, allowWrites: false, maxSteps: 40, maxCalls: 0 });
    await ref.set({ status: "approved", decidedAt: now, decidedBy: by, missionId: m.id }, { merge: true });
    await audit(uid, { kind: "watchers_approved", chatId: p.chatId, text: `${id} -> mission ${m.id} by ${by}` }).catch(() => {});
    return { ok: true, message: `Started. I am preparing it now (mission ${m.id}); the result comes to this chat.`, missionId: m.id };
  } catch (e) {
    await ref.set({ status: "failed", decidedAt: now, decidedBy: by }, { merge: true }).catch(() => {});
    return { ok: false, message: `Could not start it: ${e instanceof Error ? e.message.slice(0, 160) : "unknown error"}` };
  }
}

/** Used by other modules (meetings) to add a proposal without a scan. Same dedupe rule: an id that exists is never added again. */
export async function addProposal(uid: string, chatId: string, p: Proposal, site: string, notify = true): Promise<boolean> {
  const ref = proposals(uid).doc(p.id);
  if ((await ref.get()).exists) return false;
  await ref.set(clean({ ...p, chatId, sentAt: Date.now() }));
  if (notify) await notifyOwner(uid, chatId, proposalMessage(p, `${site}/dashboard`)).catch(() => {});
  return true;
}
