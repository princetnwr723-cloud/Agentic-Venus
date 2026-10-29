import test from 'node:test';
import assert from 'node:assert/strict';
import { fromPlan, fromTeamRun, summarize, isRelevant, retryText, noteStatus, planStepState, fmtDur } from '../../lib/steps.ts';

const NOW = 1_700_000_000_000;

test('notes decide failed / skipped / done', () => {
  assert.equal(noteStatus('failed: login blocked'), 'failed');
  assert.equal(noteStatus('Skipped - not needed'), 'skipped');
  assert.equal(noteStatus('tool showed 12 rows'), 'done');
  assert.equal(noteStatus(undefined), 'done');
});

test('old plan steps (no status field) still read correctly', () => {
  assert.equal(planStepState({ t: 'a', done: false }), 'open');
  assert.equal(planStepState({ t: 'a', done: true }), 'done');
  assert.equal(planStepState({ t: 'a', done: true, note: 'skipped: no need' }), 'skipped');
});

test('agent plan: first open step is active, the rest pending', () => {
  const v = fromPlan({ steps: [{ t: 'one', done: true, s: 'done', st: 1000, at: 4000 }, { t: 'two', done: false }, { t: 'three', done: false }], updatedAt: NOW }, NOW);
  assert.deepEqual(v.steps.map((x) => x.status), ['done', 'active', 'pending']);
  const s = summarize(v, true);
  assert.equal(s.state, 'running');
  assert.equal(s.current, 2);
  assert.equal(s.pct, 33);
  assert.equal(summarize(v, false).state, 'paused');
});

test('agent plan: a failed step shows where it broke', () => {
  const v = fromPlan({ steps: [{ t: 'a', done: true, s: 'done' }, { t: 'b', done: true, s: 'failed', note: 'failed: site blocked' }, { t: 'c', done: true, s: 'done' }], updatedAt: NOW }, NOW);
  const s = summarize(v);
  assert.equal(s.state, 'partial');
  assert.equal(s.brokeAt.n, 2);
  assert.match(retryText(v, 2), /Step 2/);
  assert.equal(isRelevant(v, s, NOW + 3600_000), true);
});

test('agent plan: all done is finished, then hidden after a while', () => {
  const v = fromPlan({ steps: [{ t: 'a', done: true, s: 'done' }], updatedAt: NOW }, NOW);
  const s = summarize(v);
  assert.equal(s.state, 'done');
  assert.equal(isRelevant(v, s, NOW + 60_000), true);
  assert.equal(isRelevant(v, s, NOW + 40 * 60_000), false);
});

test('empty and very old plans show nothing', () => {
  assert.equal(fromPlan({ steps: [], updatedAt: NOW }, NOW), null);
  assert.equal(fromPlan(null, NOW), null);
  assert.equal(fromPlan({ steps: [{ t: 'a', done: false }], updatedAt: NOW - 4 * 86_400_000 }, NOW), null);
});

const run = (status, steps, updatedAt = NOW) => ({ id: 'r1', goal: 'Find leads and email them', status, steps, startedAt: NOW - 1000, updatedAt });
const ts = (i, status, extra = {}) => ({ i, member: 'hunter', name: 'Hunter', task: `task ${i + 1}`, after: i ? [i - 1] : [], status, ...extra });

test('team run: live steps, parallel running and queued', () => {
  const v = fromTeamRun(run('running', [ts(0, 'done'), ts(1, 'running'), ts(2, 'queued')]), NOW);
  assert.deepEqual(v.steps.map((x) => x.status), ['done', 'active', 'pending']);
  const s = summarize(v);
  assert.equal(s.state, 'running');
  assert.equal(s.current, 2);
});

test('team run: failed step and skipped dependants', () => {
  const v = fromTeamRun(run('partial', [ts(0, 'done'), ts(1, 'failed', { note: 'login needed' }), ts(2, 'skipped', { note: 'earlier step failed' })]), NOW);
  const s = summarize(v);
  assert.equal(s.state, 'partial');
  assert.equal(s.brokeAt.n, 2);
  assert.match(retryText(v, 2), /Sirf yahan se/);
});

test('team run that stopped writing is shown as broken, not as running forever', () => {
  const v = fromTeamRun(run('running', [ts(0, 'done'), ts(1, 'running')], NOW - 30 * 60_000), NOW);
  assert.equal(v.stale, true);
  const s = summarize(v);
  assert.equal(s.state, 'broken');
  assert.equal(s.brokeAt.n, 2);
});

test('team run still planning (no steps yet) shows nothing', () => {
  assert.equal(fromTeamRun(run('planning', []), NOW), null);
});

test('durations read well', () => {
  assert.equal(fmtDur(400), '');
  assert.equal(fmtDur(9000), '9s');
  assert.equal(fmtDur(75_000), '1m 15s');
});
