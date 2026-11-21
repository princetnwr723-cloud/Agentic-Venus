import type { Def } from "./plugins";

const flag = (v: unknown): boolean | undefined => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined);

// Tools of the meeting bot and of the owner's calendar. Joining a call, and making, moving or cancelling a meeting, are actions in the outside world, so they are held for the owner's approval.
export const MEETING_TOOLS: Def[] = [
  {
    name: "calendar.show", risk: "read", params: "range?:string (today, tomorrow, this week, next week, this month, next 7 days, a weekday, or a date like 2026-11-24), from?:string (YYYY-MM-DD), to?:string (YYYY-MM-DD)",
    description: "Show the owner's calendar in the chat as a calendar card with the real meetings and what the notetaker does with each. Use it whenever the owner asks about their calendar, schedule, meetings, plans or what is coming up. The calendar is read from Google Calendar once and kept up to date by itself.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { showCalendar } = await import("@/lib/calendar-server");
      return showCalendar(ctx.uid, ctx.chatId, { range: String(a.range ?? ""), from: String(a.from ?? ""), to: String(a.to ?? "") });
    },
  },
  {
    name: "calendar.sync", risk: "read", params: "",
    description: "Read the owner's Google Calendar again right now (use it after the owner says they changed or added something).",
    run: async (_a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { syncCalendar } = await import("@/lib/calendar-server");
      const r = await syncCalendar(ctx.uid, ctx.chatId);
      if (!r.connected) return "Google Calendar is not connected to this chat yet. Tell the owner to say \"connect Google\" or press Connect on Google Workspace in Connectors.";
      return r.ok ? `The calendar is up to date: ${r.count} events, ${r.meetings} meetings (time zone ${r.tz}).` : `The calendar could not be read: ${r.error ?? "unknown error"}`;
    },
  },
  {
    name: "calendar.free", risk: "read", params: "date?:string (today, tomorrow, a weekday or YYYY-MM-DD), minutes?:number (shortest free block, default 30)",
    description: "The owner's free time on one day between 09:00 and 18:00, to answer \"am I free ...\" and to suggest a time for a meeting.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { freeTime } = await import("@/lib/calendar-server");
      return freeTime(ctx.uid, ctx.chatId, { date: String(a.date ?? "today"), minutes: Number(a.minutes) || 30 });
    },
  },
  {
    name: "calendar.create", risk: "write", params: "title:string, date:string (today, tomorrow, a weekday, or YYYY-MM-DD), time:string (the start, like 11:00, 11am, 3:30 pm or 15:00), minutes?:number (length, default 30), invite?:string (the e-mail addresses to invite, comma separated), description?:string (agenda or notes), location?:string, meet?:boolean (add a Google Meet link, default true), reminder?:number (popup reminder this many minutes before, default 10, 0 = none), force?:boolean (create even if it overlaps another event)",
    description: "Put a new meeting or event on the owner's Google Calendar, with a Google Meet link, and e-mail the invitation to the people given. Use it when the owner says set / schedule / book / fix a meeting (\"meeting set kro\", \"invite bhejo\"). The tool checks the owner's free time itself and refuses a clash with the free slots instead; do not check first. Each invitee needs an e-mail address: if the owner gave only a name, ask for the address with ask_user. If the owner did not say the title, the length or the time, ask only for what you truly cannot guess (a time is always needed). The invitations are sent by Google from the owner's account. Afterwards tell the owner the day, time, Meet link and who was invited.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { createEvent } = await import("@/lib/calendar-actions");
      return createEvent(ctx.uid, ctx.chatId, { title: a.title, date: a.date, time: a.time, minutes: a.minutes, invite: a.invite, description: a.description, location: a.location, meet: flag(a.meet), reminder: a.reminder, force: flag(a.force) === true });
    },
  },
  {
    name: "calendar.invite", risk: "write", params: "invite:string (e-mail addresses to add, comma separated), title?:string (the meeting, or part of its title), id?:string (the event id, when several meetings match)",
    description: "Add people to a meeting that is already on the owner's calendar. Google e-mails them the invitation. Each person needs an e-mail address (ask the owner with ask_user if only a name was given).",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { inviteToEvent } = await import("@/lib/calendar-actions");
      return inviteToEvent(ctx.uid, ctx.chatId, { id: a.id, title: a.title, invite: a.invite });
    },
  },
  {
    name: "calendar.move", risk: "write", params: "title?:string (the meeting, or part of its title), id?:string (the event id, when several meetings match), date?:string (the NEW day), time?:string (the NEW start), minutes?:number (the NEW length), force?:boolean (even if it overlaps another event)",
    description: "Move a meeting on the owner's calendar to another day or time, or change its length (reschedule, \"meeting aage badha do\"). What is not given stays as it was. Google tells the guests about the new time. Refuses a clash and shows the free slots instead.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { moveEvent } = await import("@/lib/calendar-actions");
      return moveEvent(ctx.uid, ctx.chatId, { id: a.id, title: a.title, date: a.date, time: a.time, minutes: a.minutes, force: flag(a.force) === true });
    },
  },
  {
    name: "calendar.cancel", risk: "write", params: "title?:string (the meeting, or part of its title), id?:string (the event id, when several meetings match)",
    description: "Cancel (delete) a meeting from the owner's calendar. Google tells the guests that it is cancelled. Only the meeting the owner named; never cancel anything they did not ask for.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { cancelEvent } = await import("@/lib/calendar-actions");
      return cancelEvent(ctx.uid, ctx.chatId, { id: a.id, title: a.title });
    },
  },
  {
    name: "calendar.settings", risk: "write", params: "agenda?:boolean (the morning plan), brief_minutes?:number (a short brief this many minutes before every meeting, 0 = off), auto_join?:boolean (the notetaker joins calendar meetings by itself)",
    description: "Change what the agent does with the owner's calendar by itself: the morning plan, the brief before each meeting, and joining meetings with the notetaker.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const { setCalendarPrefs } = await import("@/lib/calendar-server");
      const mins = a.brief_minutes === undefined || a.brief_minutes === "" ? undefined : Number(a.brief_minutes);
      return setCalendarPrefs(ctx.uid, ctx.chatId, { agenda: flag(a.agenda), briefMin: Number.isFinite(mins) ? mins : undefined, autoJoin: flag(a.auto_join) });
    },
  },
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
