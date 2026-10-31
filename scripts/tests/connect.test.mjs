import test from 'node:test';
import assert from 'node:assert/strict';
import { API_PRESETS, findPreset, apiPayload } from '../../lib/tools/api-presets.ts';
import { brandDomain } from '../../lib/tools/brand.ts';

test('known services are found by name, alias and small spelling differences', () => {
  assert.equal(findPreset('Stripe')?.id, 'stripe');
  assert.equal(findPreset('stripe api')?.id, 'stripe');
  assert.equal(findPreset('Open AI')?.id, 'openai');
  assert.equal(findPreset('claude')?.id, 'anthropic');
  assert.equal(findPreset('my-crm'), undefined);
  assert.equal(findPreset(''), undefined);
});

test('every preset has an https address and a header', () => {
  for (const p of API_PRESETS) {
    assert.ok(p.baseUrl.startsWith('https://'), p.id);
    assert.ok(p.header.length > 0, p.id);
  }
  assert.equal(new Set(API_PRESETS.map((p) => p.id)).size, API_PRESETS.length);
});

test('a known service needs only the key', () => {
  const p = apiPayload({ name: 'stripe', key: '  sk_test_123  ', preset: findPreset('stripe') });
  assert.equal(p.baseUrl, 'https://api.stripe.com/v1');
  assert.equal(p.header, 'Authorization');
  assert.equal(p.value, 'Bearer sk_test_123');
  const a = apiPayload({ name: 'anthropic', key: 'sk-ant-1', preset: findPreset('anthropic') });
  assert.equal(a.header, 'x-api-key');
  assert.equal(a.value, 'sk-ant-1');
  assert.equal(a.headers?.['anthropic-version'], '2023-06-01');
});

test('a key that already says Bearer is not doubled, quotes are removed', () => {
  assert.equal(apiPayload({ name: 'openai', key: 'Bearer abc', preset: findPreset('openai') }).value, 'Bearer abc');
  assert.equal(apiPayload({ name: 'openai', key: '"abc"', preset: findPreset('openai') }).value, 'Bearer abc');
});

test('an unknown service needs a base URL (https only)', () => {
  assert.throws(() => apiPayload({ name: 'my crm', key: 'k' }), /Base URL/);
  assert.throws(() => apiPayload({ name: 'my crm', key: 'k', baseUrl: 'http://crm.example.com' }), /https/);
  const p = apiPayload({ name: 'my crm', key: 'k', baseUrl: 'https://api.crm.example.com/v2/' });
  assert.equal(p.baseUrl, 'https://api.crm.example.com/v2');
  assert.equal(p.value, 'Bearer k');
  const q = apiPayload({ name: 'my crm', key: 'k', baseUrl: 'https://x.example.com', header: 'X-Api-Key' });
  assert.equal(q.header, 'X-Api-Key');
  assert.equal(q.value, 'k');
  assert.throws(() => apiPayload({ name: 'x', key: '   ', preset: findPreset('stripe') }), /key/i);
});

test('brandDomain finds the logo domain', () => {
  assert.equal(brandDomain('mcp.canva.com'), 'canva.com');
  assert.equal(brandDomain('api.githubcopilot.com'), 'githubcopilot.com');
  assert.equal(brandDomain('accounts.google.com'), 'google.com');
  assert.equal(brandDomain('mcp.example.co.uk'), 'example.co.uk');
  assert.equal(brandDomain('notion.so'), 'notion.so');
});

import { connectIntent } from '../../lib/connect-intent.ts';

test('short connect messages are understood, also in Hinglish and with typos', () => {
  assert.deepEqual(connectIntent('can a connect kro'), { kind: 'connect', name: 'can a' });
  assert.deepEqual(connectIntent('connect canva'), { kind: 'connect', name: 'canva' });
  assert.deepEqual(connectIntent('can you connect canva please'), { kind: 'connect', name: 'canva' });
  assert.deepEqual(connectIntent('canva mcp connect kar do'), { kind: 'connect', name: 'canva' });
  assert.deepEqual(connectIntent('bhai notion add karo mcp'), { kind: 'connect', name: 'notion' });
  assert.deepEqual(connectIntent('disconnect canva'), { kind: 'remove', name: 'canva' });
});

test('an address or an API key travels with the intent', () => {
  const u = connectIntent('firecrawl mcp https://mcp.firecrawl.dev/fc-abc123456789012/v2/mcp');
  assert.equal(u?.name, 'firecrawl');
  assert.equal(u?.url, 'https://mcp.firecrawl.dev/fc-abc123456789012/v2/mcp');
  const k = connectIntent('stripe connect kro sk_live_abcdefghijklmnop12345');
  assert.equal(k?.name, 'stripe');
  assert.equal(k?.key, 'sk_live_abcdefghijklmnop12345');
  assert.deepEqual(connectIntent('connect https://mcp.example.com/mcp'), { kind: 'connect', name: '', url: 'https://mcp.example.com/mcp' });
});

test('anything that is more than a plain connect request goes to the agent', () => {
  assert.equal(connectIntent('add milk to list'), null);
  assert.equal(connectIntent('connect to the database'), null);
  assert.equal(connectIntent('add feature'), null);
  assert.equal(connectIntent('canva connect kro aur ek design banao'), null);
  assert.equal(connectIntent('research karo isko use karke'), null);
  assert.equal(connectIntent('/clone a/b'), null);
  assert.equal(connectIntent(''), null);
});
