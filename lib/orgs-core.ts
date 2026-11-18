// Shared workspaces ("orgs"): roles, permissions, invite / link codes and who is who in Slack. PURE (tested with node --test).
//
// Model: one organisation has ONE shared agent (the owner's chat with its connectors, memory and tools). Members reach it from Slack
// with their own identity: every person has their own conversation and their own pending approvals, and what they may do depends on
// their role. Nothing here touches a database; orgs-server.ts stores the documents.

export type Role = "owner" | "admin" | "member" | "viewer";
export const ROLES: Role[] = ["owner", "admin", "member", "viewer"];

export type Action =
  | "use_agent"          // talk to the shared agent, read-only tools
  | "write_tools"        // let the agent use tools that change things (each still asks for approval)
  | "approve_write"      // answer YES for an ordinary write (send a mail, post, save a file)
  | "approve_risky"      // answer YES for money, deletion, secrets or confidential content leaving
  | "approve_proposals"  // say yes / no to the agent's proactive proposals
  | "start_meeting"      // send the meeting bot into a call
  | "view_runs"          // see what the agent did
  | "manage_members"     // invite, remove, change roles
  | "manage_connectors"; // change the agent's logins and tools

const MATRIX: Record<Role, Action[]> = {
  owner: ["use_agent", "write_tools", "approve_write", "approve_risky", "approve_proposals", "start_meeting", "view_runs", "manage_members", "manage_connectors"],
  admin: ["use_agent", "write_tools", "approve_write", "approve_risky", "approve_proposals", "start_meeting", "view_runs", "manage_members"],
  member: ["use_agent", "write_tools", "approve_write", "start_meeting", "view_runs"],
  viewer: ["use_agent", "view_runs"],
};
export const can = (role: Role | null | undefined, action: Action): boolean => Boolean(role && MATRIX[role]?.includes(action));
export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as string[]).includes(v);

export type OrgMember = { uid: string; name: string; role: Role; joinedAt: number; slackId?: string };
export type Org = {
  id: string; name: string; ownerUid: string; chatId: string;
  members: Record<string, OrgMember>;
  /** Slack member id -> uid of the member who linked it */
  slackIds: Record<string, string>;
  createdAt: number;
};

export const cleanName = (s: unknown, d = "Team") => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || d;

/** Who may change whose role. One owner only; an admin manages members and viewers, never admins or the owner. */
export function canChangeRole(actor: Role, target: Role, next: Role): boolean {
  if (!can(actor, "manage_members")) return false;
  if (target === "owner" || next === "owner") return false;
  if (actor === "owner") return true;
  return (target === "member" || target === "viewer") && (next === "member" || next === "viewer");
}
export function canRemove(actor: Role, target: Role): boolean {
  if (!can(actor, "manage_members") || target === "owner") return false;
  return actor === "owner" || target === "member" || target === "viewer";
}

/** Codes use an alphabet without look-alike characters. `bytes` come from crypto.getRandomValues in the server file. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function codeFromBytes(bytes: ArrayLike<number>, length = 10): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return out;
}
export const isCode = (s: unknown): s is string => typeof s === "string" && /^[A-HJ-NP-Z2-9]{8,12}$/.test(s);
export const normalizeCode = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** "link ABCD234567" typed to the Slack bot. */
export function parseLinkCommand(text: string): string | null {
  const m = /^\s*(?:\/)?link\s+([A-Za-z0-9-]{8,14})\s*$/i.exec(String(text ?? ""));
  const code = m ? normalizeCode(m[1]) : "";
  return isCode(code) ? code : null;
}

/** The Slack bot's own mention (<@U123>) is not part of the question. */
export const stripMention = (text: string) => String(text ?? "").replace(/<@[A-Z0-9]+>/g, "").replace(/\s+/g, " ").trim();

/** Who is this Slack user? The owner's own Slack id is always the owner. */
export function actorFromSlack(org: Org, slackUserId: string, ownerSlackId: string): { uid: string; name: string; role: Role } | null {
  if (slackUserId && slackUserId === ownerSlackId) { const o = org.members[org.ownerUid]; return { uid: org.ownerUid, name: o?.name ?? "Owner", role: "owner" }; }
  const uid = org.slackIds[slackUserId];
  const m = uid ? org.members[uid] : undefined;
  return m ? { uid: m.uid, name: m.name, role: m.role } : null;
}

/** Added to the agent's instructions so it knows who it is talking to. */
export const actorNote = (a: { name: string; role: Role }, orgName: string) =>
  `You work in the shared workspace "${orgName}". You are talking to ${a.name}, role: ${a.role}. Other team members have their own conversations with you. ` +
  (a.role === "viewer" ? "This person may only ask questions and read: never start an action that changes something outside; say it needs a member, admin or owner." : "Only act for this person's own request; never reveal another person's private conversation.");

/** Can this person say YES to this kind of action? `risky` comes from the risk classifier (risk.ts). */
export const mayApprove = (role: Role | null | undefined, risky: boolean) => can(role, risky ? "approve_risky" : "approve_write");

export function addMember(org: Org, m: { uid: string; name: string; role: Role }, now: number): Org {
  if (org.members[m.uid]) return org;
  return { ...org, members: { ...org.members, [m.uid]: { uid: m.uid, name: cleanName(m.name, "Member"), role: m.role === "owner" ? "member" : m.role, joinedAt: now } } };
}
export function removeMemberFrom(org: Org, uid: string): Org {
  if (uid === org.ownerUid || !org.members[uid]) return org;
  const members = { ...org.members }; delete members[uid];
  const slackIds = Object.fromEntries(Object.entries(org.slackIds).filter(([, u]) => u !== uid));
  return { ...org, members, slackIds };
}
/** One Slack id belongs to one person; a person has one Slack id (a new link replaces the old one). */
export function linkSlack(org: Org, uid: string, slackId: string): Org {
  if (!org.members[uid] || !/^[UW][A-Z0-9]{5,}$/.test(slackId)) return org;
  const slackIds = Object.fromEntries(Object.entries(org.slackIds).filter(([s, u]) => u !== uid && s !== slackId));
  slackIds[slackId] = uid;
  return { ...org, slackIds, members: { ...org.members, [uid]: { ...org.members[uid], slackId } } };
}
export function setRole(org: Org, uid: string, role: Role): Org {
  const m = org.members[uid];
  return m ? { ...org, members: { ...org.members, [uid]: { ...m, role } } } : org;
}
export const publicView = (org: Org) => ({
  id: org.id, name: org.name, ownerUid: org.ownerUid, chatId: org.chatId, createdAt: org.createdAt,
  members: Object.values(org.members).sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.joinedAt - b.joinedAt).map((m) => ({ uid: m.uid, name: m.name, role: m.role, joinedAt: m.joinedAt, slackLinked: Boolean(m.slackId) })),
});
