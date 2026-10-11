"use client";

import { useEffect, useState } from "react";

type Health = { ok: boolean; total: number; bad: Array<{ label: string; fix: string }>; keyMode: string };

export default function VaultHealth() {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    fetch("/api/vault/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json()).then((d) => { if (Array.isArray(d.bad)) setH(d); }).catch(() => {});
  }, []);
  if (!h) return null;
  if (h.ok) return <p className="mb-3 text-[11px] text-avatar-teal">Vault health: all {h.total} saved secrets can be opened ({h.keyMode}).</p>;
  return (
    <div className="mb-3 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-200">
      <p className="font-medium">{h.bad.length} saved secret(s) can&apos;t be opened (the server&apos;s encryption key changed):</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5">{h.bad.map((b, i) => <li key={i}><b>{b.label}</b> — {b.fix}</li>)}</ul>
      <p className="mt-2 text-[11px] text-red-300/80">Tip: if you still have the OLD value of VAULT_KEY, put it in the Vercel variable VAULT_KEY_OLD and redeploy: these will open again without re-entering anything. Never change VAULT_KEY again after that.</p>
    </div>
  );
}