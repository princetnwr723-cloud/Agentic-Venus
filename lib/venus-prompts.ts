import { ASPECTS, type Aspect } from "@/lib/venus-schema";

export function storyboardPrompt(o: {
  brief: string;
  seconds: number;
  aspect: Aspect;
  theme: string;
  voice: boolean;
  captions: boolean;
}): string {
  const a = ASPECTS[o.aspect];
  return `You are the motion-graphics director of "Venus Pro", an AI video studio. Turn the brief into a storyboard for a ${o.seconds}-second video (${a.width}x${a.height}, ${o.aspect}). Reply with ONE JSON object only — no prose, no markdown fences.

SCENE TYPES (use ONLY these; every scene also accepts: "seconds", "narration", "transition", "fontScale"):
1. title      {headline, subhead?}                                   opening / section title
2. kinetic    {text, emphasis?: [words to highlight]}                punchy one-liner, words pop in
3. bullets    {headline, items: [3-5 short strings]}
4. stat       {label, value: number, prefix?, suffix?, decimals?, caption?}   one big animated number
5. bar-chart  {headline, data: [{label, value}] (2-6), unit?}
6. line-chart {headline, data: [{label, value}] (3-8)}
7. quote      {text, author?}
8. split      {headline?, left: {title, points: [..]}, right: {title, points: [..]}}   comparison
9. timeline   {headline, steps: [{label, text}] (3-5)}
10. ranking   {headline, items: [{title, note?}] (3-5)}               top-N list
11. image     {headline?, subhead?, imageQuery: "2-4 English words describing a stock photo"}
12. outro     {headline, subhead?, handle?}

OUTPUT FORMAT:
{"title":"...","scenes":[{"type":"title","seconds":4,"transition":"zoom","headline":"...","subhead":"..."}, ...]}

RULES
- 6 to 12 scenes. Total of all "seconds" must be about ${o.seconds} and NEVER above ${o.seconds}. Each scene 3-9 seconds.
- First scene is "title" (or "kinetic"), last scene is "outro".
- Vary the scene types: never the same type twice in a row. Mix typography, data and imagery.
- "transition" is one of: fade, slide, zoom, wipe, blur. Vary it.
- Text must be SHORT: headlines max 7 words, bullet items max 9 words, kinetic text max 12 words. Write the on-screen text in English unless the brief clearly asks for another language.
- NEVER invent statistics, prices or facts. Use numbers only if they are in the brief or are common knowledge you are sure of. If you have no real data, use bullets, kinetic, quote, timeline or ranking instead of charts.
- Pick "image" scenes only when a photo helps; imageQuery must be concrete and visual.
- ${
    o.voice
      ? 'Every scene needs a "narration" (a natural spoken sentence or two, about 2 words per second of the scene, so a 5-second scene has roughly 10 words). The narration and the on-screen text must agree.'
      : 'Do not add "narration".'
  }
- Theme is "${o.theme}"; do not mention colors.

BRIEF:
${o.brief}`;
}

export function reviewPrompt(
  tiles: Array<{ tile: number; index: number; type: string; summary: string }>
): string {
  const lines = tiles
    .map((t) => `Tile ${t.tile} (left to right, top to bottom) = scene index ${t.index}, type "${t.type}", text: "${t.summary}"`)
    .join("\n");
  return `You are the quality reviewer of a motion-graphics video. The image is a contact sheet of frames taken from the middle of each scene.

${lines}

Check each tile for REAL problems only: text cut off or overflowing the frame, text too small to read, text overlapping other elements, an empty or broken layout, low contrast. Do not nitpick style.

Reply with ONE JSON object only:
{"verdict":"good"|"fix","issues":[{"scene":<scene index>,"problem":"...","patch":{...}}]}

"patch" may contain ONLY these keys: "fontScale" (number 0.5-1.2; use a smaller value when text overflows), "transition" (fade|slide|zoom|wipe|blur), and shorter replacements for the text keys "headline", "subhead", "text", "label", "caption". If everything looks fine, answer {"verdict":"good","issues":[]}.`;
}