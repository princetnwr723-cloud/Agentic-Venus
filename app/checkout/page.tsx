"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, Lock } from "lucide-react";
import Logo from "@/components/Logo";
import { useAuth } from "@/lib/auth-context";
import { fmtDuration, fmtTokens, fullName, isPaid, planById, type PlanId } from "@/lib/plans";

type Phase = "idle" | "opening" | "waiting" | "done" | "error";

function openGumroad(url: string) {
  document.querySelectorAll("a[data-agv]").forEach((e) => e.remove());
  document.querySelectorAll("script[data-agv]").forEach((e) => e.remove());
  const a = document.createElement("a");
  a.href = url;
  a.className = "gumroad-button";
  a.setAttribute("data-agv", "1");
  a.style.display = "none";
  a.textContent = "Pay";
  document.body.appendChild(a);
  const s = document.createElement("script");
  s.src = "https://gumroad.com/js/gumroad.js";
  s.async = true;
  s.setAttribute("data-agv", "1");
  s.onload = () => setTimeout(() => a.click(), 300);
  s.onerror = () => window.open(url, "_blank", "noopener");
  document.body.appendChild(s);
}

export default function CheckoutPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [planId, setPlanId] = useState<PlanId | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  const [checking, setChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("plan") || "";
    if (isPaid(p)) setPlanId(p as PlanId);
    else router.replace("/dashboard");
  }, [router]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  if (!user || !planId) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;
  const plan = planById(planId);

  /** Asks the server once whether the plan is active. Returns true when it is. */
  async function check(): Promise<boolean> {
    try {
      const r = await fetch("/api/billing/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await r.json();
      if (d.plan === planId) {
        if (timer.current) clearInterval(timer.current);
        setPhase("done");
        return true;
      }
    } catch { /* try again later */ }
    return false;
  }

  function watch() {
    if (timer.current) clearInterval(timer.current);
    setTimedOut(false);
    const until = Date.now() + 10 * 60_000;
    timer.current = setInterval(async () => {
      if (await check()) return;
      if (Date.now() > until) {
        if (timer.current) clearInterval(timer.current);
        setTimedOut(true);
      }
    }, 5000);
  }

  async function checkNow() {
    setChecking(true);
    const done = await check();
    setChecking(false);
    if (!done) setTimedOut(true);
  }

  async function pay() {
    setErr(""); setPhase("opening");
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: planId, email: user!.email }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d?.error || "Could not start the checkout.");
      setUrl(d.url);
      openGumroad(d.url);
      setPhase("waiting");
      watch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the checkout.");
      setPhase("error");
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-8 flex items-center justify-between">
          <button onClick={() => router.push("/dashboard")} className="flex items-center gap-1.5 text-xs text-muted hover:text-ink"><ArrowLeft size={14} /> Back to dashboard</button>
          <Logo size={18} />
        </div>

        {phase === "done" ? (
          <div className="mx-auto max-w-md rounded-xl2 border border-avatar-teal/50 bg-panel p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-avatar-teal/20 text-avatar-teal"><Check size={24} /></div>
            <h1 className="text-xl font-semibold text-ink">{fullName(plan)} is active</h1>
            <p className="mt-2 text-sm text-muted">Your new limits are live now. Thank you!</p>
            <button onClick={() => router.push("/dashboard")} className="mt-6 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-bg hover:opacity-90">Go to dashboard</button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[1fr_340px]">
            <section className="rounded-xl2 border border-line bg-panel p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">Checkout</p>
              <h1 className="mt-1 text-2xl font-semibold text-ink">{fullName(plan)}</h1>
              <p className="mt-1 text-sm text-muted">{plan.tagline}</p>
              <ul className="mt-5 space-y-2.5">
                {plan.perks.map((p) => (
                  <li key={p} className="flex gap-2.5 text-sm text-ink"><Check size={16} className="mt-0.5 shrink-0 text-avatar-teal" />{p}</li>
                ))}
              </ul>
              <div className="mt-6 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border border-line bg-bg p-3"><p className="text-faint">AI tokens</p><p className="mt-0.5 text-sm font-medium text-ink">{fmtTokens(plan.tokens)} / {plan.windowHours}h</p></div>
                <div className="rounded-lg border border-line bg-bg p-3"><p className="text-faint">Computer agent</p><p className="mt-0.5 text-sm font-medium text-ink">{fmtDuration(plan.pcSeconds)}{plan.pcSeconds !== null ? ` / ${plan.windowHours}h` : ""}</p></div>
              </div>
            </section>

            <aside className="h-fit rounded-xl2 border border-line bg-panel p-6">
              <p className="text-sm font-medium text-ink">Order summary</p>
              <div className="mt-4 flex items-center justify-between text-sm"><span className="text-muted">{fullName(plan)} · monthly</span><span className="text-ink">${plan.price}</span></div>
              <div className="mt-2 flex items-center justify-between text-xs text-faint"><span>Taxes</span><span>calculated by Gumroad</span></div>
              <div className="my-4 h-px bg-line" />
              <div className="flex items-center justify-between"><span className="text-sm font-medium text-ink">Total today</span><span className="text-xl font-semibold text-ink">${plan.price}</span></div>
              <p className="mt-1 text-[11px] text-faint">Renews every month until you cancel.</p>

              <button onClick={pay} disabled={phase === "opening" || (phase === "waiting" && !timedOut)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-60">
                {phase === "opening" || (phase === "waiting" && !timedOut) ? <Loader2 size={15} className="animate-spin" /> : <Lock size={14} />}
                {phase === "waiting" && !timedOut ? "Waiting for payment…" : phase === "opening" ? "Opening…" : `Pay $${plan.price} securely`}
              </button>

              {phase === "waiting" && !timedOut && (
                <p className="mt-3 text-[11px] leading-relaxed text-muted">
                  Finish the payment in the window that opened. This page updates by itself once it is confirmed.{" "}
                  <a href={url} target="_blank" rel="noreferrer" className="text-gold underline">Window did not open? Click here.</a>
                </p>
              )}
              {phase === "waiting" && (
                <div className="mt-3 rounded-lg border border-line bg-bg p-3">
                  <p className="text-[11px] leading-relaxed text-muted">
                    {timedOut
                      ? "Still not confirmed. If you already paid, it can take a few minutes. Your plan is never lost: check again, or open Settings → Plans."
                      : "Already paid? You can check right now."}
                  </p>
                  <button onClick={checkNow} disabled={checking} className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-line py-2 text-xs text-ink hover:bg-panel2 disabled:opacity-60">
                    {checking && <Loader2 size={12} className="animate-spin" />} I already paid, check again
                  </button>
                </div>
              )}
              {err && <p className="mt-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">{err}</p>}
              <p className="mt-4 text-[11px] leading-relaxed text-faint">Payment is processed securely by Gumroad. Your card details never touch our servers. Cancel any time from the link in your Gumroad receipt email.</p>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}