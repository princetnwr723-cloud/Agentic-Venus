"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, Monitor } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import { parseAvatar } from "@/lib/bots";
import { JOBS } from "./data";

export default function RolesShowcase() {
  const [activeId, setActiveId] = useState(JOBS[1].id);
  const job = JOBS.find((j) => j.id === activeId) ?? JOBS[0];

  return (
    <section id="jobs" className="mx-auto max-w-6xl px-6 pb-24">
      <h2 className="text-4xl font-semibold tracking-tight text-ink md:text-6xl">
        Give each bot a job worth doing.
      </h2>
      <p className="mt-4 text-lg text-muted">
        Pick a job to see what its bot reports back, and what it waits for you to approve.
      </p>

      <div className="mt-12 grid items-center gap-12 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <div className="flex flex-wrap gap-3">
            {JOBS.map((j) => {
              const on = j.id === activeId;
              const hex = parseAvatar(j.color).hex;
              return (
                <button
                  key={j.id}
                  onClick={() => setActiveId(j.id)}
                  className="flex items-center gap-2.5 rounded-full border px-5 py-3 text-base transition-colors hover:bg-panel"
                  style={
                    on
                      ? { borderColor: hex, color: hex, background: `${hex}1a` }
                      : { borderColor: "#28282D", color: "#F1F0EC" }
                  }
                >
                  <BotAvatar color={j.color} size={26} animate={false} />
                  {j.name}
                </button>
              );
            })}
          </div>

          <p key={job.id} className="lv-msg mt-10 max-w-xl text-2xl leading-snug text-ink md:text-[1.7rem]">
            {job.blurb}
          </p>

          <dl className="mt-8 space-y-3 text-lg">
            <div className="flex gap-8">
              <dt className="w-16 text-muted">Runs</dt>
              <dd className="text-ink">{job.runs}</dd>
            </div>
            <div className="flex gap-8">
              <dt className="w-16 text-muted">Uses</dt>
              <dd className="text-ink">{job.uses}</dd>
            </div>
          </dl>

          <Link
            href="/docs"
            className="mt-10 inline-flex items-center gap-2 rounded-full border border-line px-6 py-4 text-lg text-ink hover:bg-panel"
          >
            Explore more bots <ArrowUpRight size={18} />
          </Link>
        </div>

        {/* phone */}
        <div className="relative mx-auto h-[540px] w-[300px] overflow-hidden rounded-[2.8rem] border-[3px] border-white/70 bg-bg">
          <div className="mx-auto mt-4 h-8 w-24 rounded-full bg-panel" />
          <div className="absolute left-4 top-14 flex h-10 w-10 items-center justify-center rounded-full bg-panel text-ink">
            <ChevronLeft size={20} />
          </div>
          <div className="absolute right-4 top-14 flex h-10 w-10 items-center justify-center rounded-full bg-panel text-ink">
            <Monitor size={17} />
          </div>
          <div className="mt-3 flex flex-col items-center">
            <BotAvatar color={job.color} size={64} />
            <span className="mt-2 rounded-full bg-panel px-4 py-1.5 text-sm font-medium text-ink">
              {job.name}
            </span>
          </div>

          <div key={job.id} className="absolute inset-x-0 bottom-0 top-[190px] space-y-2.5 overflow-hidden px-3 pb-4">
            <p className="pt-3 text-center text-xs text-muted">Today 9:00 AM</p>
            {job.msgs.map((m, i) => (
              <div
                key={i}
                className={`lv-msg flex ${m.from === "me" ? "justify-end" : "justify-start"}`}
                style={{ animationDelay: `${0.2 + i * 0.9}s` }}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug ${
                    m.from === "me" ? "bg-[#2f6fed] text-white" : "bg-panel2 text-ink"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}