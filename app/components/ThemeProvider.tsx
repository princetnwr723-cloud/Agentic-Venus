"use client";
// Mounted once in app/layout.tsx. It (1) puts the saved Night/Light theme on the page, (2) keeps the owner's profile fresh
// (so a theme or name the agent changed shows up by itself), and (3) hosts the "[dashboard" chat command.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { paintTheme, savedTheme } from "@/lib/theme";
import { loadProfile, resetProfile } from "@/lib/profile";
import DashboardHost from "@/components/dashboard/DashboardHost";

export default function ThemeProvider() {
  const { user } = useAuth();
  const path = usePathname();

  useEffect(() => { paintTheme(savedTheme()); }, [path]);

  useEffect(() => {
    if (!user) { resetProfile(); return; }
    void loadProfile();
    const tick = () => { if (document.visibilityState === "visible") void loadProfile(); };
    const id = window.setInterval(tick, 20_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); };
  }, [user]);

  return <DashboardHost />;
}