import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('voice feature exposes authenticated settings, call and webhook routes', () => {
  for (const p of [
    'app/api/voice/settings/route.ts', 'app/api/voice/test/route.ts', 'app/api/voice/realtime/route.ts',
    'app/api/voice/calls/route.ts', 'app/api/voice/twiml/route.ts', 'app/api/voice/turn/route.ts',
    'app/api/voice/status/route.ts', 'app/api/voice/tts/route.ts', 'app/voice/page.tsx', 'lib/voice-calls.ts',
  ]) assert.ok(fs.existsSync(path.join(root, p)), `missing ${p}`);
  assert.ok(!fs.existsSync(path.join(root, 'app/api/voice/settings/rouete.ts')), 'delete the misspelled rouete.ts');
});

test('phone-call reasoning uses the chat agent (its model, memory and tools)', () => {
  const turn = read('app/api/voice/turn/route.ts');
  const calls = read('lib/voice-calls.ts');
  assert.match(turn, /loadAgent\(/);
  assert.match(turn, /callProvider\(/);
  assert.match(turn, /callTool\(/);
  assert.match(calls, /connectors/);
});

test('Twilio webhooks are signature-checked', () => {
  for (const p of ['app/api/voice/twiml/route.ts', 'app/api/voice/turn/route.ts', 'app/api/voice/status/route.ts']) {
    assert.match(read(p), /verifyTwilioSignature\(/, p);
  }
});

test('settings responses expose connection status but not raw credentials', () => {
  const route = read('app/api/voice/settings/route.ts');
  assert.match(route, /openaiConnected/);
  assert.match(route, /twilioConnected/);
  assert.doesNotMatch(route, /twilioToken:\s*s\.twilioToken/);
});