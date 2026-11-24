"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Caveat } from "next/font/google";
import BotAvatar from "@/components/BotAvatar";

const hand = Caveat({ subsets: ["latin"], weight: ["600", "700"], display: "swap" });

const TEAM = [
  { name: "Appu", color: "orange-calm", line: "Here's your week: Mon 10:00 Dentist…" },
  { name: "Inbox", color: "blue-calm", line: "Priya wants a yes or no on Thursday." },
  { name: "Research", color: "purple-calm", line: "Brief: best noise-cancelling headphones" },
  { name: "Accounting", color: "green-joy", line: "October software spend: $580" },
  { name: "Travel", color: "red-calm", line: "Best pick for a morning Delhi → Goa flight" },
] as const;

function Bubble({ me, children }: { me?: boolean; children: React.ReactNode }) {
  return <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-snug ${me ? "ml-auto bg-ink text-bg" : "border border-line bg-panel text-ink"}`}>{children}</div>;
}

const SLIDES: Array<{ title: string; card: React.ReactNode }> = [
  {
    title: "Your AI teammates in your pocket",
    card: (
      <ul className="space-y-3.5">
        {TEAM.map((t) => (
          <li key={t.name} className="flex items-center gap-3">
            <BotAvatar color={t.color} size={44} />
            <span className="min-w-0"><span className="block text-[15px] font-semibold">{t.name}</span><span className="block truncate text-[13px] text-muted">{t.line}</span></span>
          </li>
        ))}
      </ul>
    ),
  },
  {
    title: "Ask from anywhere, get it handled",
    card: (
      <div className="space-y-2.5">
        <Bubble me>What needs my attention today?</Bubble>
        <Bubble>
          <b>Figma invoice:</b> $45, due Friday.<br /><b>Priya:</b> wants to move Thursday&apos;s sync to 4 pm.<br /><b>Northwind contract:</b> waiting on your signature.
        </Bubble>
      </div>
    ),
  },
  {
    title: "Schedules that run on your phone, on time",
    card: (
      <div className="space-y-2.5">
        {[["07:00", "Morning brief"], ["09:30", "Check my inbox"], ["18:00", "Daily spend report"]].map(([t, n]) => (
          <div key={n} className="flex items-center gap-3 rounded-2xl border border-line bg-panel px-3.5 py-3">
            <span className="rounded-full bg-goldSoft px-2.5 py-1 text-[12.5px] font-semibold text-gold">{t}</span>
            <span className="text-[14px]">{n}</span>
            <span className="ml-auto text-[12px] text-emerald-300">on time</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "They check with you before they act",
    card: (
      <div className="rounded-2xl border border-line bg-panel p-3.5">
        <p className="text-[12.5px] text-muted">Inbox asks</p>
        <p className="mb-3 text-[16px] font-semibold">How do you like things done?</p>
        {["Short and casual", "Detailed and formal", "Check with me before acting", "Just get it done"].map((o) => (
          <div key={o} className="mb-2 flex items-center gap-3 rounded-xl bg-panel2 px-3 py-2.5 text-[14px]"><span className="h-5 w-5 rounded-full border border-faint" />{o}</div>
        ))}
      </div>
    ),
  },
  {
    title: "Pair with your computer, or use a cloud one",
    card: (
      <div className="flex flex-col items-center gap-4 pt-2 text-center">
        <div className="flex items-end gap-1">{TEAM.map((t, i) => <BotAvatar key={t.name} color={t.color} size={i === 0 ? 64 : 44} />)}</div>
        <p className="text-[22px] font-semibold">You&apos;re paired</p>
        <p className="text-[14px] text-muted">Appu, Inbox and 3 more are ready.</p>
      </div>
    ),
  },
];

/** First launch: five short cards. Night and Light both work, because everything uses the app's colors. */
export default function Welcome() {
  const router = useRouter();
  const [i, setI] = useState(0);
  const x0 = useRef<number | null>(null);
  const last = i === SLIDES.length - 1;
  const done = () => { try { localStorage.setItem("av:welcomed", "1"); } catch { /* ignore */ } router.replace("/m"); };
  const go = (n: number) => setI(Math.max(0, Math.min(SLIDES.length - 1, n)));

  return (
    <main
      className="mx-auto flex min-h-screen max-w-md flex-col bg-bg px-5 pb-[calc(var(--sab)+20px)] pt-[calc(var(--sat)+12px)] text-ink"
      onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { if (x0.current === null) return; const dx = e.changedTouches[0].clientX - x0.current; x0.current = null; if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1)); }}
    >
      <div className="flex justify-end"><button onClick={done} className="press px-2 py-1 text-[16px] font-medium text-[#3b82f6]">Done</button></div>

      <h1 key={i} className={`${hand.className} rise mx-auto mt-6 max-w-[16ch] text-center text-[40px] font-bold leading-[1.05]`}>{SLIDES[i].title}</h1>
      <div className="mx-auto mt-2 h-0.5 w-40 rounded-full bg-line" />

      <div key={`c${i}`} className="rise mt-8 flex-1" style={{ animationDelay: "80ms" }}>
        <div className="rounded-[28px] border border-line bg-panel2/60 p-4">{SLIDES[i].card}</div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex gap-1.5">
          {SLIDES.map((_, k) => <span key={k} className={`h-2 rounded-full transition-all ${k === i ? "w-6 bg-ink" : "w-2 bg-faint/50"}`} />)}
        </div>
        <button onClick={() => (last ? done() : go(i + 1))} className="press rounded-full bg-ink px-6 py-3 text-[15px] font-semibold text-bg">{last ? "Get started" : "Next"}</button>
      </div>
    </main>
  );
}
