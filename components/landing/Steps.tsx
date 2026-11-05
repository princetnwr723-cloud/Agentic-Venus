"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import type { AvatarColor } from "@/lib/bots";

const STEPS = [
  {
    n: 1,
    title: "Create your account",
    body: "Sign up in a few seconds. Your teammates live in the cloud, so there’s nothing to install.",
  },
  {
    n: 2,
    title: "Add one provider key",
    body: "Paste a key from Claude, OpenAI or any supported provider. It goes into an encrypted vault, and you can add more later.",
  },
  {
    n: 3,
    title: "Create your first bot",
    body: "Give it a name, a role and a model. Start with one bot, you can grow the team later.",
  },
  {
    n: 4,
    title: "Send a small, useful task",
    body: "Ask it to plan your day, summarize notes or draft an email. Start with one clear request and review the answer.",
  },
];

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[210px] items-center justify-center rounded-2xl border border-line bg-panel/60 p-5">
      {children}
    </div>
  );
}

export default function Steps() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-24">
      <h2 className="text-4xl font-semibold tracking-tight text-ink md:text-6xl">
        From signup to your first useful task.
      </h2>
      <p className="mt-4 text-lg text-muted">
        Start with one bot and one provider. No extra apps or setup needed.
      </p>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1 */}
        <div>
          <Frame>
            <div className="w-full max-w-[200px] rounded-xl border border-line bg-bg p-3 text-xs">
              <div className="flex items-center gap-2">
                <BotAvatar color={"bd.bunny:#ff7eb6" as AvatarColor} size={30} />
                <span className="text-ink">Account created</span>
                <Check size={14} className="ml-auto text-[#3fe08f]" />
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div className="h-full w-full rounded-full bg-[#2fb36f]" />
              </div>
            </div>
          </Frame>
        </div>
        {/* 2 */}
        <div>
          <Frame>
            <div className="w-full max-w-[200px] rounded-xl border border-line bg-bg p-3 text-xs">
              <p className="mb-2 text-muted">Providers</p>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2 text-ink">
                <span className="h-2 w-2 rounded-full bg-[#3fe08f]" /> Claude
                <Check size={14} className="ml-auto text-[#3fe08f]" />
              </div>
              <p className="mt-2 font-mono text-muted">key ••••••••••</p>
            </div>
          </Frame>
        </div>
        {/* 3 */}
        <div>
          <Frame>
            <div className="w-full max-w-[200px] rounded-xl border border-line bg-bg p-3 text-xs">
              <p className="mb-2 text-muted">New bot</p>
              <p className="rounded-lg border border-line bg-panel2 px-3 py-2 text-ink">Mira</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="rounded-md border border-line px-2 py-1 text-muted">Claude</span>
                <span className="rounded-full bg-[#2fb36f] px-3 py-1 font-medium text-black">Created</span>
              </div>
            </div>
          </Frame>
        </div>
        {/* 4 */}
        <div>
          <Frame>
            <div className="w-full max-w-[210px] text-xs">
              <p className="mb-2 ml-auto w-fit rounded-full bg-[#2fb36f] px-3 py-1 font-mono text-black">
                Plan my morning
              </p>
              <div className="space-y-1.5 rounded-xl border border-line bg-bg p-3 font-mono text-muted">
                {["9:00 Emails", "10:00 Update", "11:00 Meeting"].map((t) => (
                  <p key={t} className="flex items-center gap-2">
                    <Check size={13} className="text-[#3fe08f]" /> {t}
                  </p>
                ))}
              </div>
            </div>
          </Frame>
        </div>
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <div key={s.n}>
            <h3 className="text-2xl font-semibold leading-snug tracking-tight text-ink">
              <span className="lv-brand">{s.n}.</span> {s.title}
            </h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">{s.body}</p>
          </div>
        ))}
      </div>

      <Link
        href="/docs"
        className="mt-10 inline-flex items-center gap-2 text-lg text-ink underline underline-offset-4 hover:opacity-80"
      >
        Full setup guide <ArrowRight size={18} />
      </Link>
    </section>
  );
}