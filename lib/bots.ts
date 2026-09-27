export type AvatarColor =
  | "teal"
  | "amber"
  | "violet"
  | "sky"
  | "coral"
  | "sage";

export const AVATAR_COLORS: AvatarColor[] = [
  "teal",
  "amber",
  "violet",
  "sky",
  "coral",
  "sage",
];

export type PresetAgent = {
  id: string;
  name: string;
  role: string;
  color: AvatarColor;
};

export const PRESET_AGENTS: PresetAgent[] = [
  { id: "chief", name: "Chief", role: "Chief of staff", color: "teal" },
  {
    id: "sales-outbound",
    name: "Sales Outbound",
    role: "Pipeline generation",
    color: "amber",
  },
  {
    id: "inbox-manager",
    name: "Inbox Manager",
    role: "Email triage",
    color: "violet",
  },
  {
    id: "account-manager",
    name: "Account Manager",
    role: "Customer success",
    color: "sky",
  },
  {
    id: "talent-scout",
    name: "Talent Scout",
    role: "Recruiting outreach",
    color: "coral",
  },
  {
    id: "expense-manager",
    name: "Expense Manager",
    role: "Finance ops",
    color: "sage",
  },
  {
    id: "offsite-crew",
    name: "Offsite crew",
    role: "Group thread",
    color: "violet",
  },
];