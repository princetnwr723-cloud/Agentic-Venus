// Server-only. The owner's "About" details (name, mobile number, company ...). Stored at users/{uid}/profile/about.
// The browser never touches this document directly (firestore.rules deny it): the page uses /api/profile and the agent uses the profile.* tools.
import { getAdminDb } from "@/lib/firebase-admin";
import { audit } from "@/lib/audit";

export const PROFILE_TEXT = ["name", "phone", "company", "role", "location", "website", "bio"] as const;
export type ProfileField = (typeof PROFILE_TEXT)[number];
export type Profile = Record<ProfileField, string> & { theme?: "dark" | "light"; themeAt?: number; updatedAt?: number };

const MAX: Record<ProfileField, number> = { name: 80, phone: 24, company: 80, role: 80, location: 80, website: 200, bio: 600 };
export const emptyProfile = (): Profile => ({ name: "", phone: "", company: "", role: "", location: "", website: "", bio: "" });

const ref = (uid: string) => getAdminDb().collection("users").doc(uid).collection("profile").doc("about");
// eslint-disable-next-line no-control-regex
const tidy = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** Checks one field. Returns the cleaned value or throws an Error that tells the owner what is wrong. */
export function cleanField(field: ProfileField, raw: unknown): string {
  const v = field === "bio" ? String(raw ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, MAX.bio) : tidy(raw, MAX[field]);
  if (!v) return "";
  if (field === "phone" && !/^\+?[0-9][0-9 ()\-]{5,22}$/.test(v)) throw new Error("The mobile number looks wrong. Use digits, spaces, + ( ) or - (for example +91 98765 43210).");
  if (field === "website") {
    const url = /^https?:\/\//i.test(v) ? v : "https://" + v;
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new Error("x"); return u.toString().replace(/\/$/, ""); }
    catch { throw new Error("The website address looks wrong (example: https://example.com)."); }
  }
  return v;
}

export async function getProfile(uid: string): Promise<Profile> {
  const d = ((await ref(uid).get()).data() ?? {}) as Partial<Profile>;
  const p = emptyProfile();
  for (const f of PROFILE_TEXT) p[f] = typeof d[f] === "string" ? (d[f] as string) : "";
  if (d.theme === "dark" || d.theme === "light") { p.theme = d.theme; p.themeAt = Number(d.themeAt) || 0; }
  if (d.updatedAt) p.updatedAt = Number(d.updatedAt);
  return p;
}

/** Saves only the fields that are given (a field set to "" clears it). */
export async function saveProfile(uid: string, patch: Partial<Record<ProfileField, unknown>> & { theme?: unknown }): Promise<Profile> {
  const out: Record<string, unknown> = {};
  for (const f of PROFILE_TEXT) if (f in patch && patch[f] !== undefined) out[f] = cleanField(f, patch[f]);
  if (patch.theme !== undefined) {
    const t = String(patch.theme).toLowerCase();
    const theme = /^(dark|night)/.test(t) ? "dark" : /^light|^day/.test(t) ? "light" : "";
    if (!theme) throw new Error('theme must be "dark" (Night mode) or "light" (Light mode).');
    out.theme = theme; out.themeAt = Date.now();
  }
  if (!Object.keys(out).length) throw new Error("Nothing to change: give at least one of name, phone, company, role, location, website, bio, theme.");
  out.updatedAt = Date.now();
  await ref(uid).set(out, { merge: true });
  await audit(uid, { kind: "profile_update", text: "fields: " + Object.keys(out).filter((k) => k !== "updatedAt" && k !== "themeAt").join(", ") });
  return getProfile(uid);
}