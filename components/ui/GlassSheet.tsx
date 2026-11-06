"use client";

import { useEffect, useState } from "react";

/** Bottom sheet in liquid glass: springs up, closes with a swipe down, a tap outside or Escape. */
export default function GlassSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const [dy, setDy] = useState(0);
  const [drag, setDrag] = useState<number | null>(null); // pointer start Y while dragging

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      setDy(0);
      return;
    }
    setLeaving(true);
    const t = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, 240);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`absolute inset-0 bg-black/55 backdrop-blur-sm ${leaving ? "gs-fade-out" : "gs-fade-in"}`}
        onClick={onClose}
      />
      <div
        className={`glass-strong absolute inset-x-0 bottom-0 mx-auto max-w-lg rounded-t-[30px] px-4 pb-[calc(1.25rem+var(--sab))] pt-1 ${
          leaving ? "gs-down" : "gs-up"
        }`}
        style={{
          transform: dy ? `translateY(${dy}px)` : undefined,
          transition: drag === null ? "transform .25s cubic-bezier(.22,1,.36,1)" : "none",
        }}
      >
        <div
          className="flex touch-none justify-center py-2.5"
          onPointerDown={(e) => {
            setDrag(e.clientY);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag !== null) setDy(Math.max(0, e.clientY - drag));
          }}
          onPointerUp={() => {
            if (dy > 90) onClose();
            setDy(0);
            setDrag(null);
          }}
          onPointerCancel={() => {
            setDy(0);
            setDrag(null);
          }}
        >
          <span className="h-1.5 w-11 rounded-full bg-white/25" />
        </div>
        {title && <h2 className="px-1 pb-3 text-[13px] font-medium text-muted">{title}</h2>}
        <div className="max-h-[70dvh] overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}