import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

type Check = { id: string; label: string; ok: boolean; ms?: number; note?: string };

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/**
 * Public health check for the status page and for uptime monitors. It shows only yes/no per part: no keys, no names of secrets,
 * no user data. "Configured" means the setting exists on the server, not that the third party is up.
 */
export async function GET() {
  const checks: Check[] = [];
  const env = process.env;

  const t0 = Date.now();
  try {
    await withTimeout(getAdminDb().collection("ops").doc("ping").get(), 4000);
    checks.push({ id: "database", label: "Database", ok: true, ms: Date.now() - t0 });
  } catch (e) {
    checks.push({ id: "database", label: "Database", ok: false, ms: Date.now() - t0, note: e instanceof Error && e.message === "timeout" ? "Too slow" : "Not reachable" });
  }

  const has = (...k: string[]) => k.every((x) => Boolean(env[x]));
  checks.push({ id: "auth", label: "Sign-in", ok: has("FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"), note: "Server sign-in check" });
  checks.push({ id: "runner", label: "Background agent", ok: (env.ROUTINE_RUNNER_SECRET ?? "").length >= 32, note: "Background runs and schedules" });
  checks.push({ id: "monitoring", label: "Error alerts", ok: Boolean(env.SENTRY_DSN || env.NEXT_PUBLIC_SENTRY_DSN || env.ALERT_WEBHOOK_URL), note: "Sentry or alert webhook set" });
  checks.push({ id: "payments", label: "Agent payments", ok: (env.VENUS_PAYMENTS_MODE ?? "beta") !== "off", note: `Mode: ${(env.VENUS_PAYMENTS_MODE ?? "beta").toLowerCase() === "on" ? "on" : (env.VENUS_PAYMENTS_MODE ?? "beta").toLowerCase() === "off" ? "off" : "beta (every payment needs your approval)"}` });

  const core = checks.filter((c) => ["database", "auth", "runner"].includes(c.id));
  const status = core.every((c) => c.ok) ? "operational" : core.some((c) => c.id === "database" && !c.ok) ? "outage" : "degraded";
  return NextResponse.json({ status, at: Date.now(), checks }, { headers: { "Cache-Control": "no-store" } });
}
