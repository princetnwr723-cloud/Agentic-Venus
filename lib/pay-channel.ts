// Approve or decline a card payment from a chat app, protected by a PIN.
// Same checks as the app's own approval (card limit, total budget, daily limit, expiry), plus: a PIN, a lock after 5 wrong
// PINs, and an optional cap per payment for chat approvals. The PIN is stored only as a salted scrypt hash, in a
// subcollection of its own (users/{uid}/channelPay/main), with a server-side pepper.
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { checkSpend, type VpMeta } from "@/lib/vpassword";
import { hashPin, lockAfterFail, pinProblem, verifyPin } from "@/lib/channel-commands";

const APPROVED_MS = 10 * 60_000;
const pepper = () => process.env.CHANNEL_PAY_PEPPER || process.env.ROUTINE_RUNNER_SECRET || "";
const userRef = (uid: string) => getAdminDb().collection("users").doc(uid);
const cfgRef = (uid: string) => userRef(uid).collection("channelPay").doc("main");

export type PayRec = {
  id: string; entry: string; label: string; last4: string; chatId: string; host: string; amount: number;
  detected: number | null; mismatch: boolean; note: string; tainted: boolean;
  status: "pending" | "approved" | "denied" | "expired" | "used"; createdAt: number; expiresAt: number; chNotified?: boolean;
};
export type ChannelPay = { salt?: string; hash?: string; enabled?: boolean; maxPerPayment?: number; fails?: number; lockedUntil?: number };

export async function getChannelPay(uid: string): Promise<ChannelPay> {
  return ((await cfgRef(uid).get()).data() ?? {}) as ChannelPay;
}
export const payEnabled = (c: ChannelPay) => Boolean(c.enabled && c.salt && c.hash);

/** What the settings page may see: never the salt or the hash. */
export async function channelPayStatus(uid: string) {
  const c = await getChannelPay(uid);
  return { enabled: payEnabled(c), maxPerPayment: c.maxPerPayment ?? 0, lockedUntil: c.lockedUntil ?? 0 };
}

export async function setChannelPay(uid: string, pin: string, maxPerPayment: number) {
  const bad = pinProblem(pin);
  if (bad) throw new Error(bad);
  const { salt, hash } = hashPin(pin, pepper());
  await cfgRef(uid).set({ salt, hash, enabled: true, maxPerPayment: Math.max(0, Math.round(Number(maxPerPayment) || 0)), fails: 0, lockedUntil: 0, updatedAt: Date.now() });
}

export async function clearChannelPay(uid: string) {
  await cfgRef(uid).delete();
}

export async function pendingPayments(uid: string): Promise<PayRec[]> {
  const snap = await userRef(uid).collection("vpay").where("status", "==", "pending").get();
  const now = Date.now();
  return snap.docs.map((d) => d.data() as PayRec).filter((p) => p.expiresAt > now).sort((a, b) => a.createdAt - b.createdAt);
}

export function describePay(p: PayRec): string {
  return [
    "💳 Payment approval chahiye",
    `${p.amount} • ${p.host}`,
    `Card: ${p.label}${p.last4 ? ` •••• ${p.last4}` : ""}`,
    p.note ? `Note: ${p.note}` : "",
    p.mismatch ? "⚠️ Page ka total is amount se match nahi karta — dhyan se dekho." : "",
    p.tainted ? "⚠️ Agent ne aisa content padha jisme use instructions diye gaye the." : "",
  ].filter(Boolean).join("\n");
}

export async function approvePayment(uid: string, id: string, pin: string): Promise<{ ok: boolean; msg: string }> {
  const cfg = await getChannelPay(uid);
  if (!payEnabled(cfg)) return { ok: false, msg: "Chat se payment abhi band hai. App me /channel-pay page par PIN set karke ON karo." };
  const now = Date.now();
  if ((cfg.lockedUntil ?? 0) > now) return { ok: false, msg: `Bahut galat PIN. ${Math.ceil(((cfg.lockedUntil ?? 0) - now) / 60_000)} minute baad try karo.` };
  if (!verifyPin(pin, cfg.salt as string, cfg.hash as string, pepper())) {
    const l = lockAfterFail(cfg.fails ?? 0, now);
    await cfgRef(uid).set({ fails: l.fails, lockedUntil: l.lockedUntil }, { merge: true });
    return { ok: false, msg: l.lockedUntil ? "5 galat PIN: chat se payments 30 minute ke liye lock ho gaye." : "PIN galat hai. Payment approve nahi hua." };
  }
  if (cfg.fails) await cfgRef(uid).set({ fails: 0, lockedUntil: 0 }, { merge: true });

  const u = userRef(uid), pays = u.collection("vpay"), entries = u.collection("vpass");
  try {
    const p = await getAdminDb().runTransaction(async (tx) => {
      const ps = await tx.get(pays.doc(id));
      if (!ps.exists) throw new Error("Ye payment request ab maujood nahi hai.");
      const pd = ps.data() as PayRec;
      if (pd.status !== "pending") throw new Error(`Ye payment pehle hi answer ho chuka hai (${pd.status}).`);
      if (now > pd.expiresAt) throw new Error("Ye payment request expire ho gayi. Agent se dobara try karne bolo.");
      if (cfg.maxPerPayment && pd.amount > cfg.maxPerPayment) throw new Error(`Chat se sirf ${cfg.maxPerPayment} tak ke payments approve hote hain. Ye ${pd.amount} ka hai — app me approve karo.`);
      const es = await tx.get(entries.doc(pd.entry));
      if (!es.exists) throw new Error("Wo card delete ho chuka hai.");
      const chk = checkSpend(es.data() as VpMeta, pd.amount);
      if (!chk.ok) throw new Error(chk.error + " vPassword me limit badhao agar sach me chahiye.");
      tx.update(pays.doc(id), { status: "approved", approvedAt: now, approvedUntil: now + APPROVED_MS });
      return pd;
    });
    await u.collection("vplog").add({ at: Date.now(), entry: p.entry, label: p.label, site: p.host, chatId: p.chatId, what: `payment of ${p.amount} APPROVED from chat (PIN)` }).catch(() => {});
    return { ok: true, msg: `✅ ${p.amount} ka payment approve ho gaya (${p.host}). Agent ab pay karega.` };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : "Approve nahi ho paya." };
  }
}

export async function denyPayment(uid: string, id: string): Promise<{ ok: boolean; msg: string }> {
  const u = userRef(uid);
  const snap = await u.collection("vpay").doc(id).get();
  if (!snap.exists) return { ok: false, msg: "Ye payment request ab maujood nahi hai." };
  const p = snap.data() as PayRec;
  if (p.status === "pending" || p.status === "approved") {
    await snap.ref.update({ status: "denied" });
    await u.collection("vplog").add({ at: Date.now(), entry: p.entry, label: p.label, site: p.host, chatId: p.chatId, what: `payment of ${p.amount} DECLINED from chat` }).catch(() => {});
  }
  return { ok: true, msg: `❌ ${p.amount} ka payment mana kar diya (${p.host}).` };
}

export { FieldValue };