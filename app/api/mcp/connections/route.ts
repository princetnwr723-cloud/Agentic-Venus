import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { verifyUser } from "@/lib/server-auth";
import { baseUrlOf, resourceUrl } from "@/lib/mcp/oauth-core.ts";
import { listConnections, revokeClient, setClientWrite } from "@/lib/mcp/store.ts";

export const runtime = "nodejs";
export const maxDuration = 15;

const CLIENT_ID = /^mcpc_[A-Za-z0-9_-]{43}$/;

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

/** Turn "Actions" ON or OFF for one connected app, without disconnecting it. Body: { clientId, write: boolean } */
export async function PATCH(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const b = (await req.json().catch(() => ({}))) as { clientId?: unknown; write?: unknown };
    if (typeof b.clientId !== "string" || !CLIENT_ID.test(b.clientId)) return NextResponse.json({ error: "Bad app id." }, { status: 400 });
    if (typeof b.write !== "boolean") return NextResponse.json({ error: "write must be true or false." }, { status: 400 });
    const changed = await setClientWrite(getAdminDb(), uid, b.clientId, b.write);
    if (!changed) return NextResponse.json({ error: "This app is not connected any more. Connect it again from Claude." }, { status: 404 });
    return NextResponse.json({ write: b.write, changed });
  } catch (e) { return fail(e); }
}

/** Disconnect one app: all its tokens stop working at once. */
export async function DELETE(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const clientId = new URL(req.url).searchParams.get("clientId") || "";
    if (!CLIENT_ID.test(clientId)) return NextResponse.json({ error: "Bad app id." }, { status: 400 });
    return NextResponse.json({ removed: await revokeClient(getAdminDb(), uid, clientId) });
  } catch (e) { return fail(e); }
}
