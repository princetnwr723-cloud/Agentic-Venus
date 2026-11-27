"use client";

// Keeps EVERY background task of the account moving, on every page and in every chat.
// Before, only the chat that was open woke its own stuck task (the card above the message box did that), so a task in chat A
// seemed to stop the moment you opened chat B. This watcher is mounted once for the whole app: it follows all running tasks,
// wakes the ones that stopped moving (a slice died, a limit was reset), and keeps the phone computer online while tasks run.
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { agentApi, isActiveRun, watchRuns, type RunView } from "@/lib/agent/client";
import { wakeComputer } from "@/lib/native-computer";

const NUDGE_AFTER_MS = 60_000; // a queued / running task that has not moved for this long is woken up
const NUDGE_EVERY_MS = 45_000; // and not more often than this
const CHECK_EVERY_MS = 15_000;

export default function RunKeeper() {
  const { user } = useAuth();
  const [runs, setRuns] = useState<RunView[]>([]);
  const runsRef = useRef<RunView[]>([]);
  const lastNudge = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!user) { setRuns([]); return; }
    return watchRuns(user.uid, setRuns);
  }, [user]);
  useEffect(() => { runsRef.current = runs; }, [runs]);

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    const check = () => {
      const now = Date.now();
      const active = runsRef.current.filter(isActiveRun);
      if (!active.length) return;
      void wakeComputer(); // the phone computer stays online while any task runs (does nothing on the website)
      for (const r of active) {
        if (r.status === "paused") continue; // waiting for the owner (approval, question): not stuck
        if (r.status === "budget" && r.error?.code === "cost") continue; // a per-task cost stop waits for the owner's "Continue"
        const idle = now - r.updatedAt;
        const due = r.status === "budget" ? !r.resumeAt || now >= r.resumeAt : idle > NUDGE_AFTER_MS;
        if (!due || now - (lastNudge.current[r.id] ?? 0) < NUDGE_EVERY_MS) continue;
        lastNudge.current[r.id] = now;
        void agentApi(uid, { action: "nudge", runId: r.id }).catch(() => {});
      }
    };
    const id = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [user]);

  return null;
}