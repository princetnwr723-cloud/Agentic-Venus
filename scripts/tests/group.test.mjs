// Group chat rules: mentions, control lines, router safety, loop limits, memory hygiene.
import test from "node:test";
import assert from "node:assert/strict";
import { addItems, canQueue, canWork, fallbackRoute, findMember, itemsFromMentions, looksSecret, mergeLines, needsWrap, nextRunnable, parseMentions, parseReply, parseRoute, transcript, turnOver } from "../../lib/group-core.ts";

const M = [
  { id: "chief", name: "Chief", title: "Chief of staff", tool: "think" },
  { id: "hunter", name: "Hunter", title: "Lead generation", tool: "pc" },
  { id: "quill", name: "Quill", title: "Copywriter", tool: "think" },
  { id: "forge", name: "Forge", title: "Engineer", tool: "code" },
];

test("mentions: real members only, @everyone, emails are not mentions", () => {
  assert.deepEqual(parseMentions("@hunter find leads and @Quill write", M), { ids: ["hunter", "quill"], everyone: false });
  assert.deepEqual(parseMentions("hey @everyone", M), { ids: [], everyone: true });
  assert.deepEqual(parseMentions("mail me at ravi@hunter.com, @nobody", M), { ids: [], everyone: false });
  assert.equal(findMember("HUNTER", M)?.id, "hunter");
});

test("control lines: hand-offs, notes and pins are taken out of the visible text", () => {
  const r = parseReply("Sure, I will check.\nHANDOFF: Hunter | find 20 dentists in Pune\nNOTE: owner sells dental software\nPIN: launch date is 5 Dec", M, "chief");
  assert.equal(r.text, "Sure, I will check.");
  assert.deepEqual(r.handoffs, [{ to: "hunter", task: "find 20 dentists in Pune" }]);
  assert.deepEqual(r.notes, ["owner sells dental software"]);
  assert.deepEqual(r.pins, ["launch date is 5 Dec"]);
  assert.equal(parseReply("HANDOFF: Chief | do it again", M, "chief").handoffs.length, 0, "no hand-off to yourself");
  assert.equal(parseReply("HANDOFF: Ghost | do it", M, "chief").handoffs.length, 0, "no hand-off to a stranger");
  const many = parseReply("HANDOFF: Hunter | one task\nHANDOFF: Quill | two task\nHANDOFF: Forge | three task", M, "chief");
  assert.equal(many.handoffs.length, 2, "at most two hand-offs per reply");
});

test("secrets never become memory", () => {
  for (const s of ["my password is hunter2", "api key: sk-abcdefghijklmnop1234", "card 4111111111111111", "token = abc123", "AKIAABCDEFGHIJKLMNOP"]) assert.ok(looksSecret(s), s);
  assert.ok(!looksSecret("owner prefers short replies"));
  assert.deepEqual(parseReply("NOTE: password is hunter2\nNOTE: likes short replies", M, "chief").notes, ["likes short replies"]);
  assert.deepEqual(mergeLines(["a note one"], ["secret: sk-abcdefghijklmnop1234", "A note one!"], 5), ["a note one"]);
});

test("notes: newest kept, duplicates dropped, capped", () => {
  const old = Array.from({ length: 12 }, (_, i) => `fact number ${i}`);
  const out = mergeLines(old, ["fresh fact"], 12);
  assert.equal(out.length, 12); assert.equal(out[11], "fresh fact"); assert.ok(!out.includes("fact number 0"));
});

test("router answer is made safe", () => {
  const r = parseRoute({ speakers: [{ member: "quill", work: true, task: "write" }, { member: "hunter", work: true, task: "find" }, { member: "ghost", work: false }, { member: "hunter", work: false }] }, M, "hello");
  assert.deepEqual(r.map((x) => [x.member, x.work]), [["quill", false], ["hunter", true]], "writers never get a work run; strangers and repeats are dropped");
  assert.equal(parseRoute(null, M, "hi there")[0].member, "chief");
  assert.equal(parseRoute({ speakers: [] }, M, "scrape the directory")[0].member, "hunter");
  assert.deepEqual(fallbackRoute("hello", []), []);
  assert.ok(canWork("pc") && canWork("research") && !canWork("think") && !canWork("email"));
});

test("@mentions and @everyone become queued items", () => {
  const one = itemsFromMentions("@hunter find 10 leads", M);
  assert.deepEqual(one.map((i) => [i.member, i.kind]), [["hunter", "work"]]);
  const talk = itemsFromMentions("@quill what do you think", M);
  assert.equal(talk[0].kind, "chat");
  const all = itemsFromMentions("@everyone build a plan", M);
  assert.equal(all.length, 4); assert.ok(all.every((i) => i.kind === "chat"), "a round table is a conversation, not four work runs");
  assert.equal(itemsFromMentions("no mention here", M).length, 0);
});

test("loops stop: depth, size, and per-member limits", () => {
  let items = itemsFromMentions("@chief plan", M);
  assert.ok(canQueue(items, "hunter", 1));
  assert.ok(!canQueue(items, "hunter", 4), "too deep");
  const r1 = addItems(items, [{ member: "hunter", kind: "work", task: "find", depth: 1, by: "chief" }]);
  assert.equal(r1.added, 1);
  let cur = r1.items;
  for (let i = 0; i < 3; i++) cur = addItems(cur, [{ member: "quill", kind: "chat", task: "x", depth: 1, by: "chief" }]).items;
  assert.equal(cur.filter((i) => i.member === "quill").length, 2, "one member speaks at most twice");
  const flood = addItems([], Array.from({ length: 20 }, (_, i) => ({ member: "m" + i, kind: "chat", task: "x", depth: 1, by: "chief" })));
  assert.equal(flood.items.length, 8, "a turn never has more than 8 speakers");
});

test("order: chat items speak one after the other, work runs in the background", () => {
  const items = [
    { n: 0, member: "chief", kind: "chat", task: "a", depth: 0, by: "you", status: "running" },
    { n: 1, member: "quill", kind: "chat", task: "b", depth: 0, by: "you", status: "queued" },
  ];
  assert.equal(nextRunnable(items), null, "must wait for the chat reply that is being written");
  items[0].status = "done";
  assert.equal(nextRunnable(items)?.member, "quill");
  const withWork = [{ n: 0, member: "hunter", kind: "work", task: "a", depth: 0, by: "you", status: "running" }, { n: 1, member: "quill", kind: "chat", task: "b", depth: 0, by: "you", status: "queued" }];
  assert.equal(nextRunnable(withWork)?.member, "quill", "a long work run does not block the conversation");
  assert.ok(!turnOver(withWork)); withWork[0].status = "done"; withWork[1].status = "skipped"; assert.ok(turnOver(withWork));
});

test("wrap-up only when it adds something", () => {
  assert.ok(!needsWrap([{ n: 0, member: "chief", kind: "chat", status: "done" }]));
  assert.ok(needsWrap([{ n: 0, member: "chief", kind: "chat", status: "done" }, { n: 1, member: "quill", kind: "chat", status: "done" }]));
  assert.ok(needsWrap([{ n: 0, member: "hunter", kind: "work", status: "done" }]));
});

test("transcript names speakers and drops notes", () => {
  const t = transcript([{ id: "1", at: 1, from: "you", text: "hi", kind: "say" }, { id: "2", at: 2, from: "hunter", text: "on it", kind: "say" }, { id: "3", at: 3, from: "system", text: "started", kind: "note" }], M);
  assert.equal(t, "Owner: hi\nHunter: on it");
});

test("an ordinary 'Note:' sentence stays in the text", () => {
  const r = parseReply("Note: the site is down today.\nNOTE: owner is in IST timezone", M, "chief");
  assert.equal(r.text, "Note: the site is down today.");
  assert.deepEqual(r.notes, ["owner is in IST timezone"]);
});