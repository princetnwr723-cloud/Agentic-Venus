import type { Def } from "./plugins";

// Tools of the meeting bot. Joining a call is an action in the outside world, so it is held for the owner's approval.
export const MEETING_TOOLS: Def[] = [
  {
    name: "meeting.join", risk: "write", params: "url:string (a Zoom, Google Meet or Microsoft Teams link), title?:string",
    description: "Send the notetaker bot into a video meeting. It listens and writes down the call; when the call ends, the notes (summary, decisions, action items, open questions, risks, talk time) arrive in this chat and each action item becomes a proposal the owner can approve.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Meetings can only be started from a chat.");
      const { joinMeeting } = await import("@/lib/meetings-server");
      const m = await joinMeeting(ctx.uid, { url: String(a.url ?? ""), chatId: ctx.chatId, title: String(a.title ?? "") });
      return `The notetaker (${m.botName}) is joining the ${m.platform} meeting. If the room has a waiting room, the host must admit it. Notes arrive here when the call ends. Meeting id: ${m.botId}.`;
    },
  },
  {
    name: "meeting.autojoin", risk: "write", params: "enabled:boolean",
    description: "Turn on (or off) joining the owner's Google Calendar video meetings automatically, a few minutes before each one starts. Meetings with words like private or personal in the title are skipped.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { saveAutoSettings } = await import("@/lib/meetings-server");
      const s = await saveAutoSettings(ctx.uid, { enabled: a.enabled === true || a.enabled === "true" }, ctx.chatId);
      return s.enabled ? `Done. The notetaker will join your calendar meetings by itself. It skips titles containing: ${s.skipWords.join(", ") || "nothing"}.` : "Done. The notetaker will only join meetings you send it to.";
    },
  },
  {
    name: "meeting.upcoming", risk: "read", params: "",
    description: "The owner's next video meetings from the calendar, and whether the notetaker will join each one.",
    run: async (_a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { upcomingMeetings } = await import("@/lib/meetings-server");
      const u = await upcomingMeetings(ctx.uid, ctx.chatId);
      if (!u.connected) return "Google Calendar is not connected to this agent, so I cannot see the meetings.";
      return u.meetings.map((m) => `${new Date(m.startMs).toISOString()} · ${m.title} · ${m.platform} · ${m.state}`).join("\n") || "No video meetings in the next 24 hours.";
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
    description: "The summary, decisions, action items, open questions and risks of one finished meeting.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { getMeeting } = await import("@/lib/meetings-server");
      const m = await getMeeting(ctx.uid, String(a.id ?? ""));
      if (!m) return "Meeting not found.";
      if (!m.notes) return `The notes are not ready yet (status: ${m.status}${m.note ? ", " + m.note : ""}).`;
      const n = m.notes;
      return [
        n.summary,
        `Decisions: ${n.decisions.join("; ") || "none"}`,
        `Action items:\n${n.items.map((i) => `- ${i.task}${i.owner ? ` (${i.owner})` : ""}${i.due ? ` — ${i.due}` : ""}`).join("\n") || "none"}`,
        n.questions?.length ? `Still open: ${n.questions.join("; ")}` : "",
        n.risks?.length ? `Risks: ${n.risks.join("; ")}` : "",
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "meeting.transcript", risk: "read", params: "id:string (from meeting.list)",
    description: "The saved transcript of one finished meeting, to answer questions about what was said (who said what, and when).",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { getTranscript } = await import("@/lib/meetings-server");
      const t = await getTranscript(ctx.uid, String(a.id ?? ""));
      return t ? t.slice(0, 60_000) : "There is no saved transcript for that meeting (it may not be finished, or nobody spoke).";
    },
  },
];
