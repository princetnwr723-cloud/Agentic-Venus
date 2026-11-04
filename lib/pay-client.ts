"use client";

// One shared store for payment approvals, used by the inline chat card AND the top banner.
// It polls the server only while something is on screen that needs it (one poller, not one per component).
// An agent can only ASK to pay; the answer (Allow / Deny) is sent from here, signed in as YOU.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth-context";
import type { PayProduct } from "@/lib/pay-product";

export type PendingPay = {
  id: string;
  chatId: string;
  label: string;
  last4: string;
  brand: string;
  host: string;
  amount: number;
  detected: number | null;
  mismatch: boolean;
  note: string;
  pitch: string;
  tainted: boolean;
  product: PayProduct | null;
  hasImage: boolean;
  createdAt: number;
  expiresAt: number;
  limit: number | null;
  budgetLeft: number | null;
  dailyLeft: number | null;
};
export type Resolved = { id: string; chatId: string; ok: boolean; host: string; amount: number; product: PayProduct | null; at: number };

type State = { items: PendingPay[]; resolved: Resolved[]; busy: string; err: string };

let state: State = { items: [], resolved: [], busy: "", err: "" };
const subs = new Set<() => void>();
const inline = new Map<string, number>();
const images = new Map<string, string>();
let getToken: (() => Promise<string>) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

const set = (p: Partial<State>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};

async function call(action: string, extra: Record<string, unknown> = {}) {
  if (!getToken) throw new Error("Not signed in.");
  const res = await fetch("/api/vpassword", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await getToken()) },
    body: JSON.stringify({ action, ...extra }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || "Request failed.");
  return d;
}

async function refresh() {
  try {
    const d = await call("pending_payments");
    set({ items: Array.isArray(d.payments) ? (d.payments as PendingPay[]) : [] });
  } catch {
    /* try again on the next tick */
  }
}

function loop() {
  if (running) return;
  running = true;
  const tick = async () => {
    if (!subs.size || !getToken) { running = false; return; }
    if (typeof document === "undefined" || document.visibilityState === "visible") await refresh();
    timer = setTimeout(tick, 4000);
  };
  void tick();
}

function subscribe(f: () => void) {
  subs.add(f);
  loop();
  return () => {
    subs.delete(f);
    if (!subs.size) { running = false; if (timer) clearTimeout(timer); }
  };
}

export async function answerPayment(id: string, ok: boolean) {
  const p = state.items.find((x) => x.id === id);
  set({ busy: id, err: "" });
  try {
    await call(ok ? "approve_payment" : "deny_payment", { id });
    const done: Resolved = { id, chatId: p?.chatId ?? "", ok, host: p?.host ?? "", amount: p?.amount ?? 0, product: p?.product ?? null, at: Date.now() };
    set({ items: state.items.filter((x) => x.id !== id), resolved: [...state.resolved, done], busy: "" });
    setTimeout(() => set({ resolved: state.resolved.filter((r) => r.id !== id) }), 8000);
  } catch (e) {
    set({ busy: "", err: e instanceof Error ? e.message : "Could not answer." });
    void refresh();
  }
}

/** The product picture is fetched once per payment (it is too big to poll). */
export async function loadPayImage(id: string): Promise<string> {
  const hit = images.get(id);
  if (hit !== undefined) return hit;
  try {
    const d = await call("payment_image", { id });
    const img = typeof d.image === "string" ? d.image : "";
    images.set(id, img);
    return img;
  } catch {
    return "";
  }
}

const getState = () => state;

export function usePayments(): State {
  const { user } = useAuth();
  const ref = useRef(user);
  ref.current = user;
  useEffect(() => {
    if (!user) return;
    getToken = async () => (ref.current ? ref.current.getIdToken() : "");
    loop();
  }, [user]);
  const s = useSyncExternalStore(subscribe, getState, getState);
  return user ? s : { items: [], resolved: [], busy: "", err: "" };
}

/** The chat shows its own payment cards; while it does, the top banner stays out of the way for that chat. */
export function useInlineMount(chatId: string | undefined) {
  useEffect(() => {
    if (!chatId) return;
    inline.set(chatId, (inline.get(chatId) ?? 0) + 1);
    set({}); // new snapshot, so the banner re-checks
    return () => {
      const n = (inline.get(chatId) ?? 1) - 1;
      if (n <= 0) inline.delete(chatId); else inline.set(chatId, n);
      set({});
    };
  }, [chatId]);
}
export const hasInline = (chatId: string) => inline.has(chatId);