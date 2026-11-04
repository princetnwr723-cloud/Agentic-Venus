"use client";

import { useId, useMemo, type CSSProperties } from "react";
import "./buddy.css";
import { buddyInner, parseBuddy } from "@/lib/buddies";

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * One animated buddy.
 *  working  = "thinking": eyes dart, a little PC pops up, thought dots
 *  happy    = forced happy face + cheering jump (hovering does this too)
 *  animate  = true | false | "hover" (still until the pointer is over it)
 */
export default function BuddyAvatar({
  value,
  size = 36,
  working = false,
  happy = false,
  animate = true,
}: {
  value: string;
  size?: number;
  working?: boolean;
  happy?: boolean;
  animate?: boolean | "hover";
}) {
  const uid = useId();
  const delay = (hash(uid) % 40) / 10;
  const parsed = parseBuddy(value);

  const id = parsed?.def.id ?? "";
  const hex = parsed?.hex ?? "";
  const face = parsed?.face ?? "dot";

  const html = useMemo(
    () => (parsed ? buddyInner(parsed.def, parsed.hex, parsed.face) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, hex, face]
  );

  if (!parsed) return null;

  const cls = [
    "bd shrink-0",
    `bd-m-${parsed.def.motion}`,
    working ? "bd-working" : "",
    happy && !working ? "bd-happy" : "",
    animate === false ? "bd-still" : animate === "hover" ? "bd-hoveronly" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      overflow="visible"
      aria-hidden="true"
      className={cls}
      style={{ "--d": `-${delay}s` } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
