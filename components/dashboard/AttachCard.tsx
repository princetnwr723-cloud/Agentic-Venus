"use client";

import { X } from "lucide-react";
import { badgeOf, shortName, type AttachKind } from "@/lib/attachments";

/**
 * One attached file as a card: type badge top-left, the file name at the bottom, a round X top-right (only before sending).
 * A photo shows its picture inside the card. Used in the message box (with X + progress) and in sent messages (read-only).
 */
export default function AttachCard({
  name, kind, preview, status = "ready", progress = 1, error, onRemove,
}: {
  name: string; kind: AttachKind | string; preview?: string; status?: "uploading" | "ready" | "error"; progress?: number; error?: string; onRemove?: () => void;
}) {
  const bad = status === "error";
  return (
    <div
      title={error || name}
      className={`relative h-[118px] w-[118px] shrink-0 overflow-hidden rounded-2xl border bg-panel2 ${bad ? "border-red-400/60" : "border-line"}`}
    >
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={name} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      )}
      {preview && <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/30" />}
      <span className="absolute left-2 top-2 rounded-full border border-line bg-panel/80 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted backdrop-blur">
        {badgeOf(name, kind as AttachKind)}
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-bg shadow hover:opacity-90"
        >
          <X size={14} />
        </button>
      )}
      <p className={`absolute inset-x-2.5 bottom-2 break-words text-[12px] font-medium leading-tight ${preview ? "text-white" : "text-ink"} line-clamp-2`}>
        {bad ? error || "Upload failed" : shortName(name, 22)}
      </p>
      {status === "uploading" && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
          <div className="h-full bg-gold transition-[width]" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
        </div>
      )}
    </div>
  );
}