import { getAdminDb } from "@/lib/firebase-admin";

export type IdentityLogEntry = { kind: "created" | "mail" | "otp" | "used"; site: string; text: string; chatId: string };

/** Where the agent's email was used / what arrived. Written only by the server. */
export async function identityLog(uid: string, e: IdentityLogEntry) {
  try {
    await getAdminDb().collection("users").doc(uid).collection("identityLog").add({ at: Date.now(), ...e, site: e.site.slice(0, 80), text: e.text.slice(0, 300) });
  } catch { /* logging must never break the action */ }
}