import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BIZ_TEAM, DEFAULT_ROSTER, applyPatch, cleanPatch, completeness, emptyProfile, inText, isReady, leadsCsv, mergeLeads,
  parseJson, safeHref, sanitizePlan, sanitizeRoster, validateLeads, profileText,
  nextActions, jobOutcome, jobRun, stepTask, reportText, wantsBusinessHub, memberById,
} from '../../lib/business-core.ts';

test('parseJson finds the JSON inside prose and code fences, and survives garbage', () => {
  assert.deepEqual(parseJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(parseJson('no json here'), null);
  assert.equal(parseJson('{broken'), null);
});

test('cleanPatch keeps only known text fields, trimmed and short', () => {
  const p = cleanPatch({ name: '  Sharma  Dental ', offer: ['braces', 'implants'], hacker: 'x', city: 'x', goals: 42, tone: '', website: { a: 1 }, policies: 'a'.repeat(900) });
  assert.equal(p.name, 'Sharma Dental');
  assert.equal(p.offer, 'braces, implants');
  assert.equal(p.goals, '42');
  assert.equal(p.policies.length, 600);
  assert.ok(!('hacker' in p) && !('city' in p) && !('tone' in p) && !('website' in p));
  assert.deepEqual(cleanPatch(null), {});
  assert.deepEqual(cleanPatch('x'), {});
});

test('applyPatch reports only real changes', () => {
  const base = { ...emptyProfile(), name: 'Acme' };
  const r = applyPatch(base, { name: 'Acme', offer: 'Shoes' });
  assert.deepEqual(r.changed, ['What you sell or do']);
  assert.equal(r.next.offer, 'Shoes');
  assert.equal(base.offer, '');
});

test('isReady needs a name and an offer; completeness counts filled fields', () => {
  assert.equal(isReady(emptyProfile()), false);
  assert.equal(isReady({ ...emptyProfile(), name: 'Acme' }), false);
  assert.equal(isReady({ ...emptyProfile(), name: 'Acme', offer: 'Shoes' }), true);
  assert.equal(completeness(emptyProfile()), 0);
  assert.equal(completeness({ ...emptyProfile(), name: 'A', offer: 'B', goals: 'C', tone: 'D', city: 'ignored' }), 33);
  assert.match(profileText(emptyProfile()), /nothing known/);
});

test('sanitizeRoster: only real ids, Chief first, falls back when too small', () => {
  assert.deepEqual(sanitizeRoster({ members: ['scout', 'closer', 'lens', 'care', 'nope', 'scout'] }), ['chief', 'scout', 'closer', 'lens', 'care']);
  assert.deepEqual(sanitizeRoster({ members: ['scout'] }), DEFAULT_ROSTER);
  assert.deepEqual(sanitizeRoster(null), DEFAULT_ROSTER);
  const many = sanitizeRoster({ members: BIZ_TEAM.map((m) => m.id) });
  assert.equal(many.length, 8);
  assert.equal(many[0], 'chief');
});

test('sanitizePlan: backward-only deps, unknown member becomes chief, empty task becomes the goal, never empty', () => {
  const team = ['chief', 'scout', 'closer'];
  const plan = sanitizePlan({ steps: [
    { member: 'scout', task: 'find leads', after: [] },
    { member: 'ghost', task: '', after: [0, 0, 5, -1, 'x'] },
    { member: 'closer', task: 'write', after: [1] },
  ] }, 'GOAL', team);
  assert.deepEqual(plan, [
    { member: 'scout', task: 'find leads', after: [] },
    { member: 'chief', task: 'GOAL', after: [0] },
    { member: 'closer', task: 'write', after: [1] },
  ]);
  assert.deepEqual(sanitizePlan(null, 'G', team), [{ member: 'chief', task: 'G', after: [] }]);
  assert.equal(sanitizePlan({ steps: new Array(9).fill({ member: 'scout', task: 't' }) }, 'G', team).length, 5);
});

test('safeHref only allows web links', () => {
  assert.equal(safeHref('example.com/a'), 'https://example.com/a');
  assert.equal(safeHref('javascript:alert(1)'), undefined);
  assert.equal(safeHref('ftp://example.com'), undefined);
  assert.equal(safeHref('localhost'), undefined);
  assert.equal(safeHref(''), undefined);
});

test('validateLeads keeps only what the search text really contains', () => {
  const source = 'Smile Care Dental - https://www.smilecare.in/contact call +91 98765 43210. Another: Bright Teeth Clinic, email hello@brightteeth.in';
  const leads = validateLeads({ leads: [
    { name: 'Smile Care Dental', why: 'big clinic', website: 'https://smilecare.in/contact', contact: '+91 98765 43210', source: 'https://www.smilecare.in/contact' },
    { name: 'Bright Teeth Clinic', why: 'local', website: 'https://made-up.example', contact: 'fake@nowhere.com' },
    { name: 'Invented Dental Co', why: 'hallucinated', website: 'https://invented.example' },
    { name: 'smile care dental', why: 'duplicate' },
    { name: 'X' },
    null,
  ] }, source);
  assert.deepEqual(leads.map((l) => l.name), ['Smile Care Dental', 'Bright Teeth Clinic']);
  assert.equal(leads[0].website, 'https://smilecare.in/contact');
  assert.equal(leads[0].contact, '+91 98765 43210');
  assert.equal(leads[1].website, undefined);
  assert.equal(leads[1].contact, undefined);
  assert.deepEqual(validateLeads({ leads: 'x' }, source), []);
  assert.deepEqual(validateLeads(null, source), []);
});

test('inText ignores protocol, www and trailing slash, and refuses tiny values', () => {
  assert.equal(inText('visit smilecare.in today', 'https://www.smilecare.in/'), true);
  assert.equal(inText('abc', 'ab'), false);
});

test('mergeLeads dedupes by name; leadsCsv quotes cells and blocks formulas', () => {
  const a = [{ name: 'A', why: 'x' }];
  assert.equal(mergeLeads(a, [{ name: 'a', why: 'y' }, { name: 'B', why: 'z' }]).length, 2);
  const csv = leadsCsv([{ name: '=HYPERLINK("x")', why: 'say "hi", ok', website: 'https://a.com' }]);
  assert.match(csv, /^Name,Why it fits,Website,Contact,Source\n/);
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"say ""hi"", ok"'));
});

test('team catalog: unique ids, chief first, every member has a skill', () => {
  assert.equal(BIZ_TEAM[0].id, 'chief');
  assert.equal(new Set(BIZ_TEAM.map((m) => m.id)).size, BIZ_TEAM.length);
  for (const m of BIZ_TEAM) assert.ok(m.skill.length > 20 && ['think', 'research', 'leads', 'agent'].includes(m.tool));
});

const S = (i, member, after, status = 'queued') => ({ i, member, task: 't' + i, after, status });

test('nextActions: starts ready steps, respects the parallel limit, skips the children of a failed step', () => {
  assert.deepEqual(nextActions([S(0, 'scout', []), S(1, 'closer', [0])]), { start: [0], skip: [] });
  assert.deepEqual(nextActions([S(0, 'scout', [], 'done'), S(1, 'closer', [0])]), { start: [1], skip: [] });
  assert.deepEqual(nextActions([S(0, 'a', []), S(1, 'b', []), S(2, 'c', [])]).start, [0, 1]); // two at a time
  assert.deepEqual(nextActions([S(0, 'a', [], 'running'), S(1, 'b', []), S(2, 'c', [])]).start, [1]);
  const r = nextActions([S(0, 'a', [], 'failed'), S(1, 'b', [0]), S(2, 'c', [1]), S(3, 'd', [])]);
  assert.deepEqual(r.skip, [1, 2]);
  assert.deepEqual(r.start, [3]);
  assert.deepEqual(nextActions([S(0, 'a', [], 'running'), S(1, 'b', [0])]), { start: [], skip: [] });
});

test('jobOutcome and jobRun describe the job honestly', () => {
  assert.equal(jobOutcome([S(0, 'a', [], 'done'), S(1, 'b', [0], 'running')]), 'running');
  assert.equal(jobOutcome([S(0, 'a', [], 'done'), S(1, 'b', [0], 'done')]), 'done');
  assert.equal(jobOutcome([S(0, 'a', [], 'done'), S(1, 'b', [0], 'failed')]), 'partial');
  assert.equal(jobOutcome([S(0, 'a', [], 'failed'), S(1, 'b', [0], 'skipped')]), 'failed');
  const run = jobRun({ runId: 'r1', goal: 'G', createdAt: 5, endedAt: 9, steps: [{ ...S(0, 'a', [], 'done'), note: 'ok' }] });
  assert.equal(run.status, 'done');
  assert.equal(run.endedAt, 9);
  assert.equal(run.steps[0].note, 'ok');
  assert.equal(jobRun({ runId: 'r1', goal: 'G', createdAt: 5, steps: [S(0, 'a', [])] }).endedAt, undefined);
});

test('stepTask carries the business, the focus, the earlier results and stays under the server limit', () => {
  const hunter = memberById('hunter');
  const t = stepTask(hunter, { ...S(1, 'hunter', [0]), task: 'collect emails' }, { goal: 'GOAL', profile: { ...emptyProfile(), name: 'Acme', offer: 'Shoes' }, results: [{ name: 'Scout', text: 'x'.repeat(5000) }] });
  assert.match(t, /Acme/); assert.match(t, /Cloud PC/); assert.match(t, /EARLIER STEP 1 \(Scout\)/); assert.match(t, /step 2/);
  assert.ok(t.length <= 7800);
  assert.match(stepTask(memberById('closer'), S(0, 'closer', []), { goal: 'g', profile: emptyProfile(), results: [] }), /DRAFT/);
});

test('reportText counts finished steps and names each member', () => {
  const r = reportText('Find leads', [{ ...S(0, 'scout', [], 'done'), result: 'Found 8' }, { ...S(1, 'closer', [0], 'skipped'), note: 'no leads' }], (id) => id.toUpperCase());
  assert.match(r, /^⚠️ Partly done: 1 of 2/); assert.match(r, /\*\*SCOUT\*\* \(done\): Found 8/); assert.match(r, /\*\*CLOSER\*\* \(skipped\): no leads/);
});

test('wantsBusinessHub: asks for the Hub in the normal chat, and leaves other chat alone', () => {
  assert.equal(wantsBusinessHub('/business'), '');
  assert.equal(wantsBusinessHub('/biz find me 10 clients'), 'find me 10 clients');
  assert.equal(wantsBusinessHub('open business hub'), 'open business hub');
  assert.equal(wantsBusinessHub('mera business ke liye team bana do'), 'mera business ke liye team bana do');
  assert.equal(wantsBusinessHub('set up a team for my business'), 'set up a team for my business');
  assert.equal(wantsBusinessHub('what is a business hub'), null);
  assert.equal(wantsBusinessHub('my business is doing well today'), null);
  assert.equal(wantsBusinessHub('write a python script'), null);
  assert.equal(wantsBusinessHub(''), null);
});
