import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadKeys, writeKey, seal, unseal } from '../../lib/vault-crypto.ts';

const KEY = randomBytes(32).toString('base64');
const env = { VAULT_KEY: KEY, ROUTINE_RUNNER_SECRET: 'cron-secret', NODE_ENV: 'production' };

test('seal and unseal round-trip', () => {
  const s = seal('sk-secret-123', 'u1', 'provider.openai', writeKey(env));
  assert.equal(unseal(s, 'u1', 'provider.openai', loadKeys(env).all).plain, 'sk-secret-123');
});

test('ciphertext cannot be moved to another user or slot', () => {
  const s = seal('x', 'u1', 'a', writeKey(env));
  assert.throws(() => unseal(s, 'u2', 'a', loadKeys(env).all));
  assert.throws(() => unseal(s, 'u1', 'b', loadKeys(env).all));
});

test('tampered ciphertext is rejected', () => {
  const s = seal('hello world', 'u1', 'a', writeKey(env));
  const bad = { ...s, ct: Buffer.from('tampered-data!').toString('base64') };
  assert.throws(() => unseal(bad, 'u1', 'a', loadKeys(env).all));
});

test('old secrets (derived key) still open once VAULT_KEY exists, and report key index 1', () => {
  const old = { ROUTINE_RUNNER_SECRET: 'cron-secret', NODE_ENV: 'development' };
  const s = seal('legacy', 'u1', 'a', writeKey(old));
  const r = unseal(s, 'u1', 'a', loadKeys(env).all);
  assert.equal(r.plain, 'legacy');
  assert.equal(r.keyIndex, 1);
});

test('production without VAULT_KEY refuses to write new secrets', () => {
  assert.throws(() => writeKey({ ROUTINE_RUNNER_SECRET: 's', NODE_ENV: 'production' }), /VAULT_KEY is required/);
  assert.doesNotThrow(() => writeKey({ ROUTINE_RUNNER_SECRET: 's', NODE_ENV: 'production', ALLOW_DERIVED_VAULT_KEY: '1' }));
  assert.doesNotThrow(() => writeKey({ ROUTINE_RUNNER_SECRET: 's', NODE_ENV: 'development' }));
});

test('bad or missing keys are errors', () => {
  assert.throws(() => loadKeys({ VAULT_KEY: 'c2hvcnQ=' }), /32 bytes/);
  assert.throws(() => loadKeys({}), /No encryption key/);
});
