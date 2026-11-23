"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

// Your data: download everything (secrets are never included) and delete the account. Both go through /api/account, which checks
// your sign-in. Deleting needs the exact phrase, and a running paid plan has to be cancelled first.
const PHRASE = "DELETE MY ACCOUNT";

export default function AccountPage() {
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState("");

  async function exportData() {
    setBusy("export"); setMsg("");
    try {
      const res = await fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "export" }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Export failed."); }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "agenticvenus-export.json";
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg("Your file was downloaded. Passwords, cards and API keys are never included.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Export failed."); }
    setBusy("");
  }

  async function deleteAccount() {
    setBusy("delete"); setMsg("");
    try {
      const res = await fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", confirm }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Deleting failed.");
      setMsg("Your account and data were deleted. You can close this page.");
      setTimeout(() => { window.location.href = "/"; }, 2500);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Deleting failed."); }
    setBusy("");
  }

  const box = "w-full rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold";

  return (
    <main className="min-h-screen bg-bg px-5 py-10 text-ink">
      <div className="mx-auto max-w-xl">
        <Link href="/dashboard" className="text-xs text-muted hover:text-ink">← Dashboard</Link>
        <h1 className="mt-4 text-2xl font-semibold">Your data</h1>
        {loading ? <p className="mt-4 text-sm text-muted">Loading…</p> : !user ? (
          <p className="mt-4 text-sm text-muted">Please <Link href="/" className="underline">sign in</Link> first.</p>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg border border-line p-4">
              <h2 className="text-sm font-medium">Download my data</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">One JSON file with your chats, runs, projects, routines, memories and activity. Passwords, card numbers, API keys and connection tokens are encrypted in our database and are never exported.</p>
              <button onClick={exportData} disabled={busy !== ""} className="mt-3 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50">{busy === "export" ? "Preparing…" : "Download"}</button>
            </div>

            <div className="rounded-lg border border-red-900/60 p-4">
              <h2 className="text-sm font-medium text-red-300">Delete my account</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">This removes your chats, memories, saved logins and cards, connections, routines, projects and your sign-in. It cannot be undone. If you have a paid plan that renews, cancel it first. Your E2B computers live in your own E2B account: delete them there too.</p>
              <input className={box + " mt-3"} placeholder={`Type ${PHRASE}`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <button onClick={deleteAccount} disabled={busy !== "" || confirm.trim() !== PHRASE} className="mt-2 rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">{busy === "delete" ? "Deleting…" : "Delete everything"}</button>
            </div>
            {msg && <p className="text-xs text-muted">{msg}</p>}
          </div>
        )}
        <div className="mt-8 flex gap-4 text-xs text-muted"><Link href="/terms" className="hover:text-ink">Terms</Link><Link href="/privacy" className="hover:text-ink">Privacy</Link></div>
      </div>
    </main>
  );
}
