// Proactive engine (pure part): deadlines, proposals, dedupe, quiet hours, chat replies, tool-output parsers.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanSettings, DEFAULT_SETTINGS as D, isQuietHour, parseCalendarEvents, parseDeadline, parseGithubRows, parseGmailRows, parseProposalReply, proposalMessage, signalsToProposals, selectToSend, signalToProposal } from "../../lib/watchers-core.ts";

const IST = 330;
// Wednesday 18 Nov 2026, 10:00 India time
const NOW = Date.UTC(2026, 10, 18, 4, 30);
const HOUR = 3600_000;
const S = { ...D, enabled: true };
const day = (t) => new Date(t + IST * 60_000).toISOString().slice(0, 10);

test("parseDeadline: cues are required, dates are read in the owner's local day", () => {
  assert.equal(parseDeadline("we met on Friday", NOW, IST), null);
  assert.equal(day(parseDeadline("please send it by Friday", NOW, IST)), "2026-11-20");
  assert.equal(day(parseDeadline("due tomorrow", NOW, IST)), "2026-11-19");
  assert.equal(day(parseDeadline("kal tak bhej do", NOW, IST)), "2026-11-19");
  assert.equal(day(parseDeadline("deadline 25 Nov", NOW, IST)), "2026-11-25");
  assert.equal(day(parseDeadline("by Dec 3rd", NOW, IST)), "2026-12-03");
  assert.equal(day(parseDeadline("due 2026-12-01", NOW, IST)), "2026-12-01");
  assert.equal(day(parseDeadline("by 20/11", NOW, IST)), "2026-11-20");
  assert.equal(day(parseDeadline("by 5 Jan", NOW, IST)), "2027-01-05", "a date that already passed this year means next year");
  assert.equal(day(parseDeadline("need it EOD", NOW, IST)), "2026-11-18");
  assert.equal(parseDeadline("by the monitor money wedding", NOW, IST), null, "'mon', 'wed' inside other words are not weekdays");
  // 23:59 local
  assert.equal(new Date(parseDeadline("by tomorrow", NOW, IST) + IST * 60_000).getUTCHours(), 23);
});

test("gmail: a deadline inside the lead time becomes a draft-only proposal, far or vague ones do not", () => {
  const near = signalToProposal({ source: "gmail", id: "m1", from: "Ravi <r@x.com>", title: "Proposal draft", text: "Can you share the proposal by tomorrow?" }, NOW, S);
  assert.ok(near && near.urgency !== "later" && /Reply to/.test(near.title));
  assert.match(near.goal, /DRAFT/); assert.match(near.goal, /Do NOT send/);
  assert.equal(signalToProposal({ source: "gmail", id: "m2", title: "Newsletter", text: "20% off this week" }, NOW, S), null);
  assert.equal(signalToProposal({ source: "gmail", id: "m3", title: "Report", text: "please send by 30 Dec" }, NOW, S), null, "too far ahead");
  assert.ok(signalToProposal({ source: "gmail", id: "m4", title: "Contract", text: "Please confirm asap" }, NOW, S), "urgent request without a date");
});

test("calendar: coming meetings with people get a prep proposal; lone far or past events do not", () => {
  const ev = { source: "calendar", id: "e1", title: "Investor call", when: NOW + 5 * HOUR, attendees: 3 };
  const p = signalToProposal(ev, NOW, S);
  assert.equal(p.urgency, "now"); assert.match(p.title, /Prepare for/);
  assert.equal(signalToProposal({ ...ev, when: NOW + 100 * HOUR }, NOW, S), null);
  assert.equal(signalToProposal({ ...ev, when: NOW - HOUR }, NOW, S), null);
  assert.equal(signalToProposal({ source: "calendar", id: "e2", title: "Lunch", when: NOW + 3 * HOUR, attendees: 1 }, NOW, S), null);
});

test("proposal ids are stable; batches are deduped and sorted by urgency", () => {
  const sigs = [
    { source: "calendar", id: "e1", title: "Team sync", when: NOW + 30 * HOUR, attendees: 4 },
    { source: "gmail", id: "m1", title: "Quote", text: "need it by today", from: "a@b.com" },
    { source: "gmail", id: "m1", title: "Quote", text: "need it by today", from: "a@b.com" },
    { source: "routine", id: "r1", title: "Daily leads", text: "HTTP 401" },
  ];
  const ps = signalsToProposals(sigs, NOW, S);
  assert.equal(ps.length, 3);
  assert.equal(ps[0].source, "gmail", "today's deadline first");
  assert.equal(signalToProposal(sigs[1], NOW + 1000, S).id, ps[0].id, "same signal, same id");
});

test("selectToSend: no repeats (a 'no' is final), daily cap, quiet hours", () => {
  const ps = signalsToProposals([
    { source: "gmail", id: "a", title: "A", text: "by today", from: "x@y.z" },
    { source: "calendar", id: "b", title: "Client demo", when: NOW + 20 * HOUR, attendees: 2 },
    { source: "routine", id: "c", title: "R", text: "failed" },
  ], NOW, S);
  assert.equal(selectToSend(ps, new Set(), 0, NOW, S).length, 3);
  assert.equal(selectToSend(ps, new Set([ps[0].id]), 0, NOW, S).length, 2, "already proposed / dismissed");
  assert.equal(selectToSend(ps, new Set(), 4, NOW, { ...S, dailyCap: 5 }).length, 1, "cap of 5, 4 already sent");
  assert.equal(selectToSend(ps, new Set(), 5, NOW, S).length, 0);
  const night = Date.UTC(2026, 10, 18, 18, 30); // 00:00 IST
  assert.equal(isQuietHour(night, S), true);
  assert.equal(isQuietHour(NOW, S), false);
  assert.deepEqual(selectToSend(ps, new Set(), 0, night, S).map((p) => p.urgency).filter((u) => u !== "now"), [], "at night only urgent ones");
});

test("chat reply parsing and message text", () => {
  assert.deepEqual(parseProposalReply("YES p1a2b3c4"), { id: "p1a2b3c4", approve: true });
  assert.deepEqual(parseProposalReply("nahi p1a2b3c4 please"), { id: "p1a2b3c4", approve: false });
  assert.equal(parseProposalReply("yes"), null);
  assert.equal(parseProposalReply("yes do it"), null);
  const msg = proposalMessage({ id: "p1a2b3c4", title: "Reply to: Quote", why: "A mail has a deadline.", urgency: "now" });
  assert.match(msg, /YES p1a2b3c4/); assert.match(msg, /NO p1a2b3c4/);
});

test("settings are cleaned", () => {
  const s = cleanSettings({ enabled: true, dailyCap: 999, quietStart: -4, sources: ["gmail", "evil"], leadHours: "x" });
  assert.equal(s.enabled, true); assert.equal(s.dailyCap, 20); assert.equal(s.quietStart, 0);
  assert.deepEqual(s.sources, ["gmail"]); assert.equal(s.leadHours, D.leadHours);
  assert.equal(cleanSettings(null).enabled, false, "off unless the owner turns it on");
});

test("tool output parsers", () => {
  const g = parseGmailRows('id=18c · Ravi <r@x.com> · "Quote by Friday" · Wed, 18 Nov 2026\n   Please send the quote.\nid=18d · A · "Hi" · Tue');
  assert.equal(g.length, 2); assert.equal(g[0].title, "Quote by Friday"); assert.match(g[0].text, /quote/);
  const c = parseCalendarEvents({ items: [
    { id: "1", summary: "Demo", start: { dateTime: "2026-11-19T10:00:00+05:30" }, attendees: [{}, {}] },
    { id: "2", summary: "All day", start: { date: "2026-11-19" } },
    { id: "3", status: "cancelled", start: { dateTime: "2026-11-19T10:00:00Z" } },
  ] });
  assert.equal(c.length, 1); assert.equal(c[0].attendees, 2);
  const h = parseGithubRows("#12 Fix login (open) https://github.com/o/r/pull/12\nNo results.", "review requested");
  assert.equal(h.length, 1); assert.equal(h[0].url, "https://github.com/o/r/pull/12");
});
