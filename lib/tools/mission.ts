import type { Def } from "./plugins";

// Despite the file name this also holds the computer tools (pc.*): both are "start something that runs in the background".
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
  {
    name: "pc.run", risk: "write", params: "task:string (complete instructions)",
    description: "Start a task on the owner's background COMPUTER (a real browser): open sites, fill forms, log in with the owner's saved vPassword logins, scrape, download, buy with an approved card. It keeps running when the website is closed. Questions, login help and payment approvals reach the owner's chat apps and the final result is sent there. Returns at once: do NOT wait for it. Put EVERY detail in `task`: site, what to do, what result is wanted, any limits.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Computer tasks can only be started from a chat.");
      const { queuePcTask } = await import("@/lib/pc-start-server");
      const id = await queuePcTask(ctx.uid, ctx.chatId, String(a.task ?? ""));
      return `Computer task ${id} is queued and starts in a moment (the first time on a new computer it needs a few minutes of setup). It runs in the background: the owner gets questions, approvals and the final result in the chat apps. Tell the owner it started; do not wait.`;
    },
  },
  {
    name: "pc.status", risk: "read", params: "",
    description: "What the background computer is doing right now (queued, running, latest steps).",
    run: async (_a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { pcStatusText } = await import("@/lib/pc-start-server");
      return pcStatusText(ctx.uid, ctx.chatId);
    },
  },
  {
    name: "pc.stop", risk: "write", params: "",
    description: "Stop the running or queued computer task of this chat.",
    run: async (_a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { stopPcTask } = await import("@/lib/pc-start-server");
      return stopPcTask(ctx.uid, ctx.chatId);
    },
  },
];