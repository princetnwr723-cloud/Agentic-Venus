"use client";

// The background agent inside the chat screen. Shows every run of this chat that is still going or waiting for the owner:
// the answer as it is being typed, the steps, and the cards (approve / question / secret / take over). Nothing shows when idle.
import { useEffect, useRef, useState } from "react";
import { isActiveRun, watchChatRuns, type RunView } from "@/lib/agent/client";
import AgentRunPanel from "./AgentRunPanel";

export default function AgentDock({ uid, chatId, onDone }: { uid: string; chatId: string; onDone?: (run: RunView) => void }) {
  const [runs, setRuns] = useState<RunView[]>([]);
  const seen = useRef(new Set<string>());
  useEffect(() => { seen.current = new Set(); setRuns([]); return watchChatRuns(uid, chatId, setRuns); }, [uid, chatId]);

  // a run this screen saw working that is now over: report it once (the dashboard learns from it)
  useEffect(() => {
    for (const r of runs) {
      if (isActiveRun(r)) seen.current.add(r.id);
      else if (seen.current.delete(r.id)) onDone?.(r);
    }
  }, [runs, onDone]);

  const active = runs.filter(isActiveRun);
  if (!active.length) return null;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-2 px-6 pb-2">
      {active.map((r) => <AgentRunPanel key={r.id} uid={uid} runId={r.id} compact />)}
    </div>
  );
}
