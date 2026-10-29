import { NextResponse } from "next/server";
import {
  activatePlan, endPlan, fetchSale, fetchSubscriber, isCurrentPlanKey, logEvent, markCancelled, periodOf,
  planOfSale, resolveBuyer, safeEq, saveUnclaimed, uidByKey,
} from "@/lib/billing-server";

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
    await logEvent("ping", { resource, saleId: get("sale_id") || get("id"), fields: Array.from(form.keys()).slice(0, 60) });

    if (resource === "sale") {
      const saleId = get("sale_id") || get("id");
      if (!saleId) return ok();
      const sale = await fetchSale(saleId);
      if (sale.refunded || sale.chargebacked || sale.disputed) return ok();

      const plan = await planOfSale(sale, [get("product_permalink"), get("permalink"), get("short_product_id")]);
      if (!plan) {
        await logEvent("unknown_product", { saleId, productName: sale.product_name, permalink: sale.product_permalink, productId: sale.product_id });
        return ok();
      }

      // our link parameters can arrive as url_params[uid] or as a JSON string; also look inside the sale itself
      let blob: Record<string, any> = {};
      try { blob = JSON.parse(get("url_params") || "{}") ?? {}; } catch { /* not JSON */ }
      const fromSale = (sale.url_params && typeof sale.url_params === "object" ? sale.url_params : {}) as Record<string, any>;
      const param = (k: string) => get(`url_params[${k}]`) || String(blob[k] ?? "") || String(fromSale[k] ?? "");

      const who = await resolveBuyer(sale, plan, { uid: param("uid"), plan: param("plan"), sig: param("sig") });
      if (!who) {
        // paid, but we cannot tell who: keep it for a manual check (the buyer can also press "Sync my purchase")
        await saveUnclaimed(saleId, { plan, email: sale.email, subscriptionId: sale.subscription_id, gotUid: Boolean(param("uid")), askedPlan: param("plan") });
        await logEvent("unclaimed", { saleId, plan, gotUid: Boolean(param("uid")), askedPlan: param("plan") });
        return ok();
      }

      await activatePlan(who.uid, plan, {
        subscriptionId: sale.subscription_id ? String(sale.subscription_id) : undefined,
        saleId,
        email: String(sale.email ?? ""),
        periodMs: periodOf(sale),
        at: Date.parse(String(sale.created_at ?? "")) || Date.now(),
      });
      await logEvent("matched_by", { saleId, how: who.how });
      return ok();
    }

    if (resource === "refunded" || resource === "dispute") {
      const saleId = get("sale_id") || get("id");
      const sale = await fetchSale(saleId);
      if (!(sale.refunded || sale.chargebacked || sale.disputed)) return ok();
      const subId = String(sale.subscription_id ?? "");
      const key = (await uidByKey(subId)) ? subId : saleId;
      const hit = (await uidByKey(subId)) ?? (await uidByKey(saleId));
      if (hit && (await isCurrentPlanKey(hit.uid, key))) await endPlan(hit.uid, resource);
      return ok();
    }

    const subId = get("subscription_id") || get("id");
    if (!subId) return ok();
    const hit = await uidByKey(subId);
    if (!hit) {
      await logEvent("unknown_subscription", { subId, resource });
      return ok();
    }
    // an OLD subscription (for example the Pro you left when you moved to Max) must never touch the plan you have now
    if (!(await isCurrentPlanKey(hit.uid, subId))) {
      await logEvent("ignored_old_subscription", { subId, resource, uid: hit.uid });
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