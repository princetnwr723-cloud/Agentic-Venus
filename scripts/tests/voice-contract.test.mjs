import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('voice feature exposes authenticated settings, realtime, call and webhook routes', () => {
  for (const p of [
    'app/api/voice/settings/route.ts',
    'app/api/voice/test/route.ts',
    'app/api/voice/realtime/route.ts',
    'app/api/voice/calls/route.ts',
    'app/api/voice/twiml/route.ts',
    'app/api/voice/turn/route.ts',
    'app/api/voice/status/route.ts',
    'app/voice/page.tsx',
  ]) assert.ok(fs.existsSync(path.join(root, p)), `missing ${p}`);
});

test('phone-call reasoning is routed through the existing 11-provider catalog', () => {
  const providers = read('lib/providers.ts');
  const turn = read('app/api/voice/turn/route.ts');
  for (const id of ['anthropic','openai','gemini','grok','openrouter','mistral','cohere','perplexity','groq','deepseek','apinex']) {
    assert.ok(providers.includes(`"${id}"`), `provider missing: ${id}`);
  }
  assert.match(turn, /callProvider\(/);
  assert.match(turn, /settings\.llmProvider/);
});

test('Realtime sessions use a server-created short-lived client secret, not a browser permanent key', () => {
  const route = read('app/api/voice/realtime/route.ts');
  const page = read('app/voice/page.tsx');
  assert.match(route, /realtime\/client_secrets/);
  assert.match(route, /expires_after/);
  assert.match(page, /api\/voice\/realtime/);
  assert.match(page, /api\.openai\.com\/v1\/realtime\/calls/);
});

test('settings responses expose connection status but not raw credentials', () => {
  const route = read('app/api/voice/settings/route.ts');
  assert.match(route, /openaiConnected/);
  assert.match(route, /twilioConnected/);
  assert.doesNotMatch(route, /return NextResponse\.json\(\{[^}]*openaiKey:/s);
});
