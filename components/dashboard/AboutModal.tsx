"use client";
// "About": the owner's own details (name, mobile number, company ...) and Night / Light mode.
// The agent can read and change the same details (profile.get / profile.set), so a change made in chat shows up here by itself.
import { useEffect, useState } from "react";
import { Check, Loader2, Moon, Sun, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useProfile, shownName, type Profile } from "@/lib/profile";
import { useTheme } from "@/lib/theme";

const FIELDS: Array<[keyof Pick<Profile, "name" | "phone" | "company" | "role" | "location" | "website">, string, string, string]> = [
  ["name", "Name", "Your name", "text"], ["phone", "Mobile number", "+91 98765 43210", "tel"], ["company", "Company", "Where you work", "text"],
  ["role", "Role", "What you do", "text"], ["location", "City / Country", "Where you are", "text"], ["website", "Website", "https://", "url"],
];

export default function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { profile, reload, save } = useProfile();
  const [theme, setTheme] = useTheme();
  const [draft, setDraft] = useState<Profile>(profile);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { if (open) { setErr(""); setSaved(false); void reload().then(setDraft); } }, [open, reload]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open, onClose]);
  if (!open) return null;

  const dirty = (Object.keys(draft) as Array<keyof Profile>).some((k) => ["name", "phone", "company", "role", "location", "website", "bio"].includes(k) && (draft[k] ?? "") !== (profile[k] ?? ""));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setSaved(false);
    try {
      const { name, phone, company, role, location, website, bio } = draft;
      setDraft(await save({ name, phone, company, role, location, website, bio }));
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not save."); }
    setBusy(false);
  }
  const inp = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";
  const since = user?.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl2 border border-line bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-panel2 text-xl font-semibold text-ink">{shownName(draft, user?.email).charAt(0).toUpperCase()}</div>
          <div className="min-w-0 flex-1"><h2 className="truncate text-base font-semibold text-ink">{shownName(draft, user?.email)}</h2><p className="truncate text-xs text-muted">{user?.email}</p></div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink" aria-label="Close"><X size={18} /></button>
        </div>

        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Appearance</p>
        <div className="mb-5 grid grid-cols-2 gap-2">
          {([["dark", "Night mode", <Moon key="m" size={15} />], ["light", "Light mode", <Sun key="s" size={15} />]] as const).map(([k, label, icon]) => (
            <button key={k} type="button" onClick={() => setTheme(k)} aria-pressed={theme === k} className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm transition-colors ${theme === k ? "border-gold bg-goldSoft text-ink" : "border-line text-muted hover:text-ink"}`}>{icon}{label}{theme === k && <Check size={14} />}</button>
          ))}
        </div>

        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">About you</p>
        <div className="space-y-3">
          <div><label className="mb-1 block text-[11px] text-muted">Email (your login)</label><input className={`${inp} opacity-70`} value={user?.email ?? ""} readOnly /></div>
          {FIELDS.map(([k, label, ph, type]) => (
            <div key={k}><label className="mb-1 block text-[11px] text-muted" htmlFor={`ab-${k}`}>{label}</label><input id={`ab-${k}`} type={type} className={inp} placeholder={ph} value={draft[k]} maxLength={k === "website" ? 200 : k === "phone" ? 24 : 80} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></div>
          ))}
          <div><label className="mb-1 block text-[11px] text-muted" htmlFor="ab-bio">About me</label><textarea id="ab-bio" rows={3} maxLength={600} className={inp} placeholder="A few lines about you and your work. Your agents can use this." value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} /></div>
        </div>
        {since && <p className="mt-3 text-[11px] text-faint">Member since {since}</p>}
        {err && <p className="mt-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">{err}</p>}
        <button type="submit" disabled={busy || !dirty} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50">{busy && <Loader2 size={14} className="animate-spin" />}{saved ? "Saved ✓" : "Save"}</button>
        <p className="mt-3 text-[11px] leading-relaxed text-faint">Your agents can also change these in chat: “my number is …”, “change my name to …”, “night mode on”.</p>
      </form>
    </div>
  );
}