"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { disableThisDevice, enablePush, initNativeLinks, isNativeApp, startRunnerLoop } from "@/lib/native";

const OPEN = ["/app-login", "/native-login"];

/** Mounted once in the layout. Does nothing on the website; inside the Android app it wires login, push and the runner. */
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
    if (user && path.startsWith("/app-login")) router.replace("/dashboard");
  }, [user, loading, path, router]);

  // push + background runner while signed in
  useEffect(() => {
    if (!isNativeApp() || !user) return;
    void enablePush();
    const stop = startRunnerLoop();
    const orig = auth.signOut.bind(auth);
    auth.signOut = async () => { await disableThisDevice(); await orig(); };
    return () => { stop(); auth.signOut = orig; };
  }, [user]);

  return null;
}