import { useSyncExternalStore } from "react";
import type { AvatarColor } from "@/lib/bots";

// 1) "something is working" counter: WorkingBar / RunBars call beginActivity()
//    while they are on screen, avatars read it with useAnyActivity().
// 2) live avatar overrides: when you change a chat's avatar it shows at once
//    in the sidebar / header (the new value is also saved in Firestore).

let active = 0;
let version = 0;
let activeChat: string | null = null;
const overrides = new Map<string, string>();
const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((l) => l());
};
const bump = () => {
  version += 1;
  emit();
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function beginActivity(): () => void {
  active += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    active = Math.max(0, active - 1);
    emit();
  };
}

export function useAnyActivity(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active > 0,
    () => false
  );
}

/** Subscribe a component to avatar-override / active-chat changes. */
export function useAvatarStore(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0
  );
}

export function setAvatarOverride(chatId: string, value: string) {
  overrides.set(chatId, value);
  bump();
}

export function avatarFor(chatId: string | null | undefined, fallback: AvatarColor): AvatarColor {
  if (chatId && overrides.has(chatId)) return overrides.get(chatId) as AvatarColor;
  return fallback;
}

export function setActiveChat(id: string | null) {
  if (activeChat === id) return;
  activeChat = id;
  bump();
}

export function getActiveChat(): string | null {
  return activeChat;
}
