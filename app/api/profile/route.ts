import { NextResponse } from "next/server";
import { verifyUser } from "@/lib/server-auth";
import { getProfile, saveProfile } from "@/lib/profile-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });
const status = (e: unknown) => (e instanceof Error && /sign in|Session missing|token|auth/i.test(e.message) ? 401 : 400);

export async function GET(req: Request) {
  try {
    const { uid } = await verifyUser(req);
    return NextResponse.json({ profile: await getProfile(uid) });
  } catch (e) { return fail(e instanceof Error ? e.message : "Could not load the profile.", status(e)); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { uid } = await verifyUser(req, body.uid);
    const patch = body.patch && typeof body.patch === "object" ? body.patch : {};
    return NextResponse.json({ profile: await saveProfile(uid, patch) });
  } catch (e) { return fail(e instanceof Error ? e.message : "Could not save.", status(e)); }
}