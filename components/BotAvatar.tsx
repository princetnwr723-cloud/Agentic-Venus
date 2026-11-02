"use client";

import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { buildTheme, mix, type AvatarTheme } from "@/lib/avatar-theme";
import { parseAvatar, type AvatarColor, type MascotExpr } from "@/lib/bots";

const STAR =
  "0,-58 15.3,-21 55.2,-17.9 24.7,8 34.1,46.9 0,26 -34.1,46.9 -24.7,8 -55.2,-17.9 -15.3,-21";

const LEG =
  "M 640 1080 L 668 1080 L 668 1210 L 508 1210 C 494 1210 489 1198 492 1182 C 500 1138 545 1106 598 1104 C 615 1103 628 1103 640 1103 Z";

const DROP =
  "M 0 -34 C 12 -12 24 0 24 16 C 24 31 13 42 0 42 C -13 42 -24 31 -24 16 C -24 0 -12 -12 0 -34 Z";

const HEART =
  "M 0 46 C -66 4 -62 -50 -30 -52 C -12 -53 -2 -42 0 -32 C 2 -42 12 -53 30 -52 C 62 -50 66 4 0 46 Z";

const NO_BROWS: MascotExpr[] = ["fierce", "rogue", "cool", "sad"];

const CODE_LINES = [
  { x: 596, y: 914, w: 150, c: "#5EE6A8" },
  { x: 612, y: 932, w: 210, c: "#7DB7FF" },
  { x: 628, y: 950, w: 120, c: "#FFD166" },
  { x: 612, y: 968, w: 180, c: "#FF8FA3" },
  { x: 596, y: 986, w: 90, c: "#C3A6FF" },
];

function spiral(cx: number, cy: number, r: number, turns = 2.6): string {
  const steps = 60;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * turns * 2 * Math.PI;
    const rr = (i / steps) * r;
    d += (i ? "L" : "M") + (cx + rr * Math.cos(a)).toFixed(1) + " " + (cy + rr * Math.sin(a)).toFixed(1) + " ";
  }
  return d;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/* ------------------------------------------------------------------ */
/* Fur: fluffy scalloped edge + hair strands + soft inner tufts        */
/* Built ONCE at module load (seeded, so every avatar looks the same), */
/* merged into a few <path>s per shade so it stays cheap to render.    */
/* ------------------------------------------------------------------ */

const TONES = 5; // 0 = lightest ... 4 = darkest

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f1 = (n: number) => n.toFixed(1);

type FurSet = { bumps: string[]; strands: string[] };

function emptyTones(): string[] {
  return Array.from({ length: TONES }, () => "");
}

// the body is shaded by a radial gradient (light top-left, dark bottom-right) -> pick the matching tone
function bodyTone(x: number, y: number): number {
  const s = Math.min(1, Math.hypot((x - 622) / 600, (y - 540) / 627));
  const idx = s < 0.55 ? (s / 0.55) * 2 : 2 + ((s - 0.55) / 0.45) * 2;
  return Math.max(0, Math.min(TONES - 1, Math.round(idx)));
}

function buildRing(o: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  bumps: number;
  bumpR: number;
  strands: number;
  len: number;
  seed: number;
  skip?: (x: number, y: number) => boolean;
  tone: (x: number, y: number) => number;
}): FurSet {
  const r = rng(o.seed);
  const out: FurSet = { bumps: emptyTones(), strands: emptyTones() };
  const clampT = (n: number) => Math.max(0, Math.min(TONES - 1, n));

  // fluffy "cloud" bumps = scalloped silhouette
  for (let i = 0; i < o.bumps; i++) {
    const a = (i / o.bumps) * Math.PI * 2 + (r() - 0.5) * 0.12;
    const x = o.cx + o.rx * 0.99 * Math.cos(a);
    const y = o.cy + o.ry * 0.99 * Math.sin(a);
    const rad = o.bumpR * (0.8 + r() * 0.5);
    if (o.skip?.(x, y)) continue;
    const k = clampT(o.tone(x, y));
    out.bumps[k] += `M ${f1(x - rad)} ${f1(y)} a ${f1(rad)} ${f1(rad)} 0 1 0 ${f1(rad * 2)} 0 a ${f1(rad)} ${f1(rad)} 0 1 0 ${f1(-rad * 2)} 0 Z `;
  }

  // hair strands sticking out, each with a little curl
  for (let i = 0; i < o.strands; i++) {
    const a = (i / o.strands) * Math.PI * 2 + (r() - 0.5) * ((Math.PI * 2) / o.strands) * 0.9;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const bx = o.cx + o.rx * 0.93 * ca;
    const by = o.cy + o.ry * 0.93 * sa;
    if (o.skip?.(bx, by)) continue;
    let nx = ca / o.rx;
    let ny = sa / o.ry;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    const L = o.len * (0.65 + r() * 0.85);
    const curl = (r() - 0.5) * 1.1;
    const mx = bx + nx * L * 0.55 - ny * L * curl * 0.45;
    const my = by + ny * L * 0.55 + nx * L * curl * 0.45;
    const tx = bx + nx * L - ny * L * curl * 0.9;
    const ty = by + ny * L + nx * L * curl * 0.9;
    const k = clampT(o.tone(bx, by) + (r() < 0.5 ? -1 : 0) + (r() < 0.2 ? 1 : 0));
    out.strands[k] += `M ${f1(bx)} ${f1(by)} Q ${f1(mx)} ${f1(my)} ${f1(tx)} ${f1(ty)} `;
  }
  return out;
}

const inBody = (x: number, y: number, k = 0.9) =>
  ((x - 712) / 375) ** 2 + ((y - 713) / 392) ** 2 < k * k;

const FUR_BODY = buildRing({
  cx: 712,
  cy: 713,
  rx: 375,
  ry: 392,
  bumps: 34,
  bumpR: 50,
  strands: 120,
  len: 62,
  seed: 7,
  tone: bodyTone,
});

const FUR_LOBE_L = buildRing({
  cx: 388,
  cy: 770,
  rx: 120,
  ry: 135,
  bumps: 12,
  bumpR: 34,
  strands: 26,
  len: 44,
  seed: 21,
  skip: (x, y) => inBody(x, y, 0.97),
  tone: () => 2,
});

const FUR_LOBE_R = buildRing({
  cx: 1036,
  cy: 770,
  rx: 120,
  ry: 135,
  bumps: 12,
  bumpR: 34,
  strands: 26,
  len: 44,
  seed: 33,
  skip: (x, y) => inBody(x, y, 0.97),
  tone: () => 2,
});

// arms are generated around (0,0) and placed with translate + rotate
const FUR_ARM = buildRing({
  cx: 0,
  cy: 0,
  rx: 102,
  ry: 74,
  bumps: 14,
  bumpR: 24,
  strands: 24,
  len: 34,
  seed: 55,
  tone: () => 1,
});

// short soft tufts scattered over the tummy / cheeks / forehead (never over the face)
const INNER = (() => {
  const r = rng(99);
  let light = "";
  let dark = "";
  let n = 0;
  let guard = 0;
  while (n < 80 && guard++ < 2000) {
    const a = r() * Math.PI * 2;
    const rr = Math.sqrt(r()) * 0.9;
    const x = 712 + 375 * rr * Math.cos(a);
    const y = 713 + 392 * rr * Math.sin(a);
    if (x > 430 && x < 995 && y > 480 && y < 930) continue; // face + laptop zone
    let dx = x - 712;
    let dy = y - 700;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const L = 34 + r() * 40;
    const bend = (r() - 0.5) * 0.8;
    const x2 = x + dx * L - dy * L * bend;
    const y2 = y + dy * L + dx * L * bend;
    const mx = x + dx * L * 0.5 - dy * L * bend * 0.6;
    const my = y + dy * L * 0.5 + dx * L * bend * 0.6;
    const seg = `M ${f1(x)} ${f1(y)} Q ${f1(mx)} ${f1(my)} ${f1(x2)} ${f1(y2)} `;
    if (r() < 0.55) light += seg;
    else dark += seg;
    n++;
  }
  return { light, dark };
})();

function FurRing({
  set,
  tones,
  sw,
  strands = true,
}: {
  set: FurSet;
  tones: string[];
  sw: number;
  strands?: boolean;
}) {
  return (
    <g>
      {set.bumps.map((d, i) => (d ? <path key={`b${i}`} d={d} fill={tones[i]} /> : null))}
      {strands &&
        set.strands.map((d, i) =>
          d ? (
            <path
              key={`s${i}`}
              d={d}
              fill="none"
              stroke={tones[i]}
              strokeWidth={sw}
              strokeLinecap="round"
            />
          ) : null
        )}
    </g>
  );
}

function Antenna({ t, side }: { t: AvatarTheme; side: "l" | "r" }) {
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

function BigEye({
  t,
  cx,
  cy,
  rx,
  ry,
  px,
  py,
  prx,
  pry,
  hx,
  hy,
  hr,
}: {
  t: AvatarTheme;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  px: number;
  py: number;
  prx: number;
  pry: number;
  hx: number;
  hy: number;
  hr: number;
}) {
  return (
    <g className="mv-eye">
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#fff" stroke={t.pupil} strokeOpacity="0.14" strokeWidth="3" />
      <g className="mv-pupil">
        <ellipse cx={px} cy={py} rx={prx} ry={pry} fill={t.pupil} />
        <circle cx={hx} cy={hy} r={hr} fill="#fff" />
      </g>
    </g>
  );
}

function Smile({ t, d, w = 11 }: { t: AvatarTheme; d: string; w?: number }) {
  return (
    <g className="mv-mouth">
      <path d={d} fill="none" stroke={t.line} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function Lens({ t }: { t: AvatarTheme }) {
  return (
    <g>
      <path d="M 478 590 L 672 590 Q 684 590 682 604 L 668 676 Q 662 700 636 700 L 520 700 Q 494 700 488 676 L 474 604 Q 472 590 478 590 Z" fill="#0B0C12" stroke={t.dark ? "#ffffff" : "#0B0C12"} strokeOpacity="0.35" strokeWidth="3" />
      <path d="M 474 604 L 436 592" fill="none" stroke="#0B0C12" strokeWidth="12" strokeLinecap="round" />
      <path d="M 520 602 L 566 602 L 524 662 L 500 662 Z" fill="#fff" fillOpacity="0.28" />
      <path d="M 580 602 L 598 602 L 570 642 L 552 642 Z" fill="#fff" fillOpacity="0.18" />
    </g>
  );
}

function Face({ expr, uid, t }: { expr: MascotExpr; uid: string; t: AvatarTheme }) {
  if (expr === "fierce" || expr === "rogue") {
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
              <circle cx="590" cy="645" r="56" fill={t.pupil} />
              <circle cx="563" cy="630" r="15" fill="#fff" />
            </g>
          </g>
        </g>
        <g clipPath={`url(#${uid}cr)`}>
          <g className="mv-eye">
            <ellipse cx="847" cy="662" rx="88" ry="70" fill="#fff" />
            <g className="mv-pupil">
              <circle cx="835" cy="650" r="56" fill={t.pupil} />
              <circle cx="808" cy="633" r="15" fill="#fff" />
            </g>
          </g>
        </g>
        <path d="M 470 584 L 670 628" fill="none" stroke={t.line} strokeWidth="10" strokeLinecap="round" />
        <path d="M 755 628 L 948 584" fill="none" stroke={t.line} strokeWidth="10" strokeLinecap="round" />
        <Smile t={t} d="M 638 784 Q 715 826 815 752" w={9} />
        {expr === "rogue" && (
          <>
            <g transform="translate(458 738) scale(0.62)">
              <g className="mv-star">
                <polygon points={STAR} fill={t.blushLight} stroke={t.blushLight} strokeWidth="8" strokeLinejoin="round" />
              </g>
            </g>
            <g transform="translate(960 734) scale(0.62)">
              <g className="mv-star">
                <polygon points={STAR} fill={t.blushLight} stroke={t.blushLight} strokeWidth="8" strokeLinejoin="round" />
              </g>
            </g>
          </>
        )}
      </g>
    );
  }

  if (expr === "wink") {
    return (
      <g>
        <BigEye t={t} cx={582} cy={640} rx={90} ry={118} px={598} py={640} prx={58} pry={72} hx={572} hy={614} hr={18} />
        <g className="mv-wink">
          <path d="M 772 680 C 792 628 852 602 904 688" fill="none" stroke={t.line} strokeWidth="12" strokeLinecap="round" />
          <path d="M 794 668 C 828 642 866 646 886 666" fill="none" stroke={t.line} strokeWidth="8" strokeLinecap="round" />
        </g>
        <g className="mv-cheek" opacity="0.7">
          <ellipse cx="500" cy="790" rx="46" ry="30" fill={t.blushLight} />
          <ellipse cx="924" cy="790" rx="46" ry="30" fill={t.blushLight} />
        </g>
        <Smile t={t} d="M 645 782 Q 712 866 779 782" w={12} />
      </g>
    );
  }

  if (expr === "wow") {
    return (
      <g>
        <BigEye t={t} cx={578} cy={634} rx={90} ry={120} px={602} py={636} prx={62} pry={72} hx={576} hy={606} hr={20} />
        <BigEye t={t} cx={841} cy={634} rx={90} ry={120} px={828} py={636} prx={62} pry={72} hx={804} hy={606} hr={20} />
        <g className="mv-cheek">
          <ellipse cx="535" cy="778" rx="56" ry="46" fill={t.blushLight} />
          <ellipse cx="884" cy="778" rx="56" ry="46" fill={t.blushLight} />
        </g>
        <g className="mv-mouth">
          <ellipse cx="712" cy="797" rx="31" ry="43" fill={t.cavity} />
          <ellipse cx="712" cy="826" rx="24" ry="16" fill={t.tongue} />
        </g>
      </g>
    );
  }

  if (expr === "joy") {
    return (
      <g>
        <g className="mv-joyeye">
          <path d="M 508 660 L 508 645 C 508 598 540 570 574 570 C 608 570 640 598 640 645 L 640 660" fill="none" stroke={t.line} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g className="mv-joyeye">
          <path d="M 772 660 L 772 645 C 772 598 804 570 838 570 C 872 570 904 598 904 645 L 904 660" fill="none" stroke={t.line} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g className="mv-cheek" opacity="0.8">
          <ellipse cx="500" cy="712" rx="50" ry="40" fill={t.blush} />
          <ellipse cx="920" cy="712" rx="50" ry="40" fill={t.blush} />
        </g>
        <g className="mv-mouth">
          <path d="M 586 706 C 640 722 784 722 840 706 C 836 820 790 888 713 888 C 636 888 590 820 586 706 Z" fill={t.cavity} />
          <path d="M 635 840 C 650 805 776 805 791 840 C 775 878 650 878 635 840 Z" fill={t.tongue} />
        </g>
      </g>
    );
  }

  if (expr === "sleepy") {
    return (
      <g>
        <ellipse cx="576" cy="672" rx="86" ry="72" fill="#fff" />
        <g className="mv-pupil">
          <circle cx="584" cy="676" r="46" fill={t.pupil} />
          <ellipse cx="558" cy="660" rx="20" ry="9" fill="#fff" />
        </g>
        <ellipse cx="846" cy="672" rx="86" ry="72" fill="#fff" />
        <g className="mv-pupil">
          <circle cx="838" cy="676" r="46" fill={t.pupil} />
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
        <Smile t={t} d="M 645 777 Q 705 818 775 777" />
      </g>
    );
  }

  if (expr === "love") {
    return (
      <g>
        <ellipse cx="579" cy="640" rx="89" ry="118" fill="#fff" stroke={t.pupil} strokeOpacity="0.14" strokeWidth="3" />
        <ellipse cx="841" cy="640" rx="89" ry="118" fill="#fff" stroke={t.pupil} strokeOpacity="0.14" strokeWidth="3" />
        <g transform="translate(579 640)">
          <g className="mv-heart">
            <path d={HEART} fill="#FF3366" />
            <ellipse cx="-32" cy="-30" rx="10" ry="6" transform="rotate(-30 -32 -30)" fill="#fff" fillOpacity="0.8" />
          </g>
        </g>
        <g transform="translate(841 640)">
          <g className="mv-heart">
            <path d={HEART} fill="#FF3366" />
            <ellipse cx="-32" cy="-30" rx="10" ry="6" transform="rotate(-30 -32 -30)" fill="#fff" fillOpacity="0.8" />
          </g>
        </g>
        <g className="mv-cheek" opacity="0.8">
          <ellipse cx="505" cy="772" rx="50" ry="40" fill={t.blushLight} />
          <ellipse cx="919" cy="772" rx="50" ry="40" fill={t.blushLight} />
        </g>
        <Smile t={t} d="M 650 790 Q 712 856 774 790" w={12} />
      </g>
    );
  }

  if (expr === "cool") {
    return (
      <g>
        <g className="mv-glasses">
          <Lens t={t} />
          <g transform="translate(1424 0) scale(-1 1)">
            <Lens t={t} />
          </g>
          <path d="M 680 606 Q 712 588 744 606" fill="none" stroke="#0B0C12" strokeWidth="12" strokeLinecap="round" />
        </g>
        <Smile t={t} d="M 645 792 Q 715 842 800 772" w={11} />
      </g>
    );
  }

  if (expr === "sad") {
    return (
      <g>
        <g className="mv-eye">
          <ellipse cx="579" cy="650" rx="86" ry="104" fill="#fff" stroke={t.pupil} strokeOpacity="0.14" strokeWidth="3" />
          <g className="mv-pupil">
            <ellipse cx="590" cy="624" rx="54" ry="62" fill={t.pupil} />
            <circle cx="568" cy="598" r="22" fill="#fff" />
            <circle cx="612" cy="650" r="8" fill="#fff" />
          </g>
        </g>
        <g className="mv-eye">
          <ellipse cx="841" cy="650" rx="86" ry="104" fill="#fff" stroke={t.pupil} strokeOpacity="0.14" strokeWidth="3" />
          <g className="mv-pupil">
            <ellipse cx="830" cy="624" rx="54" ry="62" fill={t.pupil} />
            <circle cx="808" cy="598" r="22" fill="#fff" />
            <circle cx="852" cy="650" r="8" fill="#fff" />
          </g>
        </g>
        <path d="M 480 545 L 664 500" fill="none" stroke={t.line} strokeWidth="14" strokeLinecap="round" />
        <path d="M 760 500 L 944 545" fill="none" stroke={t.line} strokeWidth="14" strokeLinecap="round" />
        <g transform="translate(528 800) scale(0.7)">
          <g className="mv-tear">
            <path d={DROP} fill="#9AE0FF" stroke="#4FB8EE" strokeWidth="3" />
          </g>
        </g>
        <Smile t={t} d="M 640 836 Q 712 772 784 836" w={11} />
      </g>
    );
  }

  if (expr === "dizzy") {
    return (
      <g>
        <circle cx="579" cy="637" r="86" fill="#fff" stroke={t.pupil} strokeOpacity="0.14" strokeWidth="3" />
        <circle cx="841" cy="637" r="86" fill="#fff" stroke={t.pupil} strokeOpacity="0.14" strokeWidth="3" />
        <g className="mv-spin">
          <path d={spiral(579, 637, 68)} fill="none" stroke={t.pupil} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g className="mv-spin mv-spin-r">
          <path d={spiral(841, 637, 68)} fill="none" stroke={t.pupil} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <Smile t={t} d="M 636 806 Q 656 780 676 806 T 716 806 T 756 806 T 796 806" w={11} />
      </g>
    );
  }

  if (expr === "starry") {
    return (
      <g>
        <ellipse cx="579" cy="640" rx="89" ry="118" fill="#fff" stroke={t.pupil} strokeOpacity="0.14" strokeWidth="3" />
        <ellipse cx="841" cy="640" rx="89" ry="118" fill="#fff" stroke={t.pupil} strokeOpacity="0.14" strokeWidth="3" />
        <g transform="translate(579 644) scale(1.25)">
          <g className="mv-star">
            <polygon points={STAR} fill="#FFD43B" stroke="#FFD43B" strokeWidth="8" strokeLinejoin="round" />
            <circle cx="-18" cy="-14" r="8" fill="#fff" fillOpacity="0.85" />
          </g>
        </g>
        <g transform="translate(841 644) scale(1.25)">
          <g className="mv-star">
            <polygon points={STAR} fill="#FFD43B" stroke="#FFD43B" strokeWidth="8" strokeLinejoin="round" />
            <circle cx="-18" cy="-14" r="8" fill="#fff" fillOpacity="0.85" />
          </g>
        </g>
        <g className="mv-mouth">
          <path d="M 636 768 C 670 790 754 790 788 768 C 784 840 754 862 712 862 C 670 862 640 840 636 768 Z" fill={t.cavity} />
          <path d="M 672 836 C 686 814 738 814 752 836 C 740 856 684 856 672 836 Z" fill={t.tongue} />
        </g>
      </g>
    );
  }

  if (expr === "tongue") {
    return (
      <g>
        <BigEye t={t} cx={579} cy={637} rx={89} ry={118} px={598} py={641} prx={58} pry={72} hx={572} hy={613} hr={18} />
        <path d="M 772 664 C 790 600 888 600 906 664" fill="none" stroke={t.line} strokeWidth="15" strokeLinecap="round" />
        <path d="M 622 772 Q 712 806 802 772 Q 792 856 712 858 Q 632 856 622 772 Z" fill={t.cavity} />
        <g className="mv-tongue">
          <path d="M 672 828 L 672 880 C 672 914 752 914 752 880 L 752 828 Z" fill="#FF7A9C" />
          <path d="M 712 842 L 712 886" fill="none" stroke="#E25579" strokeWidth="6" strokeLinecap="round" />
        </g>
      </g>
    );
  }

  if (expr === "shy") {
    return (
      <g>
        <g className="mv-eye">
          <ellipse cx="585" cy="645" rx="72" ry="92" fill="#fff" stroke={t.pupil} strokeOpacity="0.14" strokeWidth="3" />
          <g className="mv-pupil">
            <ellipse cx="608" cy="676" rx="40" ry="48" fill={t.pupil} />
            <circle cx="592" cy="654" r="12" fill="#fff" />
          </g>
        </g>
        <g className="mv-eye">
          <ellipse cx="836" cy="645" rx="72" ry="92" fill="#fff" stroke={t.pupil} strokeOpacity="0.14" strokeWidth="3" />
          <g className="mv-pupil">
            <ellipse cx="859" cy="676" rx="40" ry="48" fill={t.pupil} />
            <circle cx="843" cy="654" r="12" fill="#fff" />
          </g>
        </g>
        <g className="mv-cheek" opacity="0.8">
          <ellipse cx="505" cy="772" rx="62" ry="44" fill={t.blushLight} />
          <ellipse cx="919" cy="772" rx="62" ry="44" fill={t.blushLight} />
        </g>
        <Smile t={t} d="M 676 808 Q 694 790 712 808 Q 730 826 748 808" w={10} />
      </g>
    );
  }

  if (expr === "nerd") {
    return (
      <g>
        <circle cx="579" cy="640" r="108" fill="#fff" fillOpacity="0.1" />
        <circle cx="841" cy="640" r="108" fill="#fff" fillOpacity="0.1" />
        <BigEye t={t} cx={579} cy={640} rx={66} ry={82} px={594} py={646} prx={42} pry={52} hx={578} hy={624} hr={13} />
        <BigEye t={t} cx={841} cy={640} rx={66} ry={82} px={829} py={646} prx={42} pry={52} hx={813} hy={624} hr={13} />
        <circle cx="579" cy="640" r="108" fill="none" stroke="#14151B" strokeWidth="14" />
        <circle cx="841" cy="640" r="108" fill="none" stroke="#14151B" strokeWidth="14" />
        <path d="M 684 626 Q 710 604 736 626" fill="none" stroke="#14151B" strokeWidth="12" strokeLinecap="round" />
        <path d="M 473 622 L 440 606" fill="none" stroke="#14151B" strokeWidth="12" strokeLinecap="round" />
        <path d="M 947 622 L 980 606" fill="none" stroke="#14151B" strokeWidth="12" strokeLinecap="round" />
        <Smile t={t} d="M 650 790 Q 712 848 774 790" w={11} />
        <rect x="694" y="812" width="36" height="30" rx="6" fill="#fff" stroke={t.line} strokeWidth="4" />
      </g>
    );
  }

  // calm
  return (
    <g>
      <BigEye t={t} cx={579} cy={637} rx={89} ry={118} px={598} py={641} prx={58} pry={72} hx={572} hy={613} hr={18} />
      <BigEye t={t} cx={841} cy={637} rx={89} ry={118} px={829} py={641} prx={58} pry={72} hx={803} hy={613} hr={18} />
      <g className="mv-cheek" opacity="0.7">
        <ellipse cx="500" cy="790" rx="46" ry="30" fill={t.blushLight} />
        <ellipse cx="924" cy="790" rx="46" ry="30" fill={t.blushLight} />
      </g>
      <Smile t={t} d="M 645 782 Q 712 866 779 782" />
    </g>
  );
}

function Laptop({ t }: { t: AvatarTheme }) {
  return (
    <g className="mv-laptop">
      <path d="M 540 1018 L 884 1018 L 902 1062 Q 904 1070 894 1070 L 530 1070 Q 520 1070 522 1062 Z" fill="#B9BEC9" stroke="#8D93A1" strokeWidth="4" />
      <rect x="650" y="1044" width="124" height="14" rx="7" fill="#9AA0AD" />
      <rect x="566" y="888" width="292" height="136" rx="14" fill="#1B1D26" stroke="#0E0F14" strokeWidth="4" />
      <rect x="580" y="900" width="264" height="110" rx="8" fill="#0C1B2E" />
      <rect x="580" y="900" width="264" height="110" rx="8" fill="#3FA0FF" fillOpacity="0.12" className="mv-glow" />
      {CODE_LINES.map((l, i) => (
        <rect
          key={i}
          x={l.x}
          y={l.y}
          width={l.w}
          height="9"
          rx="4.5"
          fill={l.c}
          className="mv-code"
          style={{ animationDelay: `${i * 0.17}s` }}
        />
      ))}
      <rect x="696" y="984" width="12" height="13" rx="2" fill="#fff" className="mv-cursor" />
      <circle cx="712" cy="1036" r="4" fill={t.arm} />
    </g>
  );
}

function Mascot({
  value,
  size,
  working,
  animate,
  fur,
}: {
  value: AvatarColor;
  size: number;
  working: boolean;
  animate: boolean;
  fur: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { expr, hex } = parseAvatar(value);
  const t = buildTheme(hex);
  const delay = (hash(uid) % 40) / 10;
  const showBrows = !NO_BROWS.includes(expr);
  // lightest -> darkest shades of this mascot, used by all the fur
  const tones = useMemo(
    () => [t.hi, mix(t.hi, t.body, 0.5), t.body, mix(t.body, t.shade, 0.5), t.shade],
    [t.hi, t.body, t.shade]
  );
  const fluff = fur && size >= 14; // scalloped fluffy edge
  const hairy = fur && size >= 36; // strands + tufts (too fine to see when tiny)

  // the PC comes out of the avatar's back when work starts and goes back in when it ends
  const [pc, setPc] = useState<"off" | "in" | "out">(working ? "in" : "off");
  useEffect(() => {
    if (working) {
      setPc("in");
      return;
    }
    setPc((p) => (p === "in" ? "out" : p));
    const tm = setTimeout(() => setPc((p) => (p === "out" ? "off" : p)), 650);
    return () => clearTimeout(tm);
  }, [working]);

  const cls = [
    "mv shrink-0",
    `mv-expr-${expr}`,
    working ? "mv-working" : "",
    pc === "in" ? "mv-pc-in" : pc === "out" ? "mv-pc-out" : "",
    animate ? "" : "mv-still",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox="162 130 1100 1100"
      overflow="visible"
      aria-hidden="true"
      className={cls}
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

        {/* fluffy fur behind the body (scalloped edge + hair strands) */}
        {fluff && (
          <g>
            <FurRing set={FUR_LOBE_L} tones={tones} sw={16} strands={hairy} />
            <FurRing set={FUR_LOBE_R} tones={tones} sw={16} strands={hairy} />
            <FurRing set={FUR_BODY} tones={tones} sw={20} strands={hairy} />
          </g>
        )}

        {/* side lobes + body */}
        <ellipse cx="388" cy="770" rx="120" ry="135" fill={t.body} />
        <ellipse cx="1036" cy="770" rx="120" ry="135" fill={t.body} />
        <ellipse cx="712" cy="713" rx="375" ry="392" fill={`url(#${uid}g)`} />

        {/* soft fur tufts on the body + a baby curl on top */}
        {hairy && (
          <g fill="none" strokeLinecap="round">
            <path d={INNER.dark} stroke={t.shade} strokeOpacity="0.22" strokeWidth="13" />
            <path d={INNER.light} stroke={t.hi} strokeOpacity="0.5" strokeWidth="13" />
            <path d="M 712 352 C 706 300 764 276 778 318 C 788 348 746 360 742 332" stroke={t.shade} strokeOpacity="0.3" strokeWidth="30" />
            <path d="M 712 352 C 706 300 764 276 778 318 C 788 348 746 360 742 332" stroke={t.arm} strokeWidth="22" />
            <path d="M 672 366 C 650 330 624 322 612 340" stroke={t.arm} strokeWidth="18" />
            <path d="M 752 366 C 776 336 806 334 814 354" stroke={t.arm} strokeWidth="18" />
          </g>
        )}

        {/* antennae with stars */}
        <Antenna t={t} side="l" />
        <Antenna t={t} side="r" />

        {/* face */}
        <Face expr={expr} uid={uid} t={t} />

        {/* determined brows (only visible while working) */}
        {showBrows && (
          <g className="mv-brows" fill="none" stroke={t.line} strokeWidth="15" strokeLinecap="round">
            <path d="M 484 498 L 664 540" />
            <path d="M 760 540 L 940 498" />
          </g>
        )}

        {/* the PC pulled out from the back */}
        {pc !== "off" && <Laptop t={t} />}

        {/* arms */}
        <g className="mv-arm-l">
          {fluff && (
            <g transform="translate(368 830) rotate(35)">
              <FurRing set={FUR_ARM} tones={tones} sw={13} strands={hairy} />
            </g>
          )}
          <ellipse cx="368" cy="830" rx="102" ry="74" transform="rotate(35 368 830)" fill={t.arm} stroke={t.shade} strokeOpacity="0.35" strokeWidth="5" />
        </g>
        <g className="mv-arm-r">
          {fluff && (
            <g transform="translate(1056 830) rotate(-35)">
              <FurRing set={FUR_ARM} tones={tones} sw={13} strands={hairy} />
            </g>
          )}
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
  fur = true,
}: {
  color: AvatarColor;
  paired?: AvatarColor;
  size?: number;
  ring?: boolean;
  working?: boolean;
  animate?: boolean;
  fur?: boolean;
}) {
  if (paired) {
    return (
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <div className="absolute left-0 top-0">
          <Mascot value={paired} size={size * 0.72} working={working} animate={animate} fur={fur} />
        </div>
        <div className="absolute bottom-0 right-0 rounded-full ring-2 ring-panel">
          <Mascot value={color} size={size * 0.72} working={working} animate={animate} fur={fur} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`shrink-0 ${ring ? "rounded-full ring-2 ring-gold/70" : ""}`}
      style={{ width: size, height: size }}
    >
      <Mascot value={color} size={size} working={working} animate={animate} fur={fur} />
    </div>
  );
}