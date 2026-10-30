import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { getOAuthProvider } from "@/lib/tools/oauth-catalog";
import { buildOAuthUrl } from "@/lib/tools/oauth-begin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const b = await readBody(req);
    const provider = getOAuthProvider(String(b.provider || ""));
    const chatId = String(b.chatId || "");
    if (!provider) return NextResponse.json({ ok: false, error: "Unsupported OAuth provider." }, { status: 400 });
    if (!/^[A-Za-z0-9_-]{4,160}$/.test(chatId)) return NextResponse.json({ ok: false, error: "Valid chatId is required." }, { status: 400 });
    const hint = String(b.hint || "").trim().toLowerCase().slice(0, 120);
    if (hint && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hint)) return NextResponse.json({ ok: false, error: "Enter a valid email address, or leave the account field empty." }, { status: 400 });
    if (!process.env[provider.clientIdEnv]) return NextResponse.json({ ok: false, error: `Server setup required: ${provider.clientIdEnv} is missing in Vercel.` }, { status: 503 });
    const redirectUri = process.env.OAUTH_REDIRECT_URI || new URL("/api/connectors/oauth/callback", req.url).toString();
    const url = buildOAuthUrl({ uid: String(b.uid), chatId, providerId: provider.id, redirectUri, hint });
    return NextResponse.json({ ok: true, url });
  } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "OAuth start failed." }, { status: requestStatus(e) }); }
}
