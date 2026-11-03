// Commands, answers and payment approvals that arrive from a chat app (Telegram, WhatsApp, SMS, Slack).
// handleInbound() calls this first; it returns true when the message was handled here and must not go to the model.
import { getAdminDb } from "@/lib/firebase-admin";
import { connect } from "@/lib/e2b-server";
import { resolveValue } from "@/lib/vault";
import { answerPcJob } from "@/lib/pc-runner-server";
import { approvePayment, denyPayment, getChannelPay, payEnabled } from "@/lib/pay-channel";
import { pcStatusText, stopPcTask } from "@/lib/pc-start-server";
import { appBaseUrl } from "@/lib/voice-server";
import { isPin, matchOption, parseCommand } from "@/lib/channel-commands";

type Ask = { jobId: string; sandboxId: string; qid: string; kind: "login" | "choice" | "text"; options: string[]; until: number };
type State = { ask?: Ask | null; awaitPin?: { payId: string; until: number } | null };
type P = { uid: string; chatId: string; text: string; reply: (t: string) => Promise<void>; wipe?: () => Promise<void> };

const YES = /^\s*(yes|y|haan|han|ha|ok|okay|kar\s?do|karo|confirm|sure|approve)\W*$/i;
const NO = /^\s*(no|n|nahi|nah|cancel|mat\s?karo)\W*$/i;

const HELP = [
  "Main aapka agent hoon. Kuch bhi likho, kaam ho jayega.",
  "",
  "Computer par kaam (browser, forms, login, scraping): seedha likho, jaise \"amazon pe X ka price nikalo\". Ek baar YES bolna padega.",
  "/jobs ya /status — computer task ka haal",
  "/stop — computer task rokna",
  "/skip — agent ke sawal ko skip karna",
  "approve <id> <PIN> — card payment approve karna (PIN pehle app me /channel-pay par set hota hai)",
  "deny <id> — payment mana karna",
].join("\n");

const payLink = () => { try { return `${appBaseUrl()}/channel-pay`; } catch { return "app ka /channel-pay page"; } };

async function sendAnswer(uid: string, ask: Ask, reply: Record<string, unknown>) {
  const raw = ((await getAdminDb().collection("users").doc(uid).get()).data() as { e2bKey?: string } | undefined)?.e2bKey;
  if (!raw) throw new Error("E2B key nahi mila.");
  const sb = await connect(await resolveValue(uid, raw), ask.sandboxId);
  await answerPcJob(sb, ask.jobId, ask.qid, reply);
}

export async function handleChannelCommand(p: P): Promise<boolean> {
  const { uid, chatId, reply } = p;
  const sref = getAdminDb().collection("users").doc(uid).collection("channelState").doc(`pc_${chatId}`);
  const st = ((await sref.get()).data() ?? {}) as State;
  const now = Date.now();
  const cmd = parseCommand(p.text);
  const ask = st.ask && st.ask.until > now ? st.ask : null;
  const wantPin = st.awaitPin && st.awaitPin.until > now ? st.awaitPin : null;
  const wipe = async () => { await p.wipe?.().catch(() => {}); };

  const answer = async (a: Ask, text: string) => {
    await sendAnswer(uid, a, { type: "answer", text });
    await sref.set({ ask: null }, { merge: true });
    await reply(text ? `✅ Jawab bhej diya: ${text.slice(0, 80)}` : "⏭ Skip kar diya.");
  };

  const startApprove = async (id: string, pin?: string) => {
    if (!payEnabled(await getChannelPay(uid))) {
      await reply(`Chat se payment abhi band hai. Pehle ${payLink()} par PIN set karo (ya app me approve karo).`);
      return true;
    }
    if (pin) { await wipe(); await reply((await approvePayment(uid, id, pin)).msg); return true; }
    await sref.set({ awaitPin: { payId: id, until: now + 3 * 60_000 } }, { merge: true });
    await reply("🔐 Payment approve karne ke liye apna PIN bhejo (4-8 digit).\nTelegram me ye message turant delete ho jata hai.");
    return true;
  };

  try {
    // a PIN that was asked for
    if (wantPin && cmd.kind === "text" && isPin(cmd.text)) {
      await wipe();
      await sref.set({ awaitPin: null }, { merge: true });
      await reply((await approvePayment(uid, wantPin.payId, cmd.text.trim())).msg);
      return true;
    }

    switch (cmd.kind) {
      case "help": await reply(HELP); return true;
      case "jobs":
      case "status": await reply(await pcStatusText(uid, chatId)); return true;
      case "stop": await reply(await stopPcTask(uid, chatId)); return true;
      case "deny": await reply((await denyPayment(uid, cmd.id)).msg); return true;
      case "approve": return startApprove(cmd.id, cmd.pin);
      case "skip":
        if (!ask) { await reply("Abhi koi sawal pending nahi hai."); return true; }
        await answer(ask, ask.kind === "choice" ? "Cancel" : "");
        return true;
      case "callback": {
        if (cmd.action === "ap") return startApprove(cmd.value);
        if (cmd.action === "dn") { await reply((await denyPayment(uid, cmd.value)).msg); return true; }
        if (!ask) { await reply("Ye sawal ab pending nahi hai (shayad expire ho gaya)."); return true; }
        if (cmd.action === "sk") { await answer(ask, ask.kind === "choice" ? "Cancel" : ""); return true; }
        const opt = ask.options[Number(cmd.value)];
        if (!opt) { await reply("Ye option nahi mila."); return true; }
        await answer(ask, opt);
        return true;
      }
      case "text": {
        if (!ask || ask.kind === "login") return false; // a login is answered in the app (passwords never travel through chat apps)
        if (ask.kind === "text") { await answer(ask, cmd.text.slice(0, 2000)); return true; }
        let opt = matchOption(cmd.text, ask.options);
        if (!opt && YES.test(cmd.text) && ask.options.includes("Approve")) opt = "Approve";
        if (!opt && NO.test(cmd.text) && ask.options.includes("Cancel")) opt = "Cancel";
        if (!opt) {
          await reply("Option chuno: " + ask.options.map((o, i) => `${i + 1}. ${o}`).join("  ") + "  (ya /skip)");
          return true;
        }
        await answer(ask, opt);
        return true;
      }
    }
    return false;
  } catch (e) {
    await reply(`⚠️ ${e instanceof Error ? e.message.slice(0, 300) : "Kuch gadbad ho gayi."}`).catch(() => {});
    return true;
  }
}