"use client";

// The background agent inside the chat screen. It shows nothing itself: it only watches the runs of this chat and reports
// a run that has just ended (the dashboard learns from it).
import { useEffect, useRef, useState } from "react";
import { isActiveRun, watchChatRuns, type RunView } from "@/lib/agent/client";

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

  return null;
}
