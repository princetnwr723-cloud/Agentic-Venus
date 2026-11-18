import type { Def } from "./plugins";

// Tools of the meeting bot. Joining a call is an action in the outside world, so it is held for the owner's approval.
export const MEETING_TOOLS: Def[] = [
  {
    name: "meeting.join", risk: "write", params: "url:string (a Zoom, Google Meet, Microsoft Teams or Webex link), title?:string",
    description: "Send the notetaker bot into a video meeting. It listens and writes down the call; when the call ends, the notes (summary, decisions, action items) arrive in this chat and each action item becomes a proposal the owner can approve.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Meetings can only be started from a chat.");
      const { joinMeeting } = await import("@/lib/meetings-server");
      const m = await joinMeeting(ctx.uid, { url: String(a.url ?? ""), chatId: ctx.chatId, title: String(a.title ?? "") });
      return `The notetaker (${m.botName}) is joining the ${m.platform} meeting. If the room has a waiting room, the host must admit it. Notes arrive here when the call ends. Meeting id: ${m.botId}.`;
    },
  },
  {
    name: "meeting.list", risk: "read", params: "",
    description: "The owner's recent meetings with their status.",
    run: async (_a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { listMeetings } = await import("@/lib/meetings-server");
      const rows = await listMeetings(ctx.uid, 8);
      return rows.map((m) => `id=${m.botId} · ${m.platform} · ${m.status}${m.title ? " · " + m.title : ""}${m.notes ? `\n   ${m.notes.summary.slice(0, 200)}` : ""}`).join("\n") || "No meetings yet.";
    },
  },
  {
    name: "meeting.notes", risk: "read", params: "id:string (from meeting.list)",
    description: "The summary, decisions and action items of one finished meeting.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { getMeeting } = await import("@/lib/meetings-server");
      const m = await getMeeting(ctx.uid, String(a.id ?? ""));
      if (!m) return "Meeting not found.";
      if (!m.notes) return `The notes are not ready yet (status: ${m.status}${m.note ? ", " + m.note : ""}).`;
      return `${m.notes.summary}\nDecisions: ${m.notes.decisions.join("; ") || "none"}\nAction items:\n${m.notes.items.map((i) => `- ${i.task}${i.owner ? ` (${i.owner})` : ""}${i.due ? ` — ${i.due}` : ""}`).join("\n") || "none"}`;
    },
  },
];
