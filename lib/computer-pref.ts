// Server-only. Which computer does a SERVER-side job use (a routine, a scheduled task, a background agent, Venus Pro / Code
// started with the app closed)? The user's own computer (phone or PC) first, the cloud (E2B) computer when that one is offline.
// The choice lives here, in ONE place: lib/vault.ts calls pickComputerKey() whenever the saved "e2b" secret is opened.
import { getAdminDb } from "@/lib/firebase-admin";
import { isDeviceId, isLocalKey, makeLocalKey } from "@/lib/local-relay-core";
import { decide, normPref, pickDevice, WAIT_MS, type PcPref } from "@/lib/computer-pref-core";

export type LocalDevice = { id: string; name: string; platform: string; lastSeen: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const userRef = (uid: string) => getAdminDb().collection("users").doc(uid);

export async function listLocalDevices(uid: string): Promise<LocalDevice[]> {
  const snap = await getAdminDb().collection("localDevices").where("uid", "==", uid).get();
  return snap.docs
    .filter((d: FirebaseFirestore.QueryDocumentSnapshot) => isDeviceId(d.id))
    .map((d: FirebaseFirestore.QueryDocumentSnapshot) => {
      const x = d.data() as { name?: string; platform?: string; lastSeen?: number };
      return { id: d.id, name: String(x.name ?? "My computer"), platform: String(x.platform ?? ""), lastSeen: Number(x.lastSeen) || 0 };
    })
    .sort((a: LocalDevice, b: LocalDevice) => b.lastSeen - a.lastSeen);
}

async function lastSeenOf(deviceId: string): Promise<number> {
  const d = (await getAdminDb().collection("localDevices").doc(deviceId).get()).data() as { lastSeen?: number } | undefined;
  return Number(d?.lastSeen) || 0;
}

export async function readPref(uid: string): Promise<{ pref: PcPref; deviceId: string | null }> {
  const d = (await userRef(uid).get()).data() as { pcPref?: unknown; pcDeviceId?: unknown } | undefined;
  return { pref: normPref(d?.pcPref), deviceId: isDeviceId(d?.pcDeviceId) ? (d?.pcDeviceId as string) : null };
}

/** Saves the owner's choice. The device must belong to the account. */
export async function setPref(uid: string, pref: PcPref, deviceId?: string | null): Promise<void> {
  const patch: Record<string, unknown> = { pcPref: normPref(pref) };
  if (deviceId) {
    if (!isDeviceId(deviceId) || !(await listLocalDevices(uid)).some((d) => d.id === deviceId)) throw new Error("This computer does not belong to your account.");
    patch.pcDeviceId = deviceId;
  }
  await userRef(uid).set(patch, { merge: true });
}

export const NO_COMPUTER = "No computer is available: open the AgenticVenus app on your phone or PC and set up the computer, or add an E2B key in Settings.";

/**
 * `stored` = what the vault holds under "e2b" (a real E2B key, a local key, or null when nothing is saved).
 * Returns the key every server-side computer call must use. Never returns a key that is certainly wrong: when the own computer is
 * offline and a cloud key exists, the cloud key is used (unless the owner chose "local only").
 */
export async function pickComputerKey(uid: string, stored: string | null): Promise<string> {
  const cloud = stored && !isLocalKey(stored) ? stored : null;
  try {
    const [{ pref, deviceId }, devs] = await Promise.all([readPref(uid), listLocalDevices(uid)]);
    let dev = pickDevice(devs, deviceId);
    const hasCloud = Boolean(cloud);
    let v = decide({ pref, hasCloud, dev, now: Date.now() });
    if (v === "wait" && dev) {
      const end = Date.now() + WAIT_MS;
      while (Date.now() < end) {
        await sleep(1_500);
        dev = { ...dev, lastSeen: await lastSeenOf(dev.id) };
        if (decide({ pref, hasCloud, dev, now: Date.now() }) !== "wait") break;
      }
      v = decide({ pref, hasCloud, dev, now: Date.now(), waited: true });
    }
    if (v === "local" && dev) return makeLocalKey(dev.id);
    if (v === "cloud" && cloud) return cloud;
  } catch { /* the database did not answer: use what is stored */ }
  if (stored) return stored;
  throw new Error(NO_COMPUTER);
}