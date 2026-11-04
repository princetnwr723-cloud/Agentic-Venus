// Buddies: 100+ cute animated characters (shapes) x ANY colour x 9 faces.
// This file holds the shared types + tiny helpers used by the catalog files.
//
// A buddy value looks like:   "bd.cat:#ffa94d"        (shape + colour)
//                             "bd.cat.joy:#ffa94d"    (shape + face + colour)
//
// Every shape is plain SVG drawn in a 100 x 100 box. Colour tokens inside the
// markup are swapped for real colours at render time:
//   @c main colour   @d darker   @l lighter   @k ink (almost black)   @w white
//   @p pink  @y yellow  @o orange  @r red  @g green  @b blue  @s sky  @t tan  @n brown
// Animation helper classes you can put on any element:
//   a-twitch a-wag a-flap a-swing a-flick a-glow a-spin a-spinr a-steam a-twinkle
//   a-drift a-bounce a-tick a-tock a-wave a-wave2 a-snap a-beacon a-pop
// Transform-origin helper classes: ob (bottom) ot (top) ol (left) or (right)
//   obl obr otl otr

export type BuddyFace =
  | "dot"
  | "round"
  | "joy"
  | "wink"
  | "sleepy"
  | "wow"
  | "love"
  | "cool"
  | "sparkle";

export const BUDDY_FACES: BuddyFace[] = [
  "dot",
  "round",
  "joy",
  "wink",
  "sleepy",
  "wow",
  "love",
  "cool",
  "sparkle",
];

export const BUDDY_FACE_LABELS: Record<BuddyFace, string> = {
  dot: "Classic",
  round: "Big eyes",
  joy: "Happy",
  wink: "Wink",
  sleepy: "Sleepy",
  wow: "Surprised",
  love: "Love",
  cool: "Cool",
  sparkle: "Starstruck",
};

export type BuddyMotion =
  | "bob"
  | "hop"
  | "float"
  | "sway"
  | "wiggle"
  | "pulse"
  | "swim"
  | "waddle"
  | "roll";

export type BuddyGroup = "animals" | "creatures" | "things" | "nature" | "food";

export const BUDDY_GROUP_LABELS: Record<BuddyGroup, string> = {
  animals: "Animals",
  creatures: "Creatures",
  things: "Things",
  nature: "Nature",
  food: "Food",
};

export type BuddyValue = `bd.${string}:#${string}`;

export type BuddyDef = {
  id: string;
  name: string;
  hex: string;
  /** eye centre x, y, gap between the eyes (0 = a single side-view eye), scale */
  eyes: [number, number, number, number?];
  svg: string;
  motion: BuddyMotion;
  face: BuddyFace;
  /** fixed eye colour (for shapes where the eyes sit on a dark/light patch) */
  ink?: string;
  /** false = no cheeks */
  blush: boolean;
  /** extra search words */
  tags: string;
};

type Extra = {
  motion?: BuddyMotion;
  face?: BuddyFace;
  ink?: string;
  blush?: boolean;
  tags?: string;
};

export function b(
  id: string,
  name: string,
  hex: string,
  eyes: [number, number, number, number?],
  svg: string,
  extra: Extra = {}
): BuddyDef {
  return {
    id,
    name,
    hex,
    eyes,
    svg,
    motion: extra.motion ?? "bob",
    face: extra.face ?? "dot",
    ink: extra.ink,
    blush: extra.blush ?? true,
    tags: extra.tags ?? "",
  };
}

/** mirror a snippet left <-> right across the middle of the box */
export const mirror = (s: string) => `<g transform="translate(100 0) scale(-1 1)">${s}</g>`;

/** draw a snippet, then its mirror image (ears, arms, wings...) */
export const both = (s: string) => s + mirror(s);

/** n circles placed around a centre (manes, flower petals, fluff) */
export function ring(
  cx: number,
  cy: number,
  dist: number,
  n: number,
  r: number,
  fill: string,
  start = 0
): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    const a = ((start + (360 / n) * i) * Math.PI) / 180;
    const x = (cx + dist * Math.cos(a)).toFixed(1);
    const y = (cy + dist * Math.sin(a)).toFixed(1);
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
  }
  return out;
}

/** a rotated rectangle-ish ray / spike (sun rays, gear teeth) around a centre */
export function rays(
  cx: number,
  cy: number,
  from: number,
  to: number,
  n: number,
  width: number,
  stroke: string,
  start = 0
): string {
  let out = `<g stroke="${stroke}" stroke-width="${width}" stroke-linecap="round">`;
  for (let i = 0; i < n; i++) {
    const a = ((start + (360 / n) * i) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out += `<path d="M${(cx + from * c).toFixed(1)} ${(cy + from * s).toFixed(1)} L${(cx + to * c).toFixed(1)} ${(cy + to * s).toFixed(1)}"/>`;
  }
  return out + "</g>";
}

/** soft highlight blob used on glossy shapes */
export const shine = (x: number, y: number, rx = 5, ry = 8, rot = 20) =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${x} ${y})" fill="#fff" opacity=".35"/>`;
