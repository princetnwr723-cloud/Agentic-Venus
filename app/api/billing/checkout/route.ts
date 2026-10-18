
import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { authFromRequest } from "@/lib/job-token";
import {
  checkoutLink,
  signCheckout,
} from "@/lib/billing-server";
import { isPaid } from "@/lib/plans";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: Request) {
  try {
    const b = await readBody(req, {
      maxBytes: 4 * 1024,
    });

    // Get the real, authenticated Firebase user.
    // Never trust a uid supplied by the client.
    const { uid } = await authFromRequest(req);

    const plan = String(b.plan || "");

    if (!isPaid(plan)) {
      return NextResponse.json(
        { error: "Pick a paid plan." },
        { status: 400 }
      );
    }

    const link = checkoutLink(plan);

    if (!link) {
      return NextResponse.json(
        {
          error: `The Gumroad link for "${plan}" is not set up yet (GUMROAD_LINKS).`,
        },
        { status: 503 }
      );
    }

    const checkoutUrl = new URL(link);

    checkoutUrl.searchParams.set("wanted", "true");
    checkoutUrl.searchParams.set("uid", uid);
    checkoutUrl.searchParams.set("plan", plan);
    checkoutUrl.searchParams.set(
      "sig",
      signCheckout(uid, plan)
    );

    const email = String(b.email || "").trim();

    if (
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      checkoutUrl.searchParams.set("email", email);
    }

    return NextResponse.json(
      { url: checkoutUrl.toString() },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Checkout failed.",
      },
      {
        status: requestStatus(e),
      }
    );
  }
}
