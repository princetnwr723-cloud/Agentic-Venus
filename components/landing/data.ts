import { PRESET_AGENTS, type AvatarColor } from "@/lib/bots";

export type Msg = { from: "bot" | "me"; text: string };

export type Job = {
  id: string;
  name: string;
  color: AvatarColor;
  sub: string; // status line in the sidebar
  blurb: string;
  runs: string;
  uses: string;
  msgs: Msg[];
};

const colorOf = (id: string): AvatarColor =>
  (PRESET_AGENTS.find((a) => a.id === id)?.color ?? "blue-calm") as AvatarColor;

export const JOBS: Job[] = [
  {
    id: "chief",
    name: "Chief of Staff",
    color: colorOf("chief"),
    sub: "Waiting on your yes",
    blurb:
      "Reads your day, spots what needs a decision and lines up the next move. Anything that involves other people waits for your yes.",
    runs: "Every morning at 7:30 AM",
    uses: "Google Calendar, Gmail",
    msgs: [
      { from: "bot", text: "Two things need you today: the vendor contract redline and an offer letter waiting for your sign-off. Your 3:00 PM also lands on top of board prep." },
      { from: "bot", text: "Everyone invited is free tomorrow at 11:30. I’m holding the new invite until you confirm." },
      { from: "me", text: "Go ahead" },
      { from: "bot", text: "Rescheduled to tomorrow at 11:30 with a short note explaining why. Your afternoon is clear for board prep." },
    ],
  },
  {
    id: "sales-outbound",
    name: "Sales Outbound",
    color: colorOf("sales-outbound"),
    sub: "Weekdays at 9:00 AM",
    blurb:
      "Finds accounts that fit, checks who was contacted recently and drafts each outreach. Nothing sends until you approve it.",
    runs: "Weekdays at 9:00 AM",
    uses: "Gmail, HubSpot",
    msgs: [
      { from: "bot", text: "Overnight I found 36 accounts that match your profile. 4 were skipped because someone already contacted them recently." },
      { from: "bot", text: "All 32 drafts are written and queued. Nothing goes out until you say so." },
      { from: "me", text: "Send them" },
      { from: "bot", text: "Sent all 32. I’ll tell you who replied tomorrow morning." },
    ],
  },
  {
    id: "inbox-manager",
    name: "Inbox Manager",
    color: colorOf("inbox-manager"),
    sub: "Every 30 minutes",
    blurb:
      "Triages the inbox, drafts replies to the ones that matter and files the rest. You only see what needs you.",
    runs: "Every 30 minutes",
    uses: "Gmail, Slack",
    msgs: [
      { from: "bot", text: "47 new emails since the last check. 6 need a reply from you, 9 are receipts and the rest are newsletters." },
      { from: "bot", text: "I drafted replies for the six and filed everything else. The drafts are waiting in your inbox." },
      { from: "me", text: "Looks good" },
      { from: "bot", text: "Marked as reviewed. Next check in 30 minutes." },
    ],
  },
  {
    id: "expense-manager",
    name: "Expense Manager",
    color: colorOf("expense-manager"),
    sub: "Mondays at 9:00 AM",
    blurb:
      "Chases overdue invoices, matches receipts and keeps the expense sheet clean. Reminders go out only after you say send.",
    runs: "Mondays at 9:00 AM",
    uses: "Gmail, Google Sheets",
    msgs: [
      { from: "bot", text: "Four invoices are overdue. The oldest is 6 days past due and is worth $3,150." },
      { from: "bot", text: "I wrote a polite reminder for each one and attached the PDF. Holding them until you say send." },
      { from: "me", text: "Send" },
      { from: "bot", text: "All four reminders are sent. I’ll check for payments again next Monday." },
    ],
  },
  {
    id: "talent-scout",
    name: "Talent Scout",
    color: colorOf("talent-scout"),
    sub: "Weekdays at 8:00 AM",
    blurb:
      "Builds shortlists of candidates and writes a personal first message for each one. You approve every message.",
    runs: "Weekdays at 8:00 AM",
    uses: "LinkedIn, Gmail",
    msgs: [
      { from: "bot", text: "I shortlisted 12 backend engineers who match your brief. 3 of them posted about moving jobs this month." },
      { from: "bot", text: "Each one has a personal first message ready. I haven’t contacted anyone." },
      { from: "me", text: "Send the top 3" },
      { from: "bot", text: "Sent to the top 3. I’ll follow up in two days if they stay quiet." },
    ],
  },
  {
    id: "account-manager",
    name: "Account Manager",
    color: colorOf("account-manager"),
    sub: "Fridays at 4:00 PM",
    blurb:
      "Watches customer health, prepares renewals and drafts a check-in before an account goes quiet.",
    runs: "Fridays at 4:00 PM",
    uses: "HubSpot, Slack",
    msgs: [
      { from: "bot", text: "Three customers haven’t logged in for two weeks. One of them renews next month." },
      { from: "bot", text: "I drafted a short check-in for each and put the renewal notes in one place." },
      { from: "me", text: "Send the check-ins" },
      { from: "bot", text: "Done. I’ll flag it if any of them stay silent till Wednesday." },
    ],
  },
];