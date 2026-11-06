import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// Node 22 strips the types; venus-graphics.ts imports types only, so it runs as it is.
const G = await import(new URL('../../lib/venus-graphics.ts', import.meta.url).href);

// a 4-minute raw video cut down to a plain 1-minute plan: 8 clips of 7 s, nothing else (what the agent used to hand back)
const transcript = Array.from({ length: 24 }, (_, i) => ({ s: i * 10, e: i * 10 + 8, t: `this is spoken sentence number ${i} about the product` }));
const plainPlan = () => ({
  title: 'Product walkthrough', fps: 30, width: 1280, height: 720, theme: 'midnight', captions: true,
  source: { path: 'p/x/vid/src.mp4', duration: 240, width: 1920, height: 1080, hasAudio: true },
  scenes: Array.from({ length: 8 }, (_, i) => ({ type: 'clip', seconds: 7, srcStart: i * 30, srcEnd: i * 30 + 7, speed: 1, volume: 1, transition: 'cut', video: 'p/x/vid/src.mp4' })),
});

test('a plan of plain cuts is measured as having no motion graphics', () => {
  const rep = G.graphicsReport(plainPlan());
  assert.equal(rep.designed, 0);
  assert.equal(rep.overlayClips, 0);
  assert.equal(rep.clips, 8);
  assert.ok(G.graphicsMissing(rep, G.graphicsNeeds(rep.seconds, rep.clips)));
});

test('addMotionGraphics gives a plain plan titles, cards and an end card, using only the speaker\'s own words', () => {
  const sb = plainPlan();
  const r = G.addMotionGraphics(sb, { transcript, creative: true });
  const rep = G.graphicsReport(r.sb);
  const need = G.graphicsNeeds(G.graphicsReport(sb).seconds, 8);
  assert.ok(r.addedScenes >= need.designed, `scenes ${r.addedScenes} < ${need.designed}`);
  assert.ok(rep.overlayClips >= need.overlayClips);
  assert.equal(r.sb.scenes[0].type, 'title');
  assert.equal(r.sb.scenes[r.sb.scenes.length - 1].type, 'outro');
  assert.ok(r.sb.scenes.some((s) => s.type === 'kinetic'));
  assert.equal(r.sb.grade, 'teal-orange');
  assert.ok(!G.graphicsMissing(rep, G.graphicsNeeds(rep.seconds, rep.clips)));
  // nothing is invented: every overlay / card text is part of the transcript, the plan title, or a neutral "Part N"
  const spoken = transcript.map((t) => t.t).join(' | ');
  for (const s of r.sb.scenes) {
    const texts = s.type === 'clip' ? (s.overlays ?? []).map((o) => o.text) : [s.text, s.headline].filter(Boolean);
    for (const t of texts) assert.ok(spoken.includes(t) || t === 'Product walkthrough' || /^Part \d+$/.test(t), `invented text: ${t}`);
  }
  // the clips keep their source timing
  const clips = r.sb.scenes.filter((s) => s.type === 'clip');
  assert.equal(clips.length, 8);
  clips.forEach((c, i) => { assert.equal(c.srcStart, i * 30); assert.equal(c.srcEnd, i * 30 + 7); });
  // the added graphics stay small next to a 1-minute edit
  assert.ok(G.graphicsReport(r.sb).seconds < 60 * 1.3);
});

test('a plan that already has enough graphics is left alone (the agent\'s own design is never replaced)', () => {
  const sb = plainPlan();
  sb.scenes.splice(0, 0, { type: 'title', seconds: 3, headline: 'Hi' }, { type: 'custom', id: 'a', seconds: 3, headline: 'x' });
  sb.scenes.push({ type: 'outro', seconds: 3, headline: 'Bye' });
  sb.scenes = sb.scenes.map((s, i) => (s.type === 'clip' && i % 2 === 0 ? { ...s, overlays: [{ at: 1, dur: 2, text: 'T', style: 'chip' }] } : s));
  const r = G.addMotionGraphics(sb, { transcript });
  assert.equal(r.addedScenes, 0);
  assert.equal(r.addedOverlays, 0);
  assert.equal(r.sb.scenes.length, sb.scenes.length);
});

test('silent video: neutral labels only, no invented words', () => {
  const r = G.addMotionGraphics({ ...plainPlan(), title: 'Untitled' }, { transcript: [] });
  for (const s of r.sb.scenes) {
    if (s.type === 'clip') for (const o of s.overlays ?? []) assert.match(o.text, /^Part \d+$/);
    if (s.type === 'kinetic') assert.match(s.text, /^Part \d+$/);
  }
  assert.ok(r.addedOverlays > 0);
});

test('the pipeline enforces the motion-graphics rule, and a follow-up edits the same video again', () => {
  const pipe = read('lib/venus-pipeline.ts');
  assert.match(pipe, /import \{ addMotionGraphics, graphicsMissing, graphicsNeeds, graphicsReport \} from "@\/lib\/venus-graphics"/);
  assert.match(pipe, /if \(policy\?\.graphics\)/);
  assert.match(pipe, /a plan of plain cuts is rejected/);
  assert.match(pipe, /addMotionGraphics\(planned\.clean/);
  const dash = read('app/dashboard/page.tsx');
  assert.match(dash, /RECENT_VIDEO_MS/);
  assert.doesNotMatch(dash, /delete recentVideoRef\.current\[chat\.id\]/);
  assert.match(dash, /lastEditRef/);
  assert.match(dash, /fast\.graphics/);
});
