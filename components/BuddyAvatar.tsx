"use client";

import { useId, useMemo, type CSSProperties } from "react";
import "./buddy.css";
import { buddyInner, parseBuddy, stateClasses, type BuddyState } from "@/lib/buddies";

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * One animated buddy.
 *  working  = "thinking": eyes dart, a little PC pops up, thought dots
 *  happy    = forced happy face + cheering jump (hovering does this too)
 *  state    = idle | thinking | working | waiting | blocked | done
 *  fur      = fluffy 3D fur look (default on, false = old flat look)
 *  animate  = true | false | "hover" (still until the pointer is over it)
 */
export default function BuddyAvatar({
  value,
  size = 36,
  working = false,
  happy = false,
  animate = true,
  state,
  fur = true,
}: {
  value: string;
  size?: number;
  working?: boolean;
  happy?: boolean;
  animate?: boolean | "hover";
  state?: BuddyState;
  fur?: boolean;
}) {
  const uid = useId();
  const delay = (hash(uid) % 40) / 10;
  const furId = fur ? "bf" + uid.replace(/[^a-zA-Z0-9]/g, "") : undefined;
  const parsed = parseBuddy(value);

  const id = parsed?.def.id ?? "";
  const hex = parsed?.hex ?? "";
  const face = parsed?.face ?? "dot";

  const html = useMemo(
    () => (parsed ? buddyInner(parsed.def, parsed.hex, parsed.face, furId) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, hex, face, furId]
  );

  if (!parsed) return null;

  const cls = [
    "bd shrink-0",
    `bd-m-${parsed.def.motion}`,
    state ? stateClasses(state) : working ? "bd-working" : happy ? "bd-happy" : "",
    fur ? "bd-fur" : "",
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
