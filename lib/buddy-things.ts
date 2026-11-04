import { b, both, rays, shine, type BuddyDef } from "@/lib/buddy-kit";

export const THINGS: BuddyDef[] = [
  b("bulb", "Light bulb", "#ffd23f", [50, 40, 20],
    `<g class="a-glow">${rays(50, 40, 36, 46, 8, 3.6, "@y", 22)}</g>
     <circle cx="50" cy="40" r="28" fill="@c"/>
     <path d="M36 62 Q50 74 64 62 L62 74 H38Z" fill="@c"/>
     <rect x="38" y="72" width="24" height="16" rx="5" fill="#c9ced8"/>
     <path d="M38 78 H62 M40 83 H60" stroke="#8d93a1" stroke-width="2" stroke-linecap="round"/>` +
    shine(36, 28),
    { motion: "pulse", tags: "idea light lamp" }),

  b("mug", "Mug", "#f4f4f4", [46, 56, 20],
    `<g class="a-steam"><path d="M36 22 q-5 -6 0 -12 M50 22 q-5 -6 0 -12" stroke="@d" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/></g>
     <path d="M70 40 Q94 40 90 62 Q86 78 68 76" stroke="@d" stroke-width="8" fill="none" stroke-linecap="round"/>
     <rect x="20" y="28" width="54" height="58" rx="14" fill="@c"/>
     <path d="M22 38 H72" stroke="@d" stroke-width="2.4" opacity=".5"/>`,
    { tags: "coffee tea cup drink" }),

  b("book", "Book", "#b5733a", [54, 52, 22],
    `<rect x="14" y="14" width="72" height="74" rx="8" fill="@c"/>
     <rect x="14" y="14" width="12" height="74" rx="6" fill="@d"/>
     <path d="M36 26 H72 M36 33 H62" stroke="@l" stroke-width="3" stroke-linecap="round" opacity=".8"/>
     <path d="M66 88 V72 L72 77 L78 72 V88Z" fill="@r"/>`,
    { tags: "read study docs" }),

  b("gamepad", "Gamepad", "#ff8c42", [50, 52, 22],
    `<path d="M20 30 H80 C92 30 96 44 92 62 C90 76 80 80 74 74 L66 66 H34 L26 74 C20 80 10 76 8 62 C4 44 8 30 20 30Z" fill="@c"/>
     <path d="M22 50 H34 M28 44 V56" stroke="@d" stroke-width="5" stroke-linecap="round"/>
     <circle cx="73" cy="46" r="3.8" fill="@d"/><circle cx="82" cy="54" r="3.8" fill="@d"/>
     <circle cx="73" cy="62" r="3.2" fill="@d" opacity=".0"/>`,
    { motion: "wiggle", tags: "game play controller" }),

  b("brush", "Paint brush", "#ff3fa4", [38, 66, 15, 0.9],
    `<g class="a-swing obl"><path d="M64 6 L78 18 L54 48 L42 38Z" fill="@d"/>
     <path d="M40 36 L56 50 L50 58 L34 44Z" fill="#c9ced8"/></g>
     <path d="M12 86 C6 62 24 44 42 44 C56 52 60 70 46 82 C36 90 22 90 12 86Z" fill="@c"/>`,
    { motion: "sway", tags: "paint art draw" }),

  b("magnifier", "Magnifier", "#3b82f6", [42, 42, 19],
    `<path d="M64 64 L88 88" stroke="@d" stroke-width="12" stroke-linecap="round"/>
     <circle cx="42" cy="42" r="30" fill="#fff" opacity=".18"/>
     <circle cx="42" cy="42" r="30" fill="none" stroke="@c" stroke-width="9"/>
     <path d="M26 30 Q30 22 38 20" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round" opacity=".6"/>`,
    { motion: "sway", tags: "search find zoom" }),

  b("shield", "Shield", "#2f7bf0", [50, 44, 24],
    `<path d="M50 8 L84 20 V50 C84 72 68 86 50 94 C32 86 16 72 16 50 V20Z" fill="@c"/>
     <path d="M50 8 L50 94 C32 86 16 72 16 50 V20Z" fill="#fff" opacity=".14"/>
     <path d="M50 14 L78 24 V50 C78 68 64 80 50 87" fill="none" stroke="@l" stroke-width="2.6" opacity=".6"/>`,
    { tags: "security protect guard" }),

  b("chat", "Chat bubble", "#a855f7", [50, 42, 26],
    `<path d="M24 66 L20 90 L46 70Z" fill="@c"/>
     <rect x="8" y="12" width="84" height="62" rx="24" fill="@c"/>` +
    shine(24, 26, 5, 3, -30),
    { motion: "hop", tags: "message talk comment" }),

  b("teapot", "Teapot", "#1fb5a8", [46, 56, 22],
    `<g class="a-steam"><path d="M14 20 q-5 -6 0 -12" stroke="@d" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/></g>
     <path d="M72 42 Q96 42 92 64 Q88 78 72 74" stroke="@d" stroke-width="7" fill="none" stroke-linecap="round"/>
     <path d="M20 54 Q4 50 6 32 Q12 40 24 44Z" fill="@c"/>
     <ellipse cx="48" cy="58" rx="31" ry="27" fill="@c"/>
     <ellipse cx="48" cy="32" rx="18" ry="6" fill="@d"/><circle cx="48" cy="24" r="5" fill="@d"/>`,
    { tags: "tea drink kettle" }),

  b("wizard-hat", "Wizard hat", "#7c3aed", [50, 68, 22],
    `<path d="M18 80 Q40 72 44 46 Q46 22 62 6 Q60 30 72 54 Q80 72 90 80 Q50 94 18 80Z" fill="@c"/>
     <path d="M20 78 Q50 90 88 78 L90 82 Q50 96 18 82Z" fill="@d"/>
     <path d="M30 76 Q50 84 80 74 L81 70 Q50 80 30 72Z" fill="@y"/>
     <path d="M55 36 l2 5 l5 .5 l-4 3.5 l1.4 5 l-4.4 -2.8 l-4.4 2.8 l1.4 -5 l-4 -3.5 l5 -.5z" fill="@y" class="a-twinkle"/>`,
    { motion: "sway", tags: "magic witch fantasy" }),

  b("castle", "Castle", "#8b94a6", [50, 58, 22],
    `<path d="M50 22 V6" stroke="@d" stroke-width="2.6"/><path d="M50 6 L68 12 L50 18Z" fill="@r" class="a-wag obl"/>
     <path d="M16 90 V36 H22 V26 H32 V36 H40 V26 H60 V36 H68 V26 H78 V36 H84 V90Z" fill="@c"/>
     <path d="M16 36 H84" stroke="@d" stroke-width="2" opacity=".5"/>
     <path d="M42 90 V78 C42 68 58 68 58 78 V90Z" fill="@d"/>`,
    { tags: "tower king medieval" }),

  b("bell", "Bell", "#b0b6c4", [50, 48, 22],
    `<circle cx="50" cy="9" r="5" fill="@d"/>
     <g class="a-swing ot"><path d="M50 12 C30 12 24 32 24 50 C24 66 14 72 12 80 H88 C86 72 76 66 76 50 C76 32 70 12 50 12Z" fill="@c"/><circle cx="50" cy="86" r="7.5" fill="@d"/></g>`,
    { motion: "wiggle", tags: "alert notification ring" }),

  b("rocket", "Rocket", "#f0f3f8", [50, 38, 16, 0.75],
    `<g class="a-flick ot"><path d="M38 78 Q50 108 62 78Z" fill="@o"/><path d="M44 78 Q50 96 56 78Z" fill="@y"/></g>` +
    both(`<path d="M34 56 L14 78 L14 90 L36 80Z" fill="@r"/>`) +
    `<path d="M50 4 C72 20 74 52 66 80 H34 C26 52 28 20 50 4Z" fill="@c"/>
     <circle cx="50" cy="38" r="15" fill="@b"/>
     <path d="M34 66 H66" stroke="@r" stroke-width="5"/>`,
    { blush: false, motion: "float", tags: "space launch startup" }),

  b("ufo", "UFO", "#9aa7b8", [50, 38, 16, 0.8],
    `<circle cx="50" cy="42" r="22" fill="@s" opacity=".7"/>
     <ellipse cx="50" cy="60" rx="42" ry="15" fill="@c"/>
     <ellipse cx="50" cy="56" rx="42" ry="10" fill="@l" opacity=".35"/>
     <circle cx="24" cy="62" r="3.4" fill="@y" class="a-beacon"/><circle cx="50" cy="66" r="3.4" fill="@y" class="a-beacon" style="animation-delay:.4s"/><circle cx="76" cy="62" r="3.4" fill="@y" class="a-beacon" style="animation-delay:.8s"/>`,
    { blush: false, motion: "float", tags: "alien space saucer" }),

  b("battery", "Battery", "#4cd08a", [46, 50, 22],
    `<rect x="78" y="40" width="10" height="20" rx="4" fill="@d"/>
     <rect x="12" y="26" width="68" height="48" rx="12" fill="@c"/>
     <rect x="18" y="32" width="56" height="36" rx="8" fill="@l" opacity=".28"/>
     <path d="M62 38 L52 52 H60 L56 64" stroke="@w" stroke-width="0" fill="none"/>`,
    { motion: "pulse", tags: "power energy charge" }),

  b("phone", "Phone", "#6366f1", [50, 46, 18],
    `<rect x="26" y="6" width="48" height="88" rx="13" fill="@c"/>
     <rect x="32" y="16" width="36" height="64" rx="6" fill="@l" opacity=".5"/>
     <rect x="42" y="9" width="16" height="3.4" rx="1.7" fill="@d"/>
     <rect x="42" y="85" width="16" height="3.4" rx="1.7" fill="@d"/>`,
    { tags: "mobile app call" }),

  b("laptop", "Laptop", "#94a3b8", [50, 40, 22],
    `<rect x="14" y="14" width="72" height="52" rx="7" fill="@c"/>
     <rect x="19" y="19" width="62" height="42" rx="4" fill="#161b27"/>
     <path d="M6 70 H94 L88 84 H12Z" fill="@d"/>
     <rect x="42" y="72" width="16" height="3" rx="1.5" fill="@l" opacity=".7"/>`,
    { ink: "#7ef0ff", blush: false, tags: "computer code work" }),

  b("camera", "Camera", "#475569", [50, 58, 18, 0.8],
    `<rect x="34" y="16" width="32" height="14" rx="5" fill="@d"/>
     <rect x="8" y="26" width="84" height="62" rx="13" fill="@c"/>
     <rect x="14" y="32" width="10" height="6" rx="3" fill="@y"/>
     <circle cx="50" cy="58" r="25" fill="@d"/>
     <circle cx="50" cy="58" r="20" fill="@s"/>`,
    { ink: "#1d1b29", blush: false, tags: "photo picture snap" }),

  b("headphones", "Headphones", "#f43f5e", [50, 60, 22],
    `<path d="M14 60 C14 14 86 14 86 60" stroke="@c" stroke-width="9" fill="none" stroke-linecap="round"/>
     <circle cx="50" cy="62" r="27" fill="@l"/>` +
    both(`<rect x="6" y="48" width="20" height="38" rx="10" fill="@c"/><rect x="10" y="54" width="7" height="26" rx="3.5" fill="@d"/>`),
    { motion: "wiggle", tags: "music audio listen" }),

  b("lock", "Lock", "#f59e0b", [50, 62, 20],
    `<path d="M32 46 V32 C32 10 68 10 68 32 V46" stroke="@d" stroke-width="9" fill="none" stroke-linecap="round"/>
     <rect x="18" y="42" width="64" height="48" rx="13" fill="@c"/>
     <circle cx="50" cy="76" r="3.6" fill="@d"/><rect x="48" y="76" width="4" height="8" rx="2" fill="@d"/>`,
    { tags: "secure password privacy vault" }),

  b("key", "Key", "#fbbf24", [32, 38, 17],
    `<g transform="rotate(42 32 38)"><rect x="50" y="33" width="46" height="10" rx="4" fill="@d"/><rect x="78" y="42" width="7" height="12" rx="2" fill="@d"/><rect x="88" y="42" width="7" height="9" rx="2" fill="@d"/></g>
     <circle cx="32" cy="38" r="27" fill="@c"/>
     <circle cx="32" cy="38" r="22" fill="@l" opacity=".25"/>`,
    { motion: "sway", tags: "access login password" }),

  b("gear", "Gear", "#78839a", [50, 50, 22],
    `<g class="a-spin">${rays(50, 50, 26, 40, 8, 13, "@c", 0)}<circle cx="50" cy="50" r="33" fill="@c"/></g>
     <circle cx="50" cy="50" r="25" fill="@l" opacity=".35"/>`,
    { motion: "roll", tags: "settings cog config" }),

  b("clock", "Clock", "#ef4444", [50, 44, 22, 0.8],
    `<circle cx="22" cy="20" r="9" fill="@d"/><circle cx="78" cy="20" r="9" fill="@d"/>
     <circle cx="50" cy="54" r="36" fill="@c"/>
     <circle cx="50" cy="54" r="29" fill="#fff"/>
     <g class="a-tick"><path d="M50 54 V32" stroke="@k" stroke-width="2.6" stroke-linecap="round"/></g>
     <g class="a-tock"><path d="M50 54 V40" stroke="@k" stroke-width="3.6" stroke-linecap="round"/></g>
     <circle cx="50" cy="54" r="3" fill="@d"/>`,
    { blush: false, tags: "time alarm watch" }),

  b("mail", "Mail", "#38bdf8", [50, 66, 26, 0.9],
    `<rect x="8" y="22" width="84" height="62" rx="12" fill="@c"/>
     <path d="M8 34 Q8 22 20 22 H80 Q92 22 92 34 L50 56Z" fill="@l"/>`,
    { motion: "hop", tags: "email letter inbox" }),

  b("folder", "Folder", "#fbbf24", [50, 62, 24],
    `<path d="M8 28 Q8 18 18 18 H38 L46 26 H82 Q92 26 92 36 V78 Q92 88 82 88 H18 Q8 88 8 78Z" fill="@d"/>
     <path d="M8 42 Q8 36 16 36 H84 Q92 36 92 42 V78 Q92 88 82 88 H18 Q8 88 8 78Z" fill="@c"/>`,
    { tags: "files documents" }),

  b("cube", "Cube", "#8b5cf6", [44, 64, 24],
    `<path d="M14 38 L28 20 H90 L74 38Z" fill="@l"/>
     <path d="M74 38 L90 20 V72 L74 90Z" fill="@d"/>
     <rect x="14" y="38" width="60" height="52" rx="5" fill="@c"/>`,
    { motion: "roll", tags: "box 3d block dice" }),

  b("pencil", "Pencil", "#ffcc33", [50, 50, 16, 0.9],
    `<rect x="34" y="6" width="32" height="14" rx="6" fill="@p"/>
     <rect x="34" y="18" width="32" height="9" fill="#c9ced8"/>
     <rect x="34" y="27" width="32" height="48" fill="@c"/>
     <path d="M34 75 L66 75 L50 96Z" fill="@t"/><path d="M44.5 87 L55.5 87 L50 96Z" fill="@k"/>
     <path d="M42 28 V74 M58 28 V74" stroke="@d" stroke-width="1.6" opacity=".4"/>`,
    { motion: "sway", tags: "write draw edit" }),

  b("paper-plane", "Paper plane", "#60a5fa", [50, 46, 16, 0.8],
    `<path d="M6 46 L94 10 L60 90 L46 60Z" fill="@c"/>
     <path d="M46 60 L94 10 L36 52Z" fill="@d"/>
     <path d="M46 60 L50 80 L60 90Z" fill="@l"/>`,
    { motion: "float", tags: "send message telegram fly" }),

  b("crown", "Crown", "#fbbf24", [50, 56, 26],
    `<path d="M12 76 L6 28 L30 50 L50 16 L70 50 L94 28 L88 76Z" fill="@c"/>
     <rect x="12" y="68" width="76" height="16" rx="6" fill="@d"/>
     <circle cx="6" cy="26" r="4.6" fill="@y"/><circle cx="50" cy="14" r="4.6" fill="@y"/><circle cx="94" cy="26" r="4.6" fill="@y"/>
     <circle cx="30" cy="76" r="3.6" fill="@r"/><circle cx="50" cy="76" r="3.6" fill="@b"/><circle cx="70" cy="76" r="3.6" fill="@r"/>`,
    { motion: "hop", tags: "king queen royal boss" }),

  b("globe", "Globe", "#38bdf8", [50, 50, 24],
    `<rect x="34" y="88" width="32" height="6" rx="3" fill="@d"/><path d="M50 84 V90" stroke="@d" stroke-width="4"/>
     <circle cx="50" cy="50" r="37" fill="@c"/>
     <path d="M24 34 C30 22 44 20 46 30 C48 38 36 40 38 50 C32 52 24 46 24 34Z M58 56 C70 50 80 56 76 68 C70 78 60 74 58 66Z M62 24 C70 22 78 28 74 34 C68 34 62 32 62 24Z" fill="@g" opacity=".85"/>
     <ellipse cx="38" cy="30" rx="5" ry="9" transform="rotate(30 38 30)" fill="#fff" opacity=".28"/>`,
    { motion: "roll", tags: "world earth web internet" }),

  b("bolt", "Lightning", "#facc15", [50, 44, 14, 0.85],
    `<path d="M60 3 L16 56 H42 L34 97 L84 36 H56Z" fill="@c"/>
     <path d="M60 3 L38 30 L52 30Z" fill="#fff" opacity=".3"/>`,
    { motion: "pulse", tags: "fast power energy electric" }),

  b("trophy", "Trophy", "#fbbf24", [50, 34, 22],
    both(`<path d="M26 20 C6 20 6 46 28 48" stroke="@d" stroke-width="6" fill="none" stroke-linecap="round"/>`) +
    `<path d="M24 10 H76 V40 C76 58 62 66 50 66 C38 66 24 58 24 40Z" fill="@c"/>
     <rect x="43" y="64" width="14" height="14" fill="@d"/>
     <rect x="28" y="78" width="44" height="14" rx="5" fill="@d"/>`,
    { motion: "hop", tags: "win prize award champion" }),

  b("magnet", "Magnet", "#ef4444", [50, 46, 52, 0.9],
    `<path d="M24 20 V52 C24 86 76 86 76 52 V20" stroke="@c" stroke-width="22" fill="none"/>
     <rect x="13" y="12" width="22" height="18" rx="3" fill="#e5e7eb"/><rect x="65" y="12" width="22" height="18" rx="3" fill="#e5e7eb"/>`,
    { blush: false, motion: "wiggle", tags: "attract pull" }),

  b("chip", "Chip", "#22c55e", [50, 50, 24],
    `<g fill="@d">${[0, 1, 2, 3].map((i) => `<rect x="${28 + i * 14}" y="8" width="6" height="14" rx="2"/><rect x="${28 + i * 14}" y="78" width="6" height="14" rx="2"/><rect x="8" y="${28 + i * 14}" width="14" height="6" rx="2"/><rect x="78" y="${28 + i * 14}" width="14" height="6" rx="2"/>`).join("")}</g>
     <rect x="18" y="18" width="64" height="64" rx="12" fill="@c"/>
     <rect x="26" y="26" width="48" height="48" rx="8" fill="@l" opacity=".3"/>`,
    { motion: "pulse", tags: "cpu processor ai hardware" }),

  b("cursor", "Cursor", "#e5e7eb", [38, 42, 15, 0.8],
    `<path d="M22 8 L22 80 L40 63 L52 92 L66 86 L54 58 L80 58Z" fill="@c" stroke="@d" stroke-width="3" stroke-linejoin="round"/>`,
    { blush: false, motion: "sway", tags: "mouse pointer click arrow" }),

  b("terminal", "Terminal", "#1f2937", [50, 56, 22],
    `<rect x="8" y="16" width="84" height="68" rx="13" fill="@c"/>
     <path d="M8 29 Q8 16 21 16 H79 Q92 16 92 29 V34 H8Z" fill="@d"/>
     <circle cx="20" cy="25" r="3" fill="@r"/><circle cx="30" cy="25" r="3" fill="@y"/><circle cx="40" cy="25" r="3" fill="@g"/>
     <path d="M18 66 L26 72 L18 78" stroke="@g" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
     <rect x="32" y="76" width="12" height="3" rx="1.5" fill="@g" class="a-beacon"/>`,
    { ink: "#6ee7b7", blush: false, tags: "code console shell dev" }),

  b("balloon", "Balloon", "#ef4444", [50, 38, 22],
    `<path d="M50 74 q-8 8 0 14 q8 6 0 10" stroke="@d" stroke-width="2" fill="none" stroke-linecap="round" class="a-wave ot"/>
     <path d="M44 76 L50 68 L56 76Z" fill="@d"/>
     <ellipse cx="50" cy="40" rx="28" ry="33" fill="@c"/>` +
    shine(36, 26, 5, 9, 25),
    { motion: "float", tags: "party birthday celebrate" }),

  b("gift", "Gift", "#ec4899", [50, 62, 30],
    `<rect x="16" y="42" width="68" height="46" rx="6" fill="@c"/>
     <rect x="10" y="30" width="80" height="16" rx="5" fill="@d"/>
     <rect x="44" y="30" width="12" height="58" fill="@y"/>
     <ellipse cx="38" cy="24" rx="12" ry="8" transform="rotate(-20 38 24)" fill="@y"/><ellipse cx="62" cy="24" rx="12" ry="8" transform="rotate(20 62 24)" fill="@y"/><circle cx="50" cy="29" r="5" fill="#f5b300"/>`,
    { motion: "hop", tags: "present birthday surprise" }),

  b("umbrella", "Umbrella", "#f97316", [50, 38, 24],
    `<path d="M50 52 V82 Q50 94 38 90" stroke="@d" stroke-width="4.4" fill="none" stroke-linecap="round"/>
     <path d="M6 54 C6 14 94 14 94 54 Q82 44 72 54 Q61 44 50 54 Q39 44 28 54 Q17 44 6 54Z" fill="@c"/>
     <path d="M50 14 V52 M28 22 Q34 38 28 54 M72 22 Q66 38 72 54" stroke="@d" stroke-width="2" fill="none" opacity=".45"/>`,
    { motion: "sway", tags: "rain weather" }),

  b("hourglass", "Hourglass", "#f59e0b", [50, 30, 15, 0.8],
    `<path d="M24 14 H76 C76 38 58 44 58 50 C58 56 76 62 76 86 H24 C24 62 42 56 42 50 C42 44 24 38 24 14Z" fill="@s" opacity=".5"/>
     <path d="M28 16 H72 C70 34 58 40 54 46 H46 C42 40 30 34 28 16Z" fill="@c"/>
     <path d="M32 84 C34 70 44 62 50 62 C56 62 66 70 68 84Z" fill="@c"/>
     <path d="M50 46 V62" stroke="@c" stroke-width="2" class="a-glow"/>
     <rect x="18" y="8" width="64" height="9" rx="4.5" fill="@d"/><rect x="18" y="84" width="64" height="9" rx="4.5" fill="@d"/>`,
    { motion: "wiggle", tags: "time wait loading" }),

  b("lantern", "Lantern", "#f43f5e", [50, 50, 22],
    `<path d="M50 4 V14" stroke="@d" stroke-width="3"/>
     <rect x="36" y="12" width="28" height="9" rx="3" fill="@y"/><rect x="36" y="81" width="28" height="9" rx="3" fill="@y"/>
     <ellipse cx="50" cy="51" rx="32" ry="32" fill="@c"/>
     <path d="M50 19 C40 30 40 72 50 83 M50 19 C60 30 60 72 50 83" stroke="@d" stroke-width="2" fill="none" opacity=".5"/>
     <g class="a-swing ot"><path d="M50 90 V98" stroke="@y" stroke-width="3" stroke-linecap="round"/></g>`,
    { motion: "float", tags: "light festival diwali" }),

  b("scroll", "Scroll", "#f5deb3", [50, 50, 22],
    `<rect x="16" y="22" width="68" height="56" rx="4" fill="@c"/>
     <ellipse cx="16" cy="50" rx="9" ry="31" fill="@d"/><ellipse cx="84" cy="50" rx="9" ry="31" fill="@d"/>
     <ellipse cx="16" cy="50" rx="4" ry="12" fill="@c"/><ellipse cx="84" cy="50" rx="4" ry="12" fill="@c"/>
     <path d="M30 66 H70 M36 72 H64" stroke="@d" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>`,
    { tags: "paper note document old" }),

  b("tv", "TV", "#64748b", [50, 54, 24],
    `<path d="M30 16 L46 28 M70 16 L54 28" stroke="@d" stroke-width="3" stroke-linecap="round"/>
     <rect x="8" y="26" width="84" height="58" rx="13" fill="@c"/>
     <rect x="16" y="33" width="68" height="44" rx="7" fill="#161b27"/>
     <path d="M26 86 L22 94 M74 86 L78 94" stroke="@d" stroke-width="3.4" stroke-linecap="round"/>`,
    { ink: "#7ef0ff", blush: false, tags: "screen video watch" }),
];
