// Shared workspaces, server side. The decisions live in orgs-core.ts (tested); this file stores the documents.
// Collections (all server-only: firestore.rules denies everything that is not listed there):
//   orgs/{orgId}            the organisation (members, Slack ids, the shared agent's chat)
//   orgInvites/{code}       an invite code: orgId, role, expiry, uses
//   orgLinks/{code}         a one-time code that binds a member's Slack id to their account
//   orgIndex/{uid}          { orgIds: [...] } so a user's organisations can be found
import { randomBytes } from "node:crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { addMember, can, canChangeRole, canRemove, cleanName, codeFromBytes, isCode, linkSlack, normalizeCode, removeMemberFrom, setRole, type Org, type Role } from "@/lib/orgs-core";

const db = () => getAdminDb();
const orgs = () => db().collection("orgs");
const invites = () => db().collection("orgInvites");
const links = () => db().collection("orgLinks");
const index = () => db().collection("orgIndex");
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const code = () => codeFromBytes(randomBytes(12), 10);
const HOUR = 3600_000;
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

async function addToIndex(uid: string, orgId: string) {
  const ref = index().doc(uid);
  await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const ids = ((s.data() as { orgIds?: string[] } | undefined)?.orgIds ?? []).filter((x) => x !== orgId);
    tx.set(ref, { orgIds: [...ids, orgId].slice(-20) });
  });
}
async function dropFromIndex(uid: string, orgId: string) {
  const ref = index().doc(uid);
  await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    tx.set(ref, { orgIds: ((s.data() as { orgIds?: string[] } | undefined)?.orgIds ?? []).filter((x) => x !== orgId) });
  });
}

export async function getOrg(id: string): Promise<Org | null> {
  const s = await orgs().doc(id).get();
  return s.exists ? (s.data() as Org) : null;
}
/** Read-modify-write inside a transaction. `fn` returns the new org, or null to change nothing. */
async function update(id: string, fn: (o: Org) => Org | null): Promise<Org> {
  const ref = orgs().doc(id);
  return db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw fail("This workspace does not exist.", 404);
    const next = fn(s.data() as Org);
    if (!next) return s.data() as Org;
    tx.set(ref, clean(next));
    return next;
  });
}
const mustMember = (o: Org, uid: string) => { const m = o.members[uid]; if (!m) throw fail("You are not a member of this workspace.", 403); return m; };

export async function listOrgsFor(uid: string): Promise<Org[]> {
  const ids = ((await index().doc(uid).get()).data() as { orgIds?: string[] } | undefined)?.orgIds ?? [];
  const out: Org[] = [];
  for (const id of ids) { const o = await getOrg(id); if (o && o.members[uid]) out.push(o); }
  return out;
}

export async function createOrg(uid: string, a: { name: string; chatId: string; ownerName: string }): Promise<Org> {
  // no chat named: the newest one becomes the shared agent
  let chatId = a.chatId;
  if (!chatId) chatId = (await db().collection("users").doc(uid).collection("chats").orderBy("createdAt", "desc").limit(1).get()).docs[0]?.id ?? "";
  const chat = chatId ? await db().collection("users").doc(uid).collection("chats").doc(chatId).get() : null;
  if (!chat?.exists) throw fail("Create a chat in the dashboard first: it becomes the shared agent of the workspace.");
  if ((await listOrgsFor(uid)).some((o) => o.ownerUid === uid)) throw fail("You already own a workspace. One owner, one workspace for now.", 409);
  const now = Date.now();
  const ref = orgs().doc();
  const org: Org = { id: ref.id, name: cleanName(a.name), ownerUid: uid, chatId, slackIds: {}, createdAt: now, members: { [uid]: { uid, name: cleanName(a.ownerName, "Owner"), role: "owner", joinedAt: now } } };
  await ref.set(clean(org));
  await addToIndex(uid, org.id);
  return org;
}

export async function createInvite(orgId: string, actorUid: string, role: Role): Promise<{ code: string; expiresAt: number }> {
  const o = await getOrg(orgId);
  if (!o) throw fail("This workspace does not exist.", 404);
  if (!can(mustMember(o, actorUid).role, "manage_members")) throw fail("Only the owner or an admin can invite people.", 403);
  if (role === "owner" || (role === "admin" && o.members[actorUid].role !== "owner")) throw fail("You cannot invite someone with that role.", 403);
  const c = code(), expiresAt = Date.now() + 72 * HOUR;
  await invites().doc(c).set({ orgId, role, createdBy: actorUid, expiresAt, uses: 0, maxUses: 1 });
  return { code: c, expiresAt };
}

export async function joinWithCode(uid: string, name: string, raw: string): Promise<Org> {
  const c = normalizeCode(raw);
  if (!isCode(c)) throw fail("That invite code is not valid.");
  const ref = invites().doc(c);
  const inv = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.data() as { orgId: string; role: Role; expiresAt: number; uses: number; maxUses: number } | undefined;
    if (!d || d.expiresAt < Date.now() || d.uses >= d.maxUses) return null;
    tx.set(ref, { ...d, uses: d.uses + 1 });
    return d;
  });
  if (!inv) throw fail("That invite code is wrong, expired or already used.", 410);
  const org = await update(inv.orgId, (o) => addMember(o, { uid, name, role: inv.role }, Date.now()));
  await addToIndex(uid, org.id);
  return org;
}

export async function changeRole(orgId: string, actorUid: string, targetUid: string, role: Role): Promise<Org> {
  return update(orgId, (o) => {
    const actor = mustMember(o, actorUid), target = o.members[targetUid];
    if (!target) throw fail("That person is not in the workspace.", 404);
    if (!canChangeRole(actor.role, target.role, role)) throw fail("You may not change this role.", 403);
    return setRole(o, targetUid, role);
  });
}
export async function removeMember(orgId: string, actorUid: string, targetUid: string): Promise<Org> {
  const org = await update(orgId, (o) => {
    const actor = mustMember(o, actorUid), target = o.members[targetUid];
    if (!target) throw fail("That person is not in the workspace.", 404);
    if (actorUid !== targetUid && !canRemove(actor.role, target.role)) throw fail("You may not remove this person.", 403);
    if (target.role === "owner") throw fail("The owner cannot leave; delete the workspace instead.", 403);
    return removeMemberFrom(o, targetUid);
  });
  await dropFromIndex(targetUid, orgId);
  return org;
}

/** A member asks for a code, then sends `link <code>` to the Slack bot: that binds the Slack id to their account. */
export async function createLinkCode(orgId: string, uid: string): Promise<{ code: string; expiresAt: number }> {
  const o = await getOrg(orgId);
  if (!o) throw fail("This workspace does not exist.", 404);
  mustMember(o, uid);
  const c = code(), expiresAt = Date.now() + 15 * 60_000;
  await links().doc(c).set({ orgId, uid, expiresAt });
  return { code: c, expiresAt };
}
export async function consumeLinkCode(rawCode: string, slackId: string, expectedOrgId: string): Promise<{ name: string } | null> {
  const ref = links().doc(normalizeCode(rawCode));
  const d = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const v = s.data() as { orgId: string; uid: string; expiresAt: number } | undefined;
    if (!v || v.expiresAt < Date.now() || v.orgId !== expectedOrgId) return null;
    tx.delete(ref); // one time only
    return v;
  });
  if (!d) return null;
  const org = await update(d.orgId, (o) => linkSlack(o, d.uid, slackId));
  return { name: org.members[d.uid]?.name ?? "Member" };
}

/** The workspace whose shared agent is this chat of this owner (used by the Slack route). */
export async function orgForChat(ownerUid: string, chatId: string): Promise<Org | null> {
  const q = await orgs().where("ownerUid", "==", ownerUid).limit(3).get();
  const hit = q.docs.map((d) => d.data() as Org).find((o) => o.chatId === chatId);
  return hit ?? null;
}

export async function deleteOrg(orgId: string, actorUid: string): Promise<void> {
  const o = await getOrg(orgId);
  if (!o) return;
  if (o.ownerUid !== actorUid) throw fail("Only the owner can delete the workspace.", 403);
  for (const uid of Object.keys(o.members)) await dropFromIndex(uid, orgId);
  await orgs().doc(orgId).delete();
}
