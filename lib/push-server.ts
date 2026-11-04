// Server-only. Android app push (Firebase Cloud Messaging) and the list of the owner's phones.
import { createHash } from "crypto";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminDb } from "@/lib/firebase-admin";

export type Device = { token: string; platform: "android"; name: string; appVersion: string; lastSeen: number };

const MAX_DEVICES = 5;
const devicesOf = (uid: string) => getAdminDb().collection("users").doc(uid).collection("devices");
const idOf = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 40);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Saves a phone. A token belongs to ONE account: if another account had it, it is moved (so a logged-out phone stops getting the old account's alerts). */
export async function registerDevice(uid: string, token: string, name: string, appVersion: string) {
  const db = getAdminDb();
  const id = idOf(token);
  const map = db.collection("pushTokens").doc(id);
  const prev = (await map.get()).data() as { uid?: string } | undefined;
  if (prev?.uid && prev.uid !== uid) await devicesOf(prev.uid).doc(id).delete().catch(() => {});

  const dev: Device = {
    token, platform: "android", name: clip(name || "Android", 80), appVersion: clip(appVersion || "", 20), lastSeen: Date.now(),
  };
  await devicesOf(uid).doc(id).set(dev);
  await map.set({ uid, at: Date.now() });

  const all = await devicesOf(uid).get();
  if (all.size > MAX_DEVICES) {
    const oldest = all.docs
      .map((d) => ({ d, t: Number((d.data() as Partial<Device>).lastSeen ?? 0) }))
      .sort((a, b) => a.t - b.t)
      .slice(0, all.size - MAX_DEVICES);
    for (const o of oldest) {
      await o.d.ref.delete().catch(() => {});
      await db.collection("pushTokens").doc(o.d.id).delete().catch(() => {});
    }
  }
  return id;
}

export async function removeDevice(uid: string, token: string) {
  const id = idOf(token);
  await devicesOf(uid).doc(id).delete().catch(() => {});
  await getAdminDb().collection("pushTokens").doc(id).delete().catch(() => {});
}

/** For a settings screen: never returns the tokens. */
export async function listDevices(uid: string) {
  const s = await devicesOf(uid).get();
  return s.docs.map((d) => {
    const v = d.data() as Partial<Device>;
    return { id: d.id, name: v.name ?? "Android", appVersion: v.appVersion ?? "", lastSeen: v.lastSeen ?? 0 };
  });
}

/** "✅ Task name\n\nresult..." -> title + body. */
function shape(text: string) {
  const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`#>]/g, "");
  const lines = plain.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines[0].length <= 90) return { title: lines[0], body: clip(lines.slice(1).join(" "), 400) };
  return { title: "Agentic Venus", body: clip(lines.join(" ") || "New update", 400) };
}

/** Sends a push to every phone of the owner. Returns how many were delivered to FCM. Bad tokens are removed. */
export async function pushToOwner(uid: string, chatId: string, text: string): Promise<number> {
  const docs = (await devicesOf(uid).get()).docs.filter((d) => Boolean((d.data() as Partial<Device>).token));
  if (!docs.length) return 0;

  const { title, body } = shape(text);
  const kind = /^(⏸️|🔐)|approv|payment/i.test(text) ? "needs_you" : "update";
  const url = `/dashboard?chat=${encodeURIComponent(chatId)}`;

  getAdminDb(); // makes sure the admin app exists
  const res = await getMessaging().sendEach(
    docs.map((d) => ({
      token: (d.data() as Device).token,
      notification: { title, body },
      data: { chatId, kind, url },
      android: { priority: "high" as const, ttl: 6 * 3600 * 1000, notification: { channelId: "venus_alerts" } },
    }))
  );

  let ok = 0;
  await Promise.all(
    res.responses.map(async (r, i) => {
      if (r.success) { ok++; return; }
      const code = r.error?.code ?? "";
      if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) {
        await docs[i].ref.delete().catch(() => {});
        await getAdminDb().collection("pushTokens").doc(docs[i].id).delete().catch(() => {});
      }
    })
  );
  return ok;
}