import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeKeywords, runTask, anthropicJudge } from '../eval-run.mjs';

const task = { id: 'lead_research-01', prompt: 'Find 10 dentists', rubric: ['CSV', 'source URL'] };
const reply = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

test('keyword grader needs every rubric line', () => {
  assert.equal(gradeKeywords('CSV below. source URL: https://a.com', task.rubric).success, true);
  assert.equal(gradeKeywords('only a CSV', task.rubric).success, false);
  assert.equal(gradeKeywords('', task.rubric).success, false);
});

test('runTask records success, cost and duration', async () => {
  const r = await runTask(task, { endpoint: 'http://x', fetchImpl: reply({ output: 'CSV with source URL', costUsd: 0.02 }) });
  assert.equal(r.success, true);
  assert.equal(r.costUsd, 0.02);
  assert.ok(r.durationMs >= 0);
});

test('endpoint errors and network errors are failures, not crashes', async () => {
  assert.equal((await runTask(task, { endpoint: 'http://x', fetchImpl: reply({}, false, 500) })).success, false);
  const boom = async () => { throw new Error('offline'); };
  const r = await runTask(task, { endpoint: 'http://x', fetchImpl: boom });
  assert.equal(r.success, false);
  assert.match(r.notes, /offline/);
});

test('judge fails closed when its answer is malformed', async () => {
  const judge = anthropicJudge({ key: 'k', model: 'm', fetchImpl: reply({ content: [{ text: 'not json' }] }) });
  assert.equal((await judge(task, 'anything')).success, false);
  const good = anthropicJudge({ key: 'k', model: 'm', fetchImpl: reply({ content: [{ text: '{"results":[true,true]}' }] }) });
  assert.equal((await good(task, 'anything')).success, true);
  const short = anthropicJudge({ key: 'k', model: 'm', fetchImpl: reply({ content: [{ text: '{"results":[true]}' }] }) });
  assert.equal((await short(task, 'anything')).success, false);
});
