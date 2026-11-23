"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Check = { id: string; label: string; ok: boolean; ms?: number; note?: string };
type Status = { status: "operational" | "degraded" | "outage"; at: number; checks: Check[] };

const TONE = { operational: "text-avatar-teal", degraded: "text-avatar-amber", outage: "text-red-400" } as const;
const TEXT = { operational: "All systems operational", degraded: "Some parts are degraded", outage: "Service outage" } as const;

export default function StatusPage() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/status", { cache: "no-store" });
        const d = (await r.json()) as Status;
        if (alive) { setS(d); setErr(""); }
      } catch { if (alive) setErr("Could not reach the server."); }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <main className="min-h-screen bg-bg px-5 py-10 text-ink">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="text-xs text-muted hover:text-ink">← AgenticVenus</Link>
        <h1 className="mt-4 text-2xl font-semibold">Status</h1>
        {err && <p className="mt-4 text-sm text-red-400">{err}</p>}
        {!s && !err && <p className="mt-4 text-sm text-muted">Checking…</p>}
        {s && (
          <>
            <p className={`mt-4 text-lg font-medium ${TONE[s.status]}`}>{TEXT[s.status]}</p>
            <p className="mt-1 text-[11px] text-faint">Checked {new Date(s.at).toLocaleTimeString()} · refreshes every 30 seconds</p>
            <div className="mt-5 divide-y divide-line rounded-lg border border-line">
              {s.checks.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{c.label}</p>
                    {c.note && <p className="truncate text-[11px] text-faint">{c.note}</p>}
                  </div>
                  <span className={`shrink-0 text-xs ${c.ok ? "text-avatar-teal" : "text-red-400"}`}>{c.ok ? (c.ms ? `OK · ${c.ms} ms` : "OK") : "Problem"}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
