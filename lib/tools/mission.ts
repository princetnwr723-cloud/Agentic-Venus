import type { Def } from "./plugins";

export const MISSION_TOOLS: Def[] = [
  {
    name: "mission.start", risk: "write",
    params: "goal:string (complete instructions), max_calls?:number (phone calls allowed, default 0), allow_writes?:boolean (may write to Sheets/CRM/send messages without asking each time), notify?:string[] (default: all connected channels)",
    description: "Start a long MULTI-STEP mission that runs in the background on the server: research, many tool calls, phone calls one by one, updating sheets, then a report to the owner (chat / WhatsApp / Telegram / email). The owner approves it first and sees the limits you set. Put EVERY detail in `goal`: who, what, numbers, sheet name, how to report.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Missions can only be started from a chat.");
      const { startMission } = await import("@/lib/mission");
      const r = await startMission(ctx.uid, {
        chatId: ctx.chatId, goal: String(a.goal ?? ""), maxCalls: Number(a.max_calls) || 0, allowWrites: a.allow_writes === true,
        notify: Array.isArray(a.notify) ? a.notify.map((x) => String(x)) : undefined,
      });
      return `Mission ${r.id} started (up to ${r.maxCalls} calls, writes ${r.allowWrites ? "allowed" : "ask first"}, ${r.maxSteps} steps). It runs in the background; the report arrives in this chat and on the connected channels. Progress: Missions page.`;
    },
  },
  {
    name: "mission.status", risk: "read", params: "id?:string",
    description: "Recent missions with their status (or one by id).",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { listMissions } = await import("@/lib/mission");
      const all = await listMissions(ctx.uid, 8);
      const one = String(a.id ?? "").trim();
      const rows = one ? all.filter((m) => m.id === one) : all;
      return rows.map((m) => `id=${m.id} · ${m.status} · step ${m.steps}/${m.maxSteps} · calls ${m.calls}/${m.maxCalls}\n   ${m.goal.slice(0, 140)}${m.result ? "\n   result: " + m.result.slice(0, 300) : ""}`).join("\n") || "No missions yet.";
    },
  },
];