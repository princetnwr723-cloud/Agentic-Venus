import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider, type ChatMsg } from "@/lib/ai-providers-server";
import { loadAgent } from "@/lib/voice-calls";
import { buildCatalog, callTool } from "@/lib/tools/registry";
import { makeCtx } from "@/lib/tools/connectors";
import { extractToolCalls, toolPrompt } from "@/lib/tools/prompt";
import { brainText, notifyOwner, runAfter } from "@/lib/channels";
import { learnFromRun } from "@/lib/learning";
import { audit } from "@/lib/audit";
import { handleChannelCommand } from "@/lib/channel-control";
import { classifyAction } from "@/lib/agent/risk";
import { actorNote, can, mayApprove, type Role } from "@/lib/orgs-core";
import { parseProposalReply } from "@/lib/watchers-core";

type Turn = { role: "user" | "assistant"; content: string };
type Pending = { name: string; args: Record<string, unknown>; summary: string };

const YES = /^\s*(yes|y|yep|haan|han|ha|ok|okay|approve|approved|kar\s?do|karo|confirm|sure)\W*$/i;
const NO = /^\s*(no|n|nope|nahi|nah|cancel|mat\s?karo|stop)\W*$/i;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
const turn = (role: Turn["role"], content: string): Turn => ({ role, content });
const keep = (turns: Turn[]): Turn[] => turns.slice(-14).map((x) => turn(x.role, clip(x.content, 2500)));

/**
 * A message from the OWNER (the sender was already checked against the allowlist) arrives in a chat app.
 * The agent answers with the same model, memory, skills and tools as the dashboard chat.
 * Anything that changes something outside asks "reply YES to approve" first.
 * Commands (/jobs, /stop, approve <id> <PIN> ...) and answers to a waiting computer task are handled before the model sees the message.
 * `wipe` (optional) deletes the owner's message again: used for PINs where the chat app allows it (Telegram).
 */
export async function handleInbound(p: { uid: string; chatId: string; channel: string; from: string; text: string; reply: (t: string) => Promise<void>; wipe?: () => Promise<void>; actor?: { uid: string; name: string; role: Role; orgName: string } }) {
  const { uid } = p;
  const t0 = Date.now();
  const key = `${p.channel}_${p.from.replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 80);
  const sref = getAdminDb().collection("users").doc(uid).collection("channelState").doc(key);
  try {
    // The owner's commands (/jobs, approve <id> <PIN>, card payments) are never available to team members.
    const isOwnerUser = !p.actor || p.actor.role === "owner";
    if (isOwnerUser && (await handleChannelCommand({ uid, chatId: p.chatId, text: p.text, reply: p.reply, wipe: p.wipe }))) return;

    // "YES p1a2b3c4" / "NO p1a2b3c4": the owner's answer to a proactive proposal (see watchers-core.ts)
    const pr = parseProposalReply(p.text);
    if (pr) {
      if (p.actor && !can(p.actor.role, "approve_proposals")) { await p.reply("Only the owner or an admin can answer the agent's proposals."); return; }
      const { decideProposal } = await import("@/lib/watchers-server");
      await p.reply((await decideProposal(uid, pr.id, pr.approve, p.actor?.name ?? "owner")).message);
      return;
    }

    const st = ((await sref.get()).data() ?? {}) as { history?: Turn[]; pending?: Pending | null };
    const agent = await loadAgent(uid, p.chatId);
    const ctx = makeCtx(uid, p.chatId);
    let userText = p.text.trim().slice(0, 4000);
    const history: Turn[] = (st.history ?? []).slice(-12);
    let tainted = false;
    let toolRounds = 0;

    if (st.pending) {
      if (YES.test(userText)) {
        // a team member may only approve what their role allows: ordinary writes for members, money / secrets / confidential content for admins and the owner
        const risky = classifyAction({ name: st.pending.name, summary: st.pending.summary, args: st.pending.args }).decision === "ask";
        if (p.actor && !mayApprove(p.actor.role, risky)) {
          await sref.set({ pending: null }, { merge: true });
          await p.reply(`🔒 ${risky ? "This one touches money, secrets or confidential content" : "This changes something outside"}, so it needs an ${risky ? "admin or the owner" : "member, admin or the owner"}. I did not do it.`);
          runAfter(notifyOwner(uid, p.chatId, `${p.actor.name} (${p.actor.role}) asked for: ${clip(st.pending.summary, 300)}. It needs your decision: do it yourself in the dashboard or ask me again from your own account.`));
          return;
        }
        const r = await callTool(agent.connectors, st.pending.name, st.pending.args, true, { ctx });
        await audit(uid, { kind: "channel_approved", chatId: p.chatId, text: `${p.channel}: ${st.pending.name}` });
        userText = `The owner approved "${st.pending.name}" by replying YES. Result:\n${clip(r.text, 3000)}\nContinue and tell the owner the outcome briefly.`;
        await sref.set({ pending: null }, { merge: true });
      } else if (NO.test(userText)) {
        await sref.set({ pending: null, history: keep([...history, turn("user", "(declined the pending action)")]) }, { merge: true });
        await p.reply("Okay, cancelled.");
        return;
      } else {
        await sref.set({ pending: null }, { merge: true }); // a new request replaces the old question
      }
    }

    const specs = (await buildCatalog(agent.connectors, ctx)).specs;
    const bt = await brainText(uid, p.chatId, userText);
    const system =
      [
        `You are ${agent.name}, the owner's AI teammate. You are chatting with your owner in a messaging app (${p.channel}).`,
        `Reply like a chat message: short, clear, plain text (no markdown tables), in the owner's language (Hindi/Hinglish is fine). Use tools whenever they help; never say something is done unless a tool result confirms it.`,
        `Long multi-step jobs (research many leads, call people one by one, update sheets, then report) → start a mission with mission.start instead of doing them inline.`,
        `Anything that needs a real BROWSER or the computer (open websites, fill forms, log in with saved logins, scrape pages, download files, buy something with an approved card) → pc.run with a complete task. It keeps running when the website is closed; questions, login help and payment approvals reach the owner in this chat, and the final result is sent here. Use pc.status to check on it and pc.stop to stop it. After pc.run, just tell the owner it started: do not wait for it.`,
        `Actions that change things outside need the owner's OK: the system asks them to reply YES.`,
        p.actor ? actorNote(p.actor, p.actor.orgName) : "",
        bt.role ? `YOUR ROLE: ${bt.role}` : "",
        bt.mem ? `WHAT YOU REMEMBER:\n${bt.mem}` : "",
      ].filter(Boolean).join("\n\n") + toolPrompt(specs);

    const convo: Turn[] = [...history, turn("user", userText)];
    let final = "";
    for (let round = 0; round < 5; round++) {
      if (Date.now() - t0 > 48_000) break;
      const raw = (await callProvider({
        provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 1500,
        messages: [{ role: "system", content: system }, ...convo] as ChatMsg[],
      })).trim();
      const tc = extractToolCalls(raw);
      if (!tc.calls.length) { final = tc.clean || raw; break; }
      toolRounds++;
      convo.push(turn("assistant", clip(raw, 3000)));
      const results: string[] = [];
      for (const c of tc.calls.slice(0, 3)) {
        const r = await callTool(agent.connectors, c.name, c.args, false, { ctx, force: tainted });
        if (r.needsApproval) {
          if (p.actor && !can(p.actor.role, "write_tools")) {
            await p.reply(`🔒 ${p.actor.name}, your role (${p.actor.role}) can ask questions and read, but not start actions that change things. A member, admin or the owner can ask me for this.`);
            return;
          }
          const pending: Pending = { name: c.name, args: c.args, summary: r.needsApproval.summary };
          await sref.set({ pending, history: keep([...convo, turn("assistant", `(waiting for approval of ${c.name})`)]) }, { merge: true });
          const rk = classifyAction({ name: c.name, summary: r.needsApproval.summary, args: c.args, tainted });
          await p.reply(`⏸️ I need your OK for this:\n${clip(r.needsApproval.summary, 700)}${rk.reasons.length ? `\n⚠ Check first: ${rk.reasons.join("; ")}.` : ""}\n\nReply YES to approve or NO to cancel.`);
          return;
        }
        if (r.flagged?.length) tainted = true;
        results.push(`### ${c.name}\n${clip(r.text, 3000)}`);
      }
      convo.push(turn("user", `TOOL RESULTS:\n${results.join("\n\n")}\n\nAnswer the owner now (short), or call another tool only if really needed.`));
    }
    final = final.replace(/\[\[[\s\S]*?\]\]/g, "").trim() || "I ran out of time on this one. Send it again, or ask me to start it as a mission.";
    await p.reply(final);
    await sref.set({ history: keep([...convo, turn("assistant", final)]), pending: null, updatedAt: Date.now() }, { merge: true });
    await audit(uid, { kind: "channel_message", chatId: p.chatId, text: `${p.channel}: ${clip(p.text, 120)}` });

    // Self-improvement: after a real multi-step conversation the agent keeps what worked (never after a tainted run).
    if (toolRounds >= 2 && !tainted) {
      runAfter(learnFromRun(uid, p.chatId, { task: userText, outcome: final, steps: convo.map((x) => `${x.role}: ${clip(x.content, 300)}`).join("\n"), verdict: "pass" }));
    }
  } catch (e) {
    await p.reply(`⚠️ ${e instanceof Error ? e.message.slice(0, 300) : "Something went wrong."}`).catch(() => {});
  }
}