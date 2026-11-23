// Edge middleware: a per-IP flood guard for every /api/* request. It runs before any route code.
// It is deliberately generous (normal use never gets near it) and skips webhooks that prove themselves with signatures
// (Telegram, Slack, Twilio, Gumroad, the meeting bot, cron ticks). The per-user limits live in lib/request.ts.
// Switch it off in an emergency with RATE_LIMIT=off.
import { NextResponse, type NextRequest } from "next/server";
import { clientIp, ipRuleFor, rateLimitOn, retryAfterSeconds, sharedLimiter } from "@/lib/rate-limit";

export const config = { matcher: ["/api/:path*"] };

export function middleware(req: NextRequest) {
  if (!rateLimitOn()) return NextResponse.next();
  const rule = ipRuleFor(req.nextUrl.pathname);
  if (!rule) return NextResponse.next();
  const ip = clientIp(req.headers);
  const h = sharedLimiter().hit(`ip:${ip}:${rule.name}`, rule);
  if (h.ok) return NextResponse.next();
  const secs = retryAfterSeconds(h.retryAfterMs);
  return NextResponse.json(
    { error: `Too many requests from this network. Please wait ${secs} seconds and try again.` },
    { status: 429, headers: { "Retry-After": String(secs), "Cache-Control": "no-store" } }
  );
}
