import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveDeep, vaultDelete, vaultGet, vaultPut } from "@/lib/vault";
import { connect, exec } from "@/lib/e2b-server";
import { writeFiles } from "@/lib/venus-server";
import { brandOf, hostMatches, luhn, maskUser, normSite, totp, type VpKind, type VpMeta } from "@/lib/vpassword";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (m: string, st = 500) => NextResponse.json({ error: m }, { status: st });
const ID = /^[A-Za-z0-9_-]{1,60}$/;
const s = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
// a running task may only list and use what you allowed; you (the user) can never read a secret back
const JOB_ACTIONS = new Set(["catalog", "reveal"]);

const CAPTURE = `import {chromium} from "playwright-core";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222", {timeout: 8000});
const ctx = b.contexts()[0];
const cookies = ctx ? await ctx.cookies() : [];
console.log("@@COOKIES" + JSON.stringify(cookies));
process.exit(0);
`;

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => ({}));
    const auth = await authFromRequest(req, raw?.uid);
    const uid = auth.uid;
    const body = (await resolveDeep(uid, raw)) as Record<string, any