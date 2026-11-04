import { b, both, ring, type BuddyDef } from "@/lib/buddy-kit";

export const CREATURES: BuddyDef[] = [
  b("ghost", "Ghost", "#f4f4f8", [50, 44, 20, 1.1],
    `<path d="M20 90 V46 C20 24 33 12 50 12 C67 12 80 24 80 46 V90 L70 81 L60 90 L50 81 L40 90 L30 81 Z" fill="@c"/>` +
    both(`<ellipse cx="17" cy="60" rx="6" ry="9" transform="rotate(20 17 60)" fill="@c"/>`) +
    `<ellipse cx="35" cy="28" rx="4.4" ry="8" transform="rotate(24 35 28)" fill="#fff" opacity=".7"/>`,
    { motion: "float", tags: "boo halloween spooky" }),

  b("imp", "Imp", "#ee1c25", [50, 56, 26],
    both(`<path d="M28 34 L22 8 L42 26Z" fill="@d"/>`) +
    both(`<path d="M18 52 L2 46 L10 58 L4 68 L20 64Z" fill="@d" class="a-flap or"/>`) +
    `<path d="M82 82 C96 84 98 70 92 64 L98 62 L90 58" stroke="@d" stroke-width="4" fill="none" stroke-linecap="round" class="a-wag obl"/>
     <ellipse cx="50" cy="58" rx="34" ry="29" fill="@c"/>
     <path d="M42 74 l3 6 l3 -6 M52 74 l3 6 l3 -6" fill="@w"/>`,
    { motion: "hop", tags: "devil demon halloween" }),

  b("bull", "Bull", "#e03a3a", [50, 48, 26],
    both(`<path d="M26 34 C8 34 4 16 8 8 C12 20 22 22 34 26Z" fill="@t"/>`) +
    both(`<ellipse cx="17" cy="46" rx="10" ry="6" transform="rotate(24 17 46)" fill="@d"/>`) +
    `<ellipse cx="50" cy="55" rx="28" ry="31" fill="@c"/>
     <ellipse cx="50" cy="71" rx="17" ry="12" fill="@l"/>
     <ellipse cx="43" cy="71" rx="2.6" ry="3.4" fill="@k"/><ellipse cx="57" cy="71" rx="2.6" ry="3.4" fill="@k"/>
     <circle cx="50" cy="80" r="5" fill="none" stroke="@y" stroke-width="2.4"/>`,
    { tags: "devil horns bison" }),

  b("alien", "Alien", "#7ddc6b", [50, 46, 32, 1.35],
    `<path d="M50 14 V6" stroke="@d" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="5" r="4.4" fill="@y" class="a-glow"/>
     <path d="M50 90 C34 90 14 68 14 44 C14 24 32 13 50 13 C68 13 86 24 86 44 C86 68 66 90 50 90Z" fill="@c"/>
     <ellipse cx="36" cy="28" rx="5" ry="8" transform="rotate(30 36 28)" fill="#fff" opacity=".3"/>`,
    { face: "round", motion: "float", tags: "ufo space ET" }),

  b("skull", "Skull", "#f4f1e6", [50, 48, 26, 1.1],
    `<ellipse cx="50" cy="46" rx="33" ry="31" fill="@c"/>
     <rect x="33" y="64" width="34" height="22" rx="7" fill="@c"/>
     <path d="M44 66 V84 M50 66 V84 M56 66 V84" stroke="@d" stroke-width="2.2" stroke-linecap="round"/>
     <path d="M47 58 L50 52 L53 58Z" fill="@d"/>`,
    { face: "round", blush: false, motion: "wiggle", tags: "halloween bones" }),

  b("slime", "Slime", "#6ee06e", [50, 58, 24, 1.05],
    `<path d="M10 88 C4 62 22 26 50 26 C78 26 96 62 90 88 Q50 95 10 88Z" fill="@c"/>
     <path d="M24 90 q2 6 5 0 M66 90 q2 7 6 0" stroke="@c" stroke-width="4" stroke-linecap="round" fill="none"/>
     <ellipse cx="32" cy="44" rx="6" ry="9" transform="rotate(30 32 44)" fill="#fff" opacity=".4"/>
     <circle cx="68" cy="40" r="2.6" fill="@l"/>`,
    { motion: "hop", tags: "goo jelly" }),

  b("blob", "Blob", "#ff9ad5", [48, 52, 24],
    `<path d="M18 70 C4 50 18 20 46 20 C74 14 96 34 90 62 C86 86 54 94 30 88 C24 84 20 78 18 70Z" fill="@c"/>
     <ellipse cx="36" cy="34" rx="7" ry="4.4" transform="rotate(-20 36 34)" fill="#fff" opacity=".4"/>`,
    { motion: "roll", tags: "round jelly" }),

  b("robot", "Robot", "#9bb5d6", [50, 52, 26],
    `<path d="M50 24 V12" stroke="@d" stroke-width="3.4" stroke-linecap="round"/><circle cx="50" cy="10" r="5" fill="@r" class="a-beacon"/>` +
    both(`<rect x="8" y="42" width="10" height="20" rx="4" fill="@d"/>`) +
    `<rect x="16" y="24" width="68" height="62" rx="16" fill="@c"/>
     <rect x="24" y="36" width="52" height="38" rx="11" fill="#1a2233"/>
     <path d="M40 80 h20" stroke="@d" stroke-width="3" stroke-linecap="round"/>`,
    { ink: "#7ef0ff", blush: false, tags: "bot ai machine" }),

  b("astronaut", "Astronaut", "#f0f2f7", [50, 52, 22],
    `<path d="M50 16 V6" stroke="@d" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="5" r="3.4" fill="@r" class="a-beacon"/>
     <circle cx="50" cy="52" r="38" fill="@c"/>
     <ellipse cx="50" cy="54" rx="29" ry="25" fill="#263046"/>
     <path d="M30 42 Q38 34 48 36" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round" opacity=".5"/>
     <path d="M22 78 Q50 96 78 78" stroke="@b" stroke-width="6" fill="none" stroke-linecap="round"/>`,
    { ink: "#ffffff", blush: false, motion: "float", tags: "space nasa" }),

  b("ninja", "Ninja", "#2d3142", [50, 53, 24],
    `<circle cx="50" cy="56" r="33" fill="@c"/>
     <rect x="21" y="42" width="58" height="24" rx="12" fill="#f5d4b3"/>
     <path d="M17 38 Q50 28 83 38 L83 46 Q50 36 17 46Z" fill="@r"/>
     <path d="M82 40 L96 32 M82 44 L98 46" stroke="@r" stroke-width="4.4" stroke-linecap="round" class="a-wag otl"/>`,
    { ink: "#1d1b29", blush: false, motion: "hop", tags: "japan stealth" }),

  b("mummy", "Mummy", "#e9e2cf", [50, 52, 24],
    `<ellipse cx="50" cy="56" rx="33" ry="35" fill="@c"/>
     <path d="M20 36 L74 26 M18 46 L80 34 M20 72 L82 62 M26 82 L78 76" stroke="@d" stroke-width="4" stroke-linecap="round"/>
     <rect x="22" y="44" width="56" height="18" rx="9" fill="#2b2b3a"/>`,
    { ink: "#ffffff", blush: false, motion: "wiggle", tags: "halloween egypt" }),

  b("pumpkin", "Pumpkin", "#ff8a2b", [50, 57, 26],
    `<path d="M48 30 Q48 18 58 14" stroke="@g" stroke-width="6" fill="none" stroke-linecap="round"/>
     <ellipse cx="29" cy="60" rx="20" ry="27" fill="@d"/><ellipse cx="71" cy="60" rx="20" ry="27" fill="@d"/>
     <ellipse cx="40" cy="60" rx="20" ry="29" fill="@c"/><ellipse cx="60" cy="60" rx="20" ry="29" fill="@c"/>
     <path d="M50 70 q4 4 8 0" stroke="@k" stroke-width="2" fill="none" stroke-linecap="round" opacity="0"/>`,
    { ink: "#3a1f0a", tags: "halloween autumn" }),

  b("snowman", "Snowman", "#eef6ff", [50, 36, 17],
    `<circle cx="50" cy="71" r="23" fill="@c"/><circle cx="50" cy="38" r="20" fill="@c"/>
     <path d="M24 62 L8 52 M76 62 L92 52" stroke="@n" stroke-width="3.4" stroke-linecap="round"/>
     <path d="M32 55 Q50 66 68 55" stroke="@r" stroke-width="7" fill="none" stroke-linecap="round"/>
     <path d="M50 42 L62 46 L50 49Z" fill="@o"/>
     <circle cx="50" cy="72" r="2.6" fill="@k"/><circle cx="50" cy="82" r="2.6" fill="@k"/>`,
    { tags: "winter christmas snow" }),

  b("angel", "Angel", "#fff6e8", [50, 58, 24],
    both(`<path d="M22 62 C4 58 2 40 6 32 C16 36 24 42 30 52Z" fill="#fff" stroke="#e3d9c6" stroke-width="1.6" class="a-flap or"/>`) +
    `<ellipse cx="50" cy="12" rx="17" ry="5.4" fill="none" stroke="@y" stroke-width="4" class="a-glow"/>
     <ellipse cx="50" cy="60" rx="30" ry="31" fill="@c"/>
     <ellipse cx="36" cy="44" rx="4.4" ry="7" transform="rotate(24 36 44)" fill="#fff" opacity=".7"/>`,
    { motion: "float", tags: "halo heaven wings" }),

  b("monster", "Monster", "#8f6bff", [50, 46, 28, 1.1],
    both(`<path d="M32 26 L26 6 L44 20Z" fill="@y"/>`) +
    ring(50, 56, 31, 14, 9, "@c") +
    `<ellipse cx="50" cy="56" rx="32" ry="32" fill="@c"/>
     <path d="M30 66 Q50 84 70 66 Q50 74 30 66Z" fill="@k"/>
     <path d="M36 68 l4 5 l4 -4 M46 71 l4 5 l4 -5 M56 70 l4 4 l4 -5" fill="@w"/>`,
    { face: "round", motion: "hop", tags: "furry fuzzy" }),

  b("cyclops", "Cyclops", "#4dd0e1", [50, 46, 0, 2.1],
    both(`<path d="M30 30 L28 16 L40 26Z" fill="@d"/>`) +
    `<circle cx="50" cy="56" r="34" fill="@c"/>
     <circle cx="50" cy="46" r="18" fill="@w"/>
     <path d="M38 74 Q50 84 62 74" stroke="@d" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    { face: "round", blush: false, tags: "one eye giant" }),

  b("yeti", "Yeti", "#e8f1f8", [50, 54, 22],
    ring(50, 52, 27, 11, 11, "@c") +
    `<circle cx="50" cy="54" r="30" fill="@c"/>
     <ellipse cx="50" cy="58" rx="22" ry="19" fill="#9ec3e0"/>
     <path d="M42 70 Q50 76 58 70" stroke="@k" stroke-width="2.2" fill="none" stroke-linecap="round"/>
     <path d="M30 28 L26 16 L38 24Z M70 28 L74 16 L62 24Z" fill="#9ec3e0"/>`,
    { blush: false, tags: "snow bigfoot abominable" }),

  b("knight", "Knight", "#b8c2d1", [50, 53, 22, 0.75],
    `<path d="M50 24 Q40 4 58 6 Q50 14 56 24Z" fill="@r" class="a-wag ob"/>
     <rect x="20" y="20" width="60" height="68" rx="26" fill="@c"/>
     <rect x="26" y="44" width="48" height="18" rx="9" fill="#1d2230"/>
     <path d="M50 64 V86 M36 70 H64" stroke="@d" stroke-width="2.4" stroke-linecap="round"/>`,
    { ink: "#ffffff", blush: false, tags: "armor medieval helmet" }),

  b("pirate", "Pirate", "#f1c9a0", [64, 57, 0, 1.05],
    `<circle cx="50" cy="60" r="31" fill="@c"/>
     <path d="M16 46 C20 8 80 8 84 46 C68 38 32 38 16 46Z" fill="@k"/>
     <path d="M44 24 l4 -4 l4 4 l-4 4z" fill="@w"/>
     <path d="M20 50 L78 60" stroke="@k" stroke-width="2.4"/>
     <circle cx="36" cy="57" r="9" fill="@k"/>
     <path d="M40 74 Q50 80 60 74" stroke="@d" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
    { face: "round", tags: "ship sea captain" }),

  b("vampire", "Vampire", "#e8e4f4", [50, 56, 26],
    `<circle cx="50" cy="58" r="31" fill="@c"/>
     <path d="M18 52 C16 14 84 14 82 52 C76 38 64 32 50 44 C36 32 24 38 18 52Z" fill="@k"/>
     <path d="M20 84 L8 96 L30 90Z M80 84 L92 96 L70 90Z" fill="@r"/>
     <path d="M42 72 Q50 77 58 72" stroke="@k" stroke-width="2" fill="none" stroke-linecap="round"/>
     <path d="M43 73 l2 6 l2 -5 M53 74 l2 5 l2 -6" fill="@w" stroke="@k" stroke-width=".6"/>`,
    { tags: "dracula halloween" }),

  b("witch", "Witch", "#7bd77b", [50, 62, 24],
    `<circle cx="50" cy="64" r="28" fill="@c"/>
     <path d="M24 44 C14 56 16 74 24 84 M76 44 C86 56 84 74 76 84" stroke="@k" stroke-width="6" fill="none" stroke-linecap="round"/>
     <path d="M30 42 L54 4 Q60 22 72 42Z" fill="#6c3fc5"/>
     <ellipse cx="50" cy="44" rx="36" ry="8" fill="#55309f"/>
     <path d="M34 36 Q50 42 66 36 L67 41 Q50 47 33 41Z" fill="@y"/>
     <circle cx="66" cy="74" r="2" fill="@d"/>`,
    { tags: "halloween magic hat" }),

  b("zombie", "Zombie", "#9ccf7e", [50, 54, 26],
    `<path d="M22 40 L28 26 L36 36 L44 22 L52 34 L62 22 L68 36 L76 28 L80 42Z" fill="#4a3b52"/>
     <ellipse cx="50" cy="58" rx="33" ry="30" fill="@c"/>
     <path d="M24 38 Q50 30 76 38" stroke="@d" stroke-width="2.4" fill="none" stroke-dasharray="3 3"/>
     <path d="M64 66 h10 M66 62 v8 M70 62 v8" stroke="@d" stroke-width="1.8" stroke-linecap="round"/>
     <path d="M36 75 L40 71 L44 75 L48 71 L52 75 L56 71 L60 75" stroke="@d" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    { motion: "sway", tags: "halloween undead" }),
];