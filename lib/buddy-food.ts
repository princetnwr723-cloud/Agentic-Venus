import { b, shine, type BuddyDef } from "@/lib/buddy-kit";

export const FOOD: BuddyDef[] = [
  b("donut", "Donut", "#ff8fc7", [50, 40, 26],
    `<circle cx="50" cy="54" r="38" fill="#e0a96d"/>
     <path d="M16 52 C14 30 32 16 50 16 C68 16 86 30 84 52 C86 62 80 68 74 64 C70 72 62 70 58 76 C52 82 44 76 40 72 C34 76 26 72 24 64 C18 68 14 60 16 52Z" fill="@c"/>
     <ellipse cx="50" cy="64" rx="9" ry="6.4" fill="#c98f55"/>
     <g stroke-width="3.2" stroke-linecap="round"><path d="M28 34 l4 -2" stroke="@w"/><path d="M68 30 l4 3" stroke="#ffd23f"/><path d="M74 50 l4 -2" stroke="#58b0ff"/><path d="M24 54 l4 2" stroke="#4cd08a"/><path d="M60 22 l3 -3" stroke="@w"/><path d="M38 22 l-4 1" stroke="#ffd23f"/></g>`,
    { motion: "roll", tags: "sweet dessert snack" }),

  b("pizza", "Pizza", "#ffc233", [50, 38, 24, 0.9],
    `<path d="M6 20 Q50 2 94 20 L50 94Z" fill="@c"/>
     <path d="M6 20 Q50 2 94 20 L91 31 Q50 14 9 31Z" fill="#e0a05a"/>
     <circle cx="30" cy="46" r="6" fill="@r"/><circle cx="68" cy="46" r="6" fill="@r"/><circle cx="50" cy="68" r="5.4" fill="@r"/><circle cx="44" cy="54" r="2" fill="@g"/><circle cx="58" cy="58" r="2" fill="@g"/>`,
    { motion: "wiggle", tags: "food italian slice" }),

  b("icecream", "Ice cream", "#ff9ad5", [50, 34, 22],
    `<path d="M30 54 L70 54 L50 96Z" fill="#e8b27a"/>
     <path d="M36 62 L56 62 M42 74 L58 72 M33 58 L58 82 M67 58 L42 82" stroke="#c98f55" stroke-width="1.6" opacity=".7"/>
     <circle cx="50" cy="36" r="27" fill="@c"/>
     <path d="M23 44 Q28 60 37 48 Q43 62 52 48 Q60 60 66 48 Q72 60 77 44Z" fill="@c"/>
     <circle cx="50" cy="8" r="5" fill="@r"/>` +
    shine(36, 26, 4, 7, 30),
    { motion: "sway", tags: "dessert cold summer" }),

  b("cupcake", "Cupcake", "#ff9ad5", [50, 42, 24, 0.9],
    `<path d="M22 56 H78 L72 92 H28Z" fill="#f2b27a"/>
     <path d="M34 58 L36 90 M46 58 V90 M58 58 V90 M70 58 L66 90" stroke="#d98f55" stroke-width="2.4"/>
     <ellipse cx="50" cy="54" rx="34" ry="12" fill="@c"/><ellipse cx="50" cy="40" rx="27" ry="14" fill="@c"/><ellipse cx="50" cy="26" rx="16" ry="11" fill="@c"/>
     <circle cx="50" cy="12" r="5" fill="@r"/>`,
    { tags: "dessert sweet birthday" }),

  b("cookie", "Cookie", "#d9a066", [50, 48, 24],
    `<circle cx="50" cy="52" r="38" fill="@c"/>
     <circle cx="28" cy="36" r="5" fill="@n"/><circle cx="72" cy="38" r="5.4" fill="@n"/><circle cx="24" cy="64" r="4.6" fill="@n"/><circle cx="50" cy="26" r="4" fill="@n"/><circle cx="70" cy="68" r="5" fill="@n"/><circle cx="46" cy="76" r="4.4" fill="@n"/><circle cx="82" cy="54" r="3.4" fill="@n"/>`,
    { motion: "roll", tags: "biscuit sweet snack chocolate" }),

  b("burger", "Burger", "#f2a950", [50, 32, 24, 0.85],
    `<path d="M12 46 C12 12 88 12 88 46Z" fill="@c"/>
     <path d="M32 22 l3 -1.4 M50 16 l3 0 M66 22 l3 1.4 M42 38 l3 1.6 M60 36 l3 -1.4" stroke="@t" stroke-width="2.8" stroke-linecap="round"/>
     <path d="M8 50 Q16 44 24 50 Q32 56 40 50 Q48 44 56 50 Q64 56 72 50 Q80 44 92 50 V54 H8Z" fill="@g"/>
     <path d="M14 54 H86 L76 66 L64 56 L52 66 L40 56 L28 66Z" fill="@y"/>
     <rect x="10" y="58" width="80" height="14" rx="7" fill="@n"/>
     <rect x="14" y="74" width="72" height="14" rx="7" fill="@c"/>`,
    { motion: "hop", tags: "food fast cheeseburger" }),

  b("sushi", "Sushi", "#ffffff", [50, 52, 34, 0.9],
    `<rect x="12" y="52" width="76" height="32" rx="15" fill="@c"/>
     <path d="M8 46 Q8 30 28 30 H72 Q92 30 92 46 Q92 60 72 60 H28 Q8 60 8 46Z" fill="#ff8a65"/>
     <path d="M22 36 Q50 44 78 36" stroke="#ffb199" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".8"/>
     <rect x="46" y="28" width="8" height="58" rx="2" fill="@k"/>`,
    { tags: "japan rice fish salmon" }),

  b("boba", "Boba tea", "#d6a77a", [50, 52, 22],
    `<path d="M66 6 L56 30" stroke="@p" stroke-width="5" stroke-linecap="round"/>
     <path d="M22 30 L28 92 H72 L78 30Z" fill="@c"/>
     <path d="M25 58 H75 L72 92 H28Z" fill="@d" opacity=".35"/>
     <rect x="17" y="22" width="66" height="11" rx="5.5" fill="@w"/>
     <g fill="@k"><circle cx="37" cy="86" r="4.6"/><circle cx="49" cy="87" r="4.6"/><circle cx="61" cy="86" r="4.6"/><circle cx="43" cy="79" r="4.4"/><circle cx="55" cy="79" r="4.4"/></g>`,
    { motion: "sway", tags: "milk tea drink bubble" }),

  b("fries", "Fries", "#ef4444", [50, 68, 22],
    `<g fill="#ffd166"><rect x="24" y="14" width="9" height="44" rx="3" transform="rotate(-8 28 36)"/><rect x="36" y="8" width="9" height="50" rx="3"/><rect x="48" y="12" width="9" height="46" rx="3"/><rect x="60" y="8" width="9" height="50" rx="3" transform="rotate(6 64 33)"/><rect x="71" y="16" width="9" height="42" rx="3" transform="rotate(12 75 37)"/></g>
     <path d="M16 44 H84 L77 94 H23Z" fill="@c"/>
     <path d="M32 44 L34 94 M68 44 L66 94" stroke="@w" stroke-width="3" opacity=".35"/>`,
    { motion: "hop", tags: "food fast chips" }),

  b("egg", "Fried egg", "#ffffff", [50, 52, 20],
    `<path d="M14 54 C6 30 32 12 54 16 C80 12 96 38 88 62 C82 86 50 96 30 86 C20 80 16 66 14 54Z" fill="@c"/>
     <circle cx="50" cy="52" r="22" fill="@y"/>` +
    shine(42, 42, 4, 7, 35),
    { tags: "breakfast food" }),

  b("avocado", "Avocado", "#3f7d20", [50, 40, 20],
    `<path d="M50 6 C70 6 78 30 84 52 C90 76 74 94 50 94 C26 94 10 76 16 52 C22 30 30 6 50 6Z" fill="@c"/>
     <path d="M50 14 C64 14 70 34 75 54 C79 72 66 86 50 86 C34 86 21 72 25 54 C30 34 36 14 50 14Z" fill="#d9f09a"/>
     <circle cx="50" cy="66" r="15" fill="@n"/>
     <ellipse cx="45" cy="60" rx="4" ry="5.4" transform="rotate(30 45 60)" fill="#fff" opacity=".3"/>`,
    { tags: "guac healthy fruit" }),

  b("strawberry", "Strawberry", "#ff4d5e", [50, 52, 22],
    `<path d="M50 94 C20 76 8 50 14 34 C18 22 34 18 50 24 C66 18 82 22 86 34 C92 50 80 76 50 94Z" fill="@c"/>
     <path d="M26 26 L36 12 L46 22 L54 10 L62 22 L74 14 L76 28 L50 34Z" fill="@g"/>
     <g fill="@y"><ellipse cx="30" cy="48" rx="1.6" ry="2.4"/><ellipse cx="70" cy="48" rx="1.6" ry="2.4"/><ellipse cx="36" cy="70" rx="1.6" ry="2.4"/><ellipse cx="64" cy="70" rx="1.6" ry="2.4"/><ellipse cx="50" cy="80" rx="1.6" ry="2.4"/><ellipse cx="50" cy="42" rx="1.6" ry="2.4"/></g>`,
    { motion: "hop", tags: "fruit berry" }),

  b("cherry", "Cherry", "#e11d48", [51, 68, 34],
    `<path d="M34 52 Q38 20 58 8 M68 56 Q66 24 58 8" stroke="@g" stroke-width="3.4" fill="none" stroke-linecap="round"/>
     <path d="M58 8 C70 2 84 8 88 18 C76 22 64 18 58 8Z" fill="@g"/>
     <circle cx="33" cy="70" r="21" fill="@c"/><circle cx="68" cy="72" r="19" fill="@c"/>` +
    shine(25, 62, 3.4, 6, 25),
    { motion: "sway", tags: "fruit red" }),

  b("watermelon", "Watermelon", "#ff5a6a", [50, 58, 24],
    `<path d="M6 38 H94 C94 78 74 94 50 94 C26 94 6 78 6 38Z" fill="#4cae5c"/>
     <path d="M11 38 H89 C89 74 70 88 50 88 C30 88 11 74 11 38Z" fill="#b7f0a0"/>
     <path d="M15 38 H85 C85 70 68 82 50 82 C32 82 15 70 15 38Z" fill="@c"/>
     <g fill="@k"><ellipse cx="26" cy="52" rx="2" ry="3.4"/><ellipse cx="74" cy="52" rx="2" ry="3.4"/><ellipse cx="38" cy="72" rx="2" ry="3.4"/><ellipse cx="62" cy="72" rx="2" ry="3.4"/><ellipse cx="50" cy="46" rx="2" ry="3.4"/></g>`,
    { motion: "wiggle", tags: "fruit summer" }),

  b("apple", "Apple", "#ff4d4d", [50, 56, 26],
    `<path d="M50 28 C36 18 12 26 12 54 C12 76 30 92 50 86 C70 92 88 76 88 54 C88 26 64 18 50 28Z" fill="@c"/>
     <path d="M50 28 Q50 14 58 8" stroke="@n" stroke-width="4" fill="none" stroke-linecap="round"/>
     <path d="M56 18 C64 8 76 10 80 16 C72 24 62 24 56 18Z" fill="@g"/>` +
    shine(28, 44, 4.6, 9, 20),
    { motion: "hop", tags: "fruit red teacher" }),

  b("lemon", "Lemon", "#ffe14a", [50, 52, 24],
    `<path d="M6 52 Q12 44 22 40 C40 12 74 14 82 40 Q92 44 96 52 Q92 60 82 64 C74 90 40 92 22 64 Q12 60 6 52Z" fill="@c"/>
     <path d="M62 16 C68 6 80 6 84 12 C78 20 68 22 62 16Z" fill="@g"/>` +
    shine(36, 34, 4, 8, 40),
    { motion: "roll", tags: "fruit sour citrus" }),

  b("carrot", "Carrot", "#ff8a2b", [50, 44, 18, 0.9],
    `<g class="a-twitch ob"><path d="M50 26 C40 14 34 8 38 2 C46 6 50 14 50 26Z" fill="@g"/><path d="M50 26 C50 12 54 4 62 2 C64 10 58 18 50 26Z" fill="@g"/><path d="M48 26 C36 22 28 16 28 8 C38 8 46 14 48 26Z" fill="@g"/></g>
     <path d="M26 28 C28 20 72 20 74 28 L56 92 Q50 98 44 92Z" fill="@c"/>
     <path d="M34 54 H44 M58 66 H68 M40 74 H48" stroke="@d" stroke-width="2.4" stroke-linecap="round" opacity=".6"/>`,
    { motion: "hop", tags: "vegetable bunny" }),

  b("cheese", "Cheese", "#fcd34d", [48, 54, 24],
    `<path d="M6 74 Q6 42 26 34 L94 26 V74 Q94 80 88 80 H12 Q6 80 6 74Z" fill="@c"/>
     <path d="M6 66 Q6 42 26 34 L94 26 V38 L26 48 Q18 52 16 60Z" fill="@l" opacity=".5"/>
     <circle cx="24" cy="68" r="5" fill="@d" opacity=".55"/><circle cx="80" cy="46" r="6" fill="@d" opacity=".55"/><circle cx="76" cy="68" r="4" fill="@d" opacity=".55"/>`,
    { tags: "dairy mouse food" }),

  b("popcorn", "Popcorn", "#fff3c4", [50, 70, 22],
    `<circle cx="28" cy="40" r="14" fill="@c"/><circle cx="48" cy="28" r="16" fill="@c"/><circle cx="70" cy="38" r="15" fill="@c"/><circle cx="38" cy="48" r="12" fill="@c"/><circle cx="60" cy="48" r="12" fill="@c"/>
     <circle cx="42" cy="22" r="3" fill="@y" opacity=".7"/><circle cx="74" cy="32" r="3" fill="@y" opacity=".7"/>
     <path d="M20 50 H80 L74 94 H26Z" fill="#fff"/>
     <path d="M30 50 L33 94 M45 50 V94 M60 50 V94 M72 50 L69 94" stroke="@r" stroke-width="7"/>`,
    { motion: "hop", tags: "movie snack cinema" }),

  b("taco", "Taco", "#fcd34d", [50, 62, 24],
    `<circle cx="26" cy="50" r="9" fill="@g"/><circle cx="40" cy="38" r="10" fill="@g"/><circle cx="56" cy="34" r="10" fill="@g"/><circle cx="72" cy="42" r="10" fill="@g"/><circle cx="80" cy="54" r="8" fill="@g"/>
     <circle cx="34" cy="44" r="4.4" fill="@r"/><circle cx="64" cy="38" r="4.4" fill="@r"/>
     <path d="M6 74 C6 30 94 30 94 74Z" fill="@c"/>
     <path d="M12 70 C14 42 86 42 88 70" stroke="@d" stroke-width="2.4" fill="none" opacity=".4"/>`,
    { motion: "sway", tags: "mexican food" }),

  b("toast", "Toast", "#f6c177", [50, 56, 24],
    `<path d="M18 92 V48 C2 42 4 14 30 12 C40 6 62 6 72 12 C96 14 98 42 82 48 V92Z" fill="#c98a4b"/>
     <g transform="translate(6 7) scale(.88)"><path d="M18 92 V48 C2 42 4 14 30 12 C40 6 62 6 72 12 C96 14 98 42 82 48 V92Z" fill="@c"/></g>
     <rect x="58" y="62" width="14" height="10" rx="3" fill="@y" transform="rotate(-8 65 67)"/>`,
    { motion: "hop", tags: "bread breakfast" }),

  b("pineapple", "Pineapple", "#ffcf3d", [50, 62, 22],
    `<path d="M50 34 C40 22 30 22 26 12 C36 14 44 20 50 28 C50 14 52 6 58 2 C60 12 56 22 54 30 C62 18 72 16 78 14 C74 24 64 28 54 36Z" fill="@g"/>
     <ellipse cx="50" cy="64" rx="28" ry="31" fill="@c"/>
     <path d="M30 42 L66 86 M42 36 L74 74 M24 56 L50 90 M62 36 L30 82 M72 46 L44 90 M78 58 L58 90" stroke="@d" stroke-width="2" opacity=".5"/>`,
    { tags: "fruit tropical" }),

  b("onigiri", "Onigiri", "#ffffff", [50, 46, 24],
    `<path d="M50 10 C58 10 64 16 90 74 C94 84 88 90 78 90 H22 C12 90 6 84 10 74 C36 16 42 10 50 10Z" fill="@c"/>
     <path d="M30 70 H70 L76 90 H24Z" fill="@k"/>
     <path d="M30 22 Q34 18 40 18" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6"/>`,
    { tags: "japan rice ball" }),

  b("dumpling", "Dumpling", "#fff4e0", [50, 64, 24],
    `<path d="M6 70 C6 28 94 28 94 70 Q94 84 80 84 H20 Q6 84 6 70Z" fill="@c"/>
     <path d="M28 44 q2 -9 8 -12 M40 38 q1 -9 5 -12 M52 36 q0 -9 3 -12 M64 38 q-1 -9 -5 -12 M74 44 q-2 -9 -8 -12" stroke="@d" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".5"/>`,
    { motion: "hop", tags: "momo gyoza chinese food" }),

  b("grapes", "Grapes", "#8b5cf6", [50, 44, 24],
    `<path d="M50 14 V6" stroke="@n" stroke-width="4" stroke-linecap="round"/><path d="M52 12 C62 2 76 4 80 12 C70 18 58 18 52 12Z" fill="@g"/>
     <g fill="@c"><circle cx="28" cy="30" r="13"/><circle cx="50" cy="26" r="13"/><circle cx="72" cy="30" r="13"/><circle cx="38" cy="50" r="13"/><circle cx="62" cy="50" r="13"/><circle cx="50" cy="70" r="13"/><circle cx="50" cy="84" r="9"/></g>` +
    shine(24, 26, 3, 5, 30),
    { motion: "sway", tags: "fruit wine purple" }),

  b("lollipop", "Lollipop", "#ff5fa8", [50, 40, 20],
    `<rect x="47" y="64" width="6" height="30" rx="3" fill="@w"/>
     <circle cx="50" cy="40" r="32" fill="@c"/>
     <path d="M50 40 m0 0 q6 -6 12 0 q6 10 -4 16 q-14 6 -22 -6 q-8 -16 8 -24 q22 -8 32 12" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".5"/>`,
    { motion: "sway", tags: "candy sweet dessert" }),
];
