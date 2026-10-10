import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyResult } from '../../lib/critic.ts';

const never = async () => { throw new Error('the model must not be called'); };
const base = { task: 'Find 10 leads', evidence: [] };

test('short verified list is partial, decided by code without calling the model', async () => {
  const v = await verifyResult(never, { ...base, summary: 'VERIFIED: 7 of 10 requested' });
  assert.equal(v.verdict, 'partial');
});

test('full verified list passes without calling the model', async () => {
  const v = await verifyResult(never, { ...base, summary: 'VERIFIED: 10 of 10 requested' });
  assert.equal(v.verdict, 'pass');
});

test('reviewer verdicts pass, partial and fail are respected', async () => {
  for (const verdict of ['pass', 'partial', 'fail']) {
    const v = await verifyResult(async () => JSON.stringify({ verdict, reason: 'r' }), { ...base, summary: 'done' });
    assert.equal(v.verdict, verdict);
  }
});

test('fail-closed: an unknown verdict value is never a pass', async () => {
  const v = await verifyResult(async () => '{"verdict":"maybe","reason":"x"}', { ...base, summary: 'done' });
  assert.equal(v.verdict, 'partial');
});

test('fail-closed: unusable, malformed or failing reviewer is partial', async () => {
  assert.equal((await verifyResult(async () => 'no json here', { ...base, summary: 'done' })).verdict, 'partial');
  assert.equal((await verifyResult(async () => '{bad json}', { ...base, summary: 'done' })).verdict, 'partial');
  assert.equal((await verifyResult(never, { ...base, summary: 'done' })).verdict, 'partial');
});
