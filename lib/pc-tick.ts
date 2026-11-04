// One step of following a background computer-agent job. Used by /api/runner/tick (every 5 min, all users) and
// /api/runner/watch (every few seconds, while a job is running). It: counts plan time, forwards questions and payment
// approvals to your chat apps (Telegram with buttons), and, when the job ends, sends the full result everywhere.
import { FieldValue } from "firebase-admin/firestore";
import { connect, pauseSandbox } from "@/lib/e2b-server";
import { runnerStatus, stopRunner, type RunnerState } from "@/lib/runner-server";
import { createSignedDownload } from "@/lib/supabase-server";
import { pcExhausted, settlePcJob, touchPcSeen } from "@/lib/billing-server";
import { notifyOwner } from "@/lib/channels";
import { http } from "@/lib/tools/net";
import { unpack } from "@/lib/tools/catalog";
import { resolveValue } from "@/lib/vault";
import { describePay, getChannelPay, payEnabled, pendingPayments } from "@/lib/pay-channel";

export type Ref = FirebaseFirestore.DocumentReference;
type Job = { id: string; sandboxId: string; offset?: number; hb?: number };
type PcJobDoc = { running?: boolean; task?: string; startedAt?: number; job?: Job; notified?: string };
type Pending = { id: string; kind?: string; site?: string; question?: string; options?: string[]; message?: string };
type PcRunState = RunnerState & { pending?: Pending | null; proof?: string | null };
type Button = { text: string; data: string };

// everything except Telegram (which gets its own buttons message) + the Android app push
const OTHER_CHANNELS = ["whatsapp", "sms", "slackbot", "email", "webhook", "app"];

export async function postChat(userRef: Ref, chatId: string, content: string) {
  const ref = userRef.collection("chats").doc(chatId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const msgs = Array.isArray((snap.data() as { messages?: unknown[] }).messages) ? (snap.data() as { messages: unknown[] }).messages : [];
  await ref.update({ messages: [...msgs, { role: "assistant", content, at: Date.now() }] });
}

/** The work is finished and nobody is watching: switch the computer off right away. */
export async function switchOff(userRef: Ref, chatId: string, e2bKey: string, sandboxId: string) {
  try {
    await pauseSandbox(e2bKey, sandboxId);
    const ref = userRef.collection("chats").doc(chatId);
    const ch = (await ref.get()).data() as { pcSandboxId?: string | null } | undefined;
    if (ch?.pcSandboxId === sandboxId) await ref.update({ pcPaused: true });
  } catch { /* already off or gone */ }
}

async function telegramTarget(userRef: Ref, chatId: string): Promise<{ token: string; chat: string } | null> {
  try {
    const raw = ((await userRef.collection("chats").doc(chatId).get()).data() as { connectors?: Record<string, string> } | undefined)?.connectors?.telegram;
    const c = raw ? await resolveValue(userRef.id, raw) : undefined;
    if (!c) return null;
    const [token, chat] = unpack(c);
    return token && chat ? { token, chat } : null;
  } catch { return null; }
}

/** Sends to every connected chat app. With `rows`, Telegram gets tappable buttons and the others get the plain text. */
async function say(userRef: Ref, chatId: string, text: string, rows?: Button[][]) {
  const tg = rows ? await telegramTarget(userRef, chatId) : null;
  if (tg && rows) {
    await http(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: tg.chat, text: text.slice(0, 3800),
        reply_markup: { inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text.slice(0, 60), callback_data: b.data }))) },
      }),
    }).catch(() => null);
    await notifyOwner(userRef.id, chatId, text, OTHER_CHANNELS).catch(() => null);
  } else {
    await notifyOwner(userRef.id, chatId, text).catch(() => null);
  }
}

async function notifyPending(userRef: Ref, chatId: string, job: Job, pend: Pending) {
  const kind = pend.kind === "login" || pend.kind === "choice" ? pend.kind : "text";
  const options = kind === "choice" && Array.isArray(pend.options) ? pend.options.map(String).slice(0, 6) : [];
  // remembered so the next message (or button) from the chat app is routed to this question
  await userRef.collection("channelState").doc(`pc_${chatId}`).set(
    { ask: { jobId: job.id, sandboxId: job.sandboxId, qid: pend.id, kind, options, until: Date.now() + 30 * 60_000 } },
    { mergeFields: ["ask"] }
  );
  let text: string;
  if (kind === "login") {
    text = `🔐 Task ko ${pend.site ?? "ek site"} me login chahiye. Password chat me mat bhejo: dashboard kholke login karo, ya /skip bhejo. 30 minute me jawab nahi mila to ye step cancel ho jayega.`;
  } else {
    const q = pend.question ?? pend.message ?? "Agent ko aapka input chahiye.";
    text = `⏸️ ${q}\n\n` +
      (options.length ? options.map((o, i) => `${i + 1}. ${o}`).join("\n") + "\n\nNumber ya option ka naam bhejo" : "Seedha jawab type karo") +
      " (ya /skip). 30 minute me jawab nahi mila to risky step cancel ho jayega.";
  }
  const rows: Button[][] = options.map((o, i) => [{ text: o, data: `an:${i}` }]);
  rows.push([{ text: "⏭ Skip", data: "sk" }]);
  await say(userRef, chatId, text, rows);
}

async function notifyPayments(userRef: Ref, chatId: string) {
  const uid = userRef.id;
  const list = (await pendingPayments(uid)).filter((x) => x.chatId === chatId && !x.chNotified);
  if (!list.length) return;
  const on = payEnabled(await getChannelPay(uid));
  for (const x of list.slice(0, 3)) {
    await userRef.collection("vpay").doc(x.id).update({ chNotified: true }).catch(() => null);
    const how = on
      ? `Approve: neeche ka button ya "approve ${x.id} <PIN>"\nMana: "deny ${x.id}"`
      : "Chat se approve karne ke liye pehle app me /channel-pay par PIN set karo. Abhi app kholke approve karo.";
    await say(userRef, chatId, `${describePay(x)}\n\n${how}\n(30 minute me jawab nahi mila to payment nahi hoga.)`,
      on ? [[{ text: "✅ Approve (PIN)", data: `ap:${x.id}` }, { text: "❌ Deny", data: `dn:${x.id}` }]] : undefined);
  }
}

/** Follows ONE pcJobs document. Returns a small record for the tick's log. */
export async function processPcJob(
  d: FirebaseFirestore.QueryDocumentSnapshot,
  e2bFor: (u: Ref) => Promise<string | undefined>
): Promise<Record<string, unknown>> {
  const p = d.data() as PcJobDoc;
  const job = p.job;
  const userRef = d.ref.parent.parent;
  if (!userRef) return { pc: d.id, skipped: "no user" };
  if (!job) {
    if (Date.now() - (p.startedAt ?? 0) > 3 * 3600_000) await d.ref.update({ running: false });
    return { pc: d.id, idle: true };
  }
  try {
    const e2bKey = await e2bFor(userRef);
    if (!e2bKey) return { pc: d.id, skipped: "no E2B key" };
    let state: PcRunState = { status: "error", summary: "The computer expired or was deleted while the task was running." };
    let pcSb: Awaited<ReturnType<typeof connect>> | null = null;
    try {
      pcSb = await connect(e2bKey, job.sandboxId); // keeps the computer alive while the job runs
      state = (await runnerStatus(pcSb, job.id, 0)).state as PcRunState;
    } catch { /* expired */ }
    const watched = Date.now() - (job.hb ?? 0) < 90_000;

    if (state.status === "running") {
      // plan: count the time even when the tab is closed, and stop the job when the plan's time is used up
      await touchPcSeen(userRef.id, job.id).catch(() => {});
      if (pcSb && (await pcExhausted(userRef.id).catch(() => false))) {
        await stopRunner(pcSb, job.id).catch(() => {});
        await postChat(userRef, d.id, "⏱️ The computer-agent time of your plan for this window is used up, so the task was stopped. It refreshes automatically — see Settings → Plans.").catch(() => {});
        await say(userRef, d.id, "⏱️ Plan ka computer time khatam ho gaya, isliye task rok diya. Window refresh hone par dobara chalega.");
      }
      if (!watched) {
        const pend = state.pending;
        if (pend && p.notified !== pend.id) {
          await d.ref.update({ notified: pend.id });
          await notifyPending(userRef, d.id, job, pend);
        }
        await notifyPayments(userRef, d.id);
      }
      return { pc: d.id, uid: userRef.id, status: "running", watched };
    }
    if (watched) return { pc: d.id, status: state.status, watched: true }; // the open tab will finish it

    const ok = state.status === "done";
    const summary = String(state.summary || (ok ? "Done." : "Stopped."));
    let replay = "";
    if (state.proof) replay = await createSignedDownload(state.proof, 6 * 3600).catch(() => "");
    let finalized = false;
    await d.ref.firestore.runTransaction(async (tx) => {
      const c = (await tx.get(d.ref)).data() as PcJobDoc | undefined;
      if (!c?.job || c.job.id !== job.id) return;
      tx.update(d.ref, { running: false, job: FieldValue.delete() });
      finalized = true;
    });
    if (finalized) {
      await settlePcJob(userRef.id, job.id, state.updatedAt ?? Date.now()).catch(() => {}); // plan: close the time of this job
      const title = (p.task ?? "Task").slice(0, 120);
      await postChat(userRef, d.id,
        `${ok ? "✅ Your background task finished while you were away." : "⚠️ Your background task stopped:"}\n\n**${title}**\n\n${summary}` +
        `${replay ? `\n\n🎥 [Watch the replay](${replay}) (link works for 6 hours)` : ""}\n\n🔌 The computer was switched off to save credits.`);
      // the FULL result goes to every connected chat app (long texts are split into several messages)
      await notifyOwner(userRef.id, d.id, `${ok ? "✅" : "⚠️"} ${title}\n\n${summary}${replay ? `\n\n🎥 Replay (6 ghante chalta hai): ${replay}` : ""}`).catch(() => null);
      await userRef.collection("channelState").doc(`pc_${d.id}`).set({ ask: null, awaitPin: null }, { merge: true }).catch(() => {});
      await switchOff(userRef, d.id, e2bKey, job.sandboxId);
    }
    return { pc: d.id, status: state.status, finalized };
  } catch (e) {
    return { pc: d.id, error: e instanceof Error ? e.message : "failed" };
  }
}