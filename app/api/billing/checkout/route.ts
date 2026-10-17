import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { checkoutLink, signCheckout } from "@/lib/billing-server";
import { isPaid } from "@/lib/plans";

export const runtime = "nodejs";
export const maxDuration = 15;

// Builds the Gumroad checkout link for this user. uid + signature travel as URL params and come
// back in the Gumroad ping, which is how a payment is tied to the right account.
export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 4 * 1024 });
    const uid = String(b.uid);
    const plan = String(b.plan || "");
    if (!isPaid(plan)) return NextResponse.json({ error: "Pick a paid plan." }, { status: 400 });
    const link = checkoutLink(plan);
    if (!link) return NextResponse.json({ error: `The Gumroad link for "${plan}" is not set up yet (GUMROAD_LINKS).` }, { status: 503 });

    const u = new URL(link);
    u.searchParams.set("wanted", "true");
    u.searchParams.set("uid", uid);
    u.searchParams.set("plan", plan);
    u.searchParams.set("sig", signCheckout(uid, plan));
    const email = String(b.email || "").trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) u.searchParams.set("email", email);
    return NextResponse.json({ url: u.toString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Checkout failed." }, { status: requestStatus(e) });
  }
}
