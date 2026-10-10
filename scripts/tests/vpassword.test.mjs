import test from 'node:test';
import assert from 'node:assert/strict';
import { totp, hostMatches, luhn, brandOf, maskUser, normSite } from '../../lib/vpassword.ts';

test('TOTP matches the RFC 6238 test vector', () => {
  // secret "12345678901234567890" in base32, time 59s -> 8-digit 94287082 -> last 6 digits
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000), '287082');
});

test('invalid base32 secret is an error', () => {
  assert.throws(() => totp('!!!!'), /not valid base32/);
});

test('a look-alike host does not match the saved site', () => {
  assert.equal(hostMatches('github.com', 'github.com'), true);
  assert.equal(hostMatches('github.com', 'gist.github.com'), true);
  assert.equal(hostMatches('github.com', 'github.com.evil.com'), false);
  assert.equal(hostMatches('github.com', 'notgithub.com'), false);
  assert.equal(hostMatches('', 'github.com'), false);
});

test('site names are normalised', () => {
  assert.equal(normSite('https://www.GitHub.com/login'), 'github.com');
  assert.equal(normSite('github.com'), 'github.com');
});

test('card helpers', () => {
  assert.equal(luhn('4242424242424242'), true);
  assert.equal(luhn('4242424242424243'), false);
  assert.equal(brandOf('4242424242424242'), 'Visa');
  assert.equal(maskUser('alice@example.com'), 'al***@example.com');
});
