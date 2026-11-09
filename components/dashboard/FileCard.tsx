"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check, Download, ExternalLink, File as FileIcon, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet,
  FileText, FileVideo, Link2, Loader2, MoreHorizontal, Presentation,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { badgeOf, type AttachKind } from "@/lib/attachments";
import { freshLink, startDownload, type ChatFile } from "@/lib/chat-files";

const KIND: Record<AttachKind, { icon: LucideIcon; tile: string; label: string }> = {
  pdf: { icon: FileText, tile: "bg-[#E8445A]", label: "PDF" },
  doc: { icon: FileText, tile: "bg-[#3B82F6]", label: "Document" },
  sheet: { icon: FileSpreadsheet, tile: "bg-[#22A06B]", label: "Spreadsheet" },
  slides: { icon: Presentation, tile: "bg-[#F08A5E]", label: "Slides" },
  zip: { icon: FileArchive, tile: "bg-[#EFA83B]", label: "Archive" },
  image: { icon: FileImage, tile: "bg-[#5FA6F0]", label: "Image" },
  video: { icon: FileVideo, tile: "bg-[#A98BF0]", label: "Video" },
  audio: { icon: FileAudio, tile: "bg-[#3FC9AE]", label: "Audio" },
  text: { icon: FileCode, tile: "bg-[#6B7280]", label: "Text file" },
  other: { icon: FileIcon, tile: "bg-[#6B7280]", label: "File" },
};

/**
 * One file shown in the chat, as a card: a preview on top (the picture itself for photos), a coloured type icon,
 * the name, the type, and a "..." menu (Open, Download, Copy link). The file stays in private storage and is
 * never removed; the card asks for a fresh link every time, so it opens today and next year.
 */
export default function FileCard({ file }: { file: ChatFile }) {
  const { user } = useAuth();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [thumb, setThumb] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const k = KIND[file.kind] ?? KIND.other;
  const Icon = k.icon;

  useEffect(() => {
    if (file.kind !== "image" || !user) return;
    let dead = false;
    freshLink(user.uid, file.path).then((u) => { if (!dead) setThumb(u); }).catch(() => {});
    return () => { dead = true; };
  }, [file.kind, file.path, user]);

  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [menu]);

  const flash = (t: string) => { setNote(t); setTimeout(() => setNote(""), 2200); };

  async function run(kind: "open" | "download" | "copy") {
    if (!user || busy) { if (!user) flash("Sign in again to open this file."); return; }
    setBusy(true); setMenu(false);
    // the blank tab is opened inside the tap itself, so phones do not block it
    const tab = kind === "open" ? window.open("", "_blank") : null;
    try {
      const url = await freshLink(user.uid, file.path, kind === "download" ? file.name : undefined);
      if (kind === "open") { if (tab) { tab.opener = null; tab.location.href = url; } else window.location.assign(url); }
      else if (kind === "download") { startDownload(url, file.name); flash("Downloading…"); }
      else { await navigator.clipboard?.writeText(url); flash("Link copied (works for 6 hours)"); }
    } catch (e) {
      tab?.close();
      flash(e instanceof Error ? e.message : "Could not open the file.");
    } finally { setBusy(false); }
  }

  return (
    <div ref={box} className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-panel2 shadow-panel">
      <button type="button" onClick={() => void run("open")} className="block w-full text-left" aria-label={`Open ${file.name}`}>
        <div className="relative flex h-28 items-center justify-center overflow-hidden bg-gradient-to-br from-panel to-bg">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={file.name} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          ) : (
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg ${k.tile}`}><Icon size={28} /></div>
          )}
          <span className="absolute left-2.5 top-2.5 rounded-full border border-line bg-panel/80 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted backdrop-blur">
            {badgeOf(file.name, file.kind)}
          </span>
        </div>
      </button>

      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${k.tile}`}><Icon size={20} /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink" title={file.name}>{file.name}</p>
          <p className="truncate text-[11px] text-muted">{k.label}{file.size ? ` · ${file.size}` : ""} · saved in this chat</p>
        </div>
        <button
          type="button" aria-label="File options" onClick={() => setMenu((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <MoreHorizontal size={18} />}
        </button>
      </div>

      {menu && (
        <div className="absolute bottom-14 right-3 z-20 w-44 overflow-hidden rounded-xl border border-line bg-panel py-1 text-xs shadow-xl">
          <button type="button" onClick={() => void run("open")} className="flex w-full items-center gap-2 px-3 py-2 text-ink hover:bg-panel2"><ExternalLink size={14} /> Open</button>
          <button type="button" onClick={() => void run("download")} className="flex w-full items-center gap-2 px-3 py-2 text-ink hover:bg-panel2"><Download size={14} /> Download</button>
          <button type="button" onClick={() => void run("copy")} className="flex w-full items-center gap-2 px-3 py-2 text-ink hover:bg-panel2"><Link2 size={14} /> Copy link</button>
        </div>
      )}

      {note && (
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-[11px] text-white backdrop-blur">
          <Check size={12} /> {note}
        </div>
      )}
    </div>
  );
}
