import { getAdminDb } from "@/lib/firebase-admin";
import { placeOutboundCall } from "@/lib/voice-calls";
import type { Def } from "./plugins";

const s = (v: unknown, n = 2000) => String(v ?? "").trim().slice(0, n);

export const VOICE_TOOLS: Def[] = [
  {
    name: "voice.call", risk: "write", params: "to:+E164 number, goal:string (what to achieve on the call), context?:string (facts the caller needs: names, offer, prices)",
    description: "Make a real PHONE CALL with your own voice to a person (client, lead, vendor). The user approves every call first. You talk to them live; when the call ends, a summary and the follow-up tasks are posted in this chat.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Calls can only be started from a chat.");
      const r = await placeOutboundCall(ctx.uid, { to: s(a.to, 20), goal: s(a.goal), context: s(a.context, 3000), chatId: ctx.chatId, approved: true });
      return `Call started to ${r.to} (id ${r.id}, status ${r.status}). The conversation happens live; the summary will be posted in this chat when it ends.`;
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