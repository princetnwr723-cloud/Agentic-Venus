#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATASET_PATH = path.join(ROOT, 'evals', 'tasks.json');
const CATEGORIES = {
  lead_research: 10,
  browser_forms: 10,
  coding_bugs: 10,
  video_tasks: 5,
  team_goals: 5,
};

export function validateDataset(dataset) {
  const errors = [];
  if (!dataset || dataset.version !== 1 || !Array.isArray(dataset.tasks)) return ['Dataset must have version 1 and a tasks array.'];
  const ids = new Set();
  const counts = Object.create(null);
  for (const [index, task] of dataset.tasks.entries()) {
    const label = `tasks[${index}]`;
    if (!task || typeof task !== 'object') { errors.push(`${label} must be an object.`); continue; }
    if (typeof task.id !== 'string' || !/^[a-z][a-z0-9_-]{2,60}$/.test(task.id)) errors.push(`${label}.id is invalid.`);
    else if (ids.has(task.id)) errors.push(`Duplicate task id: ${task.id}`);
    else ids.add(task.id);
    if (!Object.hasOwn(CATEGORIES, task.category)) errors.push(`${label}.category is unknown.`);
    else counts[task.category] = (counts[task.category] || 0) + 1;
    if (typeof task.prompt !== 'string' || task.prompt.trim().length < 20) errors.push(`${label}.prompt must be a meaningful string.`);
    if (!Array.isArray(task.rubric) || task.rubric.length < 2 || task.rubric.some((r) => typeof r !== 'string' || !r.trim())) errors.push(`${label}.rubric needs at least two non-empty checks.`);
    if (!['read', 'write'].includes(task.risk)) errors.push(`${label}.risk must be read or write.`);
  }
  for (const [category, expected] of Object.entries(CATEGORIES)) {
    if ((counts[category] || 0) !== expected) errors.push(`${category}: expected ${expected} tasks, found ${counts[category] || 0}.`);
  }
  if (dataset.tasks.length !== 40) errors.push(`Expected exactly 40 tasks, found ${dataset.tasks.length}.`);
  return errors;
}

export function summarizeResults(dataset, results) {
  const expected = new Set(dataset.tasks.map((t) => t.id));
  const seen = new Set();
  const errors = [];
  const rows = [];
  for (const r of results) {
    if (!r || !expected.has(r.taskId)) { errors.push(`Unknown taskId: ${String(r?.taskId)}`); continue; }
    if (seen.has(r.taskId)) { errors.push(`Duplicate result for ${r.taskId}`); continue; }
    seen.add(r.taskId);
    if (typeof r.success !== 'boolean') errors.push(`${r.taskId}: success must be boolean.`);
    if (r.durationMs !== undefined && (!Number.isFinite(r.durationMs) || r.durationMs < 0)) errors.push(`${r.taskId}: durationMs must be non-negative.`);
    if (r.costUsd !== undefined && (!Number.isFinite(r.costUsd) || r.costUsd < 0)) errors.push(`${r.taskId}: costUsd must be non-negative.`);
    rows.push(r);
  }
  const missing = [...expected].filter((id) => !seen.has(id));
  const completed = rows.filter((r) => typeof r.success === 'boolean');
  const succeeded = completed.filter((r) => r.success).length;
  const durations = completed.map((r) => r.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
  const costs = completed.map((r) => r.costUsd).filter(Number.isFinite);
  const byCategory = {};
  for (const task of dataset.tasks) {
    const r = rows.find((x) => x.taskId === task.id);
    const stat = (byCategory[task.category] ||= { total: 0, completed: 0, succeeded: 0 });
    stat.total++;
    if (r && typeof r.success === 'boolean') { stat.completed++; if (r.success) stat.succeeded++; }
  }
  for (const stat of Object.values(byCategory)) stat.successRate = stat.completed ? Number((stat.succeeded / stat.completed).toFixed(4)) : null;
  return {
    valid: errors.length === 0,
    errors,
    totalTasks: dataset.tasks.length,
    completed: completed.length,
    missing,
    succeeded,
    failed: completed.length - succeeded,
    successRate: completed.length ? Number((succeeded / completed.length).toFixed(4)) : null,
    averageDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    p95DurationMs: durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] : null,
    totalCostUsd: costs.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(6)) : null,
    byCategory,
  };
}

function main() {
  let dataset;
  try { dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8')); }
  catch (error) { console.error(`Cannot read eval dataset: ${error.message}`); process.exitCode = 1; return; }
  const errors = validateDataset(dataset);
  if (errors.length) { console.error(errors.map((e) => `✗ ${e}`).join('\n')); process.exitCode = 1; return; }
  console.log(`✓ Eval dataset valid: ${dataset.tasks.length} tasks`);
  for (const [category, count] of Object.entries(CATEGORIES)) console.log(`  ${category}: ${count}`);
  const resultFlag = process.argv.indexOf('--results');
  if (resultFlag !== -1) {
    const resultPath = path.resolve(process.cwd(), process.argv[resultFlag + 1] || '');
    try {
      const results = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      const report = summarizeResults(dataset, Array.isArray(results) ? results : results.results);
      console.log(JSON.stringify(report, null, 2));
      if (!report.valid || report.missing.length) process.exitCode = 1;
      const min = Number(process.env.EVAL_MIN_SUCCESS_RATE || 0);
      if (min > 0 && (report.successRate ?? 0) < min) {
        console.error(`Success rate ${(report.successRate ?? 0) * 100}% is below required ${min * 100}%.`);
        process.exitCode = 1;
      }
    } catch (error) { console.error(`Could not evaluate results: ${error.message}`); process.exitCode = 1; }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
