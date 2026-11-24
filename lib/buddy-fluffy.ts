// Fluffy buddies: a real "fur" look for every buddy + the missing shapes + the 6 states.
//
//  - the fur itself is drawn by lib/fur-render.ts (real hair strokes) via lib/use-fur.ts
//  - stateOverlays()  little badges / brows shown for Waiting, Blocked, Done
//  - FLUFFY_*         new shapes (plant pot, watering can, dumbbell, palette, brain, devil, egg ghost)

import { b, both, shine, type BuddyDef } from "@/lib/buddy-kit";

// ---------------------------------------------------------------- states

export type BuddyState = "idle" | "thinking" | "working" | "waiting" | "blocked" | "done";

export const BUDDY_STATES: BuddyState[] = [
  "idle",
  "thinking",
  "working",
  "waiting",
  "blocked",
  "done",
];

export const BUDDY_STATE_LABELS: Record<BuddyState, string> = {
  idle: "Idle",
  thinking: "Thinking",
  working: "Working",
  waiting: "Waiting",
  blocked: "Blocked",
  done: "Done",
};

/** css classes that put the svg into one state (see components/buddy.css) */
export function stateClasses(state: BuddyState | undefined): string {
  switch (state) {
    case "thinking":
      return "bd-working bd-s-thinking";
    case "working":
      return "bd-working bd-s-working";
    case "waiting":
      return "bd-s-waiting";
    case "blocked":
      return "bd-s-blocked";
    case "done":
      return "bd-happy bd-s-done";
    default:
      return "";
  }
}

const n2 = (n: number) => String(+n.toFixed(2));

// ---------------------------------------------------------------- state overlays

const SPARK = "M0 -5 Q1 -1 5 0 Q1 1 0 5 Q-1 1 -5 0 Q-1 -1 0 -5Z";

/** badges + brows. Always in the markup, css shows the right one per state. */
export function stateOverlays(eyes: [number, number, number, number?]): string {
  const [ex, ey, gap, sc] = eyes;
  const s = sc ?? 1;
  const single = gap === 0;
  const x1 = single ? ex : ex - gap / 2;
  const x2 = ex + gap / 2;

  // angry brows (only Blocked)
  const browL =
    `<path d="M${n2(x1 - 5.5 * s)} ${n2(ey - 10.5 * s)} L${n2(x1 + 4.5 * s)} ${n2(ey - 6.8 * s)}"/>`;
  const browR =
    `<path d="M${n2(x2 - 4.5 * s)} ${n2(ey - 6.8 * s)} L${n2(x2 + 5.5 * s)} ${n2(ey - 10.5 * s)}"/>`;
  const brows =
    `<g class="bd-ov bd-ov-brows" fill="none" stroke="#1d1b29" stroke-width="${n2(2.4 * s)}" stroke-linecap="round">` +
    browL +
    (single ? "" : browR) +
    `</g>`;

  const wait =
    `<g class="bd-ov bd-ov-wait"><circle cx="84" cy="14" r="11" fill="#ffffff" stroke="#8d93a1" stroke-width="2.4"/>` +
    `<g transform="translate(84 14)"><g class="a-tick"><path d="M0 -6.5 V0" stroke="#4b5563" stroke-width="2.2" stroke-linecap="round"/><path d="M0 0 V6.5" stroke="#000" stroke-opacity="0"/></g>` +
    `<g class="a-tock"><path d="M0 -4 V0" stroke="#4b5563" stroke-width="2.6" stroke-linecap="round"/><path d="M0 0 V4" stroke="#000" stroke-opacity="0"/></g></g></g>`;

  const block =
    `<g class="bd-ov bd-ov-block"><circle cx="84" cy="14" r="11.5" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>` +
    `<rect x="82" y="6.5" width="4" height="9" rx="2" fill="#ffffff"/><circle cx="84" cy="19.4" r="2.3" fill="#ffffff"/></g>`;

  const done =
    `<g class="bd-ov bd-ov-done"><circle cx="84" cy="14" r="11.5" fill="#22c55e" stroke="#ffffff" stroke-width="2"/>` +
    `<path d="M78.5 14.4 L82.8 18.7 L90 9.6" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path class="a-twinkle" d="${SPARK}" transform="translate(12 14)" fill="#ffd23f"/>` +
    `<path class="a-twinkle" d="${SPARK}" transform="translate(93 46) scale(.8)" fill="#ffd23f" style="animation-delay:.5s"/>` +
    `<path class="a-twinkle" d="${SPARK}" transform="translate(8 52) scale(.7)" fill="#ffffff" style="animation-delay:.9s"/></g>`;

  return brows + wait + block + done;
}

// ---------------------------------------------------------------- new shapes
// 100 x 100 box. Keep parts chunky (thin lines get blurred away by the fur).

export const FLUFFY_NATURE: BuddyDef[] = [
  b("plant-pot", "Plant pot", "#22b35a", [50, 74, 24, 1.1],
    `<rect x="46" y="28" width="9" height="22" rx="4.5" fill="@d"/>
     <g class="a-swing obr"><path d="M49 40 C30 42 10 32 8 10 C32 8 48 20 49 40Z" fill="@c"/></g>
     <g class="a-swing obl"><path d="M52 34 C58 12 76 4 94 10 C94 32 74 44 52 34Z" fill="@l"/></g>
     <path d="M20 56 H80 L74 88 Q73 93 68 93 H32 Q27 93 26 88 Z" fill="@c"/>
     <rect x="12" y="44" width="76" height="19" rx="9.5" fill="@c"/>
     <rect x="20" y="61" width="60" height="5" rx="2.5" fill="@d" opacity=".28"/>`,
    { motion: "sway", tags: "plant pot sprout garden grow green" }),
];

export const FLUFFY_THINGS: BuddyDef[] = [
  b("watering-can", "Watering can", "#14b8b0", [44, 62, 22],
    `<path d="M66 66 L88 40 L96 47 L74 82Z" fill="@c"/>
     <rect x="83" y="28" width="16" height="11" rx="4" fill="@d" transform="rotate(42 91 33)"/>
     <path d="M28 40 C32 12 60 12 64 40" fill="none" stroke="@d" stroke-width="9" stroke-linecap="round"/>
     <path d="M24 50 C2 46 -2 82 20 84" fill="none" stroke="@d" stroke-width="9" stroke-linecap="round"/>
     <rect x="14" y="36" width="58" height="52" rx="14" fill="@c"/>
     <g class="a-fall"><circle cx="97" cy="60" r="2.8" fill="@s"/></g>
     <g class="a-fall" style="animation-delay:.45s"><circle cx="92" cy="66" r="2.4" fill="@s"/></g>`,
    { motion: "wiggle", tags: "water garden plant can teal" }),

  b("dumbbell", "Dumbbell", "#ef2b3a", [50, 52, 22, 0.95],
    `<rect x="24" y="38" width="52" height="28" rx="12" fill="@d"/>
     <rect x="3" y="14" width="22" height="72" rx="11" fill="@c"/>
     <rect x="75" y="14" width="22" height="72" rx="11" fill="@c"/>
     <rect x="20" y="26" width="14" height="48" rx="7" fill="@c"/>
     <rect x="66" y="26" width="14" height="48" rx="7" fill="@c"/>`,
    { motion: "pulse", tags: "gym fitness weight workout strong" }),

  b("palette", "Palette", "#b5733a", [48, 58, 22],
    `<path d="M50 8 C22 8 5 28 7 52 C9 76 30 92 52 92 C64 92 66 82 59 76 C53 70 57 62 68 62 H79 C92 62 95 50 93 42 C89 22 73 8 50 8Z" fill="@c"/>
     <circle cx="27" cy="38" r="7" fill="@r"/>
     <circle cx="43" cy="22" r="7" fill="@y"/>
     <circle cx="65" cy="23" r="7" fill="@g"/>
     <circle cx="81" cy="40" r="6.5" fill="@b"/>`,
    { motion: "sway", tags: "paint art colour design create" }),

  b("brain", "Brain", "#ec4899", [50, 60, 24],
    `<circle cx="30" cy="40" r="21" fill="@c"/>
     <circle cx="52" cy="30" r="23" fill="@c"/>
     <circle cx="72" cy="42" r="21" fill="@c"/>
     <circle cx="22" cy="62" r="17" fill="@c"/>
     <circle cx="78" cy="63" r="17" fill="@c"/>
     <circle cx="38" cy="72" r="20" fill="@c"/>
     <circle cx="62" cy="72" r="20" fill="@c"/>
     <rect x="20" y="40" width="60" height="38" rx="16" fill="@c"/>
     <path d="M50 14 C45 30 55 40 50 54" fill="none" stroke="@d" stroke-width="4.5" stroke-linecap="round" opacity=".35"/>
     <path d="M24 50 C30 44 36 46 40 40 M76 52 C70 46 64 48 60 42" fill="none" stroke="@d" stroke-width="4" stroke-linecap="round" opacity=".28"/>`,
    { motion: "pulse", tags: "mind think smart idea ai memory" }),

  b("egg-ghost", "Egg ghost", "#f4f4f4", [50, 58, 22, 1.05],
    `<path d="M50 6 C76 6 90 38 90 64 C90 84 73 94 50 94 C27 94 10 84 10 64 C10 38 24 6 50 6Z" fill="@c"/>` +
    shine(32, 30, 6, 10, 25),
    { motion: "float", tags: "egg ghost blob white soft" }),
];

export const FLUFFY_CREATURES: BuddyDef[] = [
  b("devil", "Little devil", "#ef2b3a", [50, 58, 26],
    both(`<path d="M28 36 C22 28 20 20 22 10 C32 14 40 24 42 36Z" fill="@d"/>`) +
    both(`<circle cx="12" cy="64" r="9" fill="@c"/>`) +
    `<path class="a-wag ol" d="M84 84 C98 86 99 72 94 68" fill="none" stroke="@d" stroke-width="6.5" stroke-linecap="round"/>
     <ellipse cx="50" cy="62" rx="39" ry="32" fill="@c"/>`,
    { motion: "wiggle", tags: "devil imp horns evil red cow" }),
];
