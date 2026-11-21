"use client";

import { useCallback, useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

type Conn = { clientId: string; name: string; since: number; write: boolean };

/** "Connect to Claude": the address to paste into Claude's custom connectors, and the apps connected right now. */
export default function ConnectPage() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [url, setUrl] = useState("");
  const [conns, setConns] = useState<Conn[]>([]);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setReady(true); }), []);

  const load = useCallback(async (u: User) => {
    try {
      const r = await fetch("/api/mcp/connections", { headers: { Authorization: `Bearer ${await u.getIdToken()}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed.");
      setUrl(j.url); setConns(j.connections);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
  }, []);
  useEffect(() => { if (user) void load(user); }, [user, load]);

  async function disconnect(id: string) {
    if (!user) return;
    await fetch(`/api/mcp/connections?clientId=${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
    await load(user);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the address is selectable */ }
  }
  async function login() {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch { setMsg("Google login nahi ho paya."); }
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl bg-bg px-5 py-10 text-ink">
      <h1 className="mb-1 text-xl font-semibold">Connect to Claude</h1>
      <p className="mb-6 text-sm text-muted">AgenticVenus ke tools apne Claude (Pro/Max plan) me chalao. Koi app install nahi.</p>

      {ready && !user && <button onClick={() => void login()} className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-bg">Continue with Google</button>}

      {user && (
        <>
          <div className="mb-6 rounded-xl2 border border-line bg-panel p-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted">Tumhara MCP address</div>
            <div className="flex items-center gap-2">
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
              <button onClick={() => void copy()} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-bg">{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>

          <ol className="mb-8 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
            <li>Claude kholo: Settings → Connectors → <b>Add custom connector</b>.</li>
            <li>Name me <b>AgenticVenus</b> likho, upar wala address paste karo, Add dabao.</li>
            <li>Connect dabao. Yahan wapas aake <b>Allow</b> karo (actions chahiye to tick bhi karo).</li>
            <li>Claude ki chat me bolo: &quot;AgenticVenus se ye kaam kar&quot;.</li>
          </ol>

          <h2 className="mb-2 text-sm font-semibold">Connected apps</h2>
          {conns.length === 0 && <p className="text-sm text-muted">Abhi koi connected nahi.</p>}
          <ul className="space-y-2">
            {conns.map((c) => (
              <li key={c.clientId} className="flex items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-sm">
                <span>{c.name} <span className="text-xs text-muted">· {c.write ? "actions allowed" : "read only"} · {new Date(c.since).toLocaleDateString()}</span></span>
                <button onClick={() => void disconnect(c.clientId)} className="text-xs text-red-400">Disconnect</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {msg && <p className="mt-4 text-sm text-amber-400">{msg}</p>}
    </main>
  );
}
