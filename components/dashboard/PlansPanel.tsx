"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { PLANS, fmtDuration, fmtTokens, fullName, planById, type PlanId } from "@/lib/plans";

type Summary = {
  plan: PlanId; status: string; cancelled: boolean; renewsAt: number | null; windowHours: number; windowEndsAt: number;
  tokens: { used: number; limit: number | null };
  pc: { usedSeconds: number; limitSeconds: number | null };
};

function Meter({ label, used, limit, text }: { label: string; used: number; limit: number | null; text: string }) {
  const pct = limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="text-muted">{label}</span><span className="text-ink">{text}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
        <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-400" : "bg-gold"}`} style={{ width: `${limit === null ? 4 : Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}

const left = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

export default function PlansPanel({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/billing/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(String(d.error)) : setS(d)))
      .catch(() => setErr("Could not load your plan."));
  }, []);

  const current = planById(s?.plan ?? "free");

  return (
    <div>
      {err && <p className="mb-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">{err}</p>}

      {s && (
        <div className="mb-5 rounded-xl border border-line bg-bg p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">{fullName(current)}</p>
            <span className="text-[11px] text-faint">
              {s.plan === "free" ? "Free plan" : s.cancelled ? `Cancelled · active until ${s.renewsAt ? new Date(s.renewsAt).toLocaleDateString() : "period end"}` : `Renews ${s.renewsAt ? new Date(s.renewsAt).toLocaleDateString() : "monthly"}`}
            </span>
          </div>
          <div className="space-y-3">
            <Meter label="AI tokens" used={s.tokens.used} limit={s.tokens.limit} text={`${fmtTokens(s.tokens.used)} / ${fmtTokens(s.tokens.limit)}`} />
            <Meter label="Computer agent" used={s.pc.usedSeconds} limit={s.pc.limitSeconds} text={`${fmtDuration(s.pc.usedSeconds)} / ${fmtDuration(s.pc.limitSeconds)}`} />
          </div>
          {s.tokens.limit !== null && <p className="mt-3 text-[11px] text-faint">Refreshes in {left(s.windowEndsAt - Date.now())} (every {s.windowHours}h)</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {PLANS.map((p) => {
          const isCurrent = p.id === current.id;
          const higher = p.price > current.price;
          return (
            <div key={p.id} className={`relative flex flex-col rounded-xl border p-4 ${isCurrent ? "border-gold/70 bg-goldSoft/20" : "border-line bg-panel"}`}>
              {p.badge && <span className="absolute -top-2 right-3 rounded-full bg-gold px-2 py-0.5 text-[10px] font-semibold text-bg">{p.badge}</span>}
              <p className="text-sm font-medium text-ink">{fullName(p)}</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{p.price === 0 ? "$0" : `$${p.price}`}<span className="text-xs font-normal text-faint">{p.price ? " /month" : ""}</span></p>
              <p className="mt-1 text-[11px] text-muted">{p.tagline}</p>
              <ul className="mt-3 flex-1 space-y-1.5">
                {p.perks.map((perk) => (
                  <li key={perk} className="flex gap-2 text-[11.5px] leading-snug text-ink"><Check size={13} className="mt-0.5 shrink-0 text-avatar-teal" />{perk}</li>
                ))}
              </ul>
              {isCurrent ? (
                <p className="mt-4 rounded-lg border border-line py-2 text-center text-xs text-muted">Current plan</p>
              ) : higher ? (
                <button onClick={() => { onNavigate?.(); router.push(`/checkout?plan=${p.id}`); }} className="mt-4 rounded-lg bg-white py-2 text-xs font-medium text-bg hover:opacity-90">Upgrade to {p.name}</button>
              ) : (
                <p className="mt-4 text-center text-[11px] text-faint">Lower than your plan</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-faint">To cancel or change your card, use the &ldquo;Manage membership&rdquo; link in your Gumroad receipt email. If you move to a bigger plan, cancel the older one there so you are not billed twice.</p>
    </div>
  );
}
