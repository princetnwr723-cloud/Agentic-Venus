import { b, both, ring, rays, shine, type BuddyDef } from "@/lib/buddy-kit";

export const NATURE: BuddyDef[] = [
  b("star", "Star", "#ff8a1f", [50, 54, 20, 1],
    `<polygon points="50,6 62,36 94,38 69,58 78,90 50,72 22,90 31,58 6,38 38,36" fill="@c" stroke="@c" stroke-width="8" stroke-linejoin="round"/>` +
    shine(40, 38, 4, 7, 40),
    { motion: "roll", tags: "favorite rating night" }),

  b("cloud", "Cloud", "#2dd4bf", [50, 58, 24],
    `<g class="a-drift"><circle cx="30" cy="58" r="19" fill="@c"/><circle cx="52" cy="42" r="24" fill="@c"/><circle cx="74" cy="56" r="20" fill="@c"/><rect x="20" y="56" width="62" height="22" rx="11" fill="@c"/></g>` +
    shine(40, 34, 5, 8, 35),
    { motion: "float", tags: "sky weather" }),

  b("moon", "Moon", "#fcd34d", [34, 58, 13, 0.85],
    `<path d="M64 6 C30 8 10 38 18 66 C26 90 58 98 82 80 C54 78 42 52 54 28 C58 20 62 14 64 6Z" fill="@c"/>
     <path d="M80 26 l2.4 5.6 l5.6 2.4 l-5.6 2.4 l-2.4 5.6 l-2.4 -5.6 l-5.6 -2.4 l5.6 -2.4z" fill="@y" class="a-twinkle"/>
     <path d="M88 56 l1.6 3.6 l3.6 1.6 l-3.6 1.6 l-1.6 3.6 l-1.6 -3.6 l-3.6 -1.6 l3.6 -1.6z" fill="@y" class="a-twinkle" style="animation-delay:.6s"/>`,
    { motion: "sway", face: "sleepy", tags: "night sleep" }),

  b("sun", "Sun", "#ffc933", [50, 50, 22],
    `<g class="a-spin">${rays(50, 50, 34, 46, 12, 6, "@c", 0)}</g>
     <circle cx="50" cy="50" r="30" fill="@c"/>` +
    shine(38, 36, 5, 8, 35),
    { motion: "pulse", tags: "day summer weather" }),

  b("storm", "Rain cloud", "#6b7a99", [50, 44, 24],
    `<g fill="@s"><path class="a-fall" d="M30 72 q-3 6 0 8 q3 -2 0 -8z"/><path class="a-fall" style="animation-delay:.4s" d="M50 76 q-3 6 0 8 q3 -2 0 -8z"/><path class="a-fall" style="animation-delay:.8s" d="M70 72 q-3 6 0 8 q3 -2 0 -8z"/></g>
     <circle cx="30" cy="48" r="19" fill="@c"/><circle cx="52" cy="34" r="23" fill="@c"/><circle cx="74" cy="46" r="20" fill="@c"/><rect x="20" y="46" width="62" height="22" rx="11" fill="@c"/>`,
    { motion: "float", tags: "weather rain" }),

  b("flame", "Flame", "#ff6a2b", [50, 66, 20],
    `<g class="a-flick ob"><path d="M50 4 C56 26 82 36 82 64 C82 84 68 96 50 96 C32 96 18 84 18 64 C18 48 30 42 34 28 C40 38 42 40 46 40 C44 28 46 16 50 4Z" fill="@c"/>
     <path d="M50 46 C54 58 68 62 68 76 C68 88 60 94 50 94 C40 94 32 88 32 76 C32 66 40 62 44 54 C46 60 48 60 50 46Z" fill="@y"/></g>`,
    { blush: false, tags: "fire hot trending" }),

  b("drop", "Water drop", "#38bdf8", [50, 62, 22],
    `<path d="M50 6 C64 30 82 46 82 64 C82 82 68 94 50 94 C32 94 18 82 18 64 C18 46 36 30 50 6Z" fill="@c"/>` +
    shine(34, 60, 5, 10, 15),
    { motion: "hop", tags: "water rain liquid" }),

  b("leaf", "Leaf", "#4ade80", [52, 54, 18, 0.9],
    `<path d="M12 88 C8 40 40 8 90 10 C92 62 60 92 12 88Z" fill="@c"/>
     <path d="M12 88 L66 34" stroke="@d" stroke-width="3" stroke-linecap="round"/>
     <path d="M30 70 L26 56 M44 56 L40 42 M40 74 L54 76" stroke="@d" stroke-width="2" stroke-linecap="round" opacity=".6"/>`,
    { motion: "sway", tags: "plant green eco nature" }),

  b("sprout", "Sprout", "#22c55e", [50, 76, 18, 0.85],
    `<path d="M50 56 V36" stroke="@d" stroke-width="4" stroke-linecap="round"/>
     <g class="a-twitch obr"><ellipse cx="36" cy="30" rx="16" ry="9" transform="rotate(-28 36 30)" fill="@c"/></g>
     <g class="a-twitch obl"><ellipse cx="64" cy="26" rx="18" ry="10" transform="rotate(28 64 26)" fill="@c"/></g>
     <path d="M24 58 H76 L68 92 H32Z" fill="#d68a4c"/><rect x="20" y="54" width="60" height="12" rx="5" fill="#e59d5f"/>`,
    { tags: "plant seed grow garden" }),

  b("cactus", "Cactus", "#34d399", [50, 56, 16],
    both(`<path d="M36 64 H25 Q20 64 20 58 V42" stroke="@c" stroke-width="12" fill="none" stroke-linecap="round"/>`) +
    `<rect x="32" y="16" width="36" height="76" rx="18" fill="@c"/>
     <circle cx="50" cy="12" r="6" fill="@p"/>
     <path d="M40 30 v4 M60 38 v4 M42 72 v4 M58 78 v4" stroke="@d" stroke-width="2" stroke-linecap="round"/>`,
    { tags: "desert plant" }),

  b("mushroom", "Mushroom", "#ef4444", [50, 72, 16, 0.85],
    `<path d="M34 52 H66 V82 Q66 92 50 92 Q34 92 34 82Z" fill="#fff3e0"/>
     <path d="M6 56 C6 14 94 14 94 56Z" fill="@c"/>
     <circle cx="28" cy="40" r="7" fill="#fff"/><circle cx="52" cy="28" r="6" fill="#fff"/><circle cx="74" cy="42" r="7.5" fill="#fff"/><circle cx="42" cy="46" r="3.6" fill="#fff"/>`,
    { ink: "#3a2a22", tags: "toad mario forest" }),

  b("flower", "Flower", "#ff7ab8", [50, 44, 18, 0.85],
    `<path d="M50 62 V94" stroke="@g" stroke-width="5" stroke-linecap="round"/><path d="M50 82 C62 72 72 76 76 82 C66 90 56 88 50 82Z" fill="@g"/>
     <g class="a-spin">${ring(50, 44, 24, 8, 14, "@c")}</g>
     <circle cx="50" cy="44" r="20" fill="@y"/>`,
    { motion: "sway", tags: "bloom spring garden daisy" }),

  b("tulip", "Tulip", "#ff5c8a", [50, 50, 22],
    `<path d="M50 70 V94" stroke="@g" stroke-width="5" stroke-linecap="round"/><path d="M50 90 C38 80 26 82 22 88 C32 96 44 96 50 90Z" fill="@g"/>
     <path d="M22 16 L38 32 L50 12 L62 32 L78 16 C88 52 72 78 50 78 C28 78 12 52 22 16Z" fill="@c"/>`,
    { motion: "sway", tags: "flower spring" }),

  b("tree", "Tree", "#3fbf6a", [50, 48, 24],
    `<path d="M43 60 H57 V90 Q50 94 43 90Z" fill="@n"/>
     <circle cx="50" cy="32" r="25" fill="@c"/><circle cx="30" cy="52" r="21" fill="@c"/><circle cx="70" cy="52" r="21" fill="@c"/><circle cx="50" cy="54" r="24" fill="@c"/>
     <circle cx="40" cy="28" r="4" fill="@l" opacity=".6"/><circle cx="66" cy="62" r="3" fill="@l" opacity=".6"/>`,
    { motion: "sway", tags: "forest nature green" }),

  b("clover", "Clover", "#34d399", [50, 50, 18],
    `<path d="M50 66 C52 80 58 88 66 92" stroke="@d" stroke-width="4" fill="none" stroke-linecap="round"/>
     <circle cx="34" cy="34" r="20" fill="@c"/><circle cx="66" cy="34" r="20" fill="@c"/><circle cx="34" cy="64" r="20" fill="@c"/><circle cx="66" cy="64" r="20" fill="@c"/><circle cx="50" cy="49" r="14" fill="@c"/>`,
    { motion: "roll", tags: "luck irish lucky" }),

  b("rainbow", "Rainbow", "#ffffff", [50, 74, 18, 0.9],
    `<g fill="none" stroke-width="7"><path d="M8 82 A42 42 0 0 1 92 82" stroke="#ff5a5f"/><path d="M15 82 A35 35 0 0 1 85 82" stroke="#ff9a3d"/><path d="M22 82 A28 28 0 0 1 78 82" stroke="#ffd23f"/><path d="M29 82 A21 21 0 0 1 71 82" stroke="#4cd08a"/><path d="M36 82 A14 14 0 0 1 64 82" stroke="#58b0ff"/></g>
     <g class="a-drift"><circle cx="14" cy="82" r="10" fill="@c"/><circle cx="26" cy="84" r="9" fill="@c"/><rect x="8" y="82" width="24" height="10" rx="5" fill="@c"/></g>
     <g class="a-drift" style="animation-delay:-1.6s"><circle cx="86" cy="82" r="10" fill="@c"/><circle cx="74" cy="84" r="9" fill="@c"/><rect x="68" y="82" width="24" height="10" rx="5" fill="@c"/></g>`,
    { blush: false, motion: "float", tags: "pride colors sky" }),

  b("planet", "Planet", "#f59e0b", [50, 50, 22],
    `<circle cx="50" cy="50" r="30" fill="@c"/>
     <circle cx="34" cy="68" r="5" fill="@d" opacity=".55"/><circle cx="70" cy="34" r="4" fill="@d" opacity=".55"/><circle cx="68" cy="68" r="6" fill="@d" opacity=".4"/>
     <ellipse cx="50" cy="52" rx="46" ry="11" transform="rotate(-20 50 52)" fill="none" stroke="@l" stroke-width="6" opacity=".9"/>`,
    { motion: "roll", tags: "space saturn galaxy" }),

  b("heart", "Heart", "#ff4d79", [50, 46, 22],
    `<path d="M50 90 C14 62 6 40 18 24 C30 10 46 16 50 30 C54 16 70 10 82 24 C94 40 86 62 50 90Z" fill="@c"/>` +
    shine(30, 30, 5, 8, 40),
    { motion: "pulse", tags: "love like favorite" }),

  b("gem", "Gem", "#22d3ee", [50, 50, 24],
    `<path d="M24 14 H76 L96 40 L50 92 L4 40Z" fill="@c"/>
     <path d="M4 40 H96 M24 14 L38 40 L50 14 L62 40 L76 14 M38 40 L50 92 L62 40" stroke="@l" stroke-width="2" fill="none" opacity=".5" stroke-linejoin="round"/>
     <path d="M24 14 L38 40 L50 14Z" fill="#fff" opacity=".25"/>`,
    { motion: "pulse", tags: "diamond crystal jewel premium" }),

  b("comet", "Comet", "#a78bfa", [62, 62, 18],
    `<path d="M52 44 C40 30 24 18 4 8 C16 26 18 44 36 62Z" fill="@l" opacity=".8" class="a-glow"/>
     <path d="M44 66 C30 64 14 68 2 78 C20 80 34 84 48 82Z" fill="@l" opacity=".55" class="a-glow"/>
     <circle cx="62" cy="62" r="26" fill="@c"/>` +
    shine(52, 50, 4, 7, 40),
    { motion: "float", tags: "space shooting star" }),
];
