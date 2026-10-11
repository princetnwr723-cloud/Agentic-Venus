import { waitUntil } from "@vercel/functions";
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider, type ChatMsg } from "@/lib/ai-providers-server";
import { loadAgent, placeOutboundCall, type Agent } from "@/lib/voice-calls";
import { appBaseUrl } from "@/lib/voice-server";
import { buildCatalog, callTool } from "@/lib/tools/registry";
import { makeCtx } from "@/lib/tools/connectors";
import { extractToolCalls, toolPrompt } from "@/lib/tools/prompt";
import { brainText, notifyOwner } from "@/lib/channels";
import { audit } from "@/lib/audit";
import type { ToolSpec } from "@/lib/tools/types";

export type MissionStatus = "running" | "waiting_call" | "needs_approval" | "done" | "error" | "stopped";
export type Mission = {
  chatId: string; goal: string; status: MissionStatus; steps: number; maxSteps: number; calls: number; maxCalls: number;
  allowWrites: boolean; tainted: boolean; notify: string[];
  messages: Array<{ role: "user" | "assistant"; content: string }>; notes: string; log: Array<{ t: number; text: string }>;
  waitCall: string | null; pending: { name: string; args: Record<string, unknown>; summary: string } | null;
  result?: string; lease?: number; createdAt: number; updatedAt: number;
};

const db = () => getAdminDb();
const col = (uid: string) => db().collection("users").doc(uid).collection("missions");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Starts the next slice of a mission in a separate function call, so one mission can run for hours. */
export function kickMission(uid: string, id: string) {
  const secret = process.env.ROUTINE_RUNNER_SECRET;
  if (!secret) return;
  let base: string;
  try { base = appBaseUrl(); } catch { return; }
  const p = fetch(`${base}/api/missions/tick`, {
    method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ uid, id }), signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
  try { waitUntil(p); } catch { /* not on Vercel */ }
}

export async function startMission(uid: string, p: { chatId: string; goal: string; maxCalls?: number; allowWrites?: boolean; notify?: string[]; maxSteps?: number }) {
  const goal = String(p.goal || "").trim().slice(0, 4000);
  if (goal.length < 10) throw new Error("Give the mission a clear goal (what to do, for whom, what the result should be).");
  const maxCalls = Math.max(0, Math.min(50, Math.floor(Number(p.maxCalls) || 0)));
  const ref = col(uid).doc();
  const now = Date.now();
  const m: Mission = {
    chatId: p.chatId, goal, status: "running", steps: 0, maxSteps: Math.max(10, Math.min(120, Math.floor(Number(p.maxSteps) || 60))),
    calls: 0, maxCalls, allowWrites: Boolean(p.allowWrites), tainted: false, notify: (p.notify ?? []).map(String).slice(0, 6),
    messages: [{ role: "user", content: `MISSION GOAL:\n${goal}` }], notes: "", log: [{ t: now, text: "Mission started" }],
    waitCall: null, pending: null, lease: 0, createdAt: now, updatedAt: now,
  };
  await ref.set(clean(m));
  await audit(uid, { kind: "mission_start", chatId: p.chatId, text: `${ref.id}: ${clip(goal, 150)} (calls ${maxCalls}, writes ${m.allowWrites})` });
  kickMission(uid, ref.id);
  return { id: ref.id, maxCalls, allowWrites: m.allowWrites, maxSteps: m.maxSteps };
}

async function postToChat(uid: string, chatId: string, content: string) {
  const ref = db().collection("users").doc(uid).collection("chats").doc(chatId);
  const s = await ref.get();
  if (!s.exists) return;
  const prior = Array.isArray((s.data() as { messages?: unknown[] }).messages) ? (s.data() as { messages: unknown[] }).messages : [];
  await ref.update({ messages: [...prior, { role: "assistant", content, at: Date.now() }] });
}

function systemPrompt(m: Mission, agent: Agent, specs: ToolSpec[], bt: { role: string; mem: string }) {
  return [
    `You are ${agent.name}, an autonomous AI teammate running a MISSION for your owner. Nobody answers questions during a mission: decide and act.`,
    bt.role ? `YOUR ROLE: ${bt.role}` : "",
    bt.mem ? `WHAT YOU REMEMBER:\n${bt.mem}` : "",
    `HOW TO WORK
- Work in small steps. Each reply: one short line of thought, then up to 3 tool calls: [[TOOL:name|{json}]]. You get the results next.
- Your memory between steps is NOTES. Rewrite it any time with [[NOTE:...]] (max 4000 chars): the full list of items (leads, phone numbers, status of each), what is done, what is next. Keep it current: older messages are trimmed.
- Phone calls: use voice.call ({"to":"+E164","goal":"...","context":"facts the caller needs"}), ONE at a time. The mission pauses until the call ends, then you receive its summary and the follow-ups promised on the call. Calls used: ${m.calls}/${m.maxCalls}. Only call numbers you were given or verified from a real source. Never invent contact data.
- Writing (Sheets, CRM, sending messages): ${m.allowWrites ? "allowed" : "NOT allowed without the owner's approval: the system will pause and ask"}.
- Lead lists: check them with verify.leads before calling anyone. Record every call result (booked / not interested / no answer / callback) in NOTES, and in the Google Sheet if one is requested.
- If a tool or connection is missing, do what you can and say exactly what is missing in the final report.
- When finished (or truly blocked) reply with [[DONE:final report]]: outcome, numbers (found, called, reached, booked), what was written where, what failed. Never claim anything a tool result did not confirm. The report is sent to the owner automatically on chat / WhatsApp / Telegram / email.`,
    `STEP ${m.steps + 1} of ${m.maxSteps}.`,
    m.notes ? `YOUR NOTES:\n${m.notes}` : "YOUR NOTES: (empty)",
  ].filter(Boolean).join("\n\n") + toolPrompt(specs);
}

async function finish(uid: string, m: Mission, status: "done" | "error" | "stopped", text: string) {
  m.status = status;
  const ref = col(uid).doc((m as Mission & { id: string }).id);
  await ref.update(clean({ status, result: clip(text, 6000), lease: 0, updatedAt: Date.now(), log: m.log.slice(-80), messages: m.messages.slice(-60), notes: m.notes, steps: m.steps, calls: m.calls, waitCall: null }));
  const head = status === "done" ? "✅ Mission finished" : status === "stopped" ? "⏹️ Mission stopped" : "⚠️ Mission stopped with a problem";
  const msg = `${head}: ${clip(m.goal, 140)}\n\n${clip(text, 3500)}`;
  await postToChat(uid, m.chatId, msg).catch(() => {});
  await notifyOwner(uid, m.chatId, msg, m.notify).catch(() => {});
}

/** Runs one slice (about 40 seconds) of a mission. The next slice is started automatically. */
export async function advance(uid: string, id: string, budgetMs = 40_000) {
  const ref = col(uid).doc(id);
  const got = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return null;
    const d = s.data() as Mission;
    if (d.status !== "running" || (d.lease ?? 0) > Date.now()) return null;
    tx.update(ref, { lease: Date.now() + budgetMs + 20_000 });
    return d;
  });
  if (!got) return;
  const m = Object.assign(got, { id }) as Mission & { id: string };
  const t0 = Date.now();
  let idle = 0;
  const flush = (extra: Record<string, unknown> = {}) =>
    ref.update(clean({ messages: m.messages.slice(-60), notes: m.notes, log: m.log.slice(-80), steps: m.steps, calls: m.calls, tainted: m.tainted, updatedAt: Date.now(), ...extra }));

  try {
    const agent = await loadAgent(uid, m.chatId);
    const ctx = makeCtx(uid, m.chatId);
    const specs = (await buildCatalog(agent.connectors, ctx)).specs.filter((s) => !s.name.startsWith("mission.") && !s.name.startsWith("identity."));
    const bt = await brainText(uid, m.chatId);

    while (Date.now() - t0 < budgetMs && m.status === "running" && m.steps < m.maxSteps) {
      const live = (await ref.get()).get("status");
      if (live !== "running") { m.status = live as MissionStatus; break; } // the owner stopped it

      const msgs = m.messages.length > 28
        ? [m.messages[0], { role: "user" as const, content: "[older steps trimmed: rely on YOUR NOTES]" }, ...m.messages.slice(-26)]
        : m.messages;
      const raw = (await callProvider({
        provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 1800,
        messages: [{ role: "system", content: systemPrompt(m, agent, specs, bt) }, ...msgs] as ChatMsg[],
      })).trim();
      m.steps++;

      const notes = [...raw.matchAll(/\[\[NOTE:([\s\S]*?)\]\]/g)];
      if (notes.length) m.notes = notes[notes.length - 1][1].trim().slice(0, 4000);
      const withoutNotes = raw.replace(/\[\[NOTE:[\s\S]*?\]\]/g, "");
      const doneAt = withoutNotes.lastIndexOf("[[DONE:");
      const tc = extractToolCalls(withoutNotes);
      m.messages.push({ role: "assistant", content: clip(raw, 3500) });

      if (tc.calls.length === 0) {
        if (doneAt >= 0) { await finish(uid, m, "done", withoutNotes.slice(doneAt + 7).replace(/\]\]\s*$/, "").trim() || "Done."); return; }
        if (++idle >= 2) { await finish(uid, m, "done", clip(withoutNotes, 3500) || "Done."); return; }
        m.messages.push({ role: "user", content: "Use a tool, or finish with [[DONE:final report]]." });
        await flush();
        continue;
      }
      idle = 0;

      const results: string[] = [];
      for (const c of tc.calls.slice(0, 3)) {
        m.log.push({ t: Date.now(), text: `🔧 ${c.name} ${clip(JSON.stringify(c.args), 110)}` });
        if (!specs.some((s) => s.name === c.name)) { results.push(`### ${c.name}\nThis tool is not connected. Do not use it.`); continue; }

        if (c.name === "voice.call") {
          if (m.calls >= m.maxCalls) { results.push(`### voice.call\nCall limit reached (${m.maxCalls}). Do not call anyone else; finish with what you have.`); continue; }
          try {
            const r = await placeOutboundCall(uid, { to: String(c.args.to ?? ""), goal: String(c.args.goal ?? ""), context: String(c.args.context ?? ""), chatId: m.chatId, approved: true });
            m.calls++;
            m.waitCall = r.id;
            m.status = "waiting_call";
            m.log.push({ t: Date.now(), text: `📞 calling ${r.to} (${m.calls}/${m.maxCalls})` });
            break; // one call at a time: the rest of this reply is dropped
          } catch (e) { results.push(`### voice.call\nCould not start the call: ${e instanceof Error ? e.message : "failed"}`); continue; }
        }

        let r = await callTool(agent.connectors, c.name, c.args, false, { ctx, force: Boolean(m.tainted) });
        if (r.needsApproval) {
          if (m.allowWrites && !m.tainted) r = await callTool(agent.connectors, c.name, c.args, true, { ctx, force: false });
          else { m.pending = { name: c.name, args: c.args, summary: r.needsApproval.summary }; m.status = "needs_approval"; break; }
        }
        if (r.flagged?.length) m.tainted = true; // something it read tried to instruct it: writes now need a human
        results.push(`### ${c.name}\n${clip(r.text, 3000)}`);
      }

      if (m.status === "waiting_call") {
        if (results.length) m.messages.push({ role: "user", content: `TOOL RESULTS (before the call):\n${results.join("\n\n")}` });
        await flush({ status: "waiting_call", waitCall: m.waitCall, lease: 0 });
        return;
      }
      if (m.status === "needs_approval") {
        await flush({ status: "needs_approval", pending: m.pending, lease: 0 });
        await notifyOwner(uid, m.chatId, `⏸️ A mission needs your approval:\n${clip(m.goal, 100)}\n\n${clip(m.pending?.summary ?? "", 500)}\n\nOpen Missions in the app and approve or decline.`, m.notify).catch(() => {});
        return;
      }
      m.messages.push({ role: "user", content: `TOOL RESULTS:\n${results.join("\n\n")}\n\nContinue the mission.` });
      await flush();
    }

    if (m.status === "stopped") return;
    if (m.status === "running" && m.steps >= m.maxSteps) { await finish(uid, m, "error", `Step limit (${m.maxSteps}) reached.\n\nNotes so far:\n${m.notes || "(none)"}`); return; }
    await ref.update({ lease: 0 });
    if (m.status === "running") kickMission(uid, id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mission failed.";
    m.log.push({ t: Date.now(), text: `⚠️ ${msg}` });
    const errs = (m.log.filter((l) => l.text.startsWith("⚠️")).length);
    if (errs >= 4) await finish(uid, m, "error", `The mission failed: ${msg}\n\nNotes so far:\n${m.notes || "(none)"}`);
    else await flush({ lease: 0 }); // the 5-minute safety net retries it
  }
}

/** A phone call that a mission waits for has ended: hand its result to the agent and continue. */
export async function resumeMissionForCall(uid: string, callId: string) {
  const q = await col(uid).where("waitCall", "==", callId).limit(1).get();
  if (q.empty) return;
  const ref = q.docs[0].ref;
  const m = q.docs[0].data() as Mission;
  const c = ((await db().collection("users").doc(uid).collection("voiceCalls").doc(callId).get()).data() ?? {}) as { to?: string; status?: string; durationSeconds?: number; summary?: string; followUps?: string[] };
  const text = `CALL RESULT for ${c.to ?? "the number"} (${c.status ?? "unknown"}, ${Math.round(c.durationSeconds ?? 0)}s):\n${clip(c.summary || "No summary.", 2500)}${c.followUps?.length ? `\nFollow-ups promised on the call:\n${c.followUps.map((f) => `- ${f}`).join("\n")}` : ""}\n\nRecord this in your NOTES, update the sheet if requested, then continue with the next item.`;
  await ref.update(clean({
    status: "running", waitCall: null, lease: 0, updatedAt: Date.now(),
    messages: [...m.messages, { role: "user", content: text }].slice(-60),
    log: [...m.log, { t: Date.now(), text: `📞 call ended: ${c.status ?? "?"}` }].slice(-80),
  }));
  kickMission(uid, ref.id);
}

export async function approveMission(uid: string, id: string, approve: boolean) {
  const ref = col(uid).doc(id);
  const s = await ref.get();
  if (!s.exists) throw new Error("Mission not found.");
  const m = s.data() as Mission;
  if (m.status !== "needs_approval" || !m.pending) throw new Error("Nothing is waiting for approval.");
  let text: string;
  if (approve) {
    const agent = await loadAgent(uid, m.chatId);
    const r = await callTool(agent.connectors, m.pending.name, m.pending.args, true, { ctx: makeCtx(uid, m.chatId) });
    await audit(uid, { kind: "mission_approved", chatId: m.chatId, text: `${id}: ${m.pending.name}` });
    text = `The owner APPROVED ${m.pending.name}. Result:\n${clip(r.text, 3000)}`;
  } else text = `The owner DECLINED ${m.pending.name}. Do not retry it; continue without it or finish.`;
  await ref.update(clean({ status: "running", pending: null, lease: 0, updatedAt: Date.now(), messages: [...m.messages, { role: "user", content: text }].slice(-60) }));
  kickMission(uid, id);
}

export async function stopMission(uid: string, id: string) {
  await col(uid).doc(id).update({ status: "stopped", waitCall: null, pending: null, lease: 0, updatedAt: Date.now() });
}

export async function listMissions(uid: string, limit = 30) {
  const snap = await col(uid).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => {
    const m = d.data() as Mission;
    return { id: d.id, goal: m.goal, status: m.status, steps: m.steps, maxSteps: m.maxSteps, calls: m.calls, maxCalls: m.maxCalls, allowWrites: m.allowWrites, notes: m.notes, log: (m.log ?? []).slice(-30), result: m.result ?? "", pending: m.pending, createdAt: m.createdAt, updatedAt: m.updatedAt };
  });
}