// A tiny shared store for the activity dock (the area right above the message box).
// RunBars owns the dock; the Progress panel (StepsPanel) renders INTO it, so everything that shows work in progress
// sits in ONE capped area instead of three separate things covering the chat.
import { useSyncExternalStore } from "react";

type State = { el: HTMLElement | null; teamShown: boolean };
let state: State = { el: null, teamShown: false };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const dock = {
  /** RunBars calls this with its slot element (and null when it goes away). */
  setEl(el: HTMLElement | null) {
    if (state.el === el) return;
    state = { ...state, el };
    emit();
  },
  /** The Progress panel says whether it is already showing the running team, so RunBars does not repeat it. */
  setTeamShown(v: boolean) {
    if (state.teamShown === v) return;
    state = { ...state, teamShown: v };
    emit();
  },
};

export const useDockEl = () => useSyncExternalStore(subscribe, () => state.el, () => null);
export const useTeamShown = () => useSyncExternalStore(subscribe, () => state.teamShown, () => false);
