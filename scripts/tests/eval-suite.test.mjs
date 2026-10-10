import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, normalizePublicHttpUrl } from '../../lib/browser-url-safety.mjs';

test('blocks private, loopback, link-local and reserved IPv4 addresses', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '240.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be blocked`);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('1.1.1.1'), false);
});

test('blocks local and special IPv6 addresses, including mapped IPv4', () => {
  for (const ip of ['::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:192.168.1.1', '::ffff:c0a8:0101', '2002:7f00:1::']) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be blocked`);
  }
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
  assert.equal(isPrivateAddress('::ffff:8.8.8.8'), false);
});

test('accepts public HTTP(S) URLs and normalizes bare hostnames', () => {
  assert.equal(normalizePublicHttpUrl('example.com'), 'https://example.com/');
  assert.equal(normalizePublicHttpUrl('https://example.com/path').startsWith('https://example.com/path'), true);
});

test('rejects private hosts, non-HTTP schemes and embedded credentials', () => {
  for (const url of ['http://localhost', 'http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://192.168.1.10', 'http://[::1]', 'http://foo.local', 'file:///etc/passwd', 'https://user:pass@example.com']) {
    assert.throws(() => normalizePublicHttpUrl(url), undefined, url);
  }
});
