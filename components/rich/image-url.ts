"use client";

import { useEffect, useState } from "react";

// Remote images are only shown from these hosts (a model-written image URL can otherwise leak data in its query string).
const IMG_HOSTS = [
  "upload.wikimedia.org", "images.unsplash.com", "images.pexels.com",
  "raw.githubusercontent.com", "user-images.githubusercontent.com", "avatars.githubusercontent.com",
];
export const hostOk = (h: string) => IMG_HOSTS.includes(h) || h.endsWith(".supabase.co");

const urlCache = new Map<string, string>();

/** True when `src` is a picture the chat is allowed to show: our own stored image (vimg:), a small data: image, or https from a known host. */
export function imgAllowed(src: string): boolean {
  if (/^vimg:[\w\-./]+$/.test(src) && !src.includes("..")) return true;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(src)) return true;
  try {
    const u = new URL(src);
    return u.protocol === "https:" && hostOk(u.hostname);
  } catch { return false; }
}

/** Turns an image source (vimg:path, data: or https) into a URL the browser can load. */
export function useImageUrl(src: string | undefined): { url: string | null; failed: boolean; fail: () => void } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    setUrl(null);
    setFailed(false);
    if (!src) { setFailed(true); return; }
    (async () => {
      try {
        if (src.startsWith("vimg:")) {
          const path = src.slice(5);
          if (path.includes("..")) throw new Error("bad path");
          const hit = urlCache.get(path);
          if (hit) { if (!dead) setUrl(hit); return; }
          const res = await fetch("/api/venus/media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "url", path }),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok || !d.url) throw new Error("no url");
          urlCache.set(path, String(d.url));
          if (!dead) setUrl(String(d.url));
        } else if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(src)) {
          setUrl(src);
        } else {
          const u = new URL(src);
          if (u.protocol === "https:" && hostOk(u.hostname)) setUrl(src);
          else throw new Error("blocked");
        }
      } catch {
        if (!dead) setFailed(true);
      }
    })();
    return () => { dead = true; };
  }, [src]);

  return { url, failed, fail: () => setFailed(true) };
}
