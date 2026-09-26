"use client";

import { useState } from "react";
import { X } from "lucide-react";

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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl2 border border-line bg-panel p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex rounded-full border border-line bg-panel2 p-1 text-sm">
            <button
              onClick={() => setTab("signin")}
              className={`rounded-full px-3.5 py-1.5 transition-colors ${
                tab === "signin" ? "bg-gold text-bg" : "text-muted"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => setTab("signup")}
              className={`rounded-full px-3.5 py-1.5 transition-colors ${
                tab === "signup" ? "bg-gold text-bg" : "text-muted"
              }`}
            >
              Create account
            </button>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
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

        {/*
          TODO(firebase): wire these up to Firebase Auth.
          - Email/password: createUserWithEmailAndPassword / signInWithEmailAndPassword
          - Google: signInWithPopup(auth, new GoogleAuthProvider())
          On success, route to /dashboard.
        */}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <input
            type="email"
            required
            placeholder="Email"
            className="w-full rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold"
          />
          <input
            type="password"
            required
            placeholder="Password"
            className="w-full rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold"
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-gold py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
          >
            {tab === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-faint">
          <div className="h-px flex-1 bg-line" />
          or
          <div className="h-px flex-1 bg-line" />
        </div>

        <button className="w-full rounded-lg border border-line bg-panel2 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line">
          Continue with Google
        </button>
      </div>
    </div>
  );
}