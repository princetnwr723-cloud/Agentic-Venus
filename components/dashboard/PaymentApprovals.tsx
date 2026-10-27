"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

type Pending = {
  id: string;
  label: string;
  last4: string;
  host: string;
  amount: number;
  detected: number | null;
  mismatch: boolean;
  note: string;
  tainted: boolean;
  expiresAt: number;
  limit: number | null;
  budgetLeft: number | null;
  dailyLeft: number | null;
};

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Payment approvals. An agent can only ASK to pay: the request lives on the server, and ONLY this banner
 * (you, signed in) can approve it. Nothing here comes from the agent's computer.
 */
export default function PaymentApprovals() {
  const { user } = useAuth();
  const [items, setItems] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState("");
  const alive = useRef(true);

  const call = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const res = await fetch("/api/vpassword", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user!.getIdToken()) },
        body: JSON.stringify({ action, ...extra }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Request failed.");
      return d;
    },
    [user],
  );

  useEffect(() => {
    alive.current = true;
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        try {
          const d = await call("pending_payments");
          if (alive.current) setItems(Array.isArray(d.payments) ? d.payments : []);
        } catch {
          /* ignore: try again on the next tick */
        }
      }
      if (alive.current) timer = setTimeout(tick, 4000);
    };
    void tick();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [user, call]);

  async function answer(id: string, ok: boolean) {
    setBusy(id);
    setErr("");
    try {
      await call(ok ? "approve_payment" : "deny_payment", { id });
      setItems((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not answer.");
      try {
        const d = await call("pending_payments");
        setItems(Array.isArray(d.payments) ? d.payments : []);
      } catch {
        /* ignore */
      }
    }
    setBusy("");
  }

  if (!user || items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3">
      {items.map((p) => (
        <div key={p.id} className="pointer-events-auto w-full max-w-md rounded-xl border border-gold bg-panel p-4 shadow-2xl">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <CreditCard size={16} className="text-gold" /> Your agent wants to pay
          </p>
          <p className="mt-2 text-2xl font-semibold text-ink">{fmt(p.amount)}</p>
          <p className="mt-1 text-xs text-muted">
            on <b className="text-ink">{p.host}</b> with {p.label}
            {p.last4 ? ` •••• ${p.last4}` : ""}
          </p>
          {p.note && <p className="mt-1 text-xs text-muted">For: {p.note}</p>}
          {(p.budgetLeft !== null || p.dailyLeft !== null || p.limit) && (
            <p className="mt-1 text-[11px] text-faint">
              {p.limit ? `Max per payment ${fmt(p.limit)}` : ""}
              {p.budgetLeft !== null ? `${p.limit ? " · " : ""}Budget left ${fmt(p.budgetLeft)}` : ""}
              {p.dailyLeft !== null ? ` · Left today ${fmt(p.dailyLeft)}` : ""}
            </p>
          )}
          {p.mismatch && p.detected !== null && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md border border-red-400/40 bg-red-400/10 px-2 py-1.5 text-xs text-red-300">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              The page shows {fmt(p.detected)}, which is more than the {fmt(p.amount)} the agent says. Check the cart before you approve.
            </p>
          )}
          {p.tainted && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md border border-red-400/40 bg-red-400/10 px-2 py-1.5 text-xs text-red-300">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              Something the agent read online tried to give it instructions. Only approve if you asked for this payment.
            </p>
          )}
          {p.detected === null && (
            <p className="mt-2 text-[11px] text-faint">The page total could not be read, so this amount is what the agent says.</p>
          )}
          {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
          <div className="mt-3 flex gap-2">
            <button
              disabled={busy === p.id}
              onClick={() => answer(p.id, true)}
              className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-medium text-bg disabled:opacity-50"
            >
              Approve {fmt(p.amount)}
            </button>
            <button
              disabled={busy === p.id}
              onClick={() => answer(p.id, false)}
              className="flex-1 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
