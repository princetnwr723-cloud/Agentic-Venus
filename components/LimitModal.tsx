"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { PLANS, nextPlan } from "@/lib/plans";

type Info = { what: string; plan: string; resetAt: number | null };

/** The server message looks like: "AI token limit reached on the Free plan. It refreshes in 3.5 hours. Upgrade to Pro in Settings → Plans." */
function parse(message: string): Info {
  const what = /^(.+?) limit reached/i.exec(message)?.[1] ?? "usage";
  const plan = /on the (.+?) plan/i.exec(message)?.[1] ?? "Free";
  const m = /refreshes in ([\d.]+) (min|hour)/i.exec(message);
  const ms = m ? Number(m[1]) * (m[2].toLowerCase() === "min" ? 60_000 : 3_600_000) : 0;
  return { what, plan, resetAt: ms ? Date.now() + ms : null };
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Shows "Upgrade to keep going" whenever any request is stopped by a plan limit. Mounted once in the root layout. */
export default function LimitModal() {
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const message = String((e as CustomEvent).detail?.message ?? "");
      if (message) setInfo(parse(message));
    };
    window.addEventListener("venus:limit", on);
    return () => window.removeEventListener("venus:limit", on);
  }, []);

  if (!info) return null;

  const current = PLANS.find((p) => p.name.toLowerCase() === info.plan.toLowerCase()) ?? PLANS[0];
  const next = nextPlan(current.id);
  const close = () => setInfo(null);
  const what = /^ai token$/i.test(info.what) ? "AI usage" : info.what.toLowerCase();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div className="relative w-full max-w-lg rounded-xl2 border border-line bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <button onClick={close} aria-label="Close" className="absolute right-4 top-4 text-muted hover:text-ink"><X size={18} /></button>

        <h2 className="pr-8 text-xl font-semibold text-ink">{next ? "Upgrade to keep going" : "Limit reached"}</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          You hit your {what} limit on the {current.name} plan.{" "}
          {info.resetAt ? `It resets at ${clock(info.resetAt)}` : "It resets soon"}
          {next ? ", or you can upgrade for higher limits." : "."}
        </p>

        {next && (
          <div className="mt-4 rounded-lg border border-line bg-bg p-3">
            <p className="text-sm font-medium text-ink">{next.name} · ${next.price}/month</p>
            <p className="mt-1 text-xs text-gold">{next.rel} limits</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              {next.videosPerDay.toLocaleString("en-US")} videos and {next.sitesPerDay.toLocaleString("en-US")} websites per day
            </p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={close} className="rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-panel2">Not now</button>
          {next && (
            <button
              onClick={() => { close(); router.push(`/checkout?plan=${next.id}`); }}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
            >
              Upgrade to {next.name}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}