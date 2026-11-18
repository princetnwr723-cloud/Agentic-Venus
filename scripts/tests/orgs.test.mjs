// Shared workspaces: roles, who can change what, codes, Slack identities.
import test from "node:test";
import assert from "node:assert/strict";
import { actorFromSlack, actorNote, addMember, can, canChangeRole, canRemove, codeFromBytes, isCode, linkSlack, mayApprove, normalizeCode, parseLinkCommand, publicView, removeMemberFrom, setRole, stripMention } from "../../lib/orgs-core.ts";

const base = () => ({ id: "o1", name: "Acme", ownerUid: "u0", chatId: "c1", createdAt: 1, slackIds: {}, members: { u0: { uid: "u0", name: "Owner", role: "owner", joinedAt: 1 } } });

test("permission matrix", () => {
  assert.equal(can("viewer", "use_agent"), true);
  assert.equal(can("viewer", "write_tools"), false);
  assert.equal(can("member", "approve_write"), true);
  assert.equal(can("member", "approve_risky"), false, "money / secrets need an admin or the owner");
  assert.equal(can("admin", "approve_risky"), true);
  assert.equal(can("admin", "manage_connectors"), false, "logins stay with the owner");
  assert.equal(can("owner", "manage_connectors"), true);
  assert.equal(can(undefined, "use_agent"), false);
  assert.equal(mayApprove("member", true), false); assert.equal(mayApprove("member", false), true);
});

test("role changes: one owner; admins cannot touch admins", () => {
  assert.equal(canChangeRole("owner", "member", "admin"), true);
  assert.equal(canChangeRole("owner", "member", "owner"), false);
  assert.equal(canChangeRole("owner", "owner", "member"), false);
  assert.equal(canChangeRole("admin", "member", "viewer"), true);
  assert.equal(canChangeRole("admin", "member", "admin"), false);
  assert.equal(canChangeRole("admin", "admin", "member"), false);
  assert.equal(canChangeRole("member", "viewer", "member"), false);
  assert.equal(canRemove("admin", "member"), true); assert.equal(canRemove("admin", "admin"), false);
  assert.equal(canRemove("owner", "owner"), false);
});

test("codes: no look-alike characters, only valid codes pass", () => {
  const c = codeFromBytes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 10);
  assert.equal(c.length, 10); assert.ok(isCode(c)); assert.ok(!/[01OIl]/.test(c));
  assert.equal(isCode("short"), false); assert.equal(normalizeCode("abcd-2345 67"), "ABCD234567");
  assert.equal(parseLinkCommand("link abcd234567"), "ABCD234567");
  assert.equal(parseLinkCommand("/link ABCD-23456"), "ABCD23456".length >= 8 ? "ABCD23456" : null);
  assert.equal(parseLinkCommand("link me please"), null);
  assert.equal(stripMention("<@U0BOT123> what is due today?"), "what is due today?");
});

test("members and Slack identities", () => {
  let o = addMember(base(), { uid: "u1", name: "Priya", role: "member" }, 5);
  o = addMember(o, { uid: "u2", name: "Raj", role: "viewer" }, 6);
  assert.equal(addMember(o, { uid: "u1", name: "X", role: "admin" }, 9).members.u1.role, "member", "joining twice does not change the role");
  assert.equal(addMember(base(), { uid: "u9", name: "Mallory", role: "owner" }, 1).members.u9.role, "member", "nobody joins as owner");
  o = linkSlack(o, "u1", "U111AAA");
  o = linkSlack(o, "u2", "U222BBB");
  assert.deepEqual(actorFromSlack(o, "U111AAA", "UOWNER1"), { uid: "u1", name: "Priya", role: "member" });
  assert.equal(actorFromSlack(o, "UOWNER1", "UOWNER1").role, "owner");
  assert.equal(actorFromSlack(o, "U999ZZZ", "UOWNER1"), null, "strangers are not served");
  o = linkSlack(o, "u1", "U333CCC");
  assert.equal(actorFromSlack(o, "U111AAA", "UOWNER1"), null, "a new link replaces the old one");
  const stolen = linkSlack(o, "u2", "U333CCC");
  assert.equal(stolen.slackIds.U333CCC, "u2"); assert.equal(Object.values(stolen.slackIds).filter((x) => x === "u1").length, 0, "one Slack id, one person");
  o = setRole(o, "u1", "admin"); assert.equal(o.members.u1.role, "admin");
  o = removeMemberFrom(o, "u1"); assert.equal(o.members.u1, undefined); assert.equal(Object.values(o.slackIds).includes("u1"), false);
  assert.equal(removeMemberFrom(o, "u0").members.u0.role, "owner", "the owner cannot be removed");
  assert.equal(linkSlack(o, "u2", "not-a-slack-id").slackIds.not, undefined);
});

test("public view hides internals; viewer note forbids actions", () => {
  const o = linkSlack(addMember(base(), { uid: "u1", name: "Priya", role: "member" }, 5), "u1", "U111AAA");
  const v = publicView(o);
  assert.deepEqual(v.members.map((m) => m.role), ["owner", "member"]);
  assert.equal(v.members[1].slackLinked, true);
  assert.ok(!JSON.stringify(v).includes("U111AAA"), "Slack ids are not sent to the browser");
  assert.match(actorNote({ name: "Raj", role: "viewer" }, "Acme"), /may only ask questions/);
});
