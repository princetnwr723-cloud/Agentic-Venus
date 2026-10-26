import { getAdminDb } from "@/lib/firebase-admin";
import { placeOutboundCall } from "@/lib/voice-calls";
import { getVoiceSettings } from "@/lib/voice-server";
import type { Def } from "./plugins";

const s = (v: unknown, n = 2000) => String(v ?? "").trim().slice(0, n);

/** "me", "owner", "mujhe" ... mean the owner number saved on the Voice page. */
const NEEDS_OWNER = /^(|me|my number|myself|owner|mujhe|mera number|mere number pe)$/i;
async function ownerNumber(uid: string): Promise<string> {
  const n = (await getVoiceSettings(uid)).ownerNumber;
  if (!n) throw new Error("Your own phone number is not saved yet. Open the Voice page and fill in \"Aapka apna number (owner)\", then try again.");
  return n;
}

export const VOICE_TOOLS: Def[] = [
  {
    name: "voice.call", risk: "write", params: "to:+E164 number, goal:string (what to achieve on the call), context?:string (facts the caller needs: names, offer, prices)",
    description: "Make a real PHONE CALL with your own voice to a person (client, lead, vendor). The user approves every call first. You talk to them live; when the call ends, a summary and the follow-up tasks are posted in this chat.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Calls can only be started from a chat.");
      const to = NEEDS_OWNER.test(s(a.to, 40)) ? await ownerNumber(ctx.uid) : s(a.to, 20);
      const r = await placeOutboundCall(ctx.uid, { to, goal: s(a.goal), context: s(a.context, 3000), chatId: ctx.chatId, approved: true });
      return `Call started to ${r.to} (id ${r.id}, status ${r.status}). The conversation happens live; the summary will be posted in this chat when it ends.`;
    },
  },
  {
    name: "voice.call_me", risk: "read", params: "goal:string (exactly what to tell the owner: the result of the work, with the key facts), context?:string (details the owner may ask about)",
    description: "PHONE THE OWNER (the user) on their own saved number and tell them something by voice. Use it whenever the user says things like \"call me when it is done\", \"mujhe call karke batao\" or wants a spoken report. Finish the work FIRST, then call with the real result in goal. No approval needed: it only rings the owner's own number. On that call the owner can ask follow-up questions and give new orders.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Calls can only be started from a chat.");
      const to = await ownerNumber(ctx.uid);
      const r = await placeOutboundCall(ctx.uid, { to, goal: `Report to your owner (they asked you to call them): ${s(a.goal)}`, context: s(a.context, 3000), chatId: ctx.chatId, approved: true });
      return `Calling the owner on ${r.to} now (id ${r.id}). The summary will be posted in this chat when the call ends.`;
    },
  },
  {
    name: "voice.calls", risk: "read", params: "id?:string",
    description: "Recent phone calls with status and summary (or one call by id with its transcript).",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const col = getAdminDb().collection("users").doc(ctx.uid).collection("voiceCalls");
      if (s(a.id)) {
        const d = (await col.doc(s(a.id, 60)).get()).data() as { status?: string; summary?: string; to?: string; from?: string; transcript?: Array<{ role: string; text: string }> } | undefined;
        if (!d) return "No call with that id.";
        return `${d.to ?? d.from} · ${d.status}\n${d.summary ?? ""}\n\n${(d.transcript ?? []).slice(-30).map((t) => `${t.role}: ${t.text}`).join("\n")}`;
      }
      const snap = await col.orderBy("createdAt", "desc").limit(6).get();
      return snap.docs.map((x) => { const d = x.data(); return `id=${x.id} · ${d.direction} ${d.to ?? d.from} · ${d.status}${d.summary ? "\n   " + String(d.summary).slice(0, 220) : ""}`; }).join("\n") || "No calls yet.";
    },
  },
];