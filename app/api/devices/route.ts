import { NextResponse } from "next/server";
import { verifyUser } from "@/lib/server-auth";
import { listDevices, registerDevice, removeDevice } from "@/lib/push-server";

export const runtime = "nodejs";
export const maxDuration = 15;

const fail = (e: unknown) => {
  const m = e instanceof Error ? e.message : "Request failed.";
  return NextResponse.json({ error: m }, { status: /session|sign in|token|auth/i.test(m) ? 401 : 500 });
};
const okToken = (t: unknown): t is string => typeof t === "string" && t.length >= 40 && t.length <= 4096;

export async function GET(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    return NextResponse.json({ devices: await listDevices(uid) });
  } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const b = (await req.json().catch(() => ({}))) as { token?: unknown; name?: unknown; appVersion?: unknown };
    if (!okToken(b.token)) return NextResponse.json({ error: "Bad token." }, { status: 400 });
    await registerDevice(uid, b.token, String(b.name ?? ""), String(b.appVersion ?? ""));
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    const b = (await req.json().catch(() => ({}))) as { token?: unknown };
    if (!okToken(b.token)) return NextResponse.json({ error: "Bad token." }, { status: 400 });
    await removeDevice(uid, b.token);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}