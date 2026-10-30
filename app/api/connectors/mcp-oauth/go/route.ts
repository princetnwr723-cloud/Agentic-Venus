import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { oauthResultPage } from "@/lib/oauth-result";

export const runtime = "nodejs";

/**
 * The Connect button in the chat points here. The one-time id (n) was made by the server when the agent asked to
 * connect a service; the real sign-in address is read from the database. A card that was made up by anyone else
 * has no valid id, so it can not send the owner to a different site.
 * If something is wrong the reason is WRITTEN ON THE PAGE (it no longer silently sends you back to the dashboard).
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const uid = q.get("u") || "";
  const n = q.get("n") || "";
  const stop = (message: string) => oauthResultPage(req, false, message);
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid) || !/^[a-f0-9]{36}$/.test(n)) return stop("This sign-in link is not valid (the card is damaged). Ask the agent to connect it again.");
  try {
    const snap = await getAdminDb().collection("users").doc(uid).collection("connectLinks").doc(n).get();
    if (!snap.exists) return stop("This sign-in link was not found. It is only valid for 10 minutes and for one use. Ask the agent to connect it again.");
    const d = snap.data() as { authUrl?: string; expiresAt?: number } | undefined;
    if (!d?.authUrl) return stop("This sign-in link is empty. Ask the agent to connect it again.");
    if (!d.expiresAt || d.expiresAt < Date.now()) return stop("This sign-in link expired (10 minutes). Ask the agent to connect it again.");
    const target = new URL(d.authUrl);
    if (target.protocol !== "https:") return stop("This sign-in link is not valid. Ask the agent to connect it again.");
    return NextResponse.redirect(target, 302);
  } catch (e) { return stop(`Could not open the sign-in page: ${e instanceof Error ? e.message : "unknown error"}. Ask the agent to connect it again.`); }
}
