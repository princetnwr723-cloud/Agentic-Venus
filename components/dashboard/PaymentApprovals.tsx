"use client";

import { hasInline } from "@/lib/pay-client";
import { usePayments } from "@/lib/pay-client";
import { OrderCard } from "@/components/dashboard/PayCard";

/**
 * Payment approvals as a banner at the top of the screen. An agent can only ASK to pay: the request lives on the
 * server, and ONLY you (signed in) can allow it. When the chat of that agent is open, the order card shows inside
 * the chat instead, so this banner only appears for payments of chats you are not looking at.
 */
export default function PaymentApprovals() {
  const { items } = usePayments();
  const shown = items.filter((p) => !hasInline(p.chatId));
  if (!shown.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex max-h-[92vh] flex-col items-center gap-2 overflow-y-auto px-3">
      {shown.map((p) => (
        <div key={p.id} className="pointer-events-auto flex w-full max-w-md justify-center">
          <OrderCard p={p} />
        </div>
      ))}
    </div>
  );
}