"use client";

import { useSyncExternalStore } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { fountFeedback, getFountStatus, subscribeFount } from "@/lib/fount/client";

/** 👍 / 👎 for the last run of a chat. Renders nothing unless that run was recorded (the owner opted in). */
export default function FountFeedback({ chatId }: { chatId: string }) {
  const s = useSyncExternalStore(subscribeFount, getFountStatus, getFountStatus);
  if (!s.episodeByChat[chatId]) return null;
  const given = s.feedbackByChat[chatId];
  const btn = (v: 1 | -1, label: string, on: boolean, icon: React.ReactNode) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={Boolean(given)}
      onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
      onClick={() => { void fountFeedback(chatId, v); }}
      className={`rounded-md p-1.5 transition-colors ${on ? "bg-goldSoft text-gold" : "text-faint hover:bg-panel2 hover:text-ink"} disabled:cursor-default`}
    >
      {icon}
    </button>
  );
  return (
    <>
      {btn(1, "This worked (helps FOUNT learn)", given === 1, <ThumbsUp size={14} />)}
      {btn(-1, "This did not work", given === -1, <ThumbsDown size={14} />)}
    </>
  );
}
