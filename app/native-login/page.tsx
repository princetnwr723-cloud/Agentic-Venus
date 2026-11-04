"use client";

import { useEffect, useState } from "react";
import {
  GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect,
  type AuthError, type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

const KEY = "venus_native_challenge";
const SCHEME = "agenticvenus";

/** Opened by the Android app in Chrome (Google blocks login inside an app's WebView). Hands a one-time code back to the app. */
export default function NativeLogin() {
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [back, setBack] = useState("");

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("challenge");
    if (c && /^[A-Za-z0-9_-]{43}$/.test(c)) sessionStorage.setItem(KEY, c);
    getRedirectResult(auth).catch((e: AuthError) => setMsg(e.code || "Login failed."));
    return onAuthStateChanged(auth, setUser);
  }, []);

  async function finish(u: User) {
    const challenge = sessionStorage.getItem(KEY) || "";
    if (!challenge) { setMsg("App kholo aur 'Continue with Google' dobara dabao."); setBusy(false); return; }
    setBusy(true);
    try {
      const token = await u.getIdToken();
      const r = await fetch("/api/native-auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ challenge }),
      });
      const j = (await r.json()) as { code?: string; error?: string };
      if (!r.ok || !j.code) throw new Error(j.error || "Login failed.");
      sessionStorage.removeItem(KEY);
      const url = `${SCHEME}://auth?code=${encodeURIComponent(j.code)}`;
      setBack(url);
      window.location.href = url;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Login failed.");
    }
    setBusy(false);
  }

  async function google() {
    setMsg("");
    setBusy(true);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      await finish(cred.user);
    } catch (e) {
      const code = (e as AuthError)?.code ?? "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment" || code === "auth/cancelled-popup-request") {
        await signInWithRedirect(auth, new GoogleAuthProvider());
        return;
      }
      setMsg(code === "auth/unauthorized-domain" ? "Firebase mein is domain ko Authorized domains mein add karo." : "Google login nahi ho paya.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-5 text-ink">
      <div className="w-full max-w-sm rounded-xl2 border border-line bg-panel p-6 text-center shadow-2xl">
        <h1 className="mb-2 text-lg font-semibold">Agentic Venus</h1>
        <p className="mb-5 text-sm leading-relaxed text-muted">Login karke app mein wapas jao.</p>

        {user && (
          <button
            onClick={() => void finish(user)} disabled={busy}
            className="mb-3 w-full rounded-lg bg-white py-2.5 text-sm font-medium text-bg disabled:opacity-50"
          >
            Continue as {user.email || "this account"}
          </button>
        )}
        <button
          onClick={() => void google()} disabled={busy}
          className="w-full rounded-lg border border-line bg-panel2 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line disabled:opacity-50"
        >
          {user ? "Use another Google account" : "Continue with Google"}
        </button>

        {msg && <p className="mt-4 text-xs leading-relaxed text-red-300">{msg}</p>}
        {back && (
          <a href={back} className="mt-4 block text-xs text-muted underline">
            App apne aap na khule to yahan dabao
          </a>
        )}
      </div>
    </main>
  );
}