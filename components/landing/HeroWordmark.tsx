"use client";

import type { CSSProperties } from "react";
import BotAvatar from "@/components/BotAvatar";
import type { AvatarColor } from "@/lib/bots";

const NAME = "AgenticVenus";

type Roamer = {
  v: AvatarColor;
  size: number;
  pos: CSSProperties;
  ax: number;
  ay: number;
  dur: number;
  delay: number;
  r0: number;
  r1: number;
  ring?: boolean;
  hideOnMobile?: boolean;
};

const ROAMERS: Roamer[] = [
  { v: "purple-star", size: 58, pos: { left: "2%", top: "58%" }, ax: 26, ay: 18, dur: 13, delay: 0, r0: -10, r1: 8 },
  { v: "bd.bunny:#ff7eb6" as AvatarColor, size: 52, pos: { left: "17%", top: "-6%" }, ax: 30, ay: 14, dur: 15, delay: -3, r0: 6, r1: -8 },
  { v: "orange-wink", size: 50, pos: { left: "88%", top: "4%" }, ax: -28, ay: 20, dur: 12, delay: -5, r0: 10, r1: -6 },
  { v: "bd.robot:#3fc9ae" as AvatarColor, size: 58, pos: { left: "70%", top: "88%" }, ax: 34, ay: 12, dur: 16, delay: -2, r0: -6, r1: 9 },
  { v: "blue-wow", size: 60, pos: { left: "92%", top: "58%" }, ax: -22, ay: 22, dur: 14, delay: -7, r0: 8, r1: -10, ring: true },
  { v: "bd.fox:#ff9f43" as AvatarColor, size: 52, pos: { left: "38%", top: "94%" }, ax: 28, ay: 10, dur: 17, delay: -9, r0: -8, r1: 6 },
  { v: "bd.ghost:#a98bf0" as AvatarColor, size: 48, pos: { left: "60%", top: "-10%" }, ax: -26, ay: 16, dur: 18, delay: -4, r0: 6, r1: -7, hideOnMobile: true },
  { v: "green-joy", size: 44, pos: { left: "0%", top: "18%" }, ax: 22, ay: 24, dur: 15, delay: -6, r0: -6, r1: 10, hideOnMobile: true },
];

export default function HeroWordmark() {
  return (
    <div className="relative mx-auto max-w-6xl px-6 pb-2 pt-10 md:pt-14">
      <div className="relative mx-auto w-fit">
        <div className="lv-word" aria-label={NAME} role="img">
          <span className="lv-ghost lv-ghost-top" aria-hidden="true">
            {NAME}
          </span>

          <span aria-hidden="true" className="relative z-[1] inline-block">
            {NAME.split("").map((ch, i) => (
              <span
                key={i}
                className="lv-letter"
                style={{
                  animationDelay: `${i * 0.06}s, ${1.4 + i * 0.12}s`,
                }}
              >
                {ch}
              </span>
            ))}
          </span>

          <span className="lv-ghost lv-ghost-bottom" aria-hidden="true">
            {NAME}
          </span>
        </div>

        {/* buddies + avatars roaming around the name */}
        {ROAMERS.map((r, i) => (
          <div
            key={i}
            className={`pointer-events-none absolute z-[2] ${r.hideOnMobile ? "hidden sm:block" : ""}`}
            style={r.pos}
          >
            <div
              className="lv-roam relative"
              style={
                {
                  "--ax": `${r.ax}px`,
                  "--ay": `${r.ay}px`,
                  "--dur": `${r.dur}s`,
                  "--delay": `${r.delay}s`,
                  "--r0": `${r.r0}deg`,
                  "--r1": `${r.r1}deg`,
                } as CSSProperties
              }
            >
              {r.ring && <span className="lv-ring" />}
              <BotAvatar color={r.v} size={r.size} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}