"use client";

import { useState } from "react";
import { ExternalLink, X } from "lucide-react";

type TestResult = { ok: boolean; label?: string; error?: string };

const CATALOG = [
  { id: "vercel", label: "Vercel", note: "Agent deploys your site and gives you a live link.", keysUrl: "https://vercel.com/account/tokens", placeholder: "Vercel token", ready: true },
  { id: "github", label: "GitHub", note: "Token is saved and checked. Pushing code comes in the next update.", keysUrl: "https://github.com/settings/tokens", placeholder: "ghp_… or github_pat_…", ready: true },
  { id: "gmail", label: "Gmail", note: "Coming soon.", keysUrl: "", placeholder: "", ready: false },
  { id: "calendar", label: "Google Calendar", note: "Coming soon.", keysUrl: "", placeholder: "", ready: false },
];

export default function ConnectorsModal({
  open, onClose, chatName, connectors, onTest, onSave,
}: {
  open: boolean;
  onClose: () => void;
  chatName: string;
  connectors: Record<string, string>;
  onTest: (kind: string, token: string) => Promise<TestResult>;
  onSave: (kind: string, token: string) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  if (!open) return null;

  async function connect(id: string) {
    const token = (drafts[id] ?? "").trim();
    if (!token) return;
    setBusy(id);
    setMsg((m) => ({ ...m, [id]: "" }));
    let r: TestResult;
    try {
      r = await onTest(id, token);
    } catch {
      r = { ok: false, error: "Could not check the token." };
    }
    if (r.ok) {
      await onSave(id, token);
      setDrafts((d) => ({ ...d, [id]: "" }));
      setMsg((m) => ({ ...m, [id]: r.label ? `Connected as ${r.label}` : "Connected" }));
    } else {
      setMsg((m) => ({ ...m, [id]: r.error || "Token not accepted." }));
    }
    setBusy(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl2 border border-line bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Connectors · {chatName}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={18} /></button>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted">Only this chat can use these. Each chat has its own connectors.</p>

        <div className="space-y-3">
          {CATALOG.map((c) => {
            const on = Boolean(connectors[c.id]);
            return (
              <div key={c.id} className={`rounded-lg border border-line p-3 ${c.ready ? "" : "opacity-50"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink">{c.label}</span>
                  <div className="flex items-center gap-2">
                    {on && <span className="text-[11px] text-avatar-teal">Connected</span>}
                    {c.keysUrl && <a href={c.keysUrl} target="_blank" rel="noreferrer" title="Get a token" className="text-faint hover:text-muted"><ExternalLink size={13} /></a>}
                  </div>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{c.note}</p>
                {c.ready && (
                  <div className="mt-2 flex gap-2">
                    {on ? (
                      <button onClick={() => onSave(c.id, "")} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2">Disconnect</button>
                    ) : (
                      <>
                        <input type="password" placeholder={c.placeholder} value={drafts[c.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))} className="flex-1 rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold" />
                        <button onClick={() => connect(c.id)} disabled={busy === c.id} className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50">{busy === c.id ? "Checking…" : "Connect"}</button>
                      </>
                    )}
                  </div>
                )}
                {msg[c.id] && <p className="mt-1.5 text-[11px] text-muted">{msg[c.id]}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}