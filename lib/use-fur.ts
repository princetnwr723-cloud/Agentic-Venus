"use client";

import { useEffect, useState } from "react";
import { renderFur } from "@/lib/fur-render";

// One fur picture per (buddy, colour, size bucket). Pictures are made one after the other
// in the background (never blocks the page) and kept, so every later use is instant.

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
let chain: Promise<void> = Promise.resolve();

function seedOf(key: string): number {
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 9973;
}

function schedule(key: string, body: string, px: number): Promise<string | null> {
  const hit = pending.get(key);
  if (hit) return hit;
  const p = new Promise<string | null>((resolve) => {
    chain = chain.then(
      () =>
        new Promise<void>((done) => {
          setTimeout(async () => {
            try {
              const url = await renderFur(body, px, seedOf(key));
              if (url) cache.set(key, url);
              resolve(url);
            } catch {
              resolve(null);
            }
            done();
          }, 0);
        })
    );
  });
  pending.set(key, p);
  return p;
}

/** picture size (px) for an avatar shown at `size` css px */
export function furBucket(size: number): number {
  const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const want = size * 1.28 * dpr;
  const buckets = [96, 160, 256, 384];
  for (const b of buckets) if (b >= want) return b;
  return 384;
}

/** url of the fur picture, or null while it is still being made (or when fur is off) */
export function useFurUrl(
  body: string,
  id: string,
  hex: string,
  size: number,
  enabled: boolean
): string | null {
  const px = furBucket(size);
  const key = `${id}|${hex}|${px}`;
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    if (!enabled) {
      setUrl(null);
      return;
    }
    const hit = cache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    setUrl(null);
    let alive = true;
    // small delay: while a colour is being dragged only the last one is made
    const t = setTimeout(() => {
      schedule(key, body, px).then((u) => {
        if (alive) setUrl(u);
      });
    }, 90);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [enabled, key, body, px]);

  return enabled ? url : null;
}
