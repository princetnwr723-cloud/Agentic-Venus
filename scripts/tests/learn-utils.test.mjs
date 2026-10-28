import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, looksSecret, nextSkillState, parseJsonLoose, sanitizeFiles, stepCountOf, validateSkillPath } from '../../lib/learn-utils.ts';

test('secrets are recognised, normal facts are not', () => {
  for (const t of ['my password is hunter2', 'token: abc123', 'card 4111 1111 1111 1111', 'sk-abcdef1234567890abcd', 'Authorization: Bearer abcdefghijklmnopqrstuv']) assert.equal(looksSecret(t), true, t);
  for (const t of ['Owner runs a dental clinic in Delhi', 'call me on +91 98765 43210', 'Prefers short answers in Hinglish']) assert.equal(looksSecret(t), false, t);
});

test('tolerant JSON: prose, code fences and trailing commas', () => {
  assert.deepEqual(parseJsonLoose('Sure!\n```json\n{"a":[1,2,],"b":"}"}\n```'), { a: [1, 2], b: '}' });
  assert.equal(parseJsonLoose('no json here'), null);
  assert.equal(parseJsonLoose('{"a": '), null);
});

test('patch: exact, unique, replace-all and whitespace-tolerant', () => {
  assert.deepEqual(applyPatch('one two three', 'two', '2'), { ok: true, text: 'one 2 three', count: 1 });
  assert.equal(applyPatch('x x', 'x', 'y').ok, false);
  assert.deepEqual(applyPatch('x x', 'x', 'y', true), { ok: true, text: 'y y', count: 2 });
  assert.equal(applyPatch('a b  c\nd', 'b c d', 'X').text, 'a X');
  assert.equal(applyPatch('abc', 'zz', 'y').ok, false);
  assert.equal(applyPatch('abc', '  ', 'y').ok, false);
});

test('skill file paths are locked to a few folders and safe names', () => {
  assert.equal(validateSkillPath('references/guide.md'), 'references/guide.md');
  assert.equal(validateSkillPath('./scripts/run.py'), 'scripts/run.py');
  for (const bad of ['../x.md', 'references/../../x.md', 'foo.md', 'references/a.exe', 'references/', '/etc/passwd']) assert.equal(validateSkillPath(bad), null, bad);
  const r = sanitizeFiles({ 'references/a.md': 'hi', '../x.md': 'no', 'scripts/b.py': '' });
  assert.deepEqual(Object.keys(r.files), ['references/a.md']);
  assert.equal(r.errors.length, 2);
});

test('skill track record: 2 wins proves a trial skill, 3 fails pauses it, partial changes nothing', () => {
  assert.deepEqual(nextSkillState({ wins: 1, fails: 0, trial: true, disabled: false }, 'pass'), { next: { wins: 2, fails: 0, trial: false, disabled: false }, event: 'proven' });
  assert.equal(nextSkillState({ wins: 0, fails: 2, trial: false, disabled: false }, 'fail').event, 'paused');
  const p = nextSkillState({ wins: 1, fails: 1, trial: true, disabled: false }, 'partial');
  assert.deepEqual(p.next, { wins: 1, fails: 1, trial: true, disabled: false });
  assert.equal(p.event, null);
});

test('step count: explicit number wins, else non-empty lines', () => {
  assert.equal(stepCountOf('a\n\nb\nc'), 3);
  assert.equal(stepCountOf('a\nb', 9), 9);
  assert.equal(stepCountOf(undefined), 0);
});
