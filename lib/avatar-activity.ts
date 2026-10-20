import { useSyncExternalStore } from "react";

// A tiny global "something is working" counter.
// WorkingBar and RunBars call beginActivity() while they are on screen,
// and avatars read it with useAnyActivity() to show the "under pressure" look.

let active = 0;
const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((l) => l());
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

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useAnyActivity(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active > 0,
    () => false
  );
}
