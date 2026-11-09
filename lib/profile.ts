"use client";
// The owner's "About" details in the browser: one shared copy (so the sidebar name, the About window and the agent's changes all agree).
import { useEffect, useSyncExternalStore } from "react";
import { auth } from "@/lib/firebase";

export type Profile = { name: string; phone: string; company: string; role: string; location: string; website: string; bio: string; theme?: "dark" | "light"; themeAt?: number; updatedAt?: number };
export const EMPTY: Profile = { name: "", phone: "", company: "", role: "", location: "", website: "", bio: "" };

let state: Profile = EMPTY;
let loaded = false;
let loadedFor = "";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const cacheKey = (uid: string) => "av:profile:" + uid;

async function call(body?: Record<string, unknown>): Promise<Profile> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error("Please sign in again.");
  const res = await fetch("/api/profile", {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer " + t, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || "Could not reach the server.");
  return d.profile as Profile;
}

function adopt(p: Profile) {
  state = { ...EMPTY, ...p };
  loaded = true;
  const uid = auth.currentUser?.uid;
  if (uid) { try { localStorage.setItem(cacheKey(uid), JSON.stringify(state)); } catch { /* ignore */ } }
  emit();
  void applyServerTheme(state);
}

/** The server holds the theme the owner (or the agent) chose last: a newer choice there wins over this device's. */
async function applyServerTheme(p: Profile) {
  if (!p.theme || !p.themeAt) return;
  const m = await import("@/lib/theme");
  if (p.themeAt > m.savedThemeAt()) m.rememberTheme(p.theme, p.themeAt);
}

export async function loadProfile(): Promise<Profile> {
  const uid = auth.currentUser?.uid;
  if (!uid) return state;
  if (loadedFor !== uid) {
    loadedFor = uid; state = EMPTY; loaded = false;
    try { const raw = localStorage.getItem(cacheKey(uid)); if (raw) { state = { ...EMPTY, ...JSON.parse(raw) }; loaded = true; emit(); } } catch { /* ignore */ }
  }
  try { adopt(await call()); } catch { /* offline or server not set up: the cached copy stays */ }
  return state;
}

export async function saveProfile(patch: Partial<Profile>): Promise<Profile> {
  const p = await call({ patch });
  adopt(p);
  // the device now uses the server's clock for "when was the theme chosen", so a later change by the agent is never ignored
  if (patch.theme && p.theme && p.themeAt) (await import("@/lib/theme")).rememberTheme(p.theme, p.themeAt);
  return p;
}

export function resetProfile() { state = EMPTY; loaded = false; loadedFor = ""; emit(); }

export function useProfile(): { profile: Profile; loaded: boolean; reload: () => Promise<Profile>; save: (p: Partial<Profile>) => Promise<Profile> } {
  const profile = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => EMPTY);
  useEffect(() => { if (auth.currentUser && loadedFor !== auth.currentUser.uid) void loadProfile(); }, []);
  return { profile, loaded, reload: loadProfile, save: saveProfile };
}

/** What to show for the owner in the sidebar: the name they gave, else the name of their account, else the part of the email before the @ (never the whole email). */
export function shownName(p: Profile, fallback?: string | null): string {
  if (p.name.trim()) return p.name.trim();
  const f = String(fallback ?? "").trim();
  if (!f) return "Account";
  return f.includes("@") ? f.split("@")[0] : f;
}