"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, X } from "lucide-react";
import Logo from "@/components/Logo";
import AuthModal from "@/components/AuthModal";
import { useAuth } from "@/lib/auth-context";
import "@/components/landing/landing.css";
import { useBrandColor } from "@/components/landing/useBrandColor";
import HeroWordmark from "@/components/landing/HeroWordmark";
import WorkspaceDemo from "@/components/landing/WorkspaceDemo";
import ComputerShowcase from "@/components/landing/ComputerShowcase";
import FeatureCards from "@/components/landing/FeatureCards";
import RolesShowcase from "@/components/landing/RolesShowcase";
import Steps from "@/components/landing/Steps";

export default function LandingPage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signup");
  const [menuOpen, setMenuOpen] = useState(false);
  const { user } = useAuth();
  const router = useRouter();
  const brand = useBrandColor();

  function openAuth(tab: "signin" | "signup") {
    setAuthTab(tab);
    setAuthOpen(true);
    setMenuOpen(false);
  }

  function primary() {
    if (user) router.push("/dashboard");
    else openAuth("signup");
  }

  return (
    <main
      className="min-h-screen overflow-x-hidden bg-bg"
      style={{ "--brand": brand } as React.CSSProperties}
    >
      {/* nav */}
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <div className="flex items-center gap-2">
            <Link href="/docs" className="hidden rounded-full px-4 py-2 text-sm text-muted hover:text-ink sm:block">
              Docs
            </Link>
            {!user && (
              <button
                onClick={() => openAuth("signin")}
                className="hidden rounded-full px-4 py-2 text-sm text-muted hover:text-ink sm:block"
              >
                Sign in
              </button>
            )}
            <button
              onClick={primary}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-bg hover:opacity-90"
            >
              {user ? "Dashboard" : "Get your team"}
            </button>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Menu"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink sm:hidden"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="mx-auto flex max-w-6xl flex-col gap-1 border-t border-line px-6 py-3 sm:hidden">
            <Link href="/docs" className="rounded-lg px-3 py-2 text-sm text-ink hover:bg-panel">
              Docs
            </Link>
            {!user && (
              <button
                onClick={() => openAuth("signin")}
                className="rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-panel"
              >
                Sign in
              </button>
            )}
          </div>
        )}
      </header>

      {/* hero */}
      <section className="lv-glow relative">
        <HeroWordmark />

        <div className="relative z-10 px-6 pb-14 pt-8 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-ink md:text-7xl">
            Your <span className="lv-brand">business</span> on autopilot
          </h1>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={primary}
              className="rounded-full bg-white px-8 py-4 text-base font-medium text-bg hover:opacity-90"
            >
              {user ? "Go to your dashboard" : "Get your first teammate"}
            </button>
            <Link
              href="/docs"
              className="rounded-full border border-line px-8 py-4 text-base text-ink hover:bg-panel"
            >
              Read the docs
            </Link>
          </div>
          <p className="mx-auto mt-6 max-w-2xl text-sm text-muted">
            AI teammates with their own computer. Bring your AI account or API key. Provider fees
            and limits apply.
          </p>
        </div>

        <div className="pb-6">
          <WorkspaceDemo />
        </div>
      </section>

      <ComputerShowcase />
      <FeatureCards />
      <RolesShowcase />
      <Steps />

      {/* closing cta */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="lv-glow rounded-xl2 border border-line bg-panel/50 px-6 py-16 text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-ink md:text-5xl">
            Hand your work to a team that never logs off.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            They sign into the tools you already use and come back only when a decision needs you.
          </p>
          <button
            onClick={primary}
            className="mt-8 rounded-full bg-white px-8 py-4 text-base font-medium text-bg hover:opacity-90"
          >
            {user ? "Go to your dashboard" : "Get your first teammate"}
          </button>
        </div>
      </section>

      {/* footer */}
      <footer className="mx-auto flex max-w-6xl items-center justify-between border-t border-line px-6 py-8">
        <Logo size={18} />
        <div className="flex items-center gap-5">
          <Link href="/docs" className="text-xs text-muted hover:text-ink">
            Docs
          </Link>
          <p className="text-xs text-faint">© {new Date().getFullYear()} AgenticVenus</p>
        </div>
      </footer>

      <AuthModal open={authOpen} initialTab={authTab} onClose={() => setAuthOpen(false)} />
    </main>
  );
}