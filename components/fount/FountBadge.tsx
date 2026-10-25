"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import { FOUNT_ON, fountWarm, getFountStatus, subscribeFount } from "@/lib/fount/client";

/** "<model> × FOUNT": shown only when FOUNT is really active for this owner (not in the control group). */
export default function FountBadge({ model }: { model: string }) {
  const s = useSyncExternalStore(subscribeFount, getFountStatus, getFountStatus);
  useEffect(() => { void fountWarm(); }, []);
  if (!FOUNT_ON || !s.enabled || s.holdout) return null;
  const last = s.lastIntent && s.lastIntent !== "general.chat"
    ? ` Last run: ${s.lastBlock ? "used a playbook" : "no playbook needed"} (${s.lastIntent}).`
    : "";
  return (
    <span
      title={`${model} × FOUNT: your model plus AgenticVenus FOUNT, a layer of proven playbooks from this app (${s.playbooks} learned on top of the built-in ones).${last}`}
      className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-goldSoft px-2 py-1 text-[11px] font-medium text-gold"
    >
      <Sparkles size={11} /> × FOUNT
    </span>
  );
}
