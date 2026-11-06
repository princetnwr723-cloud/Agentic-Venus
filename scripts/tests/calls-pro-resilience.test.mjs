import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

test('real-time calls: the bridge, its app route and the TwiML branch exist', () => {
  for (const p of ['lib/voice-rt.ts', 'app/api/voice/rt/route.ts', 'lib/tools/voice-extra.ts']) assert.ok(exists(p), `missing ${p}`);
  assert.match(read('lib/voice-rt.ts'), /input_audio_buffer\.speech_started/);
  assert.match(read('lib/voice-rt.ts'), /conversation\.item\.truncate/);
  assert.match(read('lib/voice-rt.ts'), /client_secrets/);
  assert.match(read('app/api/voice/twiml/route.ts'), /<Connect><Stream url=/);
  assert.match(read('app/api/voice/twiml/route.ts'), /prepareRealtime\(/);
  // the real key never goes to the cloud PC; tools only on a verified owner call
  assert.doesNotMatch(read('lib/voice-rt.ts'), /OPENAI_API_KEY\s*=/);
  assert.match(read('app/api/voice/rt/route.ts'), /sess\.owner/);
});

test('Telnyx is an adapter inside the telephony layer', () => {
  const t = read('lib/telephony.ts');
  assert.match(t, /"telnyx"/);
  assert.match(t, /texml\/calls/);
  assert.match(read('lib/voice-server.ts'), /startsWith\("telnyx:"\)/);
  assert.match(read('lib/tools/voice-extra.ts'), /voice\.connect_telnyx/);
  assert.match(read('lib/tools/mission.ts'), /VOICE_EXTRA_TOOLS/);
});

test('a mission can phone the owner when it is over', () => {
  const m = read('lib/mission.ts');
  assert.match(m, /export const CALL_ME_RE/);
  assert.match(m, /callOwnerAboutMission\(/);
  assert.match(read('lib/tools/mission.ts'), /call_me\?:boolean/);
});

test('Venus Pro: edits an attached video on request and continues work that was left behind', () => {
  const d = read('app/dashboard/page.tsx');
  assert.match(d, /wantsVideoEdit\(text\)/);
  assert.match(d, /async function resumeStale/);
  assert.match(d, /keepAwake\(/);
  assert.match(read('lib/venus-pipeline.ts'), /export async function lastBeat/);
  assert.match(read('lib/venus-pipeline.ts'), /beat\(run\);/);
});

test('Venus Pro edit: the length stays unless the owner asks, and the owner chooses who decides', () => {
  const clone = read('lib/venus-clone.ts');
  assert.match(clone, /export function editPolicyOf/);
  const dash = read('app/dashboard/page.tsx');
  assert.match(dash, /editPolicyOf\(brief\)/);
  assert.doesNotMatch(dash, /asked \?\? 60/);
  const pipe = read('lib/venus-pipeline.ts');
  assert.match(pipe, /Keeping the whole video/);
  assert.match(pipe, /kind: "edit-notes"/);
  assert.match(pipe, /restore the missing parts/);
  const prompts = read('lib/venus-prompts.ts');
  assert.match(prompts, /KEEPS THE WHOLE VIDEO/);
  assert.match(prompts, /THE USER'S WORDS ARE THE LAW/);
  assert.match(prompts, /CREATIVE CONTROL/);
  assert.match(prompts, /export function editNotesPrompt/);
  assert.match(read('app/api/venus/ai/route.ts'), /body\.kind === "edit-notes"/);
});

test('worldwide: English everywhere, the model reads the video request in any language, the UI follows the browser language', () => {
  const hinglish = /\b(nahi|abhi|chahiye|bolo|karo\b|taiyaar|kharid|batao)\b/;
  for (const f of ['lib/telephony.ts', 'lib/tools/voice.ts', 'lib/tools/voice-extra.ts', 'lib/voice-calls.ts']) {
    const lines = read(f).split('\n').filter((l) => hinglish.test(l) && !l.trim().startsWith('//') && !/Namaste|kaam ke baad|mujhe/.test(l));
    assert.deepEqual(lines, [], `${f} still has Hinglish messages`);
  }
  assert.match(read('lib/venus-prompts.ts'), /export function videoIntentPrompt/);
  assert.match(read('app/api/venus/ai/route.ts'), /body\.kind === "video-intent"/);
  assert.match(read('lib/venus-pipeline.ts'), /export async function classifyVideoRequest/);
  assert.match(read('app/dashboard/page.tsx'), /classifyVideoRequest\(/);
  assert.match(read('lib/tools/prompt.ts'), /17\. LANGUAGE/);
  assert.match(read('components/dashboard/CallButton.tsx'), /function useStrings/);
  assert.match(read('components/venus/TemplateModal.tsx'), /const t = hi \? STR\.hi : STR\.en/);
});
