// Buddies engine: catalog, value parsing and the SVG builder.
// (Shapes live in buddy-animals / buddy-creatures / buddy-things / buddy-nature / buddy-food.)

import { lum, mix, normHex } from "@/lib/avatar-theme";
import {
  BUDDY_FACES,
  type BuddyDef,
  type BuddyFace,
  type BuddyGroup,
  type BuddyValue,
} from "@/lib/buddy-kit";
import { ANIMALS } from "@/lib/buddy-animals";
import { CREATURES } from "@/lib/buddy-creatures";
import { THINGS } from "@/lib/buddy-things";
import { NATURE } from "@/lib/buddy-nature";
import { FOOD } from "@/lib/buddy-food";

export type { BuddyFace, BuddyGroup, BuddyValue, BuddyDef } from "@/lib/buddy-kit";

export type BuddyEntry = BuddyDef & { group: BuddyGroup };

const tag = (list: BuddyDef[], group: BuddyGroup): BuddyEntry[] =>
  list.map((d) => ({ ...d, group }));

export const BUDDIES: BuddyEntry[] = [
  ...tag(ANIMALS, "animals"),
  ...tag(CREATURES, "creatures"),
  ...tag(THINGS, "things"),
  ...tag(NATURE, "nature"),
  ...tag(FOOD, "food"),
];

export const BUDDY_MAP: Record<string, BuddyEntry> = Object.fromEntries(
  BUDDIES.map((d) => [d.id, d])
);

export const DEFAULT_BUDDY = "ghost";

const RE = /^bd\.([a-z0-9-]+)(?:\.([a-z]+))?:(#[0-9a-fA-F]{6})$/;

export function isBuddy(value: string | null | undefined): boolean {
  const m = RE.exec(String(value ?? "").trim());
  return !!m && Object.prototype.hasOwnProperty.call(BUDDY_MAP, m[1]);
}

export type ParsedBuddy = { def: BuddyEntry; face: BuddyFace; hex: string };

export function parseBuddy(value: string | null | undefined): ParsedBuddy | null {
  const m = RE.exec(String(value ?? "").trim());
  if (!m || !Object.prototype.hasOwnProperty.call(BUDDY_MAP, m[1])) return null;
  const def = BUDDY_MAP[m[1]];
  const face = m[2] && (BUDDY_FACES as string[]).includes(m[2]) ? (m[2] as BuddyFace) : def.face;
  return { def, face, hex: m[3].toLowerCase() };
}

export function makeBuddy(id: string, hex: string, face?: BuddyFace): BuddyValue {
  const def = BUDDY_MAP[id] ?? BUDDY_MAP[DEFAULT_BUDDY];
  const h = (normHex(hex) ?? def.hex).toLowerCase();
  const f = face && face !== def.face ? `.${face}` : "";
  return `bd.${def.id}${f}:${h}` as BuddyValue;
}

export function searchBuddies(q: string, group: BuddyGroup | "all"): BuddyEntry[] {
  const s = q.trim().toLowerCase();
  return BUDDIES.filter(
    (d) =>
      (group === "all" || d.group === group) &&
      (!s || d.name.toLowerCase().includes(s) || d.id.includes(s) || d.tags.includes(s))
  );
}

// ---------------------------------------------------------------- colours

const FIXED: Record<string, string> = {
  k: "#1c1a26",
  w: "#ffffff",
  p: "#ff9db8",
  y: "#ffd23f",
  o: "#ff9a3d",
  r: "#ff5a5f",
  g: "#4cd08a",
  b: "#58b0ff",
  s: "#8fd8ff",
  t: "#f3d9b1",
  n: "#8a5a3b",
};

function palette(hex: string): Record<string, string> {
  return {
    ...FIXED,
    c: hex,
    d: mix(hex, "#000000", 0.22),
    l: mix(hex, "#ffffff", 0.42),
  };
}

function paint(markup: string, pal: Record<string, string>): string {
  return markup.replace(/@([a-z])(?![a-z])/g, (m, k: string) => pal[k] ?? m);
}

const n2 = (n: number) => String(+n.toFixed(2));

// ---------------------------------------------------------------- faces

function eye(
  face: BuddyFace,
  x: number,
  y: number,
  s: number,
  ink: string,
  hl: string,
  side: 0 | 1
): string {
  const arc = `<path d="M${n2(x - 4.2 * s)} ${n2(y + 2 * s)} Q${n2(x)} ${n2(y - 5.4 * s)} ${n2(x + 4.2 * s)} ${n2(y + 2 * s)}" fill="none" stroke="${ink}" stroke-width="${n2(2.6 * s)}" stroke-linecap="round"/>`;
  const round = `<g class="bd-blink"><circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(5 * s)}" fill="${ink}"/><circle cx="${n2(x - 1.6 * s)}" cy="${n2(y - 1.8 * s)}" r="${n2(1.7 * s)}" fill="${hl}"/></g>`;
  switch (face) {
    case "round":
      return round;
    case "joy":
      return arc;
    case "wink":
      return side === 1 ? arc : round;
    case "sleepy":
      return `<path d="M${n2(x - 4.2 * s)} ${n2(y - 1 * s)} Q${n2(x)} ${n2(y + 4.6 * s)} ${n2(x + 4.2 * s)} ${n2(y - 1 * s)}" fill="none" stroke="${ink}" stroke-width="${n2(2.4 * s)}" stroke-linecap="round"/>`;
    case "wow":
      return `<g class="bd-blink"><circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(5.6 * s)}" fill="${ink}"/><circle cx="${n2(x - 1.8 * s)}" cy="${n2(y - 2 * s)}" r="${n2(2 * s)}" fill="${hl}"/></g>`;
    case "love":
      return `<path class="bd-heart" d="M${n2(x)} ${n2(y + 5.4 * s)} C${n2(x - 9 * s)} ${n2(y - 0.5 * s)} ${n2(x - 5.5 * s)} ${n2(y - 7 * s)} ${n2(x)} ${n2(y - 2.4 * s)} C${n2(x + 5.5 * s)} ${n2(y - 7 * s)} ${n2(x + 9 * s)} ${n2(y - 0.5 * s)} ${n2(x)} ${n2(y + 5.4 * s)} Z" fill="#ff4f7d"/>`;
    case "cool":
      return ""; // the sunglasses are drawn once, see shades()
    case "sparkle":
      return `<path class="bd-twinkle" d="M${n2(x)} ${n2(y - 6.4 * s)} Q${n2(x + 1 * s)} ${n2(y - 1 * s)} ${n2(x + 6.4 * s)} ${n2(y)} Q${n2(x + 1 * s)} ${n2(y + 1 * s)} ${n2(x)} ${n2(y + 6.4 * s)} Q${n2(x - 1 * s)} ${n2(y + 1 * s)} ${n2(x - 6.4 * s)} ${n2(y)} Q${n2(x - 1 * s)} ${n2(y - 1 * s)} ${n2(x)} ${n2(y - 6.4 * s)} Z" fill="#ffd23f"/>`;
    default:
      return `<rect class="bd-blink" x="${n2(x - 2.6 * s)}" y="${n2(y - 4.6 * s)}" width="${n2(5.2 * s)}" height="${n2(9.2 * s)}" rx="${n2(2.6 * s)}" fill="${ink}"/>`;
  }
}

function shades(x1: number, x2: number, y: number, s: number, single: boolean): string {
  const w = 12.5 * s;
  const h = 8.6 * s;
  const lens = (cx: number) =>
    `<rect x="${n2(cx - w / 2)}" y="${n2(y - h / 2 - 1 * s)}" width="${n2(w)}" height="${n2(h)}" rx="${n2(3.2 * s)}" fill="#14131c"/><path d="M${n2(cx - w / 2 + 2.2 * s)} ${n2(y - h / 2 + 0.6 * s)} l${n2(3 * s)} 0 l${n2(-2 * s)} ${n2(3.6 * s)} l${n2(-3 * s)} 0 z" fill="#fff" opacity=".35"/>`;
  if (single) return lens(x1);
  return (
    lens(x1) +
    lens(x2) +
    `<path d="M${n2(x1 + w / 2)} ${n2(y - 1.4 * s)} L${n2(x2 - w / 2)} ${n2(y - 1.4 * s)}" stroke="#14131c" stroke-width="${n2(1.8 * s)}" stroke-linecap="round"/>`
  );
}

function mouth(face: BuddyFace, ex: number, ey: number, s: number, ink: string): string {
  const y = ey + 9.5 * s;
  switch (face) {
    case "joy":
    case "sparkle":
      return `<g class="bd-mouth"><path d="M${n2(ex - 4.6 * s)} ${n2(y - 0.5 * s)} Q${n2(ex)} ${n2(y + 9 * s)} ${n2(ex + 4.6 * s)} ${n2(y - 0.5 * s)} Z" fill="${ink}"/><path d="M${n2(ex - 2.4 * s)} ${n2(y + 3.6 * s)} Q${n2(ex)} ${n2(y + 1.6 * s)} ${n2(ex + 2.4 * s)} ${n2(y + 3.6 * s)} Q${n2(ex)} ${n2(y + 6.2 * s)} ${n2(ex - 2.4 * s)} ${n2(y + 3.6 * s)} Z" fill="#ff7a9c"/></g>`;
    case "wink":
    case "love":
      return `<path d="M${n2(ex - 3.6 * s)} ${n2(y)} Q${n2(ex)} ${n2(y + 4.6 * s)} ${n2(ex + 3.6 * s)} ${n2(y)}" fill="none" stroke="${ink}" stroke-width="${n2(1.9 * s)}" stroke-linecap="round"/>`;
    case "wow":
      return `<ellipse class="bd-mouth" cx="${n2(ex)}" cy="${n2(y + 2 * s)}" rx="${n2(2.8 * s)}" ry="${n2(3.6 * s)}" fill="${ink}"/>`;
    case "cool":
      return `<path d="M${n2(ex - 3.8 * s)} ${n2(y + 1.4 * s)} Q${n2(ex + 1 * s)} ${n2(y + 4.4 * s)} ${n2(ex + 4.6 * s)} ${n2(y - 0.6 * s)}" fill="none" stroke="${ink}" stroke-width="${n2(1.9 * s)}" stroke-linecap="round"/>`;
    default:
      return "";
  }
}

function eyesFor(face: BuddyFace, def: BuddyDef, ink: string, hl: string): string {
  const [ex, ey, gap, sc] = def.eyes;
  const s = sc ?? 1;
  const single = gap === 0;
  const x1 = single ? ex : ex - gap / 2;
  const x2 = ex + gap / 2;
  let out = "";
  if (face === "cool") {
    out += `<g class="bd-glasses">${shades(x1, x2, ey, s, single)}</g>`;
  } else {
    out += eye(face, x1, ey, s, ink, hl, 0);
    if (!single) out += eye(face, x2, ey, s, ink, hl, 1);
  }
  if (face === "sleepy") {
    out += `<g class="bd-zzz"><path d="M${n2(x2 + 5 * s)} ${n2(ey - 9 * s)} h${n2(5 * s)} l${n2(-5 * s)} ${n2(6 * s)} h${n2(5 * s)}" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  }
  return out;
}

function faceSvg(def: BuddyDef, face: BuddyFace, hex: string): string {
  const [ex, ey, gap, sc] = def.eyes;
  const s = sc ?? 1;
  const dark = lum(hex) < 0.3;
  const ink = def.ink ?? (dark ? "#ffffff" : "#1d1b29");
  const hl = ink === "#ffffff" ? "#1d1b29" : "#ffffff";
  const single = gap === 0;
  const x1 = single ? ex : ex - gap / 2;
  const x2 = ex + gap / 2;

  const cheeks = def.blush
    ? `<g class="bd-cheek" fill="#ff6f9c" opacity=".38"><ellipse cx="${n2(x1 - 2.4 * s)}" cy="${n2(ey + 7.4 * s)}" rx="${n2(4 * s)}" ry="${n2(2.6 * s)}"/>${
        single ? "" : `<ellipse cx="${n2(x2 + 2.4 * s)}" cy="${n2(ey + 7.4 * s)}" rx="${n2(4 * s)}" ry="${n2(2.6 * s)}"/>`
      }</g>`
    : "";

  const joyInk = def.ink ?? (dark ? "#ffffff" : "#1d1b29");
  const joyEyes =
    eye("joy", x1, ey, s, joyInk, hl, 0) + (single ? "" : eye("joy", x2, ey, s, joyInk, hl, 1));

  return (
    `<g class="bd-face">` +
    cheeks +
    `<g class="bd-eyes-main"><g class="bd-look">${eyesFor(face, def, ink, hl)}</g>${mouth(face, ex, ey, s, ink)}</g>` +
    `<g class="bd-eyes-joy">${joyEyes}${mouth("joy", ex, ey, s, joyInk)}</g>` +
    `</g>`
  );
}

const LAPTOP =
  `<g class="bd-laptop"><g>` +
  `<path d="M27 88 L73 88 L77 93 Q78 95 75 95 L25 95 Q22 95 23 93 Z" fill="#b9bec9" stroke="#8d93a1" stroke-width="1"/>` +
  `<rect x="31" y="68" width="38" height="21" rx="3" fill="#1b1d26" stroke="#0e0f14" stroke-width="1"/>` +
  `<rect x="34" y="71" width="32" height="15" rx="1.6" fill="#0c1b2e"/>` +
  `<rect class="bd-code" x="36" y="73.5" width="14" height="2" rx="1" fill="#5ee6a8"/>` +
  `<rect class="bd-code" x="39" y="77" width="20" height="2" rx="1" fill="#7db7ff" style="animation-delay:.17s"/>` +
  `<rect class="bd-code" x="36" y="80.5" width="11" height="2" rx="1" fill="#ffd166" style="animation-delay:.34s"/>` +
  `<rect class="bd-cursor" x="50" y="80.2" width="2" height="2.6" fill="#fff"/>` +
  `</g></g>`;

const DOTS =
  `<g class="bd-dots" fill="#9aa0ad"><circle cx="76" cy="10" r="2.2"/><circle cx="83" cy="6" r="2.9" style="animation-delay:.2s"/><circle cx="91" cy="2" r="3.6" style="animation-delay:.4s"/></g>`;

/** the inside of the <svg> (viewBox 0 0 100 100) for one buddy */
export function buddyInner(def: BuddyDef, hexIn: string, face: BuddyFace): string {
  const hex = normHex(hexIn) ?? def.hex;
  const pal = palette(hex);
  return (
    `<ellipse class="bd-shadow" cx="50" cy="93" rx="27" ry="3.6" fill="#000" opacity=".18"/>` +
    `<g class="bd-body">${paint(def.svg, pal)}${paint(faceSvg(def, face, hex), pal)}</g>` +
    LAPTOP +
    DOTS
  );
}
