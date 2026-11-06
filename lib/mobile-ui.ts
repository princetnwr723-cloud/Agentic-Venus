"use client";

import { useEffect, useSyncExternalStore } from "react";

type Fn = () => void;

// ---- the chat-list drawer (phone). The header opens it, the sidebar shows it. ----
let drawerOpen = false;
const subs = new Set<Fn>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: Fn) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export function openDrawer() {
  if (!drawerOpen) { drawerOpen = true; emit(); }
}
export function closeDrawer() {
  if (drawerOpen) { drawerOpen = false; emit(); }
}
export function useDrawer(): boolean {
  return useSyncExternalStore(subscribe, () => drawerOpen, () => false);
}

// ---- html[data-dash] switches on the phone look of the dashboard (see app/mobile.css). Reference-counted. ----
let dashUsers = 0;
export function useDashFlag() {
  useEffect(() => {
    dashUsers++;
    document.documentElement.setAttribute("data-dash", "1");
    return () => {
      dashUsers--;
      if (dashUsers <= 0) document.documentElement.removeAttribute("data-dash");
    };
  }, []);
}

// ---- true below Tailwind's md breakpoint (768px) ----
const mq = () => window.matchMedia("(max-width: 767px)");
const subMobile = (cb: Fn) => {
  const m = mq();
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
export function useIsMobile(): boolean {
  return useSyncExternalStore(subMobile, () => mq().matches, () => false);
}