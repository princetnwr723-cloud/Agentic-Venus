#!/usr/bin/env node
// Runs the fixed evaluation tasks (evals/tasks.json) against a live agent endpoint, grades each answer and writes
// results in the format that `npm run eval:check -- --results <file>` understands.
//
//   EVAL_ENDPOINT=https://your-app/api/eval  EVAL_TOKEN=...  npm run eval:run
//
// The endpoint receives POST {"taskId","prompt"} and must answer {"output":"<final answer text>","costUsd":0.01?}.
// Use a SANDBOX account: tasks marked risk "write" can change things. Add --read-only to run only the read tasks.
// Grading: set EVAL_JUDGE_KEY (and optionally EVAL_JUDGE_MODEL) to let a second model judge every rubric line;
// without it a simple keyword check is used (cheap, but only a rough signal).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeResults, validateDataset } from './eval-suite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STOP = new Set(['the', 'and', 'for', 'with', 'each', 'when', 'available', 'every', 'all', 'any', 'are', 'not', 'that', 'from']);

/** Rough, deterministic check: every meaningful word of a rubric line must appear in the answer. */
export function gradeKeywords(output, rubric) {
  const text = String(output || '').toLowerCase();
  const checks = rubric.map((line) => {
    const words = line.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
    return { line, pass: words.length > 0 && words.every((w) => text.includes(w)) };
  });
  return { success: checks.length > 0 && checks.every((c) => c.pass), checks };
}

/** A second model decides, per rubric line, whether the answer satisfies it. Anything unclear counts as NOT passed. */
export function anthropicJudge({ key, model, fetchImpl = fetch }) {
  return async (task, output) => {
    const prompt = `You grade an AI agent's answer. Be strict: only evidence in the answer counts.\nTASK:\n${task.prompt}\n\nRUBRIC LINES:\n${task.rubric.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nANSWER:\n${String(output).slice(0, 12000)}\n\nReply with ONE JSON object only: {"results":[true|false, ...]} with exactly ${task.rubric.length} booleans, one per rubric line, in order.`;
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
    const data = await res.json();
    const raw = (data.content || []).map((c) => c.text || '').join('');
    const m = /\{[\s\S]*\}/.exec(raw);
    const arr = m ? JSON.parse(m[0]).results : null;
    const ok = Array.isArray(arr) && arr.length === task.rubric.length;
    const checks = task.rubric.map((line, i) => ({ line, pass: ok && arr[i] === true }));
    return { success: ok && checks.every((c) => c.pass), checks };
  };
}

export async function runTask(task, { endpoint, token, fetchImpl = fetch, timeoutMs = 600_000, judge } = {}) {
  const t0 = Date.now();
  const done = (extra) => ({ taskId: task.id, durationMs: Date.now() - t0, ...extra });
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ taskId: task.id, prompt: task.prompt }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return done({ success: false, notes: `endpoint HTTP ${res.status}` });
    const data = await res.json();
    const output = String(data.output ?? '');
    const grade = judge ? await judge(task, output) : gradeKeywords(output, task.rubric);
    const failed = grade.checks.filter((c) => !c.pass).map((c) => c.line);
    return done({
      success: grade.success,
      ...(Number.isFinite(data.costUsd) && data.costUsd >= 0 ? { costUsd: data.costUsd } : {}),
      ...(failed.length ? { notes: `failed: ${failed.join('; ')}` } : {}),
    });
  } catch (e) {
    return done({ success: false, notes: e instanceof Error ? e.message : 'error' });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'tasks.json'), 'utf8'));
  const problems = validateDataset(dataset);
  if (problems.length) { console.error(problems.map((p) => `✗ ${p}`).join('\n')); process.exit(1); }

  const endpoint = process.env.EVAL_ENDPOINT;
  if (!endpoint) { console.error('Set EVAL_ENDPOINT (see the header of scripts/eval-run.mjs).'); process.exit(1); }
  const judge = process.env.EVAL_JUDGE_KEY
    ? anthropicJudge({ key: process.env.EVAL_JUDGE_KEY, model: process.env.EVAL_JUDGE_MODEL || 'claude-sonnet-5-5' })
    : undefined;
  if (!judge) console.warn('⚠ No EVAL_JUDGE_KEY: using the rough keyword grader.');

  let tasks = dataset.tasks;
  if (args.includes('--read-only')) tasks = tasks.filter((t) => t.risk === 'read');
  const only = arg('--only');
  if (only) tasks = tasks.filter((t) => t.category === only);
  const limit = Number(arg('--limit'));
  if (limit > 0) tasks = tasks.slice(0, limit);

  const results = [];
  for (const task of tasks) {
    const r = await runTask(task, { endpoint, token: process.env.EVAL_TOKEN, judge });
    results.push(r);
    console.log(`${r.success ? '✓' : '✗'} ${task.id} (${Math.round(r.durationMs / 1000)}s)${r.notes ? ' - ' + r.notes : ''}`);
  }

  const out = path.resolve(process.cwd(), arg('--out') || 'evals/results.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
  const report = summarizeResults({ ...dataset, tasks }, results);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Saved ${out}`);
  const min = Number(process.env.EVAL_MIN_SUCCESS_RATE || 0);
  if (!report.valid || (min > 0 && (report.successRate ?? 0) < min)) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
