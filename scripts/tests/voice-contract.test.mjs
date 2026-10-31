import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

test('voice feature exposes authenticated settings, call and webhook routes', () => {
  for (const p of [
    'app/api/voice/settings/route.ts', 'app/api/voice/test/route.ts', 'app/api/voice/realtime/route.ts',
    'app/api/voice/calls/route.ts', 'app/api/voice/twiml/route.ts', 'app/api/voice/turn/route.ts',
    'app/api/voice/status/route.ts', 'app/api/voice/tts/route.ts', 'app/api/voice/web/route.ts',
    'lib/voice-calls.ts', 'lib/telephony.ts', 'lib/tools/voice.ts', 'components/dashboard/CallButton.tsx',
  ]) assert.ok(exists(p), `missing ${p}`);
  assert.ok(!exists('app/api/voice/settings/rouete.ts'), 'delete the misspelled rouete.ts');
});

test('calling is set up and managed from the chat, not from a settings page', () => {
  assert.ok(!exists('app/voice/page.tsx'), 'the Voice & Calling settings page must be deleted');
  assert.ok(!/href="\/voice"/.test(read('components/dashboard/Sidebar.tsx')), 'no link to the old Voice page');
  const tools = read('lib/tools/voice.ts');
  for (const name of ['voice.status', 'voice.connect', 'voice.settings', 'voice.numbers', 'voice.number_assign', 'voice.number_buy', 'voice.call', 'voice.call_me', 'voice.calls']) {
    assert.ok(tools.includes(`"${name}"`), `missing tool ${name}`);
  }
});

test('phone company access goes through the telephony layer only', () => {
  assert.doesNotMatch(read('lib/voice-calls.ts'), /api\.twilio\.com/);
  assert.match(read('lib/voice-calls.ts'), /telRest\(/);
  assert.match(read('lib/telephony.ts'), /signalwire/);
});

test('every agent can have its own number and inbound calls are routed by the dialled number', () => {
  assert.match(read('lib/voice-calls.ts'), /fromNumberFor\(/);
  assert.match(read('app/api/voice/twiml/route.ts'), /chatForNumber\(/);
});

test('caller ID is not trusted for inbound calls unless the owner switched it on', () => {
  assert.match(read('lib/voice-calls.ts'), /trustCallerId/);
});

test('the composer has a call button next to attach', () => {
  const c = read('components/dashboard/ChatComposer.tsx');
  assert.match(c, /<CallButton/);
  assert.ok(c.indexOf('Paperclip size') < c.indexOf('<CallButton'));
});

test('phone-call reasoning uses the chat agent (its model, memory and tools)', () => {
  const turn = read('app/api/voice/turn/route.ts');
  const calls = read('lib/voice-calls.ts');
  assert.match(turn, /loadAgent\(/);
  assert.match(turn, /callProvider\(/);
  assert.match(turn, /callTool\(/);
  assert.match(calls, /connectors/);
});

test('in-app call runs tools for the signed-in owner and blocks the secret-taking setup tools', () => {
  const web = read('app/api/voice/web/route.ts');
  assert.match(web, /callTool\(/);
  assert.match(web, /voice\\\.\(connect\|settings\|number_assign\|number_buy\)/);
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
