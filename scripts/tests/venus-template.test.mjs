import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

test('video templates: files, route and modal exist', () => {
  for (const p of ['lib/venus-clone.ts', 'app/api/venus/template/route.ts', 'components/venus/TemplateModal.tsx']) assert.ok(exists(p), `missing ${p}`);
  const route = read('app/api/venus/template/route.ts');
  for (const a of ['list', 'get', 'save', 'delete']) assert.match(route, new RegExp(`action === "${a}"`));
  assert.match(route, /saveSkillServer\(/);
});

test('a template is cloned through its own prompt field and the AI route can extract one', () => {
  assert.match(read('app/api/venus/ai/route.ts'), /body\.kind === "template-extract"/);
  assert.match(read('lib/venus-prompts.ts'), /export function templateExtractPrompt/);
  assert.match(read('lib/venus-pipeline.ts'), /template: tplNote \|\| undefined/);
  assert.match(read('lib/venus-pipeline.ts'), /export async function analyzeVideoTemplate/);
});

test('an attached video is edited from the chat and assets go to Venus Pro\'s own computer', () => {
  const dash = read('app/dashboard/page.tsx');
  assert.match(dash, /recentVideoRef/);
  assert.match(dash, /mode: "edit" as const/);
  assert.doesNotMatch(dash, /Computer assets download kar raha hai/);
  assert.doesNotMatch(dash, /pexels: Boolean\(cfg\?\.pexels\), sandboxId: sid/);
  assert.doesNotMatch(read('lib/venus-pipeline.ts'), /PEXELS_API_KEY is not set — remaining photo/);
});

test('the voice-over speaks the script only', () => {
  const s = read('lib/venus-script.ts');
  assert.match(s, /export function splitDirections/);
  assert.match(s, /export const spokenOnly/);
  assert.match(s, /spokenOnly\(scriptRaw\)/);
});
