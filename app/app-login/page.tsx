"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, type AuthError } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { nativeGoogleLogin } from "@/lib/native";

function friendly(code: string) {
  switch (code) {
    case "auth/email-already-in-use": return "That email already has an account, sign in instead.";
    case "auth/invalid-email": return "That email doesn't look right.";
    case "auth/weak-password": return "Use at least 6 characters for the password.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Email or password is incorrect.";
    default: return "Something went wrong. Try again.";
  }
}

/** The first screen of the Android app. After login, NativeBridge sends the user to /dashboard. */
export default function AppLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (signup) await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(friendly((err as AuthError)?.code ?? ""));
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    try {
      await nativeGoogleLogin();
      setWaiting(true);
    } catch {
      setError("Browser nahi khul paya. Email se login karo.");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-5 text-ink">
      <div className="w-full max-w-sm rounded-xl2 border border-line bg-panel p-6 shadow-2xl">
        <h1 className="mb-1 text-xl font-semibold">Agentic Venus</h1>
        <p className="mb-5 text-sm leading-relaxed text-muted">
          {signup ? "Create your account." : "Sign in to your AI teammates."}
        </p>

        <button
          onClick={google}
          disabled={busy}
          className="w-full rounded-lg border border-line bg-panel2 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line disabled:opacity-50"
        >
          Continue with Google
        </button>
        {waiting && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Chrome mein login karo, phir apne aap app mein wapas aa jaoge.
          </p>
        )}

        <div className="my-4 flex items-center gap-3 text-xs text-faint">
          <div className="h-px flex-1 bg-line" />
          or
          <div className="h-px flex-1 bg-line" />
        </div>

        <form className="space-y-3" onSubmit={submit}>
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
            className="w-full rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold"
          />
          <input
            type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
            className="w-full rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold"
          />
          {error && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs leading-relaxed text-red-300">{error}</p>
          )}
          <button
            type="submit" disabled={busy}
            className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          onClick={() => { setSignup(!signup); setError(null); }}
          className="mt-4 w-full text-center text-xs text-muted hover:text-ink"
        >
          {signup ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </div>
    </main>
  );
}