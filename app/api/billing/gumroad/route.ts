import { NextResponse } from "next/server";
import {
  activatePlan, endPlan, fetchProduct, fetchSale, fetchSubscriber, logEvent, markCancelled, planOfSlugs,
  safeEq, saveUnclaimed, uidByKey, verifyCheckout,
} from "@/lib/billing-server";
import type { PlanId } from "@/lib/plans";

export const runtime = "nodejs";
export const maxDuration = 30;

const DAY = 86_400_000;
const ok = () => new NextResponse("ok", { status: 200 });

// Gumroad "Ping" endpoint. The secret in the URL (?s=...) keeps strangers out; every sale is
// then re-checked with Gumroad's API, so a forged request cannot give anybody a plan.
export async function POST(req: Request) {
  const secret = (process.env.GUMROAD_PING_SECRET || "").trim();
  const given = (new URL(req.url).searchParams.get("s") || "").trim();
  if (secret.length < 16 || !safeEq(given, secret)) {
    await logEvent("ping_rejected", { why: secret.length < 16 ? "GUMROAD_PING_SECRET missing or too short on the server" : "secret in the ping URL does not match" });
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const form = await req.formData();
    const get = (k: string) => String(form.get(k) ?? "");
    const resource = get("resource_name") || "sale";

    if (resource === "sale") {
      const saleId = get("sale_id") || get("id");
      if (!saleId) return ok();
      const sale = await fetchSale(saleId);
      if (sale.refunded || sale.chargebacked || sale.disputed) return ok();

      // Gumroad names the product in several ways: try all of them, then ask Gumroad for the product itself.
      const names = [sale.product_permalink, sale.permalink, sale.short_product_id, get("product_permalink"), get("permalink"), get("short_product_id")];
      let plan: PlanId | null = planOfSlugs(names);
      let product: Record<string, any> | null = null;
      if (!plan && sale.product_id) {
        product = await fetchProduct(String(sale.product_id)).catch(() => null);
        if (product) plan = planOfSlugs([product.custom_permalink, product.short_url, product.url, product.id]);
      }
      if (!plan) {
        await logEvent("unknown_product", { saleId, names, productName: sale.product_name, custom: product?.custom_permalink, shortUrl: product?.short_url });
        return ok();
      }

      const uid = get("url_params[uid]");
      const sig = get("url_params[sig]");
      const asked = get("url_params[plan]");
      if (!uid || asked !== plan || !verifyCheckout(uid, plan, sig)) {
        // paid, but not through our signed checkout link: keep it for a manual check
        await saveUnclaimed(saleId, { plan, email: sale.email, subscriptionId: sale.subscription_id, gotUid: Boolean(uid), askedPlan: asked });
        await logEvent("unclaimed", { saleId, plan, gotUid: Boolean(uid), askedPlan: asked });
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