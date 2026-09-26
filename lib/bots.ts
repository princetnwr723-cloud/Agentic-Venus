// Every Bot has its own identity: a name, a role, a color, and a persistent
// memory of how the person likes work done. This file is mock data only —
// swap fetchBots()/fetchThread() for real Firestore reads once auth + the
// agent backend are wired in (see README "Next steps").

export type AvatarColor =
  | "teal"
  | "amber"
  | "violet"
  | "sky"
  | "coral"
  | "sage";

export type Bot = {
  id: string;
  name: string;
  role: string;
  color: AvatarColor;
  lastMessage: string;
  time: string;
  unread?: boolean;
  paired?: AvatarColor; // second avatar color, for group/paired threads
};

export const bots: Bot[] = [
  {
    id: "chief",
    name: "Chief",
    role: "Chief of staff",
    color: "teal",
    lastMessage: "booked the venue and sent the calendar hold.",
    time: "Yesterday",
  },
  {
    id: "sales-outbound",
    name: "Sales Outbound",
    role: "Pipeline generation",
    color: "amber",
    lastMessage: "Done.",
    time: "11:37 AM",
  },
  {
    id: "inbox-manager",
    name: "Inbox Manager",
    role: "Email triage",
    color: "violet",
    lastMessage: "sent. inbox at zero, 5 drafts parked for review.",
    time: "8:38 AM",
    unread: true,
  },
  {
    id: "account-manager",
    name: "Account Manager",
    role: "Customer success",
    color: "violet",
    lastMessage: "invite's out to vicky. globex note added.",
    time: "6:38 AM",
  },
  {
    id: "talent-scout",
    name: "Talent Scout",
    role: "Recruiting outreach",
    color: "sky",
    lastMessage: "3 intros drafted in your voice, held for review.",
    time: "3:38 AM",
  },
  {
    id: "expense-manager",
    name: "Expense Manager",
    role: "Finance ops",
    color: "coral",
    lastMessage: "report filed. 9 receipts, nothing out of policy.",
    time: "7:38 AM",
  },
  {
    id: "offsite-crew",
    name: "Offsite crew",
    role: "Group thread",
    color: "sage",
    paired: "violet",
    lastMessage: "that leaves the pipeline. i'd spin up a scout for it.",
    time: "5:38 AM",
  },
];

export type ToolStep = { label: string; detail: string };

export type ThreadMessage =
  | { kind: "text"; from: "user" | "bot"; body: string }
  | { kind: "tool-run"; steps: ToolStep[] }
  | { kind: "cross-bot"; from: string; body: string }
  | { kind: "routine"; name: string };

export const sampleThread: ThreadMessage[] = [
  {
    kind: "tool-run",
    steps: [
      { label: "Salesforce", detail: "list pulled · 52 accounts" },
      { label: "Hex", detail: "3 lookalike segments pulled" },
      { label: "LinkedIn", detail: "4 profiles skipped · recently contacted" },
      { label: "Sequencer", detail: "36 drafts queued · 0 sent" },
    ],
  },
  {
    kind: "cross-bot",
    from: "Account Manager and Chief",
    body: "Account Manager sent over the Acme + Globex threads and Chief flagged the priority accounts. Both are folded into tonight's list.",
  },
  {
    kind: "text",
    from: "bot",
    body: "The 36 drafts are sitting in the LinkedIn queue on my screen: recipient, opener, and a Draft badge on each. Nothing goes out until you've had a look.",
  },
  {
    kind: "text",
    from: "user",
    body: "The top 10 look good. Send it. Run this every week.",
  },
  { kind: "routine", name: "Overnight outbound" },
  { kind: "text", from: "bot", body: "Done." },
];