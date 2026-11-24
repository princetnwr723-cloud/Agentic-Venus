"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import "./buddy.css";
import { buddyBody, buddyInner, parseBuddy, stateClasses, type BuddyState } from "@/lib/buddies";
import { useFurUrl } from "@/lib/use-fur";

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * One animated buddy.
 *  state    = idle | thinking | working | waiting | blocked | done
 *  fur      = plush fur look (default on, false = old flat look)
 *  working / happy = old props, still work
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
  const parsed = parseBuddy(value);

  const id = parsed?.def.id ?? "";
  const hex = parsed?.hex ?? "";
  const face = parsed?.face ?? "dot";

  // only make the fur picture when the avatar is (almost) on screen
  const ref = useRef<SVGSVGElement | null>(null);
  const [seen, setSeen] = useState(false);
  const has = !!parsed;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (list) => {
        if (list.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "120px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [has]);

  const body = useMemo(() => (parsed ? buddyBody(parsed.def, parsed.hex) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, hex]
  );
  const furUrl = useFurUrl(body, id, hex, size, fur && has && seen);

  const html = useMemo(
    () => (parsed ? buddyInner(parsed.def, parsed.hex, parsed.face, fur ? { url: furUrl } : undefined) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, hex, face, fur, furUrl]
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
      ref={ref}
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
