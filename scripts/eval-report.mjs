#!/usr/bin/env node
// Turns one or more `eval:run` result files into a publishable Markdown report (evals/RESULTS.md).
//   node scripts/eval-report.mjs --label "Cheap model + FOUNT" evals/cheap.json --label "Opus" evals/opus.json --out evals/RESULTS.md
// The report shows the pass rate WITH its 95% confidence interval (Wilson): with 40 tasks a gap of a few points is noise, and the
// report says so instead of declaring a winner. Only numbers from the result files are used, nothing is estimated.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeResults, validateDataset } from './eval-suite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Wilson score interval for k successes out of n (z = 1.96). */
export function wilson(k, n, z = 1.96) {
  if (!n) return { lo: null, hi: null };
  const p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}
const pct = (x) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(0)}%`);
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

export function summarizeEntry(dataset, entry) {
  const report = summarizeResults(dataset, entry.results);
  const done = entry.results.filter((r) => typeof r.success === 'boolean');
  const ok = done.filter((r) => r.success);
  const costs = done.map((r) => r.costUsd).filter(Number.isFinite);
  const totalCost = costs.reduce((a, b) => a + b, 0);
  return {
    label: entry.label, ranAt: entry.ranAt, report,
    n: done.length, k: ok.length, ci: wilson(ok.length, done.length),
    medianSec: median(done.map((r) => (r.durationMs ?? NaN) / 1000)),
    avgCost: costs.length ? totalCost / costs.length : null,
    costPerSuccess: ok.length && costs.length === done.length ? totalCost / ok.length : null,
    complete: report.valid && report.totalTasks === done.length,
  };
}

export function renderReport(dataset, entries, { now = new Date().toISOString().slice(0, 10) } = {}) {
  const rows = entries.map((e) => summarizeEntry(dataset, e));
  const L = [`# Agent evaluation results`, '', `Run on ${now} with the ${dataset.tasks.length}-task suite in \`evals/suite.json\`. Every task is graded against its rubric by a second model (or by the keyword grader if no judge key was set: say which one you used when you publish).`, ''];
  L.push('| Setup | Passed | Pass rate (95% interval) | Median time | Avg cost / task | Cost / success |', '|---|---|---|---|---|---|');
  for (const r of rows) {
    L.push(`| ${r.label}${r.complete ? '' : ' ⚠ incomplete'} | ${r.k}/${r.n} | ${pct(r.k / Math.max(1, r.n))} (${pct(r.ci.lo)}–${pct(r.ci.hi)}) | ${r.medianSec === null ? 'n/a' : Math.round(r.medianSec) + ' s'} | ${r.avgCost === null ? 'n/a' : '$' + r.avgCost.toFixed(3)} | ${r.costPerSuccess === null ? 'n/a' : '$' + r.costPerSuccess.toFixed(3)} |`);
  }
  if (rows.length >= 2) {
    const [a, b] = rows;
    const overlap = a.ci.lo !== null && b.ci.lo !== null && a.ci.lo <= b.ci.hi && b.ci.lo <= a.ci.hi;
    L.push('', overlap
      ? `**Reading:** the intervals of “${a.label}” and “${b.label}” overlap, so this run does not show a real difference in quality. What it does show is the cost column.`
      : `**Reading:** the intervals of “${a.label}” and “${b.label}” do not overlap, so the difference in pass rate is unlikely to be chance.`);
  }
  L.push('', '## By category', '', '| Category | ' + rows.map((r) => r.label).join(' | ') + ' |', '|---|' + rows.map(() => '---|').join(''));
  const cats = Object.keys(rows[0]?.report.byCategory ?? {});
  for (const c of cats) L.push(`| ${c} | ` + rows.map((r) => { const s = r.report.byCategory[c]; return s ? `${s.succeeded}/${s.completed} (${pct(s.successRate)})` : 'n/a'; }).join(' | ') + ' |');
  const fails = rows.flatMap((r) => entries.find((e) => e.label === r.label).results.filter((x) => x.success === false).map((x) => `- ${r.label}: \`${x.taskId}\`${x.notes ? ' — ' + String(x.notes).slice(0, 160) : ''}`));
  if (fails.length) L.push('', '## Failed tasks', '', ...fails);
  L.push('', '_Numbers come straight from the result files. Costs are the agent\'s own estimates from list prices, not a bill._', '');
  return L.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const entries = []; let label = null, out = path.join(ROOT, 'evals', 'RESULTS.md');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--label') label = args[++i];
    else if (args[i] === '--out') out = path.resolve(process.cwd(), args[++i]);
    else { const f = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), args[i]), 'utf8')); entries.push({ label: label || path.basename(args[i], '.json'), ranAt: f.ranAt, results: f.results }); label = null; }
  }
  if (!entries.length) { console.error('Usage: node scripts/eval-report.mjs [--label "name"] results.json ... [--out evals/RESULTS.md]'); process.exit(1); }
  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'suite.json'), 'utf8'));
  const problems = validateDataset(dataset);
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderReport(dataset, entries));
  console.log(`Wrote ${out}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
