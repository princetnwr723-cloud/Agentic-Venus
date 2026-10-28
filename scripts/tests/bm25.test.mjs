import test from 'node:test';
import assert from 'node:assert/strict';
import { hybrid, tokens, jaccard } from '../../lib/bm25.ts';

const docs = [
  'Send weekly expense report email to accountant',
  'Cold outreach email follow-ups for leads',
  'Make a landing page design with tailwind',
  'Remotion video captions editing',
];
const top = (q) => hybrid(docs, (d) => d, q)[0]?.doc;

test('Hinglish and English words land on the same tokens', () => {
  assert.ok(tokens('kharcha ka report mail bhejo').includes('expense'));
  assert.ok(tokens('kharcha ka report mail bhejo').includes('email'));
  assert.ok(tokens('sending invoices').includes('send'));
});

test('hybrid search finds the right document, also with typos and Hinglish', () => {
  assert.equal(top('kharcha report mail bhejo'), docs[0]);
  assert.equal(top('landing pge desing'), docs[2]);
  assert.equal(top('video subtitle'), docs[3]);
});

test('hybrid search returns nothing for unrelated queries (no noise)', () => {
  assert.deepEqual(hybrid(docs, (d) => d, 'weather in paris'), []);
  assert.deepEqual(hybrid(docs, (d) => d, ''), []);
});

test('jaccard: same words = 1, unrelated = 0', () => {
  assert.equal(jaccard('Owner runs a dental clinic', 'owner runs dental clinic'), 1);
  assert.equal(jaccard('dental clinic', 'video editing'), 0);
});
