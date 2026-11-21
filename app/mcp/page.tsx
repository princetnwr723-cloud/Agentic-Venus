"use client";

import { useCallback, useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

type Conn = { clientId: string; name: string; since: number; write: boolean };

/** "Connect to Claude": the address to paste into Claude's custom connectors, the apps connected right now, and an Actions ON/OFF switch for each. */
export default function ConnectPage() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [url, setUrl] = useState("");
  const [conns, setConns] = useState<Conn[]>([]);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState("");
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    setMsg(""); setOk(""); setBusyId(id);
    try {
      const r = await fetch(`/api/mcp/connections?clientId=${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "Disconnect nahi ho paya.");
      await load(user);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
    setBusyId(null);
  }

  async function setWrite(c: Conn, write: boolean) {
    if (!user) return;
    if (write && !window.confirm(`${c.name} ko actions allow karne hain? (email bhejna, call karna, video banana...). Claude har baar pehle tumse poochega.`)) return;
    setMsg(""); setOk(""); setBusyId(c.clientId);
    try {
      const r = await fetch("/api/mcp/connections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ clientId: c.clientId, write }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || "Failed.");
      await load(user);
      setOk(write ? "Actions ON ho gaye. Ab Claude me apna kaam bolo (agar na chale to nayi chat kholo)." : "Actions OFF. Ab sirf read-only hai.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
    setBusyId(null);
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
            <li>Connect dabao aur login screen par <b>Allow</b> karo. Wahan <b>&quot;Actions bhi allow karo&quot;</b> tick kar sakte ho, ya baad me neeche <b>Actions ON</b> dabao.</li>
            <li>Claude ki chat me bolo: &quot;AgenticVenus se ye kaam kar&quot;.</li>
          </ol>

          <h2 className="mb-2 text-sm font-semibold">Connected apps</h2>
          {conns.length === 0 && <p className="text-sm text-muted">Abhi koi connected nahi.</p>}
          <ul className="space-y-2">
            {conns.map((c) => (
              <li key={c.clientId} className="rounded-lg border border-line bg-panel px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    {c.name}{" "}
                    <span className="text-xs text-muted">· {c.write ? "actions allowed" : "read only"} · {new Date(c.since).toLocaleDateString()}</span>
                  </span>
                  <button onClick={() => void disconnect(c.clientId)} disabled={busyId === c.clientId} className="text-xs text-red-400 disabled:opacity-50">Disconnect</button>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2">
                  <span className="text-xs text-muted">
                    {c.write ? "Actions ON: email, call, video jaise kaam Claude kar sakta hai (har baar pehle poochega)." : "Actions OFF: Claude sirf dekh/padh sakta hai. Email, call, video nahi chalenge."}
                  </span>
                  <button
                    onClick={() => void setWrite(c, !c.write)}
                    disabled={busyId === c.clientId}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${c.write ? "border border-line text-ink" : "bg-white text-bg"}`}
                  >
                    {busyId === c.clientId ? "..." : c.write ? "Actions OFF karo" : "Actions ON karo"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {ok && <p className="mt-4 text-sm text-emerald-400">{ok}</p>}
      {msg && <p className="mt-4 text-sm text-amber-400">{msg}</p>}
    </main>
  );
}
