import test from 'node:test';
import assert from 'node:assert/strict';
import {
  totp, hostMatches, luhn, brandOf, maskUser, normSite,
  parseAmount, maxAmount, checkSpend, applySpend, spendLeft, totalLooksWrong, pageTotalChanged, cleanProxy, dayKey,
} from '../../lib/vpassword.ts';

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

test('amounts are parsed from real page text', () => {
  assert.equal(parseAmount('499'), 499);
  assert.equal(parseAmount('₹1,299.50'), 1299.5);
  assert.equal(parseAmount('1.299,50'), 1299.5);
  assert.equal(parseAmount('12,5'), 12.5);
  assert.equal(parseAmount('1,299'), 1299);
  assert.equal(parseAmount(250), 250);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('free'), 0);
  assert.equal(parseAmount(-5), 0);
  assert.equal(parseAmount(0), 0);
  assert.equal(maxAmount(['499', '1,299.00', 'x']), 1299);
  assert.equal(maxAmount([]), null);
  assert.equal(maxAmount('nope'), null);
});

test('per-payment limit, total budget and daily limit are all enforced', () => {
  const now = Date.UTC(2026, 9, 27, 12);
  const card = { limit: 500, budget: 1000, daily: 600, spent: 0 };
  assert.equal(checkSpend(card, 499, now).ok, true);
  assert.equal(checkSpend(card, 501, now).ok, false);       // over the per-payment limit
  assert.equal(checkSpend(card, 0, now).ok, false);          // no amount
  assert.equal(checkSpend(card, NaN, now).ok, false);
  // 100 payments of 499 can no longer happen: the budget counts up
  let c = { ...card };
  const a = applySpend(c, 499, now); c = { ...c, ...a };
  assert.equal(c.spent, 499);
  assert.equal(checkSpend(c, 200, now).ok, false);           // daily 600: only 101 left today
  assert.match(checkSpend(c, 200, now).error, /today/);
  assert.equal(checkSpend(c, 101, now).ok, true);
  // next day the daily counter resets but the total budget does not
  const next = now + 24 * 3600 * 1000;
  assert.equal(checkSpend(c, 400, next).ok, true);
  c = { ...c, ...applySpend(c, 400, next) };
  assert.equal(c.spent, 899);
  assert.equal(checkSpend(c, 200, next).ok, false);          // budget 1000: only 101 left in total
  assert.match(checkSpend(c, 200, next).error, /budget/);
  assert.deepEqual(spendLeft(c, next), { budgetLeft: 101, dailyLeft: 200 });
});

test('floating point never lets a payment squeeze past the budget', () => {
  const card = { budget: 0.3, spent: 0.1 };
  assert.equal(checkSpend(card, 0.2).ok, true);
  assert.equal(checkSpend(card, 0.21).ok, false);
});

test('a card with no caps only needs a positive amount', () => {
  assert.equal(checkSpend({}, 10).ok, true);
  assert.deepEqual(spendLeft({}), { budgetLeft: null, dailyLeft: null });
  assert.equal(dayKey(Date.UTC(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('page total checks: understated amount and a cart that grows after approval', () => {
  assert.equal(totalLooksWrong(499, 5000), true);
  assert.equal(totalLooksWrong(499, 499), false);
  assert.equal(totalLooksWrong(499, null), false);
  assert.equal(pageTotalChanged(499, 499, 499), false);
  assert.equal(pageTotalChanged(499, 5000, 5000), false);    // the user already saw 5000 when approving
  assert.equal(pageTotalChanged(499, 499, 650), true);       // cart grew after approval
  assert.equal(pageTotalChanged(499, 499, null), false);
});

test('proxy entries are validated', () => {
  const ok = cleanProxy({ scheme: 'http', host: 'Proxy.Example.com', port: '8080', username: 'u', password: 'p', tz: 'Asia/Kolkata', lang: 'en-IN' });
  assert.equal(ok.ok, true);
  assert.equal(ok.cfg.host, 'proxy.example.com');
  assert.equal(ok.cfg.port, 8080);
  assert.equal(cleanProxy({ host: 'a b', port: 80 }).ok, false);
  assert.equal(cleanProxy({ host: 'x.com; rm -rf', port: 80 }).ok, false);
  assert.equal(cleanProxy({ host: 'x.com', port: 70000 }).ok, false);
  assert.equal(cleanProxy({ host: 'x.com', port: 80, scheme: 'socks5' }).ok, false);
  assert.equal(cleanProxy({ host: 'x.com', port: 80, tz: 'Asia/Kol kata' }).ok, false);
  assert.equal(cleanProxy({ host: 'x.com', port: 80, lang: 'english' }).ok, false);
  assert.equal(cleanProxy({ host: 'x.com', port: 80 }).ok, true);
});
