"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FOUNT_ON, fountForget, fountSetConsent, fountWarm, getFountStatus, subscribeFount } from "@/lib/fount/client";

/** Settings section: opt in or out of learning, and delete the stored runs. Renders nothing when FOUNT is off. */
export default function FountSettings() {
  const s = useSyncExternalStore(subscribeFount, getFountStatus, getFountStatus);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { void fountWarm(); }, []);
  if (!FOUNT_ON || !s.enabled) return null;

  async function toggle() {
    setBusy(true); setNote("");
    await fountSetConsent(!s.optIn);
    setBusy(false);
  }
  async function forget() {
    setBusy(true); setNote("");
    const n = await fountForget();
    setBusy(false);
    setNote(n === null ? "Could not delete right now. Try again." : `Deleted ${n} saved run${n === 1 ? "" : "s"}. Learning is off.`);
  }

  return (
    <>
      <h3 className="mb-1.5 text-sm text-ink">FOUNT: learn from my runs</h3>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        FOUNT makes every model better inside AgenticVenus using playbooks of jobs that worked. If you allow it, runs that used tools are saved
        without passwords, keys, emails or phone numbers, and without your name. Only the pattern (which tools worked, in which order) can become a
        shared playbook, never your text. You can turn this off and delete your runs at any time.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={toggle} disabled={busy}
          className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${s.optIn ? "bg-white text-bg hover:opacity-90" : "border border-line bg-panel2 text-ink hover:border-gold"}`}
        >
          {s.optIn ? "Learning is ON (tap to turn off)" : "Allow learning from my runs"}
        </button>
        <button onClick={forget} disabled={busy} className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-ink disabled:opacity-50">
          Delete my saved runs
        </button>
      </div>
      {note && <p className="mt-1.5 text-[11px] text-avatar-teal">{note}</p>}
      <div className="my-5 h-px bg-line" />
    </>
  );
}
