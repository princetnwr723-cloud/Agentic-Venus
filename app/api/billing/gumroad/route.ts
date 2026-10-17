import { NextResponse } from "next/server";
import {
  activatePlan, endPlan, fetchSale, fetchSubscriber, logEvent, markCancelled, planOfPermalink,
  safeEq, saveUnclaimed, uidByKey, verifyCheckout,
} from "@/lib/billing-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const DAY = 86_400_000;
const ok = () => new NextResponse("ok", { status: 200 });

// Gumroad "Ping" endpoint. The secret in the URL (?s=...) keeps strangers out; every sale is
// then re-checked with Gumroad's API, so a forged request cannot give anybody a plan.
export async function POST(req: Request) {
  const secret = process.env.GUMROAD_PING_SECRET || "";
  const given = new URL(req.url).searchParams.get("s") || "";
  if (secret.length < 16 || !safeEq(given, secret)) return new NextResponse("Forbidden", { status: 403 });

  try {
    const form = await req.formData();
    const get = (k: string) => String(form.get(k) ?? "");
    const resource = get("resource_name") || "sale";

    if (resource === "sale") {
      const saleId = get("sale_id") || get("id");
      if (!saleId) return ok();
      const sale = await fetchSale(saleId);
      if (sale.refunded || sale.chargebacked || sale.disputed) return ok();

      const plan = planOfPermalink(String(sale.product_permalink ?? get("product_permalink") ?? get("permalink")));
      if (!plan) {
        await logEvent("unknown_product", { saleId, permalink: sale.product_permalink });
        return ok();
      }

      const uid = get("url_params[uid]");
      const sig = get("url_params[sig]");
      const asked = get("url_params[plan]");
      if (!uid || asked !== plan || !verifyCheckout(uid, plan, sig)) {
        // paid, but not through our signed checkout link: keep it for a manual check
        await saveUnclaimed(saleId, { plan, email: sale.email, subscriptionId: sale.subscription_id });
        await logEvent("unclaimed", { saleId, plan });
        return ok();
      }

      const yearly = /year/i.test(String(sale.recurrence ?? get("recurrence")));
      await activatePlan(uid, plan, {
        subscriptionId: sale.subscription_id ? String(sale.subscription_id) : undefined,
        saleId,
        email: String(sale.email ?? ""),
        periodMs: (yearly ? 366 : 31) * DAY,
        at: Date.parse(String(sale.created_at ?? "")) || Date.now(),
      });
      return ok();
    }

    if (resource === "refunded" || resource === "dispute") {
      const saleId = get("sale_id") || get("id");
      const sale = await fetchSale(saleId);
      if (!(sale.refunded || sale.chargebacked || sale.disputed)) return ok();
      const hit = (await uidByKey(String(sale.subscription_id ?? ""))) ?? (await uidByKey(saleId));
      if (hit) await endPlan(hit.uid, resource);
      return ok();
    }

    const subId = get("subscription_id") || get("id");
    if (!subId) return ok();
    const hit = await uidByKey(subId);
    if (!hit) {
      await logEvent("unknown_subscription", { subId, resource });
      return ok();
    }

    if (resource === "cancellation") {
      await fetchSubscriber(subId); // confirms the subscription really exists
      await markCancelled(hit.uid);
    } else if (resource === "subscription_ended") {
      const s = await fetchSubscriber(subId);
      if (s.ended_at || s.cancelled_at || ["ended", "cancelled", "failed_payment", "fully_refunded"].includes(String(s.status))) await endPlan(hit.uid, "subscription_ended");
    } else if (resource === "subscription_restarted") {
      const s = await fetchSubscriber(subId);
      if (!s.ended_at) await activatePlan(hit.uid, hit.plan, { subscriptionId: subId, periodMs: 31 * DAY, at: Date.now() });
    }
    return ok();
  } catch (e) {
    await logEvent("error", { message: e instanceof Error ? e.message.slice(0, 200) : "failed" });
    return new NextResponse("error", { status: 500 }); // Gumroad retries later
  }
}
