"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { disableThisDevice, enablePush, initNativeLinks, isNativeApp, startRunnerLoop } from "@/lib/native";
import { clearScheduler, resyncScheduler, setupScheduler } from "@/lib/native-scheduler";
import { autoSetupComputer, clearComputer } from "@/lib/native-computer";

const OPEN = ["/app-login", "/native-login"];

/** Mounted once in the layout. Does nothing on the website; inside the Android app it wires login, push, the runner and the phone's own scheduler. */
export default function NativeBridge() {
  const { user, loading } = useAuth();
  const path = usePathname() || "/";
  const router = useRouter();

  // login link coming back from Chrome
  useEffect(() => {
    if (!isNativeApp()) return;
    let off = () => {};
    let dead = false;
    void initNativeLinks().then((f) => { if (dead) f(); else off = f; });
    return () => { dead = true; off(); };
  }, []);

  // the app always lives behind its own login page
  useEffect(() => {
    if (!isNativeApp() || loading) return;
    const open = OPEN.some((p) => path.startsWith(p));
    if (!user && !open) router.replace("/app-login");
    if (user && path.startsWith("/app-login")) router.replace("/m");
  }, [user, loading, path, router]);

  useEffect(() => {
    if (!isNativeApp() || !user) return;
    void enablePush();
    const stop = startRunnerLoop();
    const orig = auth.signOut.bind(auth);
    auth.signOut = async () => { await disableThisDevice(); await clearScheduler(); await clearComputer(); await orig(); };
    return () => { stop(); auth.signOut = orig; };
  }, [user]);

  // schedules on the phone: hand over the login once, then keep the alarms fresh (on open, on coming back, every 10 minutes)
  useEffect(() => {
    if (!isNativeApp() || !user) return;
    void setupScheduler().catch(() => undefined);
    const tick = () => { if (document.visibilityState === "visible") void resyncScheduler(); };
    const id = window.setInterval(tick, 10 * 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [user]);

  // the phone computer: right after the app is installed and signed in, it installs itself (on Wi-Fi; on mobile data it waits for a tap)
  useEffect(() => {
    if (!isNativeApp() || !user) return;
    void autoSetupComputer().catch(() => undefined);
  }, [user]);

  // a routine was created, edited, paused or deleted (by you or by the agent): re-arm the alarms within a few seconds
  useEffect(() => {
    if (!isNativeApp() || !user) return;
    let last = "";
    let timer: number | undefined;
    const off = onSnapshot(collection(db, "users", user.uid, "routines"), (snap) => {
      const sig = snap.docs.map((d) => { const r = d.data() as { enabled?: boolean; nextRunAt?: number; schedule?: unknown; everyMinutes?: number }; return `${d.id}|${r.enabled}|${r.nextRunAt}|${JSON.stringify(r.schedule ?? r.everyMinutes)}`; }).sort().join(";");
      if (sig === last) return;
      const first = last === "";
      last = sig;
      if (first) return; // the first snapshot is just the current state: setupScheduler() already armed it
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void resyncScheduler(); }, 3000);
    }, () => undefined);
    return () => { off(); window.clearTimeout(timer); };
  }, [user]);

  return null;
}
