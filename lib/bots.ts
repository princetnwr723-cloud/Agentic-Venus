// The 10 mascot avatars. Old chats saved one of the 6 legacy colour names;
// resolveMascot() maps those to a mascot so nothing breaks.

export type MascotId =
  | "red-fierce"
  | "orange-wink"
  | "blue-wow"
  | "green-joy"
  | "purple-star"
  | "red-sleepy"
  | "orange-calm"
  | "blue-calm"
  | "purple-calm"
  | "red-calm";

export type LegacyColor = "teal" | "amber" | "violet" | "sky" | "coral" | "sage";

export type AvatarColor = MascotId | LegacyColor;

export type MascotTheme = "red" | "redFelt" | "orange" | "blue" | "green" | "purple";
export type MascotExpr = "fierce" | "wink" | "wow" | "joy" | "sleepy" | "calm";

export type MascotDef = {
  label: string;
  theme: MascotTheme;
  expr: MascotExpr;
  stars?: boolean;
};

export const MASCOTS: Record<MascotId, MascotDef> = {
  "red-fierce": { label: "Red · fierce", theme: "red", expr: "fierce" },
  "orange-wink": { label: "Orange · wink", theme: "orange", expr: "wink" },
  "blue-wow": { label: "Blue · surprised", theme: "blue", expr: "wow" },
  "green-joy": { label: "Green · happy", theme: "green", expr: "joy" },
  "purple-star": { label: "Purple · star cheeks", theme: "purple", expr: "fierce", stars: true },
  "red-sleepy": { label: "Red · sleepy", theme: "redFelt", expr: "sleepy" },
  "orange-calm": { label: "Orange · calm", theme: "orange", expr: "calm" },
  "blue-calm": { label: "Blue · calm", theme: "blue", expr: "calm" },
  "purple-calm": { label: "Purple · calm", theme: "purple", expr: "calm" },
  "red-calm": { label: "Red · calm", theme: "redFelt", expr: "calm" },
};

export const AVATAR_COLORS: MascotId[] = Object.keys(MASCOTS) as MascotId[];

const LEGACY: Record<LegacyColor, MascotId> = {
  teal: "green-joy",
  amber: "orange-calm",
  violet: "purple-calm",
  sky: "blue-calm",
  coral: "red-calm",
  sage: "green-joy",
};

export function resolveMascot(color: string | null | undefined): MascotId {
  if (color && Object.prototype.hasOwnProperty.call(MASCOTS, color)) return color as MascotId;
  if (color && Object.prototype.hasOwnProperty.call(LEGACY, color)) return LEGACY[color as LegacyColor];
  return "blue-calm";
}

export type PresetAgent = {
  id: string;
  name: string;
  role: string;
  color: AvatarColor;
};

export const PRESET_AGENTS: PresetAgent[] = [
  { id: "chief", name: "Chief", role: "Chief of staff", color: "purple-star" },
  {
    id: "sales-outbound",
    name: "Sales Outbound",
    role: "Pipeline generation",
    color: "red-fierce",
  },
  {
    id: "inbox-manager",
    name: "Inbox Manager",
    role: "Email triage",
    color: "blue-wow",
  },
  {
    id: "account-manager",
    name: "Account Manager",
    role: "Customer success",
    color: "green-joy",
  },
  {
    id: "talent-scout",
    name: "Talent Scout",
    role: "Recruiting outreach",
    color: "orange-wink",
  },
  {
    id: "expense-manager",
    name: "Expense Manager",
    role: "Finance ops",
    color: "red-sleepy",
  },
  {
    id: "offsite-crew",
    name: "Offsite crew",
    role: "Group thread",
    color: "orange-calm",
  },
];
