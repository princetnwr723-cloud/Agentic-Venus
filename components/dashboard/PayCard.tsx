"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clock, CreditCard, Loader2, ShieldAlert, ShoppingCart, Star, X } from "lucide-react";
import {
  answerPayment, loadPayImage, useInlineMount, usePayments,
  type PendingPay, type Resolved,
} from "@/lib/pay-client";
import { dealWarning, money, pitchFor, savingsPct } from "@/lib/pay-product";

const left = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-400/40 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
      <ShieldAlert size={14} className="mt-0.5 shrink-0" /> <span>{children}</span>
    </p>
  );
}

function Thumb({ p }: { p: PendingPay }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let dead = false;
    if (p.hasImage) loadPayImage(p.id).then((u) => { if (!dead) setSrc(u); });
    return () => { dead = true; };
  }, [p.id, p.hasImage]);
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-bg">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={p.product?.name || "Product"} className="h-full w-full object-cover" />
      ) : p.hasImage ? (
        <div className="h-full w-full animate-pulse bg-panel2" />
      ) : (
        <ShoppingCart size={22} className="text-faint" />
      )}
    </div>
  );
}

/** The order card: the product as it is on the page, the card that pays, the total, and Allow / Deny. */
export function OrderCard({ p, agent = "Your agent" }: { p: PendingPay; agent?: string }) {
  const { busy, err } = usePayments();
  const now = useNow(true);
  const pr = p.product;
  const cur = pr?.currency ?? "";
  const pct = savingsPct(pr);
  const deal = dealWarning(pr);
  const working = busy === p.id;
  return (
    <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-4 shadow-xl" role="group" aria-label={`Order approval on ${p.host}`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <ShoppingCart size={18} className="shrink-0" />
        <span className="min-w-0 break-words">{agent} wants to place an order at {p.host}</span>
      </p>

      {pr && (pr.name || p.hasImage) && (
        <div className="mt-3 flex gap-3 rounded-xl bg-panel2 p-3">
          <Thumb p={p} />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-semibold text-ink">{pr.name || "Item in the cart"}</p>
            {(pr.variant || pr.brand) && <p className="mt-0.5 truncate text-xs text-muted">{[pr.brand, pr.variant].filter(Boolean).join(" · ")}</p>}
            {pr.rating !== null && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                <Star size={12} className="fill-gold text-gold" /> {pr.rating}
                {pr.reviews ? <span className="text-faint">({pr.reviews.toLocaleString()} reviews)</span> : null}
              </p>
            )}
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-lg font-semibold text-ink">{money(pr.price ?? p.amount, cur)}</span>
              {pr.was ? <span className="text-xs text-faint line-through">{money(pr.was, cur)}</span> : null}
              {pct > 0 && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">SAVE {pct}%</span>}
              {pr.qty > 1 && <span className="text-xs text-muted">× {pr.qty}</span>}
            </p>
          </div>
        </div>
      )}
      {p.note && !pr?.name && <p className="mt-2 text-xs text-muted">For: {p.note}</p>}

      <div className="mt-3 flex items-center gap-3 rounded-xl bg-panel2 px-3 py-2.5">
        <CreditCard size={18} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {p.brand || p.label}{p.last4 ? ` •••• ${p.last4}` : ""}
        </span>
      </div>

      <div className="mt-3 flex items-baseline justify-between px-1">
        <span className="text-sm text-muted">Estimated total</span>
        <span className="text-xl font-semibold text-ink">{money(p.amount, cur)}</span>
      </div>

      {(p.budgetLeft !== null || p.dailyLeft !== null || p.limit) && (
        <p className="mt-1 px-1 text-[11px] text-faint">
          {p.limit ? `Max per payment ${money(p.limit, cur)}` : ""}
          {p.budgetLeft !== null ? `${p.limit ? " · " : ""}Budget left ${money(p.budgetLeft, cur)}` : ""}
          {p.dailyLeft !== null ? ` · Left today ${money(p.dailyLeft, cur)}` : ""}
        </p>
      )}

      {p.mismatch && p.detected !== null && (
        <Warn>The page shows {money(p.detected, cur)}, which is more than the {money(p.amount, cur)} the agent says. Check the cart before you allow.</Warn>
      )}
      {deal && <Warn>{deal}</Warn>}
      {p.tainted && <Warn>Something the agent read online tried to give it instructions. Only allow this if you asked for it.</Warn>}
      {p.detected === null && <p className="mt-2 px-1 text-[11px] text-faint">The page total could not be read, so this amount is what the agent says.</p>}
      {err && <p className="mt-2 px-1 text-xs text-red-300">{err}</p>}

      <button
        type="button"
        disabled={working}
        onClick={() => void answerPayment(p.id, true)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
      >
        {working ? <Loader2 size={16} className="animate-spin" /> : null} Allow {money(p.amount, cur)}
      </button>
      <button
        type="button"
        disabled={working}
        onClick={() => void answerPayment(p.id, false)}
        className="mt-2 w-full rounded-full bg-panel2 px-4 py-3 text-sm font-semibold text-ink transition-colors hover:bg-line disabled:opacity-60"
      >
        Deny
      </button>
      <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-faint">
        <Clock size={11} /> Asks again if you do not answer in {left(p.expiresAt - now)}
      </p>
    </div>
  );
}

function Result({ r, agent }: { r: Resolved; agent: string }) {
  const cur = r.product?.currency ?? "";
  return (
    <div className={`flex max-w-md items-center gap-2 rounded-xl border px-3 py-2 text-sm ${r.ok ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-line bg-panel text-muted"}`}>
      {r.ok ? <Check size={16} className="shrink-0" /> : <X size={16} className="shrink-0" />}
      <span>
        {r.ok
          ? `Allowed ${money(r.amount, cur)} on ${r.host}. ${agent} is paying now.`
          : `Denied ${money(r.amount, cur)} on ${r.host}. Nothing was bought.`}
      </span>
    </div>
  );
}

/** Inside the chat: the agent's message first, then the order card under it. */
export function PayCards({ chatId, agentName }: { chatId?: string; agentName?: string }) {
  useInlineMount(chatId);
  const { items, resolved } = usePayments();
  const agent = agentName || "Your agent";
  const mine = items.filter((x) => x.chatId === chatId);
  const done = resolved.filter((x) => x.chatId === chatId);
  const end = useRef<HTMLDivElement>(null);
  const key = mine.map((x) => x.id).join(",");
  useEffect(() => {
    if (key) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [key]);
  if (!chatId || (!mine.length && !done.length)) return null;
  return (
    <div className="space-y-3">
      {mine.map((p) => (
        <div key={p.id} className="space-y-2">
          <div className="max-w-[85%] rounded-xl border border-line bg-panel2 px-4 py-2.5 text-sm leading-relaxed text-ink">
            {p.pitch || pitchFor(p.product, p.amount, p.host)}
          </div>
          <OrderCard p={p} agent={agent} />
        </div>
      ))}
      {done.map((r) => <Result key={r.id} r={r} agent={agent} />)}
      <div ref={end} />
    </div>
  );
}

export default PayCards;