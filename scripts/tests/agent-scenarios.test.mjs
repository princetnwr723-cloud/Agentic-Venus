// Real-life scenarios, run through the REAL store, slice logic, loop, card rules and takeover rules (see helpers/platform.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { platform, say, use } from "./helpers/platform.mjs";
import { latchActive } from "../../lib/agent/budget.ts";
import { replyFor, ActionError } from "../../lib/agent/actions.ts";

const MIN = 60_000, HOUR = 3600_000;
const allText = (P) => JSON.stringify([P.events, P.chat, [...P.data.values()]]);

// ---------------------------------------------------------------- long tasks
test("LONG TASK: 14 tool rounds of 8 s run over several slices, nothing is repeated, one answer reaches the chat", async () => {
  const script = [];
  for (let i = 0; i < 14; i++) script.push(use(["web.search", { query: `q${i}` }, `t${i}`]));
  script.push(say("All 14 searches done."));
  const P = platform({ script, sliceMs: 40_000 });
  P.toolMs = 8000;
  await P.start("research 14 things");
  const seen = [];
  for (let i = 0; i < 20; i++) { const r = await P.slice(); seen.push(r.status); if (r.status !== "continue") break; }
  assert.equal(seen.at(-1), "done");
  assert.ok(seen.filter((s) => s === "continue").length >= 2, "needed more than one slice: " + seen.join(","));
  assert.deepEqual(P.toolLog.map((t) => t.input.query), Array.from({ length: 14 }, (_, i) => `q${i}`), "every search exactly once, in order");
  assert.equal(P.chat.length, 1);
  assert.equal(P.chat[0].t, "All 14 searches done.");
  const run = await P.run();
  assert.equal(run.status, "done");
  assert.equal(run.result, "All 14 searches done.");
  assert.equal(run.calls, 15);
  assert.ok(run.slices >= 3);
  assert.ok(run.costMicros > 0 && run.usage.inTok === 1500);
  assert.equal((await P.S.dueQueue(P.clock + 10 * HOUR)).length, 0);
  assert.ok(P.notes.some((n) => n.startsWith("Done:")), "a run that took several slices tells the owner when it is done");
  // the model of slice 3 still saw the work of slice 1
  const lastCall = P.calls.at(-1).messages;
  assert.ok(JSON.stringify(lastCall).includes("t0"), "history survived across slices");
});

test("LONG TASK: the context is compacted instead of failing when it grows", async () => {
  const big = "x".repeat(60_000);
  const script = [];
  for (let i = 0; i < 12; i++) script.push(use(["web.search", { query: `q${i}` }, `t${i}`]));
  script.push(say("finished"));
  const P = platform({ script, tools: { "web.search": (i) => ({ ok: true, text: `result for ${i.query} ` + big + i.query }) }, sliceMs: 10 * HOUR, windowTokens: 20_000 });
  await P.start("big research");
  const r = await P.drive(5);
  assert.equal(r.status, "done");
  const run = await P.run();
  assert.ok(P.events.some((e) => e.kind === "compact"), "history was trimmed");
  const biggest = Math.max(...P.calls.map((c) => JSON.stringify(c.messages).length));
  assert.ok(biggest < 12 * 60_000 / 2, "what the model sees stays far below the full history");
});

// ---------------------------------------------------------------- crash and resume
test("CRASH: the server dies inside the 2nd model call; the run continues from the save after tool 1", async () => {
  const P = platform({ script: [use(["web.search", { query: "a" }, "t1"]), use(["web.search", { query: "b" }, "t2"]), say("done after crash")] });
  await P.start();
  P.hangModelAt = 2;
  assert.equal((await P.slice({ owner: "A" })).status, "killed");
  assert.equal(P.toolLog.length, 1, "tool 1 had run and its result was saved");
  P.at(2 * MIN);
  assert.deepEqual(await P.tick(), ["resume"]);
  assert.equal((await P.drive()).status, "done");
  assert.equal(P.toolLog.filter((t) => t.input.query === "a").length, 1, "tool 1 is not run again");
  assert.equal(P.toolLog.filter((t) => t.input.query === "b").length, 1);
  assert.equal(P.chat.length, 1);
});

test("CRASH: a killed slice leaves the lease; after it expires the tick resumes the run and nothing is lost or repeated", async () => {
  const P = platform({ script: [use(["web.search", { query: "a" }, "t1"]), use(["web.search", { query: "b" }, "t2"]), say("finished after the crash")] });
  await P.start();
  P.hangOn = "web.search"; // the process dies while running the first search
  const dead = await P.slice({ owner: "A" });
  assert.equal(dead.status, "killed");
  let run = await P.run();
  assert.equal(run.status, "running");
  // a second worker cannot take it while the lease is valid
  assert.equal((await P.slice({ owner: "B" })).status, "busy");
  // the lease runs out; the tick sees a run that should be running and wakes it
  P.at(2 * MIN);
  assert.deepEqual(await P.tick(), ["resume"]);
  const r = await P.drive();
  assert.equal(r.status, "done");
  assert.equal(P.chat[0].t, "finished after the crash");
  // the read tool that was cut off is simply run again (it is safe to repeat); the second one runs once
  assert.deepEqual(P.toolLog.filter((t) => t.input.query === "b").length, 1);
});

test("CRASH: a WRITE tool that was started when the server died is never run a second time", async () => {
  const P = platform({
    script: [use(["db.write", { row: "invoice-7" }, "w1"]), (req) => say("checked"), say("final")],
    tools: { "db.write": () => ({ ok: true, text: "row written" }) },
  });
  await P.start();
  P.hangOn = "db.write";
  assert.equal((await P.slice({ owner: "A" })).status, "killed");
  P.at(2 * MIN);
  await P.tick();
  const r = await P.drive();
  assert.equal(r.status, "done");
  assert.equal(P.toolLog.filter((t) => t.name === "db.write").length, 1, "the write was started once and never again");
  const toldModel = JSON.stringify(P.calls.at(-1).messages);
  assert.match(toldModel, /may or may not have happened/);
});

test("CRASH: the slice limit stops a run that keeps restarting forever", async () => {
  const P = platform({ script: [] });
  await P.start();
  await P.S.patchRun("u1", "r1", { slices: 500 });
  const r = await P.slice();
  assert.equal(r.status, "error");
  assert.equal((await P.run()).error.code, "too_long");
});

test("TWO WORKERS: a double kick runs the step once", async () => {
  const P = platform({ script: [use(["web.search", { query: "a" }, "t1"]), say("ok")] });
  await P.start();
  const [a, b] = await Promise.all([P.slice({ owner: "A" }), P.slice({ owner: "B" })]);
  assert.deepEqual([a.status, b.status].sort(), ["busy", "done"]);
  assert.equal(P.toolLog.length, 1);
});

// ---------------------------------------------------------------- approval cards
test("APPROVAL: a mail waits for the owner, runs only after Approve, then the run finishes", async () => {
  const P = platform({
    script: [use(["mail.send", { to: "a@b.c", body: "hi" }, "m1"]), say("Mail sent.")],
    tools: { "mail.send": (_i, f) => (f.approved ? { ok: true, text: "sent #42" } : { ok: false, text: "needs approval", needsApproval: { summary: "Send mail to a@b.c" } }) },
  });
  await P.start();
  const r1 = await P.slice();
  assert.equal(r1.status, "paused");
  let run = await P.run();
  assert.equal(run.status, "paused");
  assert.equal(run.pending.kind, "approve_tool");
  assert.match(run.pending.summary, /Send mail/);
  assert.ok(P.notes[0].includes("Approve?"), "the owner is told they are needed");
  assert.equal(P.toolLog.filter((t) => t.approved).length, 0, "nothing was sent yet");
  // while paused, a tick does not wake the run, it only waits for the card to expire
  assert.deepEqual(await P.tick().then((d) => d.filter((x) => x !== "wait")), []);
  assert.equal((await P.slice()).status, "busy", "a paused run is not started again without an answer");
  await P.owner({ reply: "approve" });
  const r2 = await P.drive();
  assert.equal(r2.status, "done");
  assert.equal(P.toolLog.filter((t) => t.name === "mail.send" && t.approved).length, 1);
  assert.equal(P.chat[0].t, "Mail sent.");
  assert.equal((await P.run()).pending, null);
});

test("APPROVAL: Deny means the tool never runs and the model is told", async () => {
  const P = platform({
    script: [use(["mail.send", { to: "a@b.c", body: "hi" }, "m1"]), say("Okay, I did not send it.")],
    tools: { "mail.send": (_i, f) => (f.approved ? { ok: true, text: "sent" } : { ok: false, text: "needs approval", needsApproval: { summary: "Send mail" } }) },
  });
  await P.start();
  await P.slice();
  await P.owner({ reply: "deny", note: "wrong person" });
  assert.equal((await P.drive()).status, "done");
  assert.equal(P.toolLog.filter((t) => t.approved).length, 0);
  assert.match(JSON.stringify(P.calls.at(-1).messages), /declin|refus|not approved|denied/i);
});

test("APPROVAL: nobody answers for 24 hours: the agent is told and finishes instead of hanging forever", async () => {
  const P = platform({
    script: [use(["mail.send", { to: "a@b.c", body: "hi" }, "m1"]), say("No answer came, so I stopped and sent nothing.")],
    tools: { "mail.send": (_i, f) => (f.approved ? { ok: true, text: "sent" } : { ok: false, text: "needs approval", needsApproval: { summary: "Send mail" } }) },
  });
  await P.start();
  await P.slice();
  P.at(23 * HOUR);
  assert.ok(!(await P.tick()).some((d) => d.startsWith("answer")), "not yet");
  P.at(2 * HOUR);
  const did = await P.tick();
  assert.ok(did.includes("answer:timedOut"), did.join());
  assert.equal((await P.drive()).status, "done");
  assert.equal(P.toolLog.filter((t) => t.approved).length, 0);
});

// ---------------------------------------------------------------- ask / secret
test("ASK: the agent asks a question with options, the owner's answer reaches the model", async () => {
  const P = platform({ script: [use(["ask_user", { question: "Which city?", options: ["Delhi", "Pune"] }, "q1"]), say("Booked for Pune.")] });
  await P.start();
  assert.equal((await P.slice()).status, "paused");
  const run = await P.run();
  assert.equal(run.pending.kind, "ask_user");
  assert.deepEqual(run.pending.options, ["Delhi", "Pune"]);
  await P.owner({ reply: "answer", text: "Pune" });
  assert.equal((await P.drive()).status, "done");
  assert.match(JSON.stringify(P.calls.at(-1).messages), /Pune/);
});

test("SECRET: the key goes to the vault; the model, the run, the events and the chat only ever see the reference", async () => {
  const SECRET = "sk-live-SUPER-SECRET-123";
  const P = platform({ script: [use(["request_secret", { name: "Stripe Key!", reason: "to create the invoice" }, "s1"]), say("Invoice created using the saved key.")] });
  await P.start();
  assert.equal((await P.slice()).status, "paused");
  const run = await P.run();
  assert.equal(run.pending.kind, "request_secret");
  assert.equal(run.pending.secretName, "stripe_key");
  const ans = await P.owner({ reply: "secret", value: SECRET });
  assert.equal(P.vault.get(ans.secret.name), SECRET, "stored in the vault");
  assert.match(ans.secret.name, /^agent\.c1\.stripe_key$/);
  assert.equal((await P.drive()).status, "done");
  assert.ok(!allText(P).includes(SECRET), "the secret appears nowhere except the vault");
  assert.match(JSON.stringify(P.calls.at(-1).messages), /vault:agent\.c1\.stripe_key/);
});

test("SECRET: an empty value and a refusal are handled", () => {
  const card = { id: "p", kind: "request_secret", toolUseId: "t", name: "request_secret", summary: "s", secretName: "k", createdAt: 0, expiresAt: 1 };
  assert.throws(() => replyFor(card, { reply: "secret", value: "" }, "c1"), (e) => e instanceof ActionError && e.status === 400);
  assert.deepEqual(replyFor(card, { reply: "deny" }, "c1").reply, { action: "deny" });
});

test("CARD RULES: every card kind maps the owner's tap to the right reply", () => {
  const mk = (kind, extra = {}) => ({ id: "p", kind, toolUseId: "t", name: "n", summary: "s", createdAt: 0, expiresAt: 1, ...extra });
  assert.deepEqual(replyFor(mk("approve_tool"), { reply: "approve" }, "c").reply, { action: "approve" });
  assert.deepEqual(replyFor(mk("request_approval"), { reply: "deny", note: "n".repeat(500) }, "c").reply.note.length, 300);
  assert.deepEqual(replyFor(mk("ask_user"), { reply: "answer", text: "a".repeat(9000) }, "c").reply.text.length, 4000);
  assert.deepEqual(replyFor(mk("ask_user"), { reply: "whatever" }, "c").reply, { action: "deny" });
  assert.equal(replyFor(mk("request_takeover"), { reply: "deny" }, "c").declineTakeover, true);
});

// ---------------------------------------------------------------- takeover
test("TAKEOVER: owner takes the screen, hands it back, the agent continues and is told how long", async () => {
  const P = platform({ script: [use(["request_takeover", { reason: "solve the captcha" }, "k1"]), say("Logged in after your help.")] });
  await P.start();
  assert.equal((await P.slice()).status, "paused");
  let run = await P.run();
  assert.equal(run.takeover.status, "requested");
  P.at(5000);
  const t = await P.takeoverStart();
  assert.equal(t.status, "active");
  for (let i = 0; i < 6; i++) { P.at(20_000); await P.takeoverBeat(); }
  assert.deepEqual(await P.tick().then((d) => d.filter((x) => x !== "wait")), [], "alive: the scheduler leaves it alone");
  assert.equal((await P.slice()).status, "busy", "a paused run is not started again without an answer");
  await P.takeoverHandBack("captcha done");
  assert.equal((await P.drive()).status, "done");
  assert.equal(P.chat[0].t, "Logged in after your help.");
  assert.match(JSON.stringify(P.calls.at(-1).messages), /captcha done/);
  run = await P.run();
  assert.equal(run.takeover, null);
});

test("TAKEOVER: the owner closes the tab (no heartbeat): after 90 s the screen goes back to the agent by itself", async () => {
  const P = platform({ script: [use(["request_takeover", { reason: "2-step login" }, "k1"]), say("Continuing without you.")] });
  await P.start();
  await P.slice();
  await P.takeoverStart();
  P.at(60_000);
  assert.ok(!(await P.tick()).some((d) => d.startsWith("answer")), "60 s of silence is still fine");
  P.at(40_000);
  assert.ok((await P.tick()).includes("answer:handedBack"));
  assert.equal((await P.drive()).status, "done");
  assert.match(JSON.stringify(P.calls.at(-1).messages), /stopped responding|handed back/i);
});

test("TAKEOVER: even with heartbeats it ends after 15 minutes", async () => {
  const P = platform({ script: [use(["request_takeover", { reason: "payment page" }, "k1"]), say("Took too long, moving on.")] });
  await P.start();
  await P.slice();
  await P.takeoverStart();
  for (let i = 0; i < 44; i++) { P.at(20_000); await P.takeoverBeat(); }
  assert.ok(!(await P.tick()).some((d) => d.startsWith("answer")), "14m40s: still allowed");
  P.at(30_000); await P.takeoverBeat();
  assert.ok((await P.tick()).includes("answer:handedBack"));
  assert.equal((await P.drive()).status, "done");
  assert.match(JSON.stringify(P.calls.at(-1).messages), /15 minute/);
});

test("TAKEOVER: declining sends the agent on without the screen", async () => {
  const P = platform({ script: [use(["request_takeover", { reason: "captcha" }, "k1"]), say("Understood, I will skip that site.")] });
  await P.start();
  await P.slice();
  await P.owner({ reply: "deny" });
  assert.equal((await P.drive()).status, "done");
  assert.match(JSON.stringify(P.calls.at(-1).messages), /declin|refus|denied|no/i);
});

// ---------------------------------------------------------------- budget
test("BUDGET: plan used up -> the run waits (does not fail), the latch is armed, it resumes by itself when the limit resets", async () => {
  const resetAt = 1_700_000_000_000 + 3 * HOUR;
  const P = platform({ script: [say("finished once the limit reset")] });
  await P.start();
  const err = Object.assign(new Error("Plan token limit reached"), { code: "plan_limit", resetAt });
  const first = await P.slice({ reserve: async () => { throw err; } });
  assert.equal(first.status, "budget");
  assert.equal((await P.run()).status, "budget");
  assert.ok(latchActive(await P.S.readLatch("u1"), P.clock), "latch armed");
  // another run for the same owner is held at once, without calling the model
  P.runId = "r2"; await P.start("second task");
  assert.equal((await P.slice()).status, "budget");
  assert.equal(P.calls.length, 0, "no model call while latched");
  // tick before the reset: both just wait
  P.runId = "r1";
  P.at(HOUR);
  assert.ok((await P.tick()).every((d) => d === "wait" || d === "resume"));
  // after the reset the latch is over: the tick puts the runs back in the queue and they finish
  P.at(3 * HOUR);
  const did = await P.tick();
  assert.ok(did.includes("requeue"), did.join());
  P.runId = "r1";
  assert.equal((await P.drive()).status, "done");
  assert.equal(P.chat[0].t, "finished once the limit reset");
});

test("BUDGET: the owner's routines are skipped, not failed, while the latch is on (the check the routine runner uses)", async () => {
  const P = platform();
  await P.S.armLatch("u1", { kind: "plan", until: P.clock + HOUR, reason: "Plan limit", at: P.clock });
  assert.equal(latchActive(await P.S.readLatch("u1"), P.clock), true);
  assert.equal(latchActive(await P.S.readLatch("u1"), P.clock + 2 * HOUR), false);
  await P.S.clearLatch("u1");
  assert.equal(latchActive(await P.S.readLatch("u1"), P.clock), false);
});

test("BUDGET: the per-run cost cap stops a runaway; every Continue grants one more allowance and the run really goes on", async () => {
  const script = Array.from({ length: 8 }, (_, i) => use(["web.search", { query: `q${i}` }, `t${i}`])).concat([say("done at last")]);
  const P = platform({ script, capBase: 2_500 }); // about two model calls per allowance
  await P.start();
  let r = await P.drive();
  assert.equal(r.status, "budget");
  let run = await P.run();
  assert.equal(run.error.code, "cost");
  assert.equal(latchActive(await P.S.readLatch("u1"), P.clock), false, "a cost cap is about THIS run, it does not block the owner's other work");
  let continues = 0, lastCalls = run.calls;
  while (run.status === "budget" && continues < 10) {
    // what the Continue button does in /api/agent
    await P.S.patchRun("u1", "r1", { status: "queued", error: null, stopRequested: false, costExtra: (run.costExtra ?? 0) + 1 });
    r = await P.drive();
    run = await P.run();
    assert.ok(run.calls > lastCalls, "each Continue makes progress (without the fix it stopped again at once)");
    lastCalls = run.calls; continues++;
  }
  assert.equal(run.status, "done");
  assert.ok(continues >= 2);
  assert.equal(P.chat[0].t, "done at last");
});

test("STOP: the owner presses Stop while it works: it ends at the next step with nothing half done", async () => {
  const script = Array.from({ length: 10 }, (_, i) => use(["web.search", { query: `q${i}` }, `t${i}`])).concat([say("never")]);
  const P = platform({ script, tools: {} });
  await P.start();
  let n = 0;
  const orig = P.queue.shift.bind(P.queue);
  P.queue.shift = () => { if (++n === 3) P.S.patchRun("u1", "r1", { stopRequested: true }); return orig(); };
  P.at(0);
  const r = await P.slice();
  await new Promise((r) => setTimeout(r, 30));
  const again = r.status === "stopped" ? r : await P.slice();
  assert.equal(again.status, "stopped");
  assert.equal((await P.run()).status, "stopped");
  assert.equal(P.chat.length, 0);
  assert.ok(P.toolLog.length < 10);
});
