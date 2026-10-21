// Mascot avatars: 15 expressions x ANY colour.
// An avatar value is one of:
//   - a preset id            "red-calm"
//   - a custom value         "love:#ff3ea5"   (expression:#hex)
//   - an old colour name     "teal" (still works, mapped to a preset)

export type MascotExpr =
  | "fierce"
  | "rogue"
  | "wink"
  | "wow"
  | "joy"
  | "sleepy"
  | "calm"
  | "love"
  | "cool"
  | "sad"
  | "dizzy"
  | "starry"
  | "tongue"
  | "shy"
  | "nerd";

export const EXPRESSIONS: MascotExpr[] = [
  "calm",
  "joy",
  "wink",
  "wow",
  "fierce",
  "rogue",
  "sleepy",
  "love",
  "cool",
  "sad",
  "dizzy",
  "starry",
  "tongue",
  "shy",
  "nerd",
];

export const EXPRESSION_LABELS: Record<MascotExpr, string> = {
  calm: "Calm",
  joy: "Happy",
  wink: "Wink",
  wow: "Surprised",
  fierce: "Fierce",
  rogue: "Star cheeks",
  sleepy: "Sleepy",
  love: "Love",
  cool: "Cool",
  sad: "Sad",
  dizzy: "Dizzy",
  starry: "Starstruck",
  tongue: "Tongue out",
  shy: "Shy",
  nerd: "Nerd",
};

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

export type CustomAvatar = `${MascotExpr}:#${string}`;

export type AvatarColor = MascotId | LegacyColor | CustomAvatar;

export type MascotDef = { label: string; expr: MascotExpr; hex: string };

export const MASCOTS: Record<MascotId, MascotDef> = {
  "red-fierce": { label: "Red · fierce", expr: "fierce", hex: "#ee1216" },
  "orange-wink": { label: "Orange · wink", expr: "wink", hex: "#ff690c" },
  "blue-wow": { label: "Blue · surprised", expr: "wow", hex: "#1e88f0" },
  "green-joy": { label: "Green · happy", expr: "joy", hex: "#52b438" },
  "purple-star": { label: "Purple · star cheeks", expr: "rogue", hex: "#7a2cd6" },
  "red-sleepy": { label: "Red · sleepy", expr: "sleepy", hex: "#ec3220" },
  "orange-calm": { label: "Orange · calm", expr: "calm", hex: "#ff690c" },
  "blue-calm": { label: "Blue · calm", expr: "calm", hex: "#1e88f0" },
  "purple-calm": { label: "Purple · calm", expr: "calm", hex: "#7a2cd6" },
  "red-calm": { label: "Red · calm", expr: "calm", hex: "#ec3220" },
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

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function parseAvatar(value: string | null | undefined): { expr: MascotExpr; hex: string } {
  const v = String(value ?? "").trim();
  if (has(MASCOTS, v)) {
    const m = MASCOTS[v as MascotId];
    return { expr: m.expr, hex: m.hex };
  }
  if (has(LEGACY, v)) {
    const m = MASCOTS[LEGACY[v as LegacyColor]];
    return { expr: m.expr, hex: m.hex };
  }
  const c = /^([a-z]+):(#[0-9a-fA-F]{6})$/.exec(v);
  if (c && (EXPRESSIONS as string[]).includes(c[1])) {
    return { expr: c[1] as MascotExpr, hex: c[2].toLowerCase() };
  }
  const d = MASCOTS["blue-calm"];
  return { expr: d.expr, hex: d.hex };
}

export function makeAvatar(expr: MascotExpr, hex: string): AvatarColor {
  return `${expr}:${hex.toLowerCase()}` as AvatarColor;
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
