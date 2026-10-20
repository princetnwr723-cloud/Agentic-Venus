"use client";

import { useId, type CSSProperties } from "react";
import {
  MASCOTS,
  resolveMascot,
  type AvatarColor,
  type MascotId,
  type MascotTheme,
} from "@/lib/bots";

type Theme = {
  hi: string;
  body: string;
  shade: string;
  arm: string;
  ink: string;
  mouth: string;
  blush: string;
  tongue: string;
};

const THEMES: Record<MascotTheme, Theme> = {
  red: { hi: "#F8282B", body: "#EE1216", shade: "#CC0608", arm: "#F4262A", ink: "#080000", mouth: "#150000", blush: "#D40A0D", tongue: "#9B0505" },
  redFelt: { hi: "#F4452F", body: "#EC3220", shade: "#D71E0E", arm: "#F13E2A", ink: "#0A0A0A", mouth: "#5C0F06", blush: "#D81F10", tongue: "#9B1608" },
  orange: { hi: "#FF7B24", body: "#FF690C", shade: "#E95805", arm: "#FF7418", ink: "#0B0B0B", mouth: "#5A1A00", blush: "#E55A08", tongue: "#C24300" },
  blue: { hi: "#3C9EFF", body: "#1E88F0", shade: "#0D6BD4", arm: "#3496F8", ink: "#07122E", mouth: "#0A1A3E", blush: "#46A8FF", tongue: "#0B58B8" },
  green: { hi: "#68C94D", body: "#52B438", shade: "#3C972B", arm: "#5DBE42", ink: "#03230A", mouth: "#052609", blush: "#3E9D2E", tongue: "#2F8C2C" },
  purple: { hi: "#8E3FE8", body: "#7A2CD6", shade: "#5A16B2", arm: "#8639E2", ink: "#12042A", mouth: "#1A0A3A", blush: "#8B3DE0", tongue: "#4A1090" },
};

const STAR =
  "0,-58 15.3,-21 55.2,-17.9 24.7,8 34.1,46.9 0,26 -34.1,46.9 -24.7,8 -55.2,-17.9 -15.3,-21";

const LEG =
  "M 640 1080 L 668 1080 L 668 1210 L 508 1210 C 494 1210 489 1198 492 1182 C 500 1138 545 1106 598 1104 C 615 1103 628 1103 640 1103 Z";

const DROP =
  "M 0 -34 C 12 -12 24 0 24 16 C 24 31 13 42 0 42 C -13 42 -24 31 -24 16 C -24 0 -12 -12 0 -34 Z";

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function Antenna({ t, side }: { t: Theme; side: "l" | "r" }) {
  const inner = (
    <g>
      <path d="M 580 432 C 592 372 562 298 498 244" fill="none" stroke={t.shade} strokeOpacity="0.28" strokeWidth="36" strokeLinecap="round" />
      <path d="M 580 432 C 592 372 562 298 498 244" fill="none" stroke={t.arm} strokeWidth="30" strokeLinecap="round" />
      <g transform="translate(463 205) rotate(-12)">
        <g className="mv-star">
          <polygon points={STAR} fill={t.arm} stroke={t.arm} strokeWidth="10" strokeLinejoin="round" />
        </g>
      </g>
    </g>
  );
  if (side === "l") return <g className="mv-ant-l">{inner}</g>;
  return (
    <g className="mv-ant-r">
      <g transform="translate(1410 0) scale(-1 1)">{inner}</g>
    </g>
  );
}

function Face({ id, uid, t }: { id: MascotId; uid: string; t: Theme }) {
  const def = MASCOTS[id];

  if (def.expr === "fierce") {
    return (
      <g>
        <defs>
          <clipPath id={`${uid}cl`}>
            <polygon points="462,578 672,626 672,780 462,780" />
          </clipPath>
          <clipPath id={`${uid}cr`}>
            <polygon points="752,626 952,578 952,780 752,780" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${uid}cl)`}>
          <g className="mv-eye">
            <ellipse cx="576" cy="662" rx="88" ry="70" fill="#fff" />
            <g className="mv-pupil">
              <circle cx="590" cy="645" r="56" fill={t.ink} />
              <circle cx="563" cy="630" r="15" fill="#fff" />
            </g>
          </g>
        </g>
        <g clipPath={`url(#${uid}cr)`}>
          <g className="mv-eye">
            <ellipse cx="847" cy="662" rx="88" ry="70" fill="#fff" />
            <g className="mv-pupil">
              <circle cx="835" cy="650" r="56" fill={t.ink} />
              <circle cx="808" cy="633" r="15" fill="#fff" />
            </g>
          </g>
        </g>
        <path d="M 470 584 L 670 628" fill="none" stroke={t.ink} strokeWidth="10" strokeLinecap="round" />
        <path d="M 755 628 L 948 584" fill="none" stroke={t.ink} strokeWidth="10" strokeLinecap="round" />
        <g className="mv-mouth">
          <path d="M 638 784 Q 715 826 815 752" fill="none" stroke={t.mouth} strokeWidth="9" strokeLinecap="round" />
        </g>
        {def.stars && (
          <>
            <g transform="translate(458 738) scale(0.62)">
              <g className="mv-star">
                <polygon points={STAR} fill={t.blush} stroke={t.blush} strokeWidth="8" strokeLinejoin="round" />
              </g>
            </g>
            <g transform="translate(960 734) scale(0.62)">
              <g className="mv-star">
                <polygon points={STAR} fill={t.blush} stroke={t.blush} strokeWidth="8" strokeLinejoin="round" />
              </g>
            </g>
          </>
        )}
      </g>
    );
  }

  if (def.expr === "wink") {
    return (
      <g>
        <g className="mv-eye">
          <ellipse cx="582" cy="640" rx="90" ry="118" fill="#fff" />
          <g className="mv-pupil">
            <ellipse cx="598" cy="640" rx="58" ry="72" fill={t.ink} />
            <circle cx="572" cy="614" r="18" fill="#fff" />
          </g>
        </g>
        <g className="mv-wink">
          <path d="M 772 680 C 792 628 852 602 904 688" fill="none" stroke={t.ink} strokeWidth="12" strokeLinecap="round" />
          <path d="M 794 668 C 828 642 866 646 886 666" fill="none" stroke={t.ink} strokeWidth="8" strokeLinecap="round" />
        </g>
        <g className="mv-mouth">
          <path d="M 645 782 Q 712 866 779 782" fill="none" stroke={t.mouth} strokeWidth="12" strokeLinecap="round" />
        </g>
      </g>
    );
  }

  if (def.expr === "wow") {
    return (
      <g>
        <g className="mv-eye">
          <ellipse cx="578" cy="634" rx="90" ry="120" fill="#fff" />
          <g className="mv-pupil">
            <ellipse cx="602" cy="636" rx="62" ry="72" fill={t.ink} />
            <circle cx="576" cy="606" r="20" fill="#fff" />
          </g>
        </g>
        <g className="mv-eye">
          <ellipse cx="841" cy="634" rx="90" ry="120" fill="#fff" />
          <g className="mv-pupil">
            <ellipse cx="828" cy="636" rx="62" ry="72" fill={t.ink} />
            <circle cx="804" cy="606" r="20" fill="#fff" />
          </g>
        </g>
        <g className="mv-cheek">
          <ellipse cx="535" cy="778" rx="56" ry="46" fill={t.blush} />
          <ellipse cx="884" cy="778" rx="56" ry="46" fill={t.blush} />
        </g>
        <g className="mv-mouth">
          <ellipse cx="712" cy="797" rx="31" ry="43" fill={t.mouth} />
          <ellipse cx="712" cy="826" rx="24" ry="16" fill={t.tongue} />
        </g>
      </g>
    );
  }

  if (def.expr === "joy") {
    return (
      <g>
        <g className="mv-joyeye">
          <path d="M 508 660 L 508 645 C 508 598 540 570 574 570 C 608 570 640 598 640 645 L 640 660" fill="none" stroke={t.ink} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g className="mv-joyeye">
          <path d="M 772 660 L 772 645 C 772 598 804 570 838 570 C 872 570 904 598 904 645 L 904 660" fill="none" stroke={t.ink} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g className="mv-cheek" opacity="0.8">
          <ellipse cx="500" cy="712" rx="50" ry="40" fill={t.blush} />
          <ellipse cx="920" cy="712" rx="50" ry="40" fill={t.blush} />
        </g>
        <g className="mv-mouth">
          <path d="M 586 706 C 640 722 784 722 840 706 C 836 820 790 888 713 888 C 636 888 590 820 586 706 Z" fill={t.mouth} />
          <path d="M 635 840 C 650 805 776 805 791 840 C 775 878 650 878 635 840 Z" fill={t.tongue} />
        </g>
      </g>
    );
  }

  if (def.expr === "sleepy") {
    return (
      <g>
        <ellipse cx="576" cy="672" rx="86" ry="72" fill="#fff" />
        <g className="mv-pupil">
          <circle cx="584" cy="676" r="46" fill={t.ink} />
          <ellipse cx="558" cy="660" rx="20" ry="9" fill="#fff" />
        </g>
        <ellipse cx="846" cy="672" rx="86" ry="72" fill="#fff" />
        <g className="mv-pupil">
          <circle cx="838" cy="676" r="46" fill={t.ink} />
          <ellipse cx="812" cy="660" rx="20" ry="9" fill="#fff" />
        </g>
        <g className="mv-lid">
          <path d="M 488 650 L 488 606 C 490 550 530 540 574 540 C 620 540 660 552 660 606 L 660 650 C 620 640 530 640 488 650 Z" fill={t.arm} stroke={t.shade} strokeOpacity="0.35" strokeWidth="4" />
        </g>
        <g className="mv-lid">
          <path d="M 760 650 L 760 606 C 762 552 800 540 846 540 C 892 540 932 552 932 606 L 932 650 C 890 640 800 640 760 650 Z" fill={t.arm} stroke={t.shade} strokeOpacity="0.35" strokeWidth="4" />
        </g>
        <g className="mv-cheek" opacity="0.75">
          <ellipse cx="505" cy="772" rx="50" ry="42" fill={t.blush} />
          <ellipse cx="915" cy="772" rx="50" ry="42" fill={t.blush} />
        </g>
        <g className="mv-mouth">
          <path d="M 645 777 Q 705 818 775 777" fill="none" stroke={t.mouth} strokeWidth="11" strokeLinecap="round" />
        </g>
      </g>
    );
  }

  // calm
  return (
    <g>
      <g className="mv-eye">
        <ellipse cx="579" cy="637" rx="89" ry="118" fill="#fff" />
        <g className="mv-pupil">
          <ellipse cx="598" cy="641" rx="58" ry="72" fill={t.ink} />
          <circle cx="572" cy="613" r="18" fill="#fff" />
        </g>
      </g>
      <g className="mv-eye">
        <ellipse cx="841" cy="637" rx="89" ry="118" fill="#fff" />
        <g className="mv-pupil">
          <ellipse cx="829" cy="641" rx="58" ry="72" fill={t.ink} />
          <circle cx="803" cy="613" r="18" fill="#fff" />
        </g>
      </g>
      <g className="mv-mouth">
        <path d="M 645 782 Q 712 866 779 782" fill="none" stroke={t.mouth} strokeWidth="11" strokeLinecap="round" />
      </g>
    </g>
  );
}

function Mascot({
  id,
  size,
  working,
  animate,
}: {
  id: MascotId;
  size: number;
  working: boolean;
  animate: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const def = MASCOTS[id];
  const t = THEMES[def.theme];
  const delay = (hash(uid) % 40) / 10;
  const showBrows = def.expr !== "fierce";

  return (
    <svg
      width={size}
      height={size}
      viewBox="162 130 1100 1100"
      overflow="visible"
      aria-hidden="true"
      className={`mv shrink-0 ${working ? "mv-working" : ""} ${animate ? "" : "mv-still"}`}
      style={{ "--d": `-${delay}s` } as CSSProperties}
    >
      <defs>
        <radialGradient id={`${uid}g`} cx="38%" cy="28%" r="80%">
          <stop offset="0" stopColor={t.hi} />
          <stop offset="0.55" stopColor={t.body} />
          <stop offset="1" stopColor={t.shade} />
        </radialGradient>
      </defs>

      <g className="mv-char">
        {/* legs + shoes */}
        <g className="mv-foot-l">
          <path d={LEG} fill={t.arm} />
        </g>
        <g className="mv-foot-r">
          <g transform="translate(1424 0) scale(-1 1)">
            <path d={LEG} fill={t.arm} />
          </g>
        </g>

        {/* side lobes + body */}
        <ellipse cx="388" cy="770" rx="120" ry="135" fill={t.body} />
        <ellipse cx="1036" cy="770" rx="120" ry="135" fill={t.body} />
        <ellipse cx="712" cy="713" rx="375" ry="392" fill={`url(#${uid}g)`} />

        {/* antennae with stars */}
        <Antenna t={t} side="l" />
        <Antenna t={t} side="r" />

        {/* face */}
        <Face id={id} uid={uid} t={t} />

        {/* determined brows (only visible while working) */}
        {showBrows && (
          <g className="mv-brows" fill="none" stroke={t.ink} strokeWidth="15" strokeLinecap="round">
            <path d="M 484 498 L 664 540" />
            <path d="M 760 540 L 940 498" />
          </g>
        )}

        {/* arms */}
        <g className="mv-arm-l">
          <ellipse cx="368" cy="830" rx="102" ry="74" transform="rotate(35 368 830)" fill={t.arm} stroke={t.shade} strokeOpacity="0.35" strokeWidth="5" />
        </g>
        <g className="mv-arm-r">
          <ellipse cx="1056" cy="830" rx="102" ry="74" transform="rotate(-35 1056 830)" fill={t.arm} stroke={t.shade} strokeOpacity="0.35" strokeWidth="5" />
        </g>

        {/* sweat (only visible while working) */}
        <g transform="translate(928 468)">
          <g className="mv-sweat">
            <path d={DROP} fill="#9AE0FF" stroke="#4FB8EE" strokeWidth="3" />
            <ellipse cx="-8" cy="18" rx="5" ry="9" fill="#fff" fillOpacity="0.7" />
          </g>
        </g>
        <g transform="translate(498 520)">
          <g className="mv-sweat mv-sweat-b">
            <path d={DROP} fill="#9AE0FF" stroke="#4FB8EE" strokeWidth="3" />
            <ellipse cx="-8" cy="18" rx="5" ry="9" fill="#fff" fillOpacity="0.7" />
          </g>
        </g>
      </g>
    </svg>
  );
}

export default function BotAvatar({
  color,
  paired,
  size = 36,
  ring = false,
  working = false,
  animate = true,
}: {
  color: AvatarColor;
  paired?: AvatarColor;
  size?: number;
  ring?: boolean;
  working?: boolean;
  animate?: boolean;
}) {
  if (paired) {
    return (
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <div className="absolute left-0 top-0">
          <Mascot id={resolveMascot(paired)} size={size * 0.72} working={working} animate={animate} />
        </div>
        <div className="absolute bottom-0 right-0 rounded-full ring-2 ring-panel">
          <Mascot id={resolveMascot(color)} size={size * 0.72} working={working} animate={animate} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`shrink-0 ${ring ? "rounded-full ring-2 ring-gold/70" : ""}`}
      style={{ width: size, height: size }}
    >
      <Mascot id={resolveMascot(color)} size={size} working={working} animate={animate} />
    </div>
  );
}
