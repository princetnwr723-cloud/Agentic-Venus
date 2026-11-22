import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGoal, pulseDue, nextPulseTime, computePace, buildPulseGoalText, parseUpdate, jsonAfter, applyUpdate,
  settlePulseResult, failPulse, patchGoal, needsVerification, verifyInput, parseQuiet, parseDeadline, renderGoal, renderList, pushLog, emptyUpdate,
} from '../../lib/goals-core.ts';

const T0 = Date.parse('2026-11-22T06:00:00Z'); // 11:30 in India
const DAY = 86_400_000;
const base = (extra = {}) => ({
  title: 'First 20 customers',
  objective: 'Get 20 paying customers for the agent product so the launch pays for itself.',
  success: ['20 paying customers', 'at least 2000 in revenue'],
  ...extra,
});
const make = (extra = {}, now = T0) => {
  const r = newGoal(base(extra), 'chat1', now);
  assert.ok(r.goal, JSON.stringify(r));
  r.goal.id = 'g1';
  return r.goal;
};

test('newGoal: needs a title, an objective and a measurable success line', () => {
  assert.ok(newGoal({ ...base(), title: '' }, 'c', T0).error);
  assert.ok(newGoal({ ...base(), objective: 'short' }, 'c', T0).error);
  assert.match(newGoal({ ...base(), success: [] }, 'c', T0).error, /MEASURABLE/);
  assert.match(newGoal({ ...base(), success: ['ok'] }, 'c', T0).error, /MEASURABLE/);
});

test('newGoal: sane defaults and clamps', () => {
  const g = make();
  assert.equal(g.status, 'active');
  assert.equal(g.cadenceMinutes, 1440);
  assert.equal(g.autonomy, 'ask');
  assert.equal(g.notify, 'smart');
  assert.deepEqual(g.limits, { maxPulsesPerDay: 3, maxPulsesTotal: 60, maxSteps: 40, maxCalls: 0 });
  assert.equal(g.replan, true); // no milestones yet: the first session plans them
  const h = make({ cadence_hours: 0.1, max_steps: 9999, max_calls: -4, max_pulses_per_day: 99, autonomy: 'auto' });
  assert.equal(h.cadenceMinutes, 60);
  assert.equal(h.limits.maxSteps, 120);
  assert.equal(h.limits.maxCalls, 0);
  assert.equal(h.limits.maxPulsesPerDay, 12);
  assert.equal(h.autonomy, 'auto');
});

test('newGoal: given milestones get ids and no replan', () => {
  const g = make({ milestones: ['Build the list', 'Send 50 emails', 'Book 5 calls'] });
  assert.deepEqual(g.milestones.map((m) => m.id), ['m1', 'm2', 'm3']);
  assert.equal(g.replan, false);
});

test('deadline: days, relative text, dates, and refusals', () => {
  assert.equal(parseDeadline({ deadline_days: 10 }, T0, 'UTC').deadline, T0 + 10 * DAY);
  assert.equal(parseDeadline({ deadline: 'in 2 weeks' }, T0, 'UTC').deadline, T0 + 14 * DAY);
  assert.equal(parseDeadline({ deadline: '2026-12-31' }, T0, 'UTC').deadline, Date.parse('2026-12-31T23:59:00Z'));
  assert.deepEqual(parseDeadline({}, T0, 'UTC'), {});
  assert.ok(parseDeadline({ deadline: '2026-11-21' }, T0, 'UTC').error);   // past
  assert.ok(parseDeadline({ deadline: 'someday' }, T0, 'UTC').error);       // unreadable
  assert.ok(parseDeadline({ deadline_days: 5000 }, T0, 'UTC').error);       // too far
});

test('quiet hours text', () => {
  assert.deepEqual(parseQuiet('22:00-07:00'), { start: '22:00', end: '07:00' });
  assert.deepEqual(parseQuiet('9:30 to 11:00'), { start: '09:30', end: '11:00' });
  assert.equal(parseQuiet('25:00-07:00'), undefined);
  assert.equal(parseQuiet('10:00-10:00'), undefined);
  assert.equal(parseQuiet('night'), undefined);
});

test('pace: expected progress against the clock', () => {
  const g = { status: 'active', createdAt: 0, deadline: 100 * DAY, progress: 0 };
  assert.equal(computePace(g, 10 * DAY), 'on_track');                       // expected 10, got 0 -> gap 10
  assert.equal(computePace(g, 25 * DAY), 'at_risk');                        // gap 25
  assert.equal(computePace(g, 60 * DAY), 'behind');                         // gap 60
  assert.equal(computePace({ ...g, progress: 60 }, 60 * DAY), 'on_track');
  assert.equal(computePace({ ...g, deadline: undefined }, 5), 'no_deadline');
  assert.equal(computePace({ ...g, status: 'achieved' }, 5), 'done');
  assert.equal(computePace(g, 101 * DAY), 'behind');
});

test('pulseDue: status, running pulse, time, budgets, quiet hours', () => {
  const g = make();
  assert.equal(pulseDue(g, T0).due, true); // nextPulseAt = creation time
  assert.equal(pulseDue({ ...g, status: 'paused' }, T0).due, false);
  assert.equal(pulseDue({ ...g, status: 'needs_owner' }, T0).due, false);
  assert.equal(pulseDue({ ...g, nextPulseAt: T0 + 1 }, T0).due, false);
  assert.equal(pulseDue({ ...g, nextPulseAt: T0 + 1 }, T0, true).due, true); // the owner asked for it now
  const running = { ...g, pulse: { id: 'p1', missionId: 'm', startedAt: T0 - 60_000, reason: 'x' } };
  assert.equal(pulseDue(running, T0).due, false);
  assert.equal(pulseDue(running, T0, true).due, false);
  const dead = { ...g, pulse: { id: 'p1', missionId: 'm', startedAt: T0 - 50 * 60_000, reason: 'x' } };
  assert.equal(pulseDue(dead, T0).due, true); // a dead pulse does not block the goal forever
  assert.equal(pulseDue({ ...g, pulses: 60 }, T0).due, false);
  assert.equal(pulseDue({ ...g, dayKey: '2026-11-22', dayPulses: 3 }, T0).due, false);
  assert.equal(pulseDue({ ...g, dayKey: '2026-11-21', dayPulses: 3 }, T0).due, true); // yesterday's count is gone
  assert.equal(pulseDue({ ...g, deadline: T0 - 1 }, T0).due, false);
});

test('pulseDue: quiet hours block scheduled pulses but not a close deadline or the owner', () => {
  const g = make({ quiet: '22:00-07:00', tz: 'Asia/Kolkata' });
  const night = Date.parse('2026-11-22T18:00:00Z'); // 23:30 India
  assert.equal(pulseDue({ ...g, nextPulseAt: 0 }, night).why, 'quiet hours');
  assert.equal(pulseDue({ ...g, nextPulseAt: 0 }, night, true).due, true);
  assert.equal(pulseDue({ ...g, nextPulseAt: 0, deadline: night + 6 * 3600_000 }, night).due, true);
});

test('nextPulseTime: cadence, halved when behind or near the deadline, out of quiet hours', () => {
  const g = make({ cadence_hours: 24 });
  assert.equal(nextPulseTime(g, T0), T0 + DAY);
  assert.equal(nextPulseTime({ ...g, pace: 'behind' }, T0), T0 + DAY / 2);
  assert.equal(nextPulseTime({ ...g, deadline: T0 + 2 * DAY }, T0), T0 + DAY / 2);
  const fast = make({ cadence_hours: 1 });
  assert.equal(nextPulseTime({ ...fast, pace: 'behind' }, T0), T0 + 30 * 60_000); // never faster than 30 minutes
  const q = make({ cadence_hours: 5, quiet: '22:00-07:00', tz: 'Asia/Kolkata' });
  const at = Date.parse('2026-11-22T14:00:00Z'); // 19:30 India -> +5h = 00:30 (quiet)
  const next = nextPulseTime(q, at);
  assert.ok(next >= Date.parse('2026-11-22T22:30:00Z'), 'pushed to 04:00 India or later'); // 07:00 India = 01:30Z next day -> 2026-11-23T01:30Z
  assert.ok(next >= Date.parse('2026-11-23T01:30:00Z'));
});

test('pulse text: has the goal, the proof rule, the owner notes, the answer format, and fits the mission limit', () => {
  const g = make({ milestones: ['Build the list', 'Send emails'] });
  g.pulses = 1;
  g.ownerNotes = ['Only target India'];
  g.lessons = ['Cold email before 9am works better'];
  const t = buildPulseGoalText(g, T0, 'scheduled');
  assert.ok(t.length <= 4000);
  for (const part of ['First 20 customers', '20 paying customers', 'm1 [open] Build the list', 'Only target India', 'Cold email before 9am', 'GOAL_UPDATE:', 'proof', 'Never create, change or stop goals']) {
    assert.ok(t.includes(part), `missing: ${part}`);
  }
  const long = make({ objective: 'x'.repeat(700), success: Array.from({ length: 8 }, () => 'y'.repeat(300)) });
  long.ownerNotes = Array.from({ length: 6 }, () => 'z'.repeat(400));
  assert.ok(buildPulseGoalText(long, T0, 'scheduled').length <= 4000);
});

test('jsonAfter: balanced, string aware, takes the last marker', () => {
  assert.equal(jsonAfter('a GOAL_UPDATE:{"a":"}{"} tail', 'GOAL_UPDATE:'), '{"a":"}{"}');
  assert.equal(jsonAfter('GOAL_UPDATE:{"a":1} then GOAL_UPDATE:{"a":2}', 'GOAL_UPDATE:'), '{"a":2}');
  assert.equal(jsonAfter('nothing', 'GOAL_UPDATE:'), '');
  assert.equal(jsonAfter('GOAL_UPDATE:{"a":', 'GOAL_UPDATE:'), '');
});

test('parseUpdate: reads a normal report, repairs trailing commas, rejects garbage', () => {
  const ok = parseUpdate('Found 5 leads.\nGOAL_UPDATE:{"progress":40,"milestones":[{"id":"m1","state":"done","proof":"sheet link"}],"new_milestones":["Call them"],"next_action":"Email them","lesson":"Use short subjects","blockers":[],"needs_owner":"","achieved":false,"evidence":[],"summary":"5 leads found"}]]');
  assert.equal(ok.progress, 40);
  assert.equal(ok.milestones[0].state, 'done');
  assert.deepEqual(ok.newMilestones, ['Call them']);
  assert.equal(ok.nextAction, 'Email them');
  assert.equal(parseUpdate('GOAL_UPDATE:{"progress":5,"blockers":["a",],}').progress, 5);
  assert.equal(parseUpdate('no marker'), null);
  assert.equal(parseUpdate('GOAL_UPDATE:{broken'), null);
  assert.equal(parseUpdate('GOAL_UPDATE:{"progress":900}').progress, 100);
  assert.equal(parseUpdate('GOAL_UPDATE:{"milestones":[{"id":"m1","state":"weird"}]}').milestones[0].state, 'open');
});

test('applyUpdate: a milestone closes only with proof', () => {
  const g = make({ milestones: ['A', 'B'] });
  const u = { ...emptyUpdate(), milestones: [{ id: 'm1', state: 'done', proof: '' }, { id: 'm2', state: 'done', proof: 'https://x.test/p' }], summary: 's' };
  const r = applyUpdate(g, u, T0);
  assert.equal(r.goal.milestones[0].state, 'open');
  assert.equal(r.goal.milestones[1].state, 'done');
  assert.equal(r.rejected.length, 1);
  assert.equal(r.goal.progress, 50);
  assert.equal(r.progressed, true);
  assert.equal(r.done.length, 1);
});

test('applyUpdate: unknown ids are ignored, new milestones are deduplicated and capped', () => {
  const g = make({ milestones: ['A'] });
  const u = { ...emptyUpdate(), milestones: [{ id: 'm99', state: 'done', proof: 'x' }], newMilestones: ['a', 'B', 'B'] };
  const r = applyUpdate(g, u, T0);
  assert.deepEqual(r.goal.milestones.map((m) => m.t), ['A', 'B']);
  assert.equal(r.added, 1);
  const many = make({ milestones: Array.from({ length: 12 }, (_, i) => `step ${i}`) });
  assert.equal(applyUpdate(many, { ...emptyUpdate(), newMilestones: ['one more'] }, T0).goal.milestones.length, 12);
});

test('applyUpdate: progress never reaches 100 without a verified finish', () => {
  const g = make({ milestones: ['A'] });
  const r = applyUpdate(g, { ...emptyUpdate(), milestones: [{ id: 'm1', state: 'done', proof: 'p' }] }, T0);
  assert.equal(r.goal.progress, 95);
});

test('stalls: no progress counts, owner questions do not, two stalls force a replan, progress resets', () => {
  let g = make({ milestones: ['A', 'B'] });
  g = applyUpdate(g, emptyUpdate(), T0).goal;
  assert.equal(g.stalls, 1);
  assert.equal(g.replan, false);
  g = applyUpdate(g, emptyUpdate(), T0).goal;
  assert.equal(g.stalls, 2);
  assert.equal(g.replan, true);
  const asked = applyUpdate(g, { ...emptyUpdate(), needsOwner: 'Which city?' }, T0).goal;
  assert.equal(asked.stalls, 2); // waiting for the owner is not a stall
  const moved = applyUpdate(g, { ...emptyUpdate(), milestones: [{ id: 'm1', state: 'done', proof: 'p' }] }, T0).goal;
  assert.equal(moved.stalls, 0);
  assert.equal(moved.replan, false);
});

test('settle: finish claim without evidence is not accepted and is never sent to the checker', () => {
  const g = make({ milestones: ['A'] });
  const u = { ...emptyUpdate(), achieved: true, summary: 'all done' };
  assert.equal(needsVerification(g, u), false);
  const s = settlePulseResult(g, u, null, T0);
  assert.equal(s.achieved, false);
  assert.equal(s.goal.status, 'active');
  assert.match(s.events.map((e) => e.text).join('|'), /no evidence/);
});

test('settle: a finish claim with evidence goes to the checker; pass = achieved, partial and fail = keep working', () => {
  const g = make({ milestones: ['A'] });
  const u = { ...emptyUpdate(), achieved: true, evidence: ['https://stripe.test/dashboard shows 21 customers'], summary: 'Reached 21 customers', milestones: [{ id: 'm1', state: 'done', proof: 'dashboard' }] };
  assert.equal(needsVerification(g, u), true);
  const input = verifyInput(applyUpdate(g, u, T0).goal, u);
  assert.match(input.task, /20 paying customers/);
  assert.ok(input.evidence.length >= 2);
  const pass = settlePulseResult(g, u, { verdict: 'pass', reason: 'dashboard shows 21' }, T0);
  assert.equal(pass.achieved, true);
  assert.equal(pass.goal.status, 'achieved');
  assert.equal(pass.goal.progress, 100);
  assert.ok(pass.goal.verifiedAt);
  assert.equal(pass.notify, true);
  assert.match(pass.message, /achieved/i);
  for (const verdict of ['partial', 'fail']) {
    const s = settlePulseResult(g, u, { verdict, reason: 'revenue not shown' }, T0);
    assert.equal(s.achieved, false);
    assert.equal(s.goal.status, 'active');
    assert.match(s.goal.nextAction, /revenue not shown/);
    assert.ok(s.goal.progress < 100);
  }
});

test('settle: an owner question parks the goal; three stalls park it too', () => {
  const g = make({ milestones: ['A'] });
  const asked = settlePulseResult(g, { ...emptyUpdate(), needsOwner: 'Do I have your OK to email them?' }, null, T0);
  assert.equal(asked.goal.status, 'needs_owner');
  assert.equal(asked.notify, true);
  assert.match(asked.message, /I need you/);
  assert.equal(asked.goal.pulse, null);
  let cur = g;
  let s;
  for (let i = 0; i < 3; i++) { s = settlePulseResult(cur, null, null, T0); cur = s.goal; }
  assert.equal(cur.status, 'needs_owner');
  assert.match(s.question, /no real progress/);
});

test('settle: smart notifications speak on progress and stay quiet otherwise; quiet and always policies', () => {
  const g = make({ milestones: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] });
  g.pulses = 3;
  const quietRun = settlePulseResult(g, { ...emptyUpdate(), summary: 'checked things' }, null, T0);
  assert.equal(quietRun.notify, false);
  const win = settlePulseResult(g, { ...emptyUpdate(), milestones: [{ id: 'm1', state: 'done', proof: 'p' }] }, null, T0);
  assert.equal(win.notify, true);
  assert.equal(settlePulseResult({ ...g, notify: 'always' }, emptyUpdate(), null, T0).notify, true);
  assert.equal(settlePulseResult({ ...g, notify: 'quiet' }, { ...emptyUpdate(), milestones: [{ id: 'm1', state: 'done', proof: 'p' }] }, null, T0).notify, false);
});

test('settle: next pulse is scheduled and gets faster when the goal falls behind', () => {
  const g = make({ milestones: ['A', 'B'], cadence_hours: 24, deadline_days: 10 });
  const later = T0 + 8 * DAY;
  const s = settlePulseResult({ ...g, pulses: 2 }, emptyUpdate(), null, later);
  assert.equal(s.goal.pace, 'behind');
  assert.ok(s.goal.nextPulseAt - later <= DAY / 2);
});

test('failPulse: a crashed session retries later; three in a row hand the goal to the owner', () => {
  const g = make({ milestones: ['A'] });
  const a = failPulse(g, 'tool timeout', T0);
  assert.equal(a.goal.errors, 1);
  assert.equal(a.goal.status, 'active');
  assert.ok(a.goal.nextPulseAt > T0);
  assert.equal(a.notify, false);
  const c = failPulse(failPulse(a.goal, 'x', T0).goal, 'x', T0);
  assert.equal(c.goal.status, 'needs_owner');
  assert.equal(c.notify, true);
});

test('patchGoal: a note answers a waiting goal and resumes it; closed goals cannot change', () => {
  const g = make({ milestones: ['A'] });
  g.status = 'needs_owner';
  g.blockers = ['Which city?'];
  const r = patchGoal(g, { note: 'Mumbai' }, T0);
  assert.equal(r.resumed, true);
  assert.equal(r.goal.status, 'active');
  assert.deepEqual(r.goal.ownerNotes, ['Mumbai']);
  assert.deepEqual(r.goal.blockers, []);
  assert.equal(r.goal.nextPulseAt, T0);
  assert.ok(patchGoal({ ...g, status: 'achieved' }, { note: 'x' }, T0).error);
  assert.ok(patchGoal(g, {}, T0).error);
});

test('patchGoal: settings change with validation; a paused goal resumes only when asked', () => {
  const g = make({ milestones: ['A'] });
  const r = patchGoal(g, { cadence_hours: 2, autonomy: 'auto', notify: 'quiet', max_pulses_per_day: 5, replan: true }, T0);
  assert.equal(r.goal.cadenceMinutes, 120);
  assert.equal(r.goal.autonomy, 'auto');
  assert.equal(r.goal.notify, 'quiet');
  assert.equal(r.goal.limits.maxPulsesPerDay, 5);
  assert.equal(r.goal.replan, true);
  assert.ok(patchGoal(g, { success: ['x'] }, T0).error);
  const paused = { ...g, status: 'paused' };
  assert.equal(patchGoal(paused, { note: 'hello' }, T0).goal.status, 'paused');
  assert.equal(patchGoal(paused, { resume: true }, T0).goal.status, 'active');
});

test('render: goal card and list show the essentials', () => {
  const g = make({ milestones: ['Build the list'], deadline_days: 20 });
  const card = renderGoal(g, T0);
  for (const s of ['First 20 customers', 'id g1', '[ ] m1 Build the list', 'Success when', 'asks before writing']) assert.ok(card.includes(s), s);
  assert.match(renderList([g], T0), /First 20 customers/);
  assert.match(renderList([], T0), /No goals yet/);
});

test('pushLog keeps the newest 60 entries', () => {
  let log = [];
  for (let i = 0; i < 75; i++) log = pushLog(log, [{ kind: 'pulse', text: `e${i}` }], T0);
  assert.equal(log.length, 60);
  assert.equal(log[59].text, 'e74');
});
