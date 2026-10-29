import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRun, nextCron, occurrences, parseCron, parseHuman, validateSchedule, describeSchedule, inQuietHours, zonedToUtc, formatLocal, dayKey } from '../../lib/schedule.ts';

const iso = (ms) => new Date(ms).toISOString();

test('every: anchored, never drifts', () => {
  const anchor = Date.parse('2026-01-01T09:00:00Z');
  const s = { kind: 'every', minutes: 1440, anchor };
  assert.equal(iso(nextRun(s, Date.parse('2026-01-01T09:00:00Z'))), '2026-01-02T09:00:00.000Z');
  // a run that finished late (09:07) still lands on 09:00 the next day
  assert.equal(iso(nextRun(s, Date.parse('2026-01-05T09:07:00Z'))), '2026-01-06T09:00:00.000Z');
  assert.equal(iso(nextRun(s, anchor - 5 * 3600_000)), iso(anchor));
});

test('cron: daily 09:00 in India has no DST and is 03:30Z', () => {
  assert.equal(iso(nextCron('0 9 * * *', 'Asia/Kolkata', Date.parse('2026-10-29T00:00:00Z'))), '2026-10-29T03:30:00.000Z');
  assert.equal(iso(nextCron('0 9 * * *', 'Asia/Kolkata', Date.parse('2026-10-29T03:30:00Z'))), '2026-10-30T03:30:00.000Z');
});

test('cron: weekdays skip the weekend', () => {
  // 2026-10-30 is a Friday
  const n = nextCron('30 9 * * 1-5', 'UTC', Date.parse('2026-10-30T10:00:00Z'));
  assert.equal(iso(n), '2026-11-02T09:30:00.000Z');
});

test('cron: steps, lists, names', () => {
  assert.equal(iso(nextCron('*/15 * * * *', 'UTC', Date.parse('2026-01-01T10:07:00Z'))), '2026-01-01T10:15:00.000Z');
  assert.equal(iso(nextCron('0 8,20 * * *', 'UTC', Date.parse('2026-01-01T10:07:00Z'))), '2026-01-01T20:00:00.000Z');
  assert.equal(iso(nextCron('0 8 * jan mon', 'UTC', Date.parse('2026-01-01T10:07:00Z'))), '2026-01-05T08:00:00.000Z');
  assert.deepEqual(parseCron('0 0 * * 7').dow.has(0), true);
});

test('cron: day-of-month and day-of-week together mean "either"', () => {
  // the 13th OR any Friday
  const a = nextCron('0 0 13 * 5', 'UTC', Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(iso(a), '2026-02-06T00:00:00.000Z'); // first Friday comes before the 13th
});

test('cron: Feb 29 is found in a leap year', () => {
  assert.equal(iso(nextCron('0 0 29 2 *', 'UTC', Date.parse('2026-03-01T00:00:00Z'))), '2028-02-29T00:00:00.000Z');
});

test('cron: never-matching date returns null and is rejected', () => {
  assert.equal(nextCron('0 0 31 2 *', 'UTC', Date.now()), null);
  assert.match(validateSchedule({ kind: 'cron', expr: '0 0 31 2 *', tz: 'UTC' }), /never matches/);
});

test('DST spring forward: 02:30 does not exist in New York, runs right after the gap', () => {
  const n = nextCron('30 2 * * *', 'America/New_York', Date.parse('2026-03-08T00:00:00Z'));
  assert.equal(iso(n), '2026-03-08T07:30:00.000Z'); // 03:30 EDT
});

test('DST fall back: 01:30 happens twice, the first one is used once', () => {
  const first = nextCron('30 1 * * *', 'America/New_York', Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(iso(first), '2026-11-01T05:30:00.000Z'); // 01:30 EDT
  const next = nextCron('30 1 * * *', 'America/New_York', first);
  assert.equal(iso(next), '2026-11-02T06:30:00.000Z'); // next day, 01:30 EST (no double run)
});

test('daily 09:00 keeps the wall clock across DST', () => {
  const a = nextCron('0 9 * * *', 'America/New_York', Date.parse('2026-03-07T20:00:00Z'));
  const b = nextCron('0 9 * * *', 'America/New_York', a);
  assert.equal(iso(a), '2026-03-08T13:00:00.000Z'); // 09:00 EDT (already switched)
  assert.equal(formatLocal(b, 'America/New_York'), '2026-03-09 09:00');
});

test('occurrences lists the next runs in order', () => {
  const list = occurrences({ kind: 'cron', expr: '0 */6 * * *', tz: 'UTC' }, Date.parse('2026-01-01T00:00:00Z'), 4);
  assert.deepEqual(list.map(iso), ['2026-01-01T06:00:00.000Z', '2026-01-01T12:00:00.000Z', '2026-01-01T18:00:00.000Z', '2026-01-02T00:00:00.000Z']);
});

test('one-shot "at" runs once', () => {
  const s = { kind: 'at', at: Date.parse('2026-05-05T10:00:00Z') };
  assert.equal(nextRun(s, Date.parse('2026-05-05T09:00:00Z')), s.at);
  assert.equal(nextRun(s, s.at), null);
});

test('validation: minimum gap, bad cron, bad timezone', () => {
  assert.match(validateSchedule({ kind: 'every', minutes: 1, anchor: 0 }), /at least 5/);
  assert.match(validateSchedule({ kind: 'cron', expr: '* * * * *', tz: 'UTC' }), /once every 5 minutes/);
  assert.match(validateSchedule({ kind: 'cron', expr: '61 * * * *', tz: 'UTC' }), /out of range/);
  assert.match(validateSchedule({ kind: 'cron', expr: '0 9 * *', tz: 'UTC' }), /5 fields/);
  assert.match(validateSchedule({ kind: 'cron', expr: '0 9 * * *', tz: 'Mars/Base' }), /Unknown timezone/);
  assert.equal(validateSchedule({ kind: 'cron', expr: '*/5 * * * *', tz: 'UTC' }), null);
});

test('human parser', () => {
  const now = Date.parse('2026-10-29T06:00:00Z');
  const p = (t) => parseHuman(t, 'Asia/Kolkata', now);
  assert.deepEqual(p('every day at 9am').schedule, { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Kolkata' });
  assert.deepEqual(p('daily 18:30').schedule, { kind: 'cron', expr: '30 18 * * *', tz: 'Asia/Kolkata' });
  assert.deepEqual(p('weekdays at 7:15 pm').schedule, { kind: 'cron', expr: '15 19 * * 1-5', tz: 'Asia/Kolkata' });
  assert.deepEqual(p('every monday and thursday at 6pm').schedule, { kind: 'cron', expr: '0 18 * * 1,4', tz: 'Asia/Kolkata' });
  assert.deepEqual(p('monthly on the 5th at 10:00').schedule, { kind: 'cron', expr: '0 10 5 * *', tz: 'Asia/Kolkata' });
  assert.deepEqual(p('har din 8 baje').schedule, { kind: 'cron', expr: '0 8 * * *', tz: 'Asia/Kolkata' });
  assert.deepEqual(p('every 2 hours').schedule, { kind: 'every', minutes: 120, anchor: now });
  assert.deepEqual(p('in 20 minutes').schedule, { kind: 'at', at: now + 20 * 60_000 });
  assert.deepEqual(p('cron: 0 9 * * 1-5').schedule, { kind: 'cron', expr: '0 9 * * 1-5', tz: 'Asia/Kolkata' });
  assert.deepEqual(p('0 */3 * * *').schedule, { kind: 'cron', expr: '0 */3 * * *', tz: 'Asia/Kolkata' });
  assert.equal(p('at 2026-11-01 18:30').schedule.at, zonedToUtc(2026, 11, 1, 18, 30, 'Asia/Kolkata'));
  assert.match(p('every minute').error, /understand/);
  assert.match(p('every 1 minutes').error, /at least 5/);
  assert.match(p('banana').error, /understand/);
});

test('describe', () => {
  assert.equal(describeSchedule({ kind: 'every', minutes: 360, anchor: 0 }), 'every 6 hours');
  assert.equal(describeSchedule({ kind: 'cron', expr: '0 9 * * 1-5', tz: 'UTC' }), 'weekdays at 09:00 (UTC)');
  assert.equal(describeSchedule({ kind: 'cron', expr: '*/10 * * * *', tz: 'UTC' }), 'every 10 minutes (UTC)');
  assert.equal(describeSchedule({ kind: 'cron', expr: '0 9 * * 1', tz: 'UTC' }), 'every Monday at 09:00 (UTC)');
});

test('quiet hours cross midnight', () => {
  const at = (h) => Date.parse(`2026-01-01T${String(h).padStart(2, '0')}:00:00Z`);
  assert.equal(inQuietHours(at(23), 'UTC', '22:00', '07:00'), true);
  assert.equal(inQuietHours(at(3), 'UTC', '22:00', '07:00'), true);
  assert.equal(inQuietHours(at(12), 'UTC', '22:00', '07:00'), false);
  assert.equal(inQuietHours(at(12), 'UTC', '13:00', '14:00'), false);
  assert.equal(inQuietHours(at(12), 'UTC', '', ''), false);
});

test('dayKey follows the routine timezone', () => {
  const ms = Date.parse('2026-10-29T20:00:00Z'); // already the 30th in India
  assert.equal(dayKey(ms, 'UTC'), '2026-10-29');
  assert.equal(dayKey(ms, 'Asia/Kolkata'), '2026-10-30');
});