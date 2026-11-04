import { b, both, ring, type BuddyDef } from "@/lib/buddy-kit";

export const ANIMALS: BuddyDef[] = [
  b("cat", "Cat", "#ffa94d", [50, 53, 27, 1.05],
    both(`<g class="a-twitch ob"><path d="M19 50 L20 13 L44 29Z" fill="@c"/><path d="M25 40 L26 23 L37 30Z" fill="@p"/></g>`) +
    `<ellipse cx="50" cy="58" rx="35" ry="29" fill="@c"/>
     <path d="M44 32 V40 M50 30 V40 M56 32 V40" stroke="@d" stroke-width="3.2" stroke-linecap="round" fill="none"/>
     <path d="M47 61 h6 l-3 3.5z" fill="@p"/>` +
    both(`<path d="M12 60 L24 62 M13 69 L25 66" stroke="@k" stroke-opacity=".3" stroke-width="2" stroke-linecap="round"/>`),
    { tags: "kitty kitten pet" }),

  b("dog", "Dog", "#c99a6b", [50, 49, 25],
    both(`<g class="a-twitch ot"><ellipse cx="21" cy="50" rx="11" ry="23" transform="rotate(10 21 50)" fill="@d"/></g>`) +
    `<ellipse cx="50" cy="55" rx="31" ry="30" fill="@c"/>
     <ellipse cx="50" cy="67" rx="16" ry="12" fill="@l"/>
     <ellipse cx="50" cy="61" rx="6.5" ry="4.2" fill="@k"/>
     <path d="M50 65 V70" stroke="@k" stroke-width="2" stroke-linecap="round"/>
     <circle cx="66" cy="42" r="9" fill="@d" opacity=".55"/>`,
    { tags: "puppy pet" }),

  b("bunny", "Bunny", "#ff7eb6", [50, 62, 24],
    both(`<g class="a-twitch ob"><ellipse cx="35" cy="26" rx="9" ry="23" transform="rotate(-6 35 26)" fill="@c"/><ellipse cx="35" cy="28" rx="4.5" ry="15" transform="rotate(-6 35 28)" fill="@l"/></g>`) +
    `<ellipse cx="50" cy="64" rx="32" ry="26" fill="@c"/>
     <path d="M47 69 h6 l-3 3.5z" fill="@l"/>`,
    { motion: "hop", tags: "rabbit easter" }),

  b("bear", "Bear", "#b07a52", [50, 49, 26],
    both(`<circle cx="24" cy="26" r="11" fill="@c"/><circle cx="24" cy="26" r="5.5" fill="@d"/>`) +
    `<circle cx="50" cy="56" r="33" fill="@c"/>
     <ellipse cx="50" cy="66" rx="14" ry="11" fill="@l"/>
     <ellipse cx="50" cy="61" rx="5.4" ry="3.6" fill="@k"/>`,
    { tags: "teddy" }),

  b("panda", "Panda", "#f2f2f5", [50, 51, 26, 0.95],
    both(`<circle cx="23" cy="26" r="12" fill="@k"/>`) +
    `<circle cx="50" cy="55" r="33" fill="@c"/>` +
    both(`<ellipse cx="37" cy="52" rx="9.5" ry="11.5" transform="rotate(20 37 52)" fill="@k"/>`) +
    `<ellipse cx="50" cy="64" rx="5.5" ry="3.6" fill="@k"/>`,
    { ink: "#ffffff", tags: "bamboo bear" }),

  b("fox", "Fox", "#ff7a2f", [50, 47, 28],
    `<path d="M50 85 C30 85 12 67 10 41 L12 13 L36 30 C44 27 56 27 64 30 L88 13 L90 41 C88 67 70 85 50 85Z" fill="@c"/>
     <path d="M17 27 L18 19 L28 27Z M83 27 L82 19 L72 27Z" fill="@k" opacity=".75"/>
     <path d="M10 42 C14 64 32 75 50 75 C68 75 86 64 90 42 C80 54 66 58 50 58 C34 58 20 54 10 42Z" fill="#fff6ea"/>
     <circle cx="50" cy="71" r="3.8" fill="@k"/>`,
    { tags: "kitsune" }),

  b("wolf", "Wolf", "#8e9bb0", [50, 48, 26],
    `<path d="M50 87 C28 87 14 69 14 47 L16 9 L38 28 C45 26 55 26 62 28 L84 9 L86 47 C86 69 72 87 50 87Z" fill="@c"/>
     <path d="M20 22 L21 15 L29 22Z M80 22 L79 15 L71 22Z" fill="@d"/>
     <ellipse cx="50" cy="70" rx="17" ry="13" fill="@l"/>
     <ellipse cx="50" cy="64" rx="5.6" ry="3.8" fill="@k"/>
     <path d="M14 56 L22 58 M86 56 L78 58" stroke="@l" stroke-width="3" stroke-linecap="round"/>`,
    { tags: "husky" }),

  b("raccoon", "Raccoon", "#9aa3b2", [50, 52, 26, 0.95],
    both(`<circle cx="25" cy="30" r="11" fill="@c"/><circle cx="25" cy="30" r="5" fill="@k"/>`) +
    `<ellipse cx="50" cy="57" rx="35" ry="29" fill="@c"/>
     <path d="M16 48 Q50 38 84 48 Q82 66 62 63 Q50 57 38 63 Q18 66 16 48Z" fill="#2b2f3a"/>
     <ellipse cx="50" cy="69" rx="11" ry="8" fill="@w"/>
     <ellipse cx="50" cy="66" rx="4.4" ry="3" fill="@k"/>`,
    { ink: "#ffffff", blush: false, tags: "bandit" }),

  b("hamster", "Hamster", "#f0b27a", [50, 52, 28],
    both(`<circle cx="26" cy="29" r="9" fill="@c"/><circle cx="26" cy="29" r="4.4" fill="@p"/>`) +
    `<ellipse cx="50" cy="59" rx="39" ry="30" fill="@c"/>
     <ellipse cx="50" cy="68" rx="24" ry="16" fill="@w" opacity=".75"/>
     <path d="M46 34 V41 M54 34 V41" stroke="@d" stroke-width="3" stroke-linecap="round"/>
     <ellipse cx="50" cy="62" rx="3.6" ry="2.6" fill="@p"/>`,
    { tags: "pet" }),

  b("mouse", "Mouse", "#b9c0cc", [50, 55, 25],
    both(`<circle cx="22" cy="29" r="15" fill="@c"/><circle cx="22" cy="29" r="9" fill="@p"/>`) +
    `<path d="M80 82 Q98 86 95 66" stroke="@d" stroke-width="4" fill="none" stroke-linecap="round" class="a-wag obl"/>
     <ellipse cx="50" cy="60" rx="31" ry="28" fill="@c"/>
     <circle cx="50" cy="68" r="3.6" fill="@p"/>` +
    both(`<path d="M18 66 L28 66 M19 73 L29 70" stroke="@k" stroke-opacity=".3" stroke-width="1.8" stroke-linecap="round"/>`),
    { tags: "rat" }),

  b("frog", "Frog", "#58c46a", [50, 33, 40, 1.05],
    `<ellipse cx="50" cy="63" rx="38" ry="26" fill="@c"/>
     <ellipse cx="50" cy="72" rx="26" ry="14" fill="@l"/>` +
    both(`<circle cx="30" cy="34" r="16" fill="@c"/>`) +
    `<path d="M28 62 Q50 78 72 62" stroke="@d" stroke-width="3" fill="none" stroke-linecap="round"/>
     <circle cx="42" cy="56" r="1.6" fill="@d"/><circle cx="58" cy="56" r="1.6" fill="@d"/>`,
    { motion: "hop", tags: "toad" }),

  b("duck", "Duck", "#ffd23f", [50, 37, 22],
    `<ellipse cx="50" cy="70" rx="33" ry="22" fill="@c"/>` +
    both(`<g class="a-flap or"><ellipse cx="22" cy="68" rx="9" ry="14" transform="rotate(-18 22 68)" fill="@d"/></g>`) +
    `<circle cx="50" cy="40" r="25" fill="@c"/>
     <path d="M50 14 C48 8 54 6 56 10" stroke="@c" stroke-width="3" fill="none" stroke-linecap="round"/>
     <ellipse cx="50" cy="51" rx="12" ry="6.5" fill="@o"/>`,
    { motion: "waddle", tags: "bird quack" }),

  b("chick", "Chick", "#ffe066", [50, 49, 26],
    `<path d="M40 88 v6 M46 88 v6 M54 88 v6 M60 88 v6" stroke="@o" stroke-width="3" stroke-linecap="round"/>
     <circle cx="50" cy="57" r="33" fill="@c"/>
     <path d="M44 24 Q46 14 48 22 M50 23 Q52 12 54 22 M56 24 Q60 16 60 25" stroke="@d" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    both(`<g class="a-flap or"><ellipse cx="20" cy="60" rx="7" ry="11" transform="rotate(20 20 60)" fill="@d"/></g>`) +
    `<path d="M44 57 L56 57 L50 65Z" fill="@o"/>`,
    { motion: "hop", tags: "bird baby" }),

  b("penguin", "Penguin", "#2f3b52", [50, 43, 24, 0.95],
    `<ellipse cx="50" cy="55" rx="32" ry="36" fill="@c"/>
     <ellipse cx="50" cy="64" rx="22" ry="26" fill="@w"/>` +
    both(`<g class="a-flap or"><ellipse cx="19" cy="62" rx="7" ry="16" transform="rotate(14 19 62)" fill="@d"/></g>`) +
    both(`<circle cx="38" cy="44" r="11" fill="@w"/>`) +
    `<path d="M44 54 L56 54 L50 62Z" fill="@o"/>
     <ellipse cx="39" cy="91" rx="9" ry="3.6" fill="@o"/><ellipse cx="61" cy="91" rx="9" ry="3.6" fill="@o"/>`,
    { ink: "#1b1f2a", blush: false, motion: "waddle", tags: "bird arctic" }),

  b("owl", "Owl", "#a47551", [50, 44, 27, 1.1],
    `<path d="M20 22 L30 34 L22 40Z M80 22 L70 34 L78 40Z" fill="@d"/>
     <ellipse cx="50" cy="58" rx="34" ry="33" fill="@c"/>` +
    both(`<g class="a-flap or"><ellipse cx="21" cy="62" rx="8" ry="17" transform="rotate(8 21 62)" fill="@d"/></g>`) +
    both(`<circle cx="36.5" cy="45" r="15" fill="@w"/>`) +
    `<path d="M46 52 L54 52 L50 61Z" fill="@y"/>
     <path d="M38 74 q4 5 8 0 q4 5 8 0 q4 5 8 0" stroke="@l" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    { face: "round", ink: "#2a1d12", blush: false, tags: "bird night wise" }),

  b("bat", "Bat", "#7c5cff", [50, 54, 19, 0.95],
    both(`<path class="a-flap or" d="M42 52 C30 34 14 34 6 42 C12 46 12 54 18 58 C23 55 28 60 30 66 C35 60 39 60 43 64Z" fill="@d"/>`) +
    both(`<path d="M38 36 L36 22 L46 31Z" fill="@c"/>`) +
    `<ellipse cx="50" cy="56" rx="21" ry="24" fill="@c"/>
     <path d="M45 70 l2 5 l2 -5 M51 70 l2 5 l2 -5" fill="@w"/>`,
    { motion: "float", tags: "halloween vampire" }),

  b("koala", "Koala", "#a0a8b5", [50, 51, 28],
    both(`<circle cx="19" cy="36" r="16" fill="@c"/><circle cx="19" cy="36" r="9" fill="@l"/>`) +
    `<ellipse cx="50" cy="57" rx="33" ry="29" fill="@c"/>
     <ellipse cx="50" cy="62" rx="8" ry="11" fill="@k"/>
     <ellipse cx="47.5" cy="58" rx="2" ry="3" fill="@w" opacity=".4"/>`,
    { tags: "australia bear" }),

  b("pig", "Pig", "#ffa6c1", [50, 49, 28],
    both(`<path d="M24 36 L17 14 L40 26Z" fill="@d"/>`) +
    `<ellipse cx="50" cy="57" rx="35" ry="30" fill="@c"/>
     <ellipse cx="50" cy="66" rx="14" ry="10.5" fill="@d"/>
     <circle cx="45.5" cy="66" r="2.2" fill="@k"/><circle cx="54.5" cy="66" r="2.2" fill="@k"/>`,
    { tags: "piggy farm" }),

  b("cow", "Cow", "#f6f6f6", [50, 47, 26],
    both(`<path d="M30 28 L26 12 L38 24Z" fill="@y"/>`) +
    both(`<g class="a-twitch or"><ellipse cx="15" cy="42" rx="11" ry="7" transform="rotate(-22 15 42)" fill="@c"/></g><ellipse cx="15" cy="42" rx="6" ry="3.6" transform="rotate(-22 15 42)" fill="@p"/>`) +
    `<ellipse cx="50" cy="54" rx="31" ry="30" fill="@c"/>
     <path d="M62 26 C78 26 82 40 72 44 C66 46 58 40 62 26Z" fill="@k"/>
     <ellipse cx="50" cy="69" rx="19" ry="12" fill="@p"/>
     <ellipse cx="43.5" cy="69" rx="2.6" ry="3.4" fill="@d"/><ellipse cx="56.5" cy="69" rx="2.6" ry="3.4" fill="@d"/>`,
    { tags: "farm milk" }),

  b("sheep", "Sheep", "#f1f1f1", [50, 55, 18],
    ring(50, 52, 28, 10, 13, "@c") +
    `<circle cx="50" cy="50" r="26" fill="@c"/>` +
    both(`<ellipse cx="25" cy="58" rx="8" ry="5" transform="rotate(25 25 58)" fill="#3d3a4f"/>`) +
    `<ellipse cx="50" cy="60" rx="20" ry="23" fill="#3d3a4f"/>
     <circle cx="50" cy="36" r="9" fill="@c"/>`,
    { ink: "#ffffff", blush: false, tags: "lamb wool farm" }),

  b("lion", "Lion", "#f5b335", [50, 52, 24],
    ring(50, 54, 29, 12, 12, "@d") +
    `<circle cx="50" cy="54" r="30" fill="@d"/>` +
    both(`<circle cx="27" cy="29" r="8" fill="@c"/>`) +
    `<circle cx="50" cy="55" r="26" fill="@c"/>
     <ellipse cx="50" cy="66" rx="13" ry="10" fill="@l"/>
     <path d="M45 61 h10 l-5 5z" fill="@k"/>`,
    { tags: "king jungle" }),

  b("tiger", "Tiger", "#ff9d2e", [50, 52, 26],
    both(`<circle cx="24" cy="28" r="10" fill="@c"/><circle cx="24" cy="28" r="5" fill="@d"/>`) +
    `<ellipse cx="50" cy="57" rx="35" ry="30" fill="@c"/>
     <ellipse cx="50" cy="68" rx="16" ry="11" fill="@w"/>
     <path d="M46 31 V40 M50 29 V40 M54 31 V40" stroke="@k" stroke-width="3" stroke-linecap="round"/>` +
    both(`<path d="M15 50 L25 54 M16 62 L26 62 M19 73 L28 69" stroke="@k" stroke-width="3" stroke-linecap="round"/>`) +
    `<path d="M45 62 h10 l-5 5z" fill="@k"/>`,
    { tags: "stripes jungle" }),

  b("monkey", "Monkey", "#9b6a45", [50, 55, 22],
    `<path d="M78 82 C98 82 100 60 88 56" stroke="@c" stroke-width="6" fill="none" stroke-linecap="round" class="a-wag obl"/>` +
    both(`<circle cx="19" cy="54" r="11" fill="@c"/><circle cx="19" cy="54" r="6" fill="@l"/>`) +
    `<ellipse cx="50" cy="54" rx="31" ry="32" fill="@c"/>
     <path d="M36 44 C30 44 26 52 28 60 C30 70 40 74 50 72 C60 74 70 70 72 60 C74 52 70 44 64 44 C58 44 54 50 50 52 C46 50 42 44 36 44Z" fill="@l"/>
     <circle cx="46" cy="66" r="1.5" fill="@k"/><circle cx="54" cy="66" r="1.5" fill="@k"/>`,
    { blush: false, tags: "ape banana" }),

  b("elephant", "Elephant", "#9fb4c8", [50, 43, 27],
    both(`<circle cx="18" cy="48" r="20" fill="@d" class="a-twitch or"/><circle cx="18" cy="48" r="12" fill="@p" opacity=".5"/>`) +
    `<circle cx="50" cy="50" r="30" fill="@c"/>
     <g class="a-swing ot"><path d="M50 60 C50 82 40 90 33 83" stroke="@c" stroke-width="14" fill="none" stroke-linecap="round"/>
     <path d="M50 60 C50 82 40 90 33 83" stroke="@d" stroke-width="2.4" fill="none" stroke-dasharray="1 5.2" stroke-linecap="round"/></g>` +
    both(`<path d="M36 66 Q34 76 40 78" stroke="@w" stroke-width="4" fill="none" stroke-linecap="round"/>`),
    { tags: "trunk" }),

  b("whale", "Whale", "#4aa3ff", [34, 52, 14, 0.95],
    `<g class="a-steam"><path d="M46 22 q-6 -8 -2 -13 M46 22 q6 -8 2 -13" stroke="@s" stroke-width="3" fill="none" stroke-linecap="round"/></g>
     <g class="a-wag obl"><path d="M80 52 L97 40 L96 66 L82 62Z" fill="@d"/></g>
     <path d="M8 58 C8 36 28 24 52 24 C70 24 84 36 90 52 C88 74 70 84 50 84 C26 84 8 78 8 58Z" fill="@c"/>
     <path d="M10 62 C28 76 66 80 86 62 C72 84 28 86 10 62Z" fill="@l"/>`,
    { motion: "swim", tags: "ocean sea" }),

  b("fish", "Fish", "#ff8f5a", [32, 47, 0, 1.05],
    `<g class="a-wag or"><path d="M70 52 L92 34 L92 70Z" fill="@d"/></g>
     <path d="M36 30 Q50 18 60 32Z" fill="@d"/>
     <ellipse cx="46" cy="53" rx="31" ry="23" fill="@c"/>
     <path d="M60 36 Q66 53 60 70 M52 34 Q58 53 52 72" stroke="@d" stroke-width="2.6" fill="none" stroke-linecap="round"/>
     <path d="M17 57 Q22 61 27 58" stroke="@k" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    { motion: "swim", tags: "ocean sea goldfish" }),

  b("octopus", "Octopus", "#b06bff", [50, 40, 26],
    `<path d="M26 56 C20 70 30 80 18 90" stroke="@c" stroke-width="9" fill="none" stroke-linecap="round" class="a-wave ot"/>
     <path d="M38 62 C34 76 44 84 36 92" stroke="@c" stroke-width="9" fill="none" stroke-linecap="round" class="a-wave2 ot"/>
     <path d="M62 62 C66 76 56 84 64 92" stroke="@c" stroke-width="9" fill="none" stroke-linecap="round" class="a-wave ot"/>
     <path d="M74 56 C80 70 70 80 82 90" stroke="@c" stroke-width="9" fill="none" stroke-linecap="round" class="a-wave2 ot"/>
     <ellipse cx="50" cy="42" rx="31" ry="32" fill="@c"/>
     <circle cx="34" cy="26" r="2.4" fill="@l"/><circle cx="62" cy="24" r="3" fill="@l"/><circle cx="68" cy="34" r="2" fill="@l"/>`,
    { motion: "float", tags: "sea ocean squid" }),

  b("jellyfish", "Jellyfish", "#ff8fd0", [50, 38, 22],
    `<g stroke="@l" stroke-width="3.6" fill="none" stroke-linecap="round">
       <path d="M32 54 C28 66 36 72 30 84" class="a-wave ot"/><path d="M44 56 C40 68 48 76 42 90" class="a-wave2 ot"/>
       <path d="M56 56 C60 68 52 76 58 90" class="a-wave ot"/><path d="M68 54 C72 66 64 72 70 84" class="a-wave2 ot"/></g>
     <path d="M16 54 C14 18 86 18 84 54 Q76 60 68 54 Q59 60 50 54 Q41 60 32 54 Q24 60 16 54Z" fill="@c"/>
     <ellipse cx="34" cy="28" rx="6" ry="3.4" transform="rotate(-30 34 28)" fill="#fff" opacity=".4"/>`,
    { motion: "float", tags: "sea ocean" }),

  b("crab", "Crab", "#ff5a4d", [50, 38, 24],
    `<path d="M38 50 V40 M62 50 V40" stroke="@c" stroke-width="5" stroke-linecap="round"/>
     <path d="M30 56 Q14 52 16 38" stroke="@c" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M70 56 Q86 52 84 38" stroke="@c" stroke-width="5" fill="none" stroke-linecap="round"/>
     <g class="a-snap obr"><circle cx="15" cy="32" r="11" fill="@c"/><path d="M15 21 L11 32 L20 30Z" fill="@d"/></g>
     <g class="a-snap obl"><circle cx="85" cy="32" r="11" fill="@c"/><path d="M85 21 L89 32 L80 30Z" fill="@d"/></g>
     <ellipse cx="50" cy="64" rx="34" ry="23" fill="@c"/>
     <path d="M26 82 L20 90 M38 86 L35 94 M62 86 L65 94 M74 82 L80 90" stroke="@c" stroke-width="4" stroke-linecap="round"/>`,
    { motion: "waddle", tags: "sea beach" }),

  b("turtle", "Turtle", "#5fbf6e", [50, 66, 17, 0.85],
    both(`<ellipse cx="22" cy="82" rx="9" ry="6" fill="@l"/>`) +
    `<path d="M13 64 C13 20 87 20 87 64Z" fill="@c"/>
     <path d="M50 27 V47 M31 38 L50 47 L69 38 M24 56 L50 47 L76 56" stroke="@d" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
     <ellipse cx="50" cy="69" rx="19" ry="16" fill="@l"/>`,
    { motion: "waddle", tags: "tortoise sea" }),

  b("snail", "Snail", "#ffbf5e", [24, 37, 13, 0.8],
    `<path d="M20 60 L18 42 M29 60 L31 42" stroke="@c" stroke-width="4.5" stroke-linecap="round"/>
     <path d="M8 88 C2 72 10 58 24 60 C30 62 36 70 52 74 L88 78 C95 84 92 90 84 90 L12 90Z" fill="@c"/>
     <circle cx="64" cy="50" r="27" fill="@d"/>
     <path d="M64 52 q3 -4 7 -1 q4 5 -2 9 q-9 4 -14 -4 q-5 -11 5 -16 q13 -5 20 6" stroke="@l" stroke-width="3" fill="none" stroke-linecap="round"/>
     <circle cx="18" cy="38" r="6.4" fill="@w"/><circle cx="31" cy="38" r="6.4" fill="@w"/>`,
    { motion: "sway", tags: "slow garden" }),

  b("bee", "Bee", "#ffd23f", [50, 51, 22],
    `<path d="M44 36 Q40 22 34 18 M56 36 Q60 22 66 18" stroke="@k" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="34" cy="18" r="3" fill="@k"/><circle cx="66" cy="18" r="3" fill="@k"/>` +
    both(`<g class="a-flap obr"><ellipse cx="33" cy="34" rx="12" ry="19" transform="rotate(-28 33 34)" fill="#fff" opacity=".85"/></g>`) +
    `<ellipse cx="50" cy="60" rx="28" ry="26" fill="@c"/>
     <path d="M25 68 Q50 78 75 68" stroke="@k" stroke-width="7" fill="none"/>
     <path d="M30 80 Q50 90 70 80" stroke="@k" stroke-width="6" fill="none"/>
     <path d="M47 86 L50 94 L53 86Z" fill="@k"/>`,
    { motion: "float", tags: "honey insect bug" }),

  b("butterfly", "Butterfly", "#ff7ad9", [50, 50, 13, 0.75],
    both(`<g class="a-flap or"><ellipse cx="29" cy="40" rx="22" ry="26" transform="rotate(-22 29 40)" fill="@c"/></g><circle cx="26" cy="34" r="6" fill="@w" opacity=".55"/>`) +
    both(`<ellipse cx="34" cy="70" rx="15" ry="14" transform="rotate(20 34 70)" fill="@d"/>`) +
    `<ellipse cx="50" cy="56" rx="13" ry="25" fill="@l"/>
     <path d="M46 32 Q42 20 36 16 M54 32 Q58 20 64 16" stroke="@k" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    { motion: "float", tags: "insect bug garden" }),

  b("ladybug", "Ladybug", "#ff4d4d", [50, 31, 18, 0.7],
    `<circle cx="50" cy="60" r="30" fill="@c"/>
     <path d="M30 40 C32 16 68 16 70 40Z" fill="@k"/>
     <path d="M50 42 V90" stroke="@k" stroke-width="2.6"/>
     <circle cx="35" cy="58" r="5" fill="@k"/><circle cx="65" cy="58" r="5" fill="@k"/><circle cx="38" cy="76" r="4" fill="@k"/><circle cx="62" cy="76" r="4" fill="@k"/>
     <path d="M42 20 Q38 12 33 10 M58 20 Q62 12 67 10" stroke="@k" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    { ink: "#ffffff", blush: false, motion: "waddle", tags: "insect bug garden" }),

  b("shark", "Shark", "#7da2c8", [50, 52, 28],
    `<path d="M43 34 L52 6 L60 34Z" fill="@d" class="a-twitch ob"/>
     <ellipse cx="50" cy="58" rx="35" ry="29" fill="@c"/>
     <path d="M16 62 C24 84 76 84 84 62 C70 72 30 72 16 62Z" fill="@w"/>
     <path d="M30 70 l3 5 l3 -5 M38 73 l3 5 l3 -5 M56 73 l3 5 l3 -5 M64 70 l3 5 l3 -5" fill="@w" stroke="@d" stroke-width=".8"/>`,
    { motion: "swim", tags: "ocean sea jaws" }),

  b("otter", "Otter", "#a0724a", [50, 50, 26],
    both(`<circle cx="23" cy="32" r="8" fill="@c"/>`) +
    `<ellipse cx="50" cy="57" rx="33" ry="29" fill="@c"/>
     <ellipse cx="50" cy="67" rx="19" ry="13" fill="@l"/>
     <ellipse cx="50" cy="62" rx="5.4" ry="3.6" fill="@k"/>
     <circle cx="42" cy="68" r="1.2" fill="@k"/><circle cx="46" cy="71" r="1.2" fill="@k"/><circle cx="58" cy="68" r="1.2" fill="@k"/><circle cx="54" cy="71" r="1.2" fill="@k"/>`,
    { tags: "river sea" }),

  b("hedgehog", "Hedgehog", "#a58a76", [50, 62, 22],
    `<path d="M10 62 L6 44 L19 47 L14 28 L29 36 L30 16 L42 28 L50 10 L58 28 L70 16 L71 36 L86 28 L81 47 L94 44 L90 62Z" fill="@d"/>
     <ellipse cx="50" cy="66" rx="30" ry="24" fill="@l"/>
     <circle cx="50" cy="73" r="3.6" fill="@k"/>`,
    { tags: "spikes sonic" }),

  b("axolotl", "Axolotl", "#ffb3d1", [50, 56, 30],
    both(`<g class="a-wag or"><path d="M20 50 L6 38 M18 57 L3 55 M20 64 L6 72" stroke="#ff6f9f" stroke-width="5" stroke-linecap="round"/><circle cx="6" cy="38" r="3.4" fill="#ff6f9f"/><circle cx="3" cy="55" r="3.4" fill="#ff6f9f"/><circle cx="6" cy="72" r="3.4" fill="#ff6f9f"/></g>`) +
    `<ellipse cx="50" cy="60" rx="34" ry="27" fill="@c"/>
     <path d="M42 70 Q50 76 58 70" stroke="@d" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
    { motion: "swim", tags: "water pet mexico" }),

  b("sloth", "Sloth", "#b79a7a", [50, 53, 25],
    `<ellipse cx="50" cy="57" rx="35" ry="30" fill="@c"/>
     <ellipse cx="50" cy="58" rx="28" ry="23" fill="@l"/>` +
    both(`<ellipse cx="37" cy="53" rx="10" ry="7.5" transform="rotate(22 37 53)" fill="#5a4331"/>`) +
    `<ellipse cx="50" cy="63" rx="4.4" ry="3" fill="@k"/>
     <path d="M45 69 Q50 73 55 69" stroke="@k" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    { ink: "#ffffff", motion: "sway", tags: "slow lazy" }),

  b("capybara", "Capybara", "#c58b5d", [50, 46, 32],
    both(`<circle cx="26" cy="31" r="6" fill="@d"/>`) +
    `<rect x="12" y="34" width="76" height="52" rx="26" fill="@c"/>
     <rect x="30" y="62" width="40" height="22" rx="11" fill="@d"/>
     <ellipse cx="43" cy="70" rx="2.2" ry="3" fill="@k"/><ellipse cx="57" cy="70" rx="2.2" ry="3" fill="@k"/>`,
    { tags: "chill rodent" }),

  b("dino", "Dino", "#6ccf8b", [50, 51, 28],
    `<path d="M30 30 L36 16 L42 28 L50 12 L58 28 L64 16 L70 30Z" fill="@d"/>
     <ellipse cx="50" cy="58" rx="36" ry="30" fill="@c"/>
     <ellipse cx="50" cy="70" rx="20" ry="12" fill="@l"/>
     <circle cx="44" cy="68" r="1.8" fill="@d"/><circle cx="56" cy="68" r="1.8" fill="@d"/>
     <circle cx="26" cy="44" r="4" fill="@d" opacity=".5"/><circle cx="76" cy="62" r="5" fill="@d" opacity=".5"/>`,
    { motion: "hop", tags: "trex dinosaur" }),

  b("dragon", "Dragon", "#ff6b6b", [50, 49, 26],
    both(`<path d="M30 30 L24 10 L40 24Z" fill="@y"/>`) +
    both(`<path d="M18 52 L4 44 L10 58 L2 66 L18 66Z" fill="@d" class="a-flap or"/>`) +
    `<ellipse cx="50" cy="57" rx="32" ry="30" fill="@c"/>
     <ellipse cx="50" cy="69" rx="18" ry="12" fill="@l"/>
     <circle cx="44" cy="68" r="1.8" fill="@d"/><circle cx="56" cy="68" r="1.8" fill="@d"/>
     <path d="M44 28 L50 20 L56 28Z" fill="@d"/>`,
    { motion: "float", tags: "fire fantasy" }),

  b("unicorn", "Unicorn", "#fdf2ff", [50, 56, 24],
    `<path d="M26 40 C10 46 10 66 18 78 C24 66 26 56 30 50Z" fill="#ff9bd5" class="a-wave otr"/>
     <path d="M30 36 C16 44 18 60 24 72 C28 60 30 52 34 46Z" fill="#8fc7ff" opacity=".8" class="a-wave2 otr"/>
     <path d="M44 34 L50 3 L56 34Z" fill="@y"/><path d="M45.5 26 L54.5 22 M47 17 L53 14" stroke="@o" stroke-width="1.6"/>` +
    both(`<path d="M30 36 L28 20 L42 30Z" fill="@c"/><path d="M32 33 L31 25 L38 30Z" fill="@p"/>`) +
    `<ellipse cx="50" cy="60" rx="28" ry="27" fill="@c"/>
     <ellipse cx="50" cy="71" rx="14" ry="9" fill="@p" opacity=".6"/>`,
    { motion: "float", face: "round", tags: "magic fantasy rainbow" }),
];