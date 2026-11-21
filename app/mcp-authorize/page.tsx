"use client";

import { useEffect, useState } from "react";
import {
  GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect,
  type AuthError, type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

type Q = { client_id: string; redirect_uri: string; state: string; code_challenge: string; code_challenge_method: string; resource: string };

/** Claude (or any MCP app) sends the person here to sign in and allow access. Nothing is shared until they press Allow. */
export default function McpAuthorize() {
  const [q, setQ] = useState<Q | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [app, setApp] = useState<{ clientName: string; redirectHost: string } | null>(null);
  const [write, setWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const get = (k: string) => p.get(k) || "";
    const query: Q = {
      client_id: get("client_id"), redirect_uri: get("redirect_uri"), state: get("state"),
      code_challenge: get("code_challenge"), code_challenge_method: get("code_challenge_method"), resource: get("resource"),
    };
    setQ(query);
    void fetch("/api/mcp/oauth/authorize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "info", client_id: query.client_id, redirect_uri: query.redirect_uri }),
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (r.ok) setApp(j); else setMsg(j.error || "This sign-in link is not valid. Start again from Claude.");
    }).catch(() => setMsg("Could not reach the server."));
    getRedirectResult(auth).catch((e: AuthError) => setMsg(e.code || "Login failed."));
    return onAuthStateChanged(auth, (u) => { setUser(u); setReady(true); });
  }, []);

  async function google() {
    setMsg(""); setBusy(true);
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) {
      const code = (e as AuthError)?.code ?? "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment" || code === "auth/cancelled-popup-request") {
        await signInWithRedirect(auth, new GoogleAuthProvider());
        return;
      }
      setMsg(code === "auth/unauthorized-domain" ? "Firebase mein is domain ko Authorized domains mein add karo." : "Google login nahi ho paya.");
    }
    setBusy(false);
  }

  async function answer(action: "approve" | "deny") {
    if (!q) return;
    setBusy(true); setMsg("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (action === "approve") {
        if (!user) throw new Error("Sign in first.");
        headers.Authorization = `Bearer ${await user.getIdToken()}`;
      }
      const r = await fetch("/api/mcp/oauth/authorize", { method: "POST", headers, body: JSON.stringify({ ...q, action, write }) });
      const j = (await r.json()) as { redirect?: string; error?: string };
      if (!r.ok || !j.redirect) throw new Error(j.error || "Failed.");
      window.location.href = j.redirect;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
      setBusy(false);
    }
  }

  const invalid = ready && q && !app && msg;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-5 text-ink">
      <div className="w-full max-w-sm rounded-xl2 border border-line bg-panel p-6 shadow-2xl">
        <h1 className="mb-1 text-center text-lg font-semibold">Agentic Venus</h1>
        {app && (
          <p className="mb-5 text-center text-sm leading-relaxed text-muted">
            <b className="text-ink">{app.clientName}</b> ({app.redirectHost}) AgenticVenus ke tools use karna chahta hai.
          </p>
        )}

        {app && ready && !user && (
          <button onClick={() => void google()} disabled={busy} className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-bg disabled:opacity-50">
            Continue with Google
          </button>
        )}

        {app && user && (
          <>
            <p className="mb-3 text-center text-xs text-muted">Signed in: {user.email || "your account"}</p>
            <ul className="mb-3 space-y-1 text-sm text-muted">
              <li>â¢ Search, padhna, files aur research jaise tools (sirf dekhna)</li>
              <li>â¢ Claude tumhari chats ki list dekhega aur jo chat tum chuno uska PC, Venus Code, team, connected apps aur schedules chalayega</li>
              <li>â¢ Saved passwords aur API keys Claude ko kabhi nahi dikhte</li>
            </ul>
            <label className="mb-4 flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-sm">
              <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} className="mt-0.5" />
              <span>
                <b>Actions bhi allow karo</b> (email bhejna, call karna, post karna...). Claude har baar pehle tumse poochega.
              </span>
            </label>
            <div className="flex gap-2">
              <button onClick={() => void answer("deny")} disabled={busy} className="flex-1 rounded-lg border border-line py-2.5 text-sm disabled:opacity-50">Cancel</button>
              <button onClick={() => void answer("approve")} disabled={busy} className="flex-1 rounded-lg bg-white py-2.5 text-sm font-medium text-bg disabled:opacity-50">Allow</button>
            </div>
          </>
        )}

        {msg && <p className={`mt-4 text-center text-sm ${invalid ? "text-red-400" : "text-amber-400"}`}>{msg}</p>}
      </div>
    </main>
  );
}
