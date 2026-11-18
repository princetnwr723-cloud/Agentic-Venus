// Risk classifier: what Automatic mode may approve, what must stop, and why.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyAction, luhn, recipientsOf, riskNote, scanSensitive } from "../../lib/agent/risk.ts";
import { autoDecision } from "../../lib/agent/autopilot.ts";

const ask = (name, summary, args, extra) => classifyAction({ name, summary, args, ...(extra ?? {}) });

test("ordinary actions are approved, with no reasons", () => {
  const r = ask("mail.send", "Send mail to a@b.co about the offer", { to: "a@b.co", body: "Hi, the offer is attached." });
  assert.equal(r.decision, "approve");
  assert.equal(r.level, "medium", "outside recipient is worth a note, not a stop");
  assert.equal(ask("db.write", "Save a row", { row: "payload text" }).decision, "approve", "'payload' is not 'pay'");
  assert.equal(ask("github.push", "Push 2 commits to main", {}).level, "low");
});

test("money, destructive steps and a tainted run always ask", () => {
  assert.equal(ask("shop.checkout", "Place the order").decision, "ask");
  assert.equal(ask("github.delete_repo", "Delete repo x").decision, "ask");
  assert.equal(ask("mail.send", "Tell the client the invoice of $250 is due").decision, "ask");
  assert.equal(ask("mail.send", "Send mail to a@b.c", {}, { tainted: true }).decision, "ask");
});

test("a mail body that merely says 'cancel' does not stop the run", () => {
  const r = ask("mail.send", "Send the meeting notes to team@acme.com", { to: "team@acme.com", body: "If you cannot join please cancel your slot by replying." });
  assert.equal(r.decision, "approve");
});

test("keys, passwords and card numbers never leave on an automatic OK", () => {
  const key = ask("mail.send", "Send mail to a@b.c", { to: "a@b.c", body: "use sk-ant-abcdefghijklmnop12345 for the API" });
  assert.equal(key.decision, "ask");
  assert.match(key.reasons.join(" "), /API key/);
  assert.ok(!JSON.stringify(key).includes("sk-ant-abcdefghijklmnop12345"), "the value itself is never repeated");
  assert.equal(ask("repo.write_file", "Write .env", { path: ".env", content: "password = hunter2hunter2" }).decision, "ask");
  assert.equal(ask("slackbot.send", "Post in Slack", { text: "card 4242 4242 4242 4242 exp 12/30" }).decision, "ask");
  assert.equal(ask("repo.write_file", "Write key", { content: "-----BEGIN RSA PRIVATE KEY-----\nabc" }).decision, "ask");
});

test("confidential text: fine inside, flagged when it goes outside", () => {
  const body = "Internal use only: the salary bands for next year are attached.";
  const outside = ask("mail.send", "Send mail to x@gmail.com", { to: "x@gmail.com", body }, { ownerDomains: ["acme.com"] });
  assert.equal(outside.decision, "ask");
  assert.match(outside.reasons.join(" "), /outside/);
  const inside = ask("mail.send", "Send mail to boss@acme.com", { to: "boss@acme.com", body }, { ownerDomains: ["acme.com"] });
  assert.equal(inside.decision, "approve", "same text, but to an address on the owner's own domain");
  const pub = ask("social.post", "Post to LinkedIn", { text: body });
  assert.equal(pub.decision, "ask", "a public post has no recipient but is still outside");
});

test("sending to very many people at once asks", () => {
  const to = Array.from({ length: 30 }, (_, i) => `u${i}@ext${i}.com`);
  assert.equal(ask("mail.send_many", "Send to 30 people", { to }).decision, "ask");
});

test("scanSensitive: kinds only, no false alarms on plain numbers", () => {
  assert.equal(luhn("4242424242424242"), true);
  assert.equal(luhn("4242424242424241"), false);
  assert.deepEqual(scanSensitive("Order 1234567890123 is shipped, call 98765 43210").map((f) => f.kind), []);
  assert.ok(scanSensitive("PAN ABCDE1234F and Aadhaar 2345 6789 0123").map((f) => f.kind).includes("pan"));
  assert.ok(scanSensitive("my password is: Tr0ub4dor&3x").some((f) => f.kind === "password"));
  assert.ok(scanSensitive("a1@x.com a2@x.com a3@x.com a4@x.com a5@x.com a6@x.com a7@x.com a8@x.com").some((f) => f.kind === "contact-list"));
});

test("recipientsOf reads e-mails and phone numbers from the usual argument names", () => {
  assert.deepEqual(recipientsOf({ summary: "x", args: { to: ["A@B.com"], cc: "c@d.com" } }).sort(), ["a@b.com", "c@d.com"]);
  assert.deepEqual(recipientsOf({ summary: "WhatsApp +91 98765 43210", args: {} }), ["+919876543210"]);
});

test("riskNote and autoDecision agree", () => {
  const args = { to: "a@b.co", body: "token = abcdef123456" };
  assert.match(riskNote({ name: "mail.send", summary: "Send mail", args }), /Check before you approve/);
  assert.equal(riskNote({ name: "db.write", summary: "Save a row" }), "");
  assert.equal(autoDecision("mail.send", "Send mail", false, args), "ask");
});
