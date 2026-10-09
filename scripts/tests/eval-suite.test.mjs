import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeResults, validateDataset } from '../eval-suite.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'evals/tasks.json'), 'utf8'));

test('the fixed benchmark contains 40 well-formed tasks across all required categories', () => {
  assert.deepEqual(validateDataset(dataset), []);
});

test('dataset validation rejects duplicate IDs and missing category coverage', () => {
  const copy = structuredClone(dataset);
  copy.tasks[1].id = copy.tasks[0].id;
  copy.tasks.pop();
  assert.ok(validateDataset(copy).some((e) => e.includes('Duplicate task id')));
  assert.ok(validateDataset(copy).some((e) => e.includes('Expected exactly 40')));
});

test('result summary reports coverage, success rate, time, cost and category rates', () => {
  const results = dataset.tasks.map((t, i) => ({ taskId: t.id, success: i % 2 === 0, durationMs: 1000 + i, costUsd: 0.01 }));
  const report = summarizeResults(dataset, results);
  assert.equal(report.valid, true);
  assert.equal(report.completed, 40);
  assert.equal(report.successRate, 0.5);
  assert.equal(report.totalCostUsd, 0.4);
  assert.equal(report.byCategory.coding_bugs.total, 10);
  assert.equal(report.missing.length, 0);
});

test('result summary flags missing, duplicate, unknown and malformed results', () => {
  const report = summarizeResults(dataset, [
    { taskId: dataset.tasks[0].id, success: true, durationMs: -1 },
    { taskId: dataset.tasks[0].id, success: false },
    { taskId: 'not-a-task', success: true },
  ]);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((e) => e.includes('negative')));
  assert.ok(report.errors.some((e) => e.includes('Duplicate result')));
  assert.ok(report.errors.some((e) => e.includes('Unknown taskId')));
  assert.equal(report.missing.length, 39);
});
