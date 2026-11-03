import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPin, isPin, lockAfterFail, matchOption, parseCommand, pinProblem, verifyPin } from '../../lib/channel-commands.ts';

test('parses slash commands, also with a Telegram @botname', () => {
  assert.deepEqual(parseCommand('/jobs'), { kind: 'jobs' });
  assert.deepEqual(parseCommand('/status@MyBot p123'), { kind: 'status', id: 'p123' });
  assert.deepEqual(parseCommand('/stop'), { kind: 'stop', id: undefined });
  assert.deepEqual(parseCommand('/skip'), { kind: 'skip' });
  assert.deepEqual(parseCommand('/start'), { kind: 'help' });
});

test('plain words are never commands, so normal chat is not hijacked', () => {
  for (const w of ['stop', 'status', 'jobs', 'approve', 'yes', 'deny', 'hello there']) assert.equal(parseCommand(w).kind, 'text', w);
});

test('approve and deny need an id; the PIN is optional', () => {
  assert.deepEqual(parseCommand('approve pay1abc 4827'), { kind: 'approve', id: 'pay1abc', pin: '4827' });
  assert.deepEqual(parseCommand('/approve pay1abc'), { kind: 'approve', id: 'pay1abc', pin: undefined });
  assert.deepEqual(parseCommand('deny pay1abc'), { kind: 'deny', id: 'pay1abc' });
});

test('Telegram button presses arrive as @cb text', () => {
  assert.deepEqual(parseCommand('@cb ap:payxyz'), { kind: 'callback', action: 'ap', value: 'payxyz' });
  assert.deepEqual(parseCommand('@cb an:2'), { kind: 'callback', action: 'an', value: '2' });
  assert.deepEqual(parseCommand('@cb sk'), { kind: 'callback', action: 'sk', value: '' });
});

test('PIN rules reject weak PINs', () => {
  for (const p of ['1111', '1234', '4321', '12', 'abcd', '123456789']) assert.notEqual(pinProblem(p), null, p);
  for (const p of ['4827', '905173']) assert.equal(pinProblem(p), null, p);
  assert.equal(isPin('4827'), true);
  assert.equal(isPin('48 27'), false);
});

test('PIN hash verifies only the right PIN', () => {
  const { salt, hash } = hashPin('4827', 'pep');
  assert.equal(verifyPin('4827', salt, hash, 'pep'), true);
  assert.equal(verifyPin('4828', salt, hash, 'pep'), false);
  assert.equal(verifyPin('4827', salt, hash, 'other'), false);
  assert.equal(verifyPin('4827', salt, 'zz', 'pep'), false);
});

test('five wrong PINs lock payments', () => {
  let s = { fails: 0, lockedUntil: 0 };
  for (let i = 0; i < 4; i++) { s = lockAfterFail(s.fails, 1000); assert.equal(s.lockedUntil, 0); }
  s = lockAfterFail(s.fails, 1000);
  assert.ok(s.lockedUntil > 1000);
});

test('options can be picked by number or by text', () => {
  const o = ['Approve', 'Cancel'];
  assert.equal(matchOption('1', o), 'Approve');
  assert.equal(matchOption('cancel', o), 'Cancel');
  assert.equal(matchOption('app', o), 'Approve');
  assert.equal(matchOption('3', o), null);
  assert.equal(matchOption('maybe', o), null);
});