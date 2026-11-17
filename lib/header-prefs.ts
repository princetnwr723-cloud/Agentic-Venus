"use client";
// Which buttons the dashboard header shows. Everything else lives in the header's "More" menu.
// Saved on this device (localStorage); changed from About → "Header buttons".
import { useSyncExternalStore } from "react";

export const HEADER_BUTTONS: Array<{ key: string; label: string; hint: string }> = [
  { key: "pc", label: "Computer", hint: "Your agent's PC" },
  { key: "team", label: "Team", hint: "Teammates working together" },
  { key: "focus", label: "Focus mode", hint: "Hide the sidebar" },
  { key: "code", label: "Venus Code", hint: "Build & deploy" },
  { key: "venus", label: "Venus Pro (video)", hint: "Video studio" },
  { key: "decks", label: "Decks", hint: "Presentations" },
  { key: "vmaps", label: "Vmaps", hint: "Maps & leads" },
  { key: "skills", label: "Memory & Skills", hint: "What it knows" },
  { key: "runs", label: "Runs", hint: "Background tasks" },
  { key: "vpassword", label: "vPassword", hint: "Logins vault" },
  { key: "connectors", label: "Connectors", hint: "Link your tools" },
  { key: "routines", label: "Routines", hint: "Scheduled tasks" },
  { key: "profile", label: "Profile & email", hint: "Avatar, role, inbox" },
];

/** Only the important ones are on the header by default. */
export const DEFAULT_HEADER = ["pc", "team", "focus"];

const KEY = "av:header-buttons";
const subs = new Set<() => void>();
let cache: string | null = null;
let cacheRaw: string | null | undefined;

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === cacheRaw && cache !== null) return JSON.parse(cache);
    cacheRaw = raw;
    if (!raw) { cache = JSON.stringify(DEFAULT_HEADER); return DEFAULT_HEADER; }
    const arr = JSON.parse(raw);
    const ok = Array.isArray(arr) ? arr.filter((k) => HEADER_BUTTONS.some((b) => b.key === k)) : DEFAULT_HEADER;
    cache = JSON.stringify(ok);
    return ok;
  } catch { return DEFAULT_HEADER; }
}

export function setHeaderButtons(keys: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(keys)); } catch { /* private mode: not remembered */ }
  subs.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  subs.add(f);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) f(); };
  window.addEventListener("storage", onStorage);
  return () => { subs.delete(f); window.removeEventListener("storage", onStorage); };
};

let lastSnap = "";
const snapshot = () => { const s = JSON.stringify(read()); lastSnap = s; return s; };

/** Keys of the buttons shown on the header. */
export function useHeaderButtons(): string[] {
  const s = useSyncExternalStore(subscribe, snapshot, () => JSON.stringify(DEFAULT_HEADER));
  void lastSnap;
  return JSON.parse(s);
}
