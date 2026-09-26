"use client";

import { useState } from "react";
import BotAvatar from "@/components/BotAvatar";
import Logo from "@/components/Logo";
import LandingChatDemo from "@/components/LandingChatDemo";
import AuthModal from "@/components/AuthModal";
import { bots } from "@/lib/bots";

export default function LandingPage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signup");

  function openAuth(tab: "signin" | "signup") {
    setAuthTab(tab);
    setAuthOpen(true);
  }

  return (
    <main className="min-h-screen bg-bg">
      {/* nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <div className="flex items-center gap-2">
          <button
            onClick={() => openAuth("signin")}
            className="rounded-full px-4 py-2 text-sm text-muted hover:text-ink"
          >
            Sign in
          </button>
          <button
            onClick={() => openAuth("signup")}
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
          >
            Sign up
          </button>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-10 md:grid-cols-2 md:items-center md:pt-16">
        <div>
          <h1 className="max-w-md text-[2.75rem] font-semibold leading-[1.08] tracking-tight text-ink md:text-5xl">
            Hand your work to a team that never logs off.
          </h1>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-muted">
            AgenticVenus teammates get their own computer, sign into the
            tools you already use, and come back only when a decision needs
            you.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={() => openAuth("signup")}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-bg hover:opacity-90"
            >
              Get your first teammate
            </button>
            <a
              href="#team"
              className="rounded-full border border-line px-5 py-2.5 text-sm text-ink hover:bg-panel"
            >
              See the roster
            </a>
          </div>
        </div>

        <div className="relative">
          <div className="pointer-events-none absolute -inset-10 rounded-full bg-gold/[0.06] blur-3xl" />
          <div className="relative">
            <LandingChatDemo />
          </div>
        </div>
      </section>

      {/* roster — every bot has its own identity */}
      <section id="team" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">
          Every teammate has an identity of their own
        </h2>
        <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-muted">
          A name, a role, a memory of how you like things done. Message one
          directly, or let them coordinate with each other.
        </p>

        <div className="mt-8 divide-y divide-line rounded-xl2 border border-line">
          {bots.map((bot) => (
            <div
              key={bot.id}
              className="flex items-center gap-4 px-5 py-4"
            >
              <BotAvatar color={bot.color} paired={bot.paired} size={38} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-ink">{bot.name}</span>
                  <span className="text-xs text-faint">{bot.role}</span>
                </div>
                <p className="truncate text-sm text-muted">
                  {bot.lastMessage}
                </p>
              </div>
              <span className="shrink-0 text-xs text-faint">{bot.time}</span>
            </div>
          ))}
        </div>
      </section>

      {/* feature rows — grounded in the real product moments, not generic icon cards */}
      <section className="mx-auto max-w-6xl space-y-14 px-6 py-16">
        <FeatureRow
          title="A computer of its own"
          body="Bots sign into Salesforce, your inbox, LinkedIn, anything with a login — even tools with no clean API. Work keeps running after you close the laptop."
        >
          <div className="space-y-2 rounded-xl border border-line bg-panel p-4 text-sm">
            {[
              ["Salesforce", "list pulled · 52 accounts"],
              ["LinkedIn", "4 profiles skipped · recently contacted"],
              ["Sequencer", "36 drafts queued · 0 sent"],
            ].map(([label, detail]) => (
              <div key={label} className="flex items-center gap-2 text-ink">
                <span className="text-avatar-teal">✓</span>
                <span className="font-medium">{label}</span>
                <span className="text-muted">→ {detail}</span>
              </div>
            ))}
          </div>
        </FeatureRow>

        <FeatureRow
          title="Show it once, it remembers"
          body="Walk through a workflow together the first time. Your teammate saves it as a routine and runs it on its own from then on — corrections included."
          reverse
        >
          <div className="rounded-xl border border-line bg-panel p-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel2 px-3 py-1.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              Created routine · Overnight outbound
            </span>
          </div>
        </FeatureRow>

        <FeatureRow
          title="A small team, not one more agent"
          body="Run several at once — one on outbound, one on the inbox, one on expenses — and let a lead teammate route work between them."
        >
          <div className="flex -space-x-3">
            <BotAvatar color="teal" size={44} />
            <BotAvatar color="amber" size={44} />
            <BotAvatar color="violet" size={44} />
            <BotAvatar color="sky" size={44} />
          </div>
        </FeatureRow>
      </section>

      {/* footer */}
      <footer className="mx-auto flex max-w-6xl items-center justify-between border-t border-line px-6 py-8">
        <Logo size={18} />
        <p className="text-xs text-faint">
          © {new Date().getFullYear()} AgenticVenus
        </p>
      </footer>

      <AuthModal open={authOpen} initialTab={authTab} onClose={() => setAuthOpen(false)} />
    </main>
  );
}

function FeatureRow({
  title,
  body,
  children,
  reverse,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      className={`grid items-center gap-8 md:grid-cols-2 ${
        reverse ? "md:[&>*:first-child]:order-2" : ""
      }`}
    >
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-ink">
          {title}
        </h3>
        <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted">
          {body}
        </p>
      </div>
      <div>{children}</div>
    </div>
  );
}