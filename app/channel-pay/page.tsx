"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";
type Status = { enabled: boolean; maxPerPayment: number; lockedUntil: number };

export default function ChannelPayPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [pin, setPin] = useState("");
  const [cap, setCap] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const res = await fetch("/api/channel-pay", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user!.getIdToken()) },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error || "Request failed.");
    return d as Status;
  }, [user]);

  useEffect(() => {
    if (!user) return;
    call("status").then((d) => { setSt(d); setCap(d.maxPerPayment ? String(d.maxPerPayment) : ""); }).catch((e) => setMsg(e.message));
  }, [user, call]);

  const run = async (action: "set" | "clear") => {
    setBusy(true); setMsg("");
    try {
      const d = await call(action, action === "set" ? { pin, maxPerPayment: Number(cap) || 0 } : {});
      setSt(d); setPin("");
      setMsg(action === "set" ? "Saved. Ab chat se payment approve ho sakta hai." : "Chat se payment band kar diya.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
    setBusy(false);
  };

  if (loading || !user) return null;
  const locked = (st?.lockedUntil ?? 0) > Date.now();
  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <button onClick={() => router.push("/vpassword")} className="flex items-center gap-1 text-sm text-faint hover:text-ink"><ArrowLeft size={16} /> vPassword</button>
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink"><ShieldCheck size={20} /> Payments from chat apps</h1>
      <p className="text-sm text-faint">
        Telegram, WhatsApp ya Slack se card payment approve karne ke liye ek PIN set karo. Agent jab pay karna chahega, chat me amount, site aur card
        dikhega; tum PIN bhejke approve karte ho. Card ki limit, budget aur site ka rule pehle jaisa hi lagta hai. 5 galat PIN pe payments 30 minute ke liye lock ho jate hain.
      </p>
      <p className="rounded-lg border border-line p-3 text-sm text-ink">
        Status: <b>{st?.enabled ? "ON" : "OFF"}</b>{locked ? " (abhi galat PIN ki wajah se lock hai)" : ""}
        {st?.enabled && st.maxPerPayment ? ` · chat se max ${st.maxPerPayment} per payment` : ""}
      </p>
      <label className="block text-sm text-ink">PIN (4-8 digit, 1234 ya 1111 jaisa nahi)
        <input className={input} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} />
      </label>
      <label className="block text-sm text-ink">Chat se ek payment ka max amount (khali = sirf card ki apni limit)
        <input className={input} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))} />
      </label>
      <div className="flex gap-2">
        <button disabled={busy || pin.length < 4} onClick={() => run("set")} className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-black disabled:opacity-50">{st?.enabled ? "PIN badlo" : "ON karo"}</button>
        {st?.enabled && <button disabled={busy} onClick={() => run("clear")} className="rounded-lg border border-line px-4 py-2 text-sm text-ink disabled:opacity-50">OFF karo</button>}
      </div>
      {msg && <p className="text-sm text-ink">{msg}</p>}
      <p className="text-xs text-faint">Note: WhatsApp/SMS/Slack me PIN wala message delete nahi hota. Telegram me bot use turant delete kar deta hai. Bade amounts ke liye cap rakho.</p>
    </main>
  );
}