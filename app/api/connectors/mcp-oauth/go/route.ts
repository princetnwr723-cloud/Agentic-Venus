import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { appBaseUrl } from "@/lib/voice-server";

export const runtime = "nodejs";

/**
 * The Connect button in the chat points here. The one-time id (n) was made by the server when the agent asked to
 * connect a service; the real sign-in address is read from the database. A card that was made up by anyone else
 * has no valid id, so it can not send the owner to a different site.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const uid = q.get("u") || "";
  const n = q.get("n") || "";
  const back = (message: string) => {
    let base: string;
    try { base = appBaseUrl(req); } catch { base = new URL(req.url).origin; }
    return NextResponse.redirect(new URL(`/dashboard?connector_oauth=error&message=${encodeURIComponent(message)}`, base), 303);
  };
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid) || !/^[a-f0-9]{36}$/.test(n)) return back("This sign-in link is not valid.");
  try {
    const snap = await getAdminDb().collection("users").doc(uid).collection("connectLinks").doc(n).get();
    const d = snap.data() as { authUrl?: string; expiresAt?: number } | undefined;
    if (!d?.authUrl || !d.expiresAt || d.expiresAt < Date.now()) return back("This sign-in link expired. Ask the agent to connect it again.");
    const target = new URL(d.authUrl);
    if (target.protocol !== "https:") return back("This sign-in link is not valid.");
    return NextResponse.redirect(target, 302);
  } catch { return back("Could not open the sign-in page. Ask the agent to connect it again."); }
}
