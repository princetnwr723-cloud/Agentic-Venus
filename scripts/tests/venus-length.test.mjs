import test from 'node:test';
import assert from 'node:assert/strict';

// Node 22 strips the types; both modules import types only, so they run as they are.
const L = await import(new URL('../../lib/venus-length.ts', import.meta.url).href);
const S = await import(new URL('../../lib/venus-script.ts', import.meta.url).href);

test('a range of minutes becomes a target in the middle and a ceiling at the upper end', () => {
  const a = L.findLengthPlan('why dubai is rich documentary, 15-20 minute ki banao');
  assert.equal(a.range, true);
  assert.equal(a.min, 900);
  assert.equal(a.max, 1200);
  assert.equal(a.target, 1050);
  const b = L.findLengthPlan('make it 15 se 20 minutes');
  assert.equal(b.max, 1200);
  const c = L.findLengthPlan('a 30 second demo');
  assert.equal(c.target, 30);
  assert.equal(c.range, false);
  assert.equal(L.findLengthPlan('no length here'), null);
});

test('chapter budgets add up exactly to the total', () => {
  for (const total of [60, 300, 1050, 3600]) {
    const out = L.chapterBudgets(total, [30, 45, 60, 20, 75, 50, 40]);
    assert.equal(out.reduce((a, b) => a + b, 0), total);
  }
  assert.deepEqual(L.chapterBudgets(100, []), []);
});

test('a narrated scene is as long as its words need', () => {
  const words = Array.from({ length: 23 }, () => 'word').join(' ');
  const s = L.sceneSecondsFromWords(words, false);
  assert.ok(s >= 10 && s <= 11, String(s));
  const sb = { fps: 30, scenes: [{ type: 'title', seconds: 12, narration: words }, { type: 'kinetic', seconds: 4 }] };
  const fit = L.fitSecondsToWords(sb, false);
  assert.ok(fit.scenes[0].seconds <= 13.1);
  assert.equal(fit.scenes[1].seconds, 4);
});

test('trimSilent only shortens scenes without a voice', () => {
  const sb = { fps: 30, scenes: [{ type: 'custom', seconds: 20, narration: 'spoken words stay as they are in this scene' }, { type: 'kinetic', seconds: 12 }] };
  const before = L.totalSecondsOf(sb);
  const out = L.trimSilent(sb, before - 5);
  assert.equal(out.scenes[0].seconds, 20);
  assert.ok(out.scenes[1].seconds < 12);
});

test('documentaries and music-only videos are told apart', () => {
  assert.ok(L.isDocumentary('Bhai why dubai is rich pe documentary bnao'));
  assert.ok(!L.isDocumentary('neon loop of floating cubes'));
});

test('a documentary from the chat always gets a voice-over; silence has to be asked for', () => {
  const chat = (brief, extra = {}) => S.voiceModeOf({ brief, origin: 'chat', ...extra }, null);
  assert.equal(chat('why dubai is rich documentary demo'), 'on');
  assert.equal(chat('make a video of a sunrise'), 'on');
  assert.equal(chat('documentary about dubai, music only'), 'off');
  assert.equal(chat('make it without voice'), 'off');
  assert.equal(chat('add voiceover please'), 'on');
  assert.equal(S.voiceModeOf({ brief: 'abstract neon loop', origin: 'venus' }, null), 'off');
  assert.equal(S.voiceModeOf({ brief: 'a product ad', origin: 'venus', voiceMode: 'auto' }, null), 'auto');
});
