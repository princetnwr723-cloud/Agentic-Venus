"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Mail } from "lucide-react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, type AuthError } from "firebase/auth";
import BotAvatar from "@/components/BotAvatar";
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

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** The first screen of the Android app. After login, NativeBridge sends the user to /dashboard. */
export default function AppLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
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
      setShowEmail(true);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#07070a] px-5 pb-[var(--sab)] pt-[var(--sat)] text-ink">
      <div aria-hidden="true" className="blob blob-a" />
      <div aria-hidden="true" className="blob blob-b" />
      <div aria-hidden="true" className="blob blob-c" />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center">
        <div className="float-y">
          <BotAvatar color="red-calm" size={84} />
        </div>
        <h1 className="rise mt-5 text-[28px] font-semibold tracking-tight" style={{ animationDelay: "80ms" }}>
          AgenticVenus
        </h1>
        <p className="rise mt-1.5 text-center text-sm text-muted" style={{ animationDelay: "160ms" }}>
          AI teammates that finish the work, even while you sleep.
        </p>

        <div className="glass rise mt-8 w-full rounded-[28px] p-5" style={{ animationDelay: "240ms" }}>
          <button
            onClick={google}
            disabled={busy}
            className="press shine flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-3.5 text-[15px] font-medium text-[#1a1a1f] disabled:opacity-50"
          >
            <GoogleG /> Continue with Google
          </button>
          {waiting && (
            <p className="mt-3 text-center text-xs leading-relaxed text-muted">
              Chrome mein login karo, phir apne aap app mein wapas aa jaoge.
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowEmail((v) => !v)}
            className="press mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-3 text-sm text-ink"
          >
            <Mail size={16} /> Use email instead
            <ChevronDown size={15} className={`transition-transform duration-300 ${showEmail ? "rotate-180" : ""}`} />
          </button>

          <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${showEmail ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <div className="overflow-hidden">
              <form className="space-y-3 pt-4" onSubmit={submit}>
                <input
                  type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[16px] text-ink placeholder:text-faint focus:border-gold focus:outline-none"
                />
                <input
                  type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete={signup ? "new-password" : "current-password"}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[16px] text-ink placeholder:text-faint focus:border-gold focus:outline-none"
                />
                <button
                  type="submit" disabled={busy}
                  className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-gold py-3 text-[15px] font-medium text-bg disabled:opacity-60"
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {signup ? "Create account" : "Sign in"}
                </button>
                <button
                  type="button"
                  onClick={() => { setSignup(!signup); setError(null); }}
                  className="w-full text-center text-xs text-muted"
                >
                  {signup ? "Already have an account? Sign in" : "New here? Create an account"}
                </button>
              </form>
            </div>
          </div>

          {error && (
            <p className="mt-3 rounded-xl border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs leading-relaxed text-red-300">{error}</p>
          )}
        </div>

        <div className="rise mt-6 flex flex-wrap justify-center gap-2" style={{ animationDelay: "340ms" }}>
          {["Own computer", "Works in background", "Asks before paying"].map((t) => (
            <span key={t} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-muted">{t}</span>
          ))}
        </div>
      </div>
    </main>
  );
}