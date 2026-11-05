"use client";

import { useEffect, useState } from "react";

// Wordmark colours. Change/add colours here.
export const BRAND_COLORS = [
  "#3FC9AE",
  "#EFA83B",
  "#A98BF0",
  "#5FA6F0",
  "#F08A5E",
  "#7FBF93",
  "#EE5C8A",
  "#E7B24D",
];

// Colour changes every 5 minutes (wall-clock based).
const SLOT_MS = 5 * 60 * 1000;
const slot = () => Math.floor(Date.now() / SLOT_MS) % BRAND_COLORS.length;

export function useBrandColor(): string {
  const [i, setI] = useState(0); // 0 on first render keeps SSR and client identical
  useEffect(() => {
    setI(slot());
    const t = setInterval(() => setI(slot()), 5000);
    return () => clearInterval(t);
  }, []);
  return BRAND_COLORS[i];
}