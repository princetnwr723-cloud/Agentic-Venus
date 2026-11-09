"use client";
// Night / Light mode. The choice lives in localStorage (instant, no flash) and in the user's profile on the server,
// so the agent can change it too ("switch to night mode") and it follows the user to other devices.
import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const KEY = "av:theme";
const AT = "av:theme:at";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The landing page ("/") is always dark: it is a designed page, the app screens follow the chosen theme. */
const forcedDark = () => typeof location !== "undefined" && location.pathname === "/";

export function savedTheme(): Theme {
  try { return localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch { return "dark"; }
}
export function savedThemeAt(): number {
  try { return Number(localStorage.getItem(AT)) || 0; } catch { return 0; }
}

/** Puts the theme on the page (the colors switch at once). */
export function paintTheme(t: Theme) {
  if (typeof document === "undefined") return;
  const shown: Theme = forcedDark() ? "dark" : t;
  document.documentElement.setAttribute("data-theme", shown);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", shown === "light" ? "#f6f6f9" : "#0a0a0b");
  emit();
}

/** Remembers the theme on this device. `at` is when the owner chose it (the newer choice wins between device and server). */
export function rememberTheme(t: Theme, at = Date.now()) {
  try { localStorage.setItem(KEY, t); localStorage.setItem(AT, String(at)); } catch { /* private mode: the theme just is not remembered */ }
  paintTheme(t);
}

const current = (): Theme => (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");

/** The theme that is on screen now, and a setter that saves it (device + server). */
export function useTheme(): [Theme, (t: Theme) => void] {
  const t = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, current, () => "dark" as Theme);
  const set = (next: Theme) => {
    rememberTheme(next);
    void import("@/lib/profile").then((m) => m.saveProfile({ theme: next })).catch(() => {});
  };
  return [t, set];
}