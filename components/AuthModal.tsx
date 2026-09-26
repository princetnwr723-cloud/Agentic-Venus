"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  type AuthError,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

function friendlyError(code: string) {
  switch (code) {
    case "auth/email-already-in-use":
      return "That email already has an account — try signing in instead.";
    case "auth/invalid-email":
      return "That email doesn't look right.";
    case "auth/weak-password":
      return "Use at least 6 characters for the password.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email or password is incorrect.";
    case "auth/unauthorized-domain":
      return "This domain isn't authorized in Firebase yet — add it under Authentication → Settings → Authorized domains.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was closed before finishing.";
    default:
      return "Something went wrong. Give it another try.";
  }
}

export default function AuthModal({
  open,
  initialTab = "signup",
  onClose,
}: {
  open: boolean;
  initialTab?: "signin" | "signup";
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"signin" | "signup">(initialTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  if (!open) return null;

  function reset() {
    setEmail("");
    setPassword("");
    setError(null);
    setBusy(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      reset();
      onClose();
      router.push("/dashboard");
    } catch (err) {
      setError(friendlyError((err as AuthError)?.code ?? ""));
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      reset();
      onClose();
      router.push("/dashboard");
    } catch (err) {
      setError(friendlyError((err as AuthError)?.code ?? ""));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm rounded-xl2 border border-line bg-panel p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex rounded-full border border-line bg-panel2 p-1 text-sm">
            <button
              onClick={() => {
                setTab("signin");
                setError(null);
              }}
              className={`rounded-full px-3.5 py-1.5 transition-colors ${
                tab === "signin" ? "bg-white text-bg" : "text-muted"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => {
                setTab("signup");
                setError(null);
              }}
              className={`rounded-full px-3.5 py-1.5 transition-colors ${
                tab === "signup" ? "bg-white text-bg" : "text-muted"
              }`}
            >
              Create account
            </button>
          </div>
          <button
            aria-label="Close"
            onClick={handleClose}
            className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-5 text-sm leading-relaxed text-muted">
          {tab === "signup"
            ? "Create an account to hand this off to a real teammate."
            : "Welcome back — sign in to pick up where your teammates left off."}
        </p>

        <form className="space-y-3" onSubmit={handleSubmit}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold"
          />

          {error && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs leading-relaxed text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? "Please wait…"
              : tab === "signup"
              ? "Create account"
              : "Sign in"}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-faint">
          <div className="h-px flex-1 bg-line" />
          or
          <div className="h-px flex-1 bg-line" />
        </div>

        <button
          onClick={handleGoogle}
          disabled={busy}
          className="w-full rounded-lg border border-line bg-panel2 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line disabled:opacity-50"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}