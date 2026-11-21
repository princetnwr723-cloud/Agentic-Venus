import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { verifyUser } from "@/lib/server-auth";
import { baseUrlOf, resourceUrl } from "@/lib/mcp/oauth-core.ts";
import { listConnections, revokeClient } from "@/lib/mcp/store.ts";

export const runtime = "nodejs";
export const maxDuration = 15;

const fail = (e: unknown) => {
  const m = e instanceof Error ? e.message : "Something went wrong.";
  return NextResponse.json({ error: m }, { status: /session|sign in|token|auth/i.test(m) ? 401 : 500 });
};

/** The "Connect to Claude" page: the address to paste, and the apps that are connected right now. */
export async function GET(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    return NextResponse.json({ url: resourceUrl(baseUrlOf(req)), connections: await listConnections(getAdminDb(), uid) });
  } catch (e) { return fail(e); }
}

/** Disconnect one app: all its tokens stop working at once. */
export async function DELETE(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const clientId = new URL(req.url).searchParams.get("clientId") || "";
    if (!/^mcpc_[A-Za-z0-9_-]{43}$/.test(clientId)) return NextResponse.json({ error: "Bad app id." }, { status: 400 });
    return NextResponse.json({ removed: await revokeClient(getAdminDb(), uid, clientId) });
  } catch (e) { return fail(e); }
}
