"use client";

import { useEffect, useState } from "react";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase";

type Desktop = { takeLoginToken?: () => Promise<string | null> };

/** Opened inside the desktop app after the browser login finished. Signs the app window in, then goes to the dashboard. */
export default function DesktopLogin() {
  const [msg, setMsg] = useState("Signing you in…");

  useEffect(() => {
    (async () => {
      const d = (window as unknown as { venusDesktop?: Desktop }).venusDesktop;
      const token = await d?.takeLoginToken?.();
      if (!token) { setMsg("Open this page from the AgenticVenus desktop app."); return; }
      await signInWithCustomToken(auth, token);
      window.location.replace("/");
    })().catch(() => setMsg("Login failed. Close the app and try again."));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-5 text-ink">
      <p className="text-sm text-muted">{msg}</p>
    </main>
  );
}